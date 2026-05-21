import { AppConfig } from "../config.js";
import type { AudioAsset, EventLog, LanguageModelContent, LanguageModelPrompt, LanguageModelSession, PromptRun, RepairAttempt } from "../types.js";
import { BenchmarkService } from "../services/benchmark-service.js";
import { StorageService } from "../services/storage-service.js";
import { ReportService } from "../services/report-service.js";
import { LanguageModelService } from "../services/language-model-service.js";
import { AudioService } from "../services/audio-service.js";
import { AppStore } from "../store/app-store.js";
import { JsonTools } from "../utils/json-tools.js";
import { TokenEstimator } from "../utils/token-estimator.js";
import { DefaultDataset } from "../data/default-dataset.js";
import { audioBufferToWav } from "../utils/wav-encoder.js";
import { TranscriptMerger } from "../utils/transcript-merger.js";
import { BootstrapMerger } from "../services/bootstrap-merger.js";

export class PipelineEngine {
  readonly storage = new StorageService();
  readonly benchmark = new BenchmarkService(this.storage);
  readonly model = new LanguageModelService();
  readonly audio = new AudioService();
  readonly bootstrap = new BootstrapMerger();
  readonly reports = new ReportService(this.storage, () => {
    const state = this.store.get();
    const caseId = state.currentTestCase?.id;
    let expectedTranscript = state.expectedTranscript || "";
    let expectedCode = state.currentTestCase?.expectedCode ?? "";

    if (caseId) {
      const merged = this.bootstrap.getMerged(caseId);
      if (merged) {
        if (!expectedTranscript) expectedTranscript = merged.transcript;
        if (!expectedCode) expectedCode = merged.code;
      }
    }

    return {
      sessionMode: state.sessionMode,
      promptVersion: state.dynamicPromptVersion || AppConfig.promptVersion,
      metrics: state.latestMetrics,
      rawOutput: state.rawOutputText || "",
      expectedTranscript,
      expectedCode,
      testCase: state.currentTestCase
        ? { id: state.currentTestCase.id, fileName: state.currentTestCase.fileName }
        : null,
      events: state.events,
    };
  });

  private typingIntervalId: number | null = null;
  private audioTranscriptionPromise: Promise<void> | null = null;
  private audioTranscriptionRequestId = 0;
  private asrBridgeUrl: string | null = null;

  private pipelineTrace: {
    originalAsr: string;
    correctedAsr: string;
    audioPassConfidence?: number;
    audioPassReasoning?: string;
    audioPassRawResponse?: string;
    mergeDiff?: string;
    codeSketch: string;
    codeNotes: string[];
  } | null = null;

  private streamingSession: LanguageModelSession | null = null;
  private streamingAppendQueue: Promise<void> = Promise.resolve();

  constructor(private readonly store: AppStore) {}

  private log(type: string, data: Record<string, unknown> = {}): void {
    const item: EventLog = { at: new Date().toISOString(), type, data };
    this.store.addEvent(item);
    if (!this.shouldRefreshLatestReport()) return;
    const report = this.reports.build();
    this.store.update({ latestReport: report });
    this.reports.persistLast(report);
  }

  private shouldRefreshLatestReport(): boolean {
    const state = this.store.get();
    if (!state.isPromptRunning) return true;

    const rawOutput = (state.rawOutputText ?? "").trim();
    if (!rawOutput || rawOutput === "Esperando respuesta...") return false;

    return true;
  }

  private setStatus(text: string, kind = ""): void {
    this.store.update({ statusText: text, statusKind: kind });
    this.log("status", { text, kind });
  }

  async initializeModel(): Promise<void> {
    const state = this.store.get();
    if (state.isInitializing || this.model.hasSession) return;
    this.store.update({ isInitializing: true });
    try {
      await this.model.initialize(
        (text, kind = "") => this.setStatus(text, kind),
        (type, data = {}) => this.log(type, data),
      );
      this.store.update({ sessionMode: this.model.sessionMode });
    } catch (error) {
      this.setStatus("No disponible", "bad");
      this.log("model-init-error", { message: (error as Error).message, stack: (error as Error).stack });
    } finally {
      this.store.update({ isInitializing: false });
    }
  }

  async resetModelSession(): Promise<void> {
    await this.model.getSessionManager().resetBaseSession();
  }

  async startRecording(delegate: import("../services/audio-service.js").AudioViewDelegate, lang = "es-AR"): Promise<void> {
    await this.initializeModel();
    if (!this.model.hasSession) return;

    if (this.typingIntervalId !== null) {
      clearInterval(this.typingIntervalId);
      this.typingIntervalId = null;
    }
    this.audioTranscriptionRequestId += 1;
    this.audioTranscriptionPromise = null;
    if (this.streamingSession) {
      try { (this.streamingSession as any).destroy?.(); } catch {}
      this.streamingSession = null;
    }
    this.streamingAppendQueue = Promise.resolve();

    try {
      this.store.update({ currentTestCase: null, expectedTranscript: "", manualTranscript: "" });

      // Clone session for streaming audio chunks during recording
      const baseSession = this.model.getSessionManager().getBaseSession();
      if (baseSession && typeof baseSession.clone === "function") {
        this.streamingSession = await baseSession.clone();
        this.log("streaming-session-created", {});
      }

      const streamingDelegate: import("../services/audio-service.js").AudioViewDelegate = {
        ...delegate,
        onAudioProgress: (partialBlob: Blob, elapsedMs: number) => {
          if (!this.streamingSession) return;
          this.streamingAppendQueue = this.streamingAppendQueue.then(async () => {
            try {
              const content: LanguageModelContent[] = [
                { type: "audio", value: partialBlob },
                { type: "text", value: `[Audio chunk at ${elapsedMs}ms — continue listening]` },
              ];
              const prompt: LanguageModelPrompt = [{ role: "user", content }];
              if (typeof (this.streamingSession as any).append === "function") {
                await (this.streamingSession as any).append(prompt);
                this.log("streaming-chunk-appended", { elapsedMs, size: partialBlob.size });
              }
            } catch (err) {
              this.log("streaming-chunk-error", { elapsedMs, error: (err as Error).message });
            }
          });
        },
      };

      await this.audio.start(streamingDelegate, (type, data = {}) => this.log(type, data), lang);
    } catch (error) {
      this.store.update({ audioStateText: "No se pudo usar el microfono" });
      this.log("recording-error", { message: (error as Error).message, stack: (error as Error).stack });
    }
  }

  async stopRecording(): Promise<void> {
    this.audio.stop((type, data = {}) => this.log(type, data));

    // Wait for any in-flight streaming appends to complete
    await this.streamingAppendQueue;
    this.log("streaming-queue-drained", { sessionAlive: Boolean(this.streamingSession) });
    
    this.store.update({
      audioStateText: "Finalizando transcripción...",
      isTranscribingAudio: true,
    });
    this.setStatus("Esperando transcripción final en vivo...");

    const liveTranscript = await this.audio.waitForRecognitionFinished(2000) || "";
    if (liveTranscript.trim().length > 0) {
      // Use the live SpeechRecognition transcript directly, avoiding slow redundant re-transcription!
      this.store.update({
        audioStateText: "Grabacion lista (Live transcript)",
        manualTranscript: liveTranscript,
        manualTranscriptEs: liveTranscript,
        manualTranscriptEn: "",
        isTranscribingAudio: false,
      });
      this.log("recording-live-transcribed", { chars: liveTranscript.length });
      this.startTypingAnimation(liveTranscript, "Transcripción en vivo lista");
    } else {
      // Fallback: If live transcript is empty/silent, probe Python ASR
      this.store.update({
        audioStateText: "Procesando audio...",
        expectedTranscript: "",
        manualTranscript: "",
        isTranscribingAudio: true,
      });
      this.setStatus("Transcribiendo grabacion con Google ASR...");
      await this.transcribeRecordedAudio();
    }
  }


  private async transcribeRecordedAudio(): Promise<void> {
    const requestId = ++this.audioTranscriptionRequestId;
    this.audioTranscriptionPromise = this.audio.waitForRecordingReady()
      .then(async (asset) => {
        if (requestId !== this.audioTranscriptionRequestId) return;
        if (!asset?.blob) throw new Error("No hay audio grabado para transcribir");
        const file = new File([asset.blob], "grabacion.webm", { type: asset.blob.type || "audio/webm" });
        const result = await this.transcribeAudioFile(file);
        if (requestId !== this.audioTranscriptionRequestId) return;
        this.store.update({
          audioStateText: "Grabacion lista e indexada con ASR",
          manualTranscript: result.transcript,
          manualTranscriptEs: result.transcriptEs,
          manualTranscriptEn: result.transcriptEn,
        });
        this.log("recording-transcribed", { chars: result.transcript.length });
        this.startTypingAnimation(result.transcript);
      })
      .catch((error) => {
        if (requestId !== this.audioTranscriptionRequestId) return;
        this.log("recording-transcribe-error", { message: (error as Error).message });
        this.store.update({
          expectedTranscript: "",
          manualTranscript: "",
          isTranscribingAudio: false,
          audioStateText: "Grabacion lista, pero Google ASR fallo",
        });
        this.setStatus("Google ASR requerido para grabacion", "bad");
      })
      .finally(() => {
        if (requestId === this.audioTranscriptionRequestId) {
          this.audioTranscriptionPromise = null;
        }
      });
  }

  loadAudioFile(file: File, delegate: import("../services/audio-service.js").AudioViewDelegate): void {
    if (this.typingIntervalId !== null) {
      clearInterval(this.typingIntervalId);
      this.typingIntervalId = null;
    }

    const testCase = DefaultDataset.cases.find((tc) => tc.fileName === file.name);
    if (testCase) {
      this.store.update({ currentTestCase: testCase });
    } else {
      this.store.update({ currentTestCase: null });
    }

    this.store.update({
      expectedTranscript: "", // clear visual text so loading indicator renders
      manualTranscript: "",
      isTranscribingAudio: true,
      audioStateText: "Transcribiendo archivo de audio..."
    });
    this.setStatus("Transcribiendo con Google ASR...");

    this.audio.loadFile(file, delegate, (type, data = {}) => this.log(type, data));
    const transcriptionRequestId = ++this.audioTranscriptionRequestId;
    
    this.audioTranscriptionPromise = this.transcribeAudioFile(file)
      .then((result) => {
        if (transcriptionRequestId !== this.audioTranscriptionRequestId) return;
        this.store.update({
          audioStateText: `Audio listo e indexado con ASR`,
          manualTranscript: result.transcript,
          manualTranscriptEs: result.transcriptEs,
          manualTranscriptEn: result.transcriptEn,
        });
        this.log("audio-file-transcribed", { name: file.name, chars: result.transcript.length });
        this.startTypingAnimation(result.transcript);
      })
      .catch((error) => {
        if (transcriptionRequestId !== this.audioTranscriptionRequestId) return;
        this.log("audio-file-transcribe-error", { name: file.name, message: (error as Error).message });
        
        this.store.update({
          expectedTranscript: "",
          manualTranscript: "",
          isTranscribingAudio: false,
          audioStateText: "Audio listo, pero Google ASR fallo"
        });
        this.setStatus("Google ASR requerido: inicia npm run asr o asr:5501", "bad");
      })
      .finally(() => {
        if (transcriptionRequestId === this.audioTranscriptionRequestId) {
          this.audioTranscriptionPromise = null;
        }
      });
  }

  private startTypingAnimation(transcript: string, successStatus = "Transcripción ASR lista"): void {
    if (this.typingIntervalId !== null) {
      clearInterval(this.typingIntervalId);
      this.typingIntervalId = null;
    }

    const words = transcript.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      this.store.update({
        expectedTranscript: "",
        isTranscribingAudio: false
      });
      this.setStatus(successStatus, "ready");
      return;
    }

    // Calcular el intervalo dinámico para un flujo premium y orgánico
    const interval = Math.max(25, Math.min(100, 2000 / words.length));
    let currentIndex = 0;
    let currentText = "";

    this.store.update({
      isTranscribingAudio: true,
      expectedTranscript: ""
    });

    this.typingIntervalId = window.setInterval(() => {
      if (currentIndex >= words.length) {
        if (this.typingIntervalId !== null) {
          clearInterval(this.typingIntervalId);
          this.typingIntervalId = null;
        }
        this.store.update({
          expectedTranscript: transcript, // set complete, absolute final transcript
          isTranscribingAudio: false
        });
        this.setStatus(successStatus, "ready");
      } else {
        currentText = currentText ? `${currentText} ${words[currentIndex]}` : words[currentIndex];
        this.store.update({ expectedTranscript: currentText });
        currentIndex++;
      }
    }, interval);
  }

  async transcribeAudioFile(file: File): Promise<{ transcript: string; transcriptEs?: string; transcriptEn?: string }> {
    const asrBridgeUrl = await this.resolveDuckSugarAsrBridge();

    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) throw new Error("AudioContext no soportado");
    
    const context = new AudioContextCtor();
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await context.decodeAudioData(arrayBuffer);
      const wavBlob = audioBufferToWav(audioBuffer);
      
      const response = await fetch(`${asrBridgeUrl}/transcribe`, {
        method: "POST",
        body: wavBlob,
        headers: {
          "Content-Type": "audio/wav"
        }
      });
      
      if (!response.ok) {
        throw new Error(`Error en endpoint Google ASR: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Error de transcripción desconocido");
      }
      
      return {
        transcript: data.transcript || "",
        transcriptEs: data.transcript_es || "",
        transcriptEn: data.transcript_en || "",
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  private async resolveDuckSugarAsrBridge(): Promise<string> {
    const candidates = this.asrBridgeCandidates();
    const failures: string[] = [];

    for (const candidate of candidates) {
      const bridgeUrl = this.normalizeBridgeUrl(candidate);
      if (!bridgeUrl) continue;

      try {
        const response = await this.fetchWithTimeout(`${bridgeUrl}/health`, { method: "GET", cache: "no-store" }, 2500);
        if (!response.ok) {
          failures.push(`${bridgeUrl}: HTTP ${response.status}`);
          continue;
        }

        let data: unknown;
        try {
          data = await response.json();
        } catch {
          failures.push(`${bridgeUrl}: /health no devolvio JSON`);
          continue;
        }

        const health = data as { success?: unknown; service?: unknown; asr?: unknown; port?: unknown };
        if (health.success === true && health.service === "ducksugar" && health.asr === "google") {
          if (this.asrBridgeUrl !== bridgeUrl) {
            this.log("asr-bridge-selected", {
              url: bridgeUrl,
              appOrigin: window.location.origin,
              sameOrigin: bridgeUrl === window.location.origin,
              port: health.port ?? null,
            });
          }
          this.asrBridgeUrl = bridgeUrl;
          return bridgeUrl;
        }

        failures.push(`${bridgeUrl}: no es DuckSugar ASR`);
      } catch (error) {
        failures.push(`${bridgeUrl}: ${(error as Error).message}`);
      }
    }

    this.asrBridgeUrl = null;
    throw new Error([
      "No se encontro el puente ASR local de DuckSugar.",
      `App actual: ${window.location.origin}.`,
      `Puertos probados: ${candidates.join(", ")}.`,
      failures.length ? `Detalles: ${failures.join(" | ")}.` : "",
      "Inicia el puente con `npm run asr` o `npm run asr:5501` y vuelve a cargar el audio.",
    ].filter(Boolean).join(" "));
  }

  private asrBridgeCandidates(): string[] {
    const candidates: string[] = [];
    const add = (value: unknown) => {
      if (typeof value !== "string" || !value.trim()) return;
      if (!candidates.includes(value.trim())) candidates.push(value.trim());
    };

    add(this.asrBridgeUrl);

    try {
      add(new URLSearchParams(window.location.search).get("asr"));
    } catch {
      // Ignore invalid location/search access in unusual browser contexts.
    }

    try {
      add(window.localStorage.getItem("ducksugarAsrBridgeUrl"));
    } catch {
      // localStorage can be disabled; probing defaults is enough.
    }

    add((window as any).DUCKSUGAR_ASR_BRIDGE_URL);
    add(window.location.origin);
    add("http://127.0.0.1:5500");
    add("http://127.0.0.1:5501");
    add("http://127.0.0.1:5510");
    return candidates;
  }

  private normalizeBridgeUrl(value: string): string | null {
    try {
      const url = new URL(value);
      return url.origin;
    } catch {
      return null;
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async sendAudio(instructionText: string, useStreaming: boolean, onChunk: (text: string) => void, langSelectCode?: string): Promise<boolean> {
    const startedAt = performance.now();
    this.pipelineTrace = null;
    let asset = this.audio.asset;
    if (!asset) {
      this.setStatus("Sin audio", "bad");
      this.recordBenchmarkFailure(null, useStreaming, "missing-audio", "Sin audio", startedAt);
      return false;
    }
    await this.audio.waitForDurationReady();
    asset = this.audio.asset;
    if (!asset) {
      this.setStatus("Sin audio", "bad");
      this.recordBenchmarkFailure(null, useStreaming, "missing-audio", "Sin audio", startedAt);
      return false;
    }
    await this.initializeModel();
    if (!this.model.hasSession) {
      this.setStatus("Modelo no disponible", "bad");
      this.log("send-blocked", { reason: "missing-session" });
      this.recordBenchmarkFailure(asset, useStreaming, "missing-session", "Modelo no disponible", startedAt);
      return false;
    }

    let state = this.store.get();
    if (state.isTranscribingAudio && !state.manualTranscript?.trim() && this.audioTranscriptionPromise) {
      this.setStatus("Esperando Google ASR...");
      await this.audioTranscriptionPromise;
      state = this.store.get();
    }

    let transcription = "";
    let transcriptionSource = "none";
    if (state.manualTranscript && state.manualTranscript.trim().length > 0) {
      transcription = state.manualTranscript.trim();
      transcriptionSource = "google_asr";
    } else if (this.audio.micTranscription && this.audio.micTranscription.trim().length > 0) {
      transcription = this.audio.micTranscription.trim();
      transcriptionSource = "mic";
    }

    if (!transcription) {
      this.setStatus("ASR Google requerido", "bad");
      this.store.update({
        rawOutputText: [
          "No hay transcripcion ASR disponible.",
          "",
          "DuckSugar no va a usar Chrome Nano como transcriptor para archivos nuevos.",
          "Inicia el puente ASR con `npm run asr` o `npm run asr:5501` y vuelve a cargar el audio."
        ].join("\n"),
        parsedResponse: null
      });
      this.log("send-blocked", { reason: "missing-google-asr-transcription" });
      this.recordBenchmarkFailure(asset, useStreaming, "missing-google-asr-transcription", "Falta transcripcion de Google ASR", startedAt);
      return false;
    }

    // Skip Audio Pass for long audio (>20s) — Main Pass hears audio directly, timeout wastes time
    const skipAudioPass = (asset.durationMs ?? 0) > 20000;
    let modelTranscription: any = null;
    if (skipAudioPass) {
      this.log("audio-transcription-skip", { reason: "audio-longer-than-20s", durationMs: asset.durationMs });
    } else {
      this.setStatus("Ajustando transcripcion ASR...");
      modelTranscription = await this.model.runAudioTranscription({
        audioBlob: asset.blob,
        asrTranscript: transcription,
        audioDurationMs: asset.durationMs,
      });
    }

    let correctedTranscript = transcription;
    const originalAsr = transcription;
    let mergeDiff: string | undefined;
    if (!modelTranscription) {
      this.log("audio-transcription-skip", { reason: "no-result-from-model" });
    } else if (modelTranscription.error) {
      this.log("audio-transcription-skip", { reason: modelTranscription.error });
    } else if (!modelTranscription.transcript) {
      this.log("audio-transcription-skip", { reason: "empty-transcript" });
    } else {
      this.log("audio-transcription-result", {
        correctionsCount: modelTranscription.phonetic_corrections?.length ?? 0,
        confidences: modelTranscription.phonetic_corrections?.map((c: any) => c.confidence ?? c),
        transcriptLength: modelTranscription.transcript.length,
        confidence: modelTranscription.confidence,
        reasoning: modelTranscription.reasoning?.slice(0, 200),
        rawResponse: modelTranscription.rawResponse,
      });
      const merger = new TranscriptMerger();
      const mergeResult = merger.merge(transcription, modelTranscription);
      correctedTranscript = mergeResult.transcript;
      if (mergeResult.correctionsApplied.length > 0) {
        this.log("audio-transcription-merged", {
          before: transcription,
          after: correctedTranscript,
          correctionsApplied: mergeResult.correctionsApplied,
        });
        mergeDiff = mergeResult.correctionsApplied.join(" | ");
      }
    }

    // Use corrected transcript from here on
    transcription = correctedTranscript;

    // Duck Empathy Engine: Calculate WPM, volume dynamics, pause ratio
    const durationMs = asset.durationMs || this.audio.recordedDurationMs || 1000;
    const durationSeconds = durationMs / 1000;
    const wordsCount = transcription.split(/\s+/).filter(Boolean).length;
    const wpm = durationSeconds > 0 ? Math.round((wordsCount / durationSeconds) * 60) : 0;

    const volumeHistory = this.audio.recordedVolumeHistory;
    let avgVolume = 0;
    let volumeVariance = 0;
    let volumeStdDev = 0;
    let pauseRatio = 0;

    if (volumeHistory.length > 0) {
      const sum = volumeHistory.reduce((a, b) => a + b, 0);
      avgVolume = sum / volumeHistory.length;
      
      const sqDiffSum = volumeHistory.reduce((a, b) => a + Math.pow(b - avgVolume, 2), 0);
      volumeVariance = sqDiffSum / volumeHistory.length;
      volumeStdDev = Math.sqrt(volumeVariance);

      pauseRatio = this.audio.silencePauseCount / volumeHistory.length;
    }

    let detectedMood: "calm" | "focus" | "tired" | "frustrated" = "calm";
    if ((wpm > 170 && volumeStdDev > 0.08) || wpm > 190) {
      detectedMood = "frustrated";
    } else if (wpm < 90 || pauseRatio > 0.35) {
      detectedMood = "tired";
    } else if (wpm >= 120 && wpm <= 170 && volumeStdDev < 0.05) {
      detectedMood = "focus";
    }

    // Calcular versión de prompt dinámica
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const dynamicPromptVersion = `${AppConfig.promptVersion} [${day}/${month} ${hours}:${minutes}]`;

    this.store.update({
      isPromptRunning: true,
      rawOutputText: "Esperando respuesta...",
      parsedResponse: null,
      dynamicPromptVersion,
      detectedEmpathyMood: detectedMood,
      empathyWpm: wpm,
    });
    this.setStatus("Modelo escuchando y analizando audio...");

    const contextHint = state.currentTestCase?.contextHint?.trim();
    
    // Detect code patterns + infer code sketch from ASR transcript
    const { SpeechNormalizer } = await import("../utils/speech-normalizer.js");
    const codeDetected = SpeechNormalizer.hasCodePatterns(transcription, contextHint);
    const codeSketch = SpeechNormalizer.inferCodeFromSpeech(transcription, contextHint);
    const codeNotes = SpeechNormalizer.buildCodeNotes(transcription, contextHint);

    // Save pipeline trace for display in AcoCoT card
    this.pipelineTrace = {
      originalAsr,
      correctedAsr: transcription,
      audioPassConfidence: modelTranscription?.confidence,
      audioPassReasoning: modelTranscription?.reasoning,
      audioPassRawResponse: modelTranscription?.rawResponse,
      mergeDiff,
      codeSketch: codeSketch.code,
      codeNotes,
    };
    console.log("[Pipeline Trace]", {
      originalAsr,
      correctedAsr: transcription,
      mergeDiff,
      audioPassConfidence: modelTranscription?.confidence,
      audioPassReasoning: modelTranscription?.reasoning?.slice(0, 200),
      audioPassRawResponse: modelTranscription?.rawResponse,
      codeSketch: codeSketch.code,
      codeNotes,
    });
    this.log("pipeline-trace", {
      originalAsr,
      correctedAsr: transcription,
      mergeDiff,
      audioPassConfidence: modelTranscription?.confidence,
      audioPassReasoning: modelTranscription?.reasoning?.slice(0, 200),
      codeSketch: codeSketch.code,
      codeNotes,
    });

    let codeSketchBlock = "";
    if (codeDetected) {
      codeSketchBlock = [
        "[CODE DETECTED] The ASR transcript contains code identifiers and/or spoken punctuation. You MUST generate the reconstructed code in the \"code\" field.",
        codeSketch.code
          ? `[CODE SKETCH] Possible code inferred from speech:\n${codeSketch.code}\n[END CODE SKETCH]\nUse this as a starting point, verify and improve the syntax.`
          : "[CODE SKETCH] No reliable sketch could be inferred, but code patterns were detected in the transcript. Analyze the transcript carefully and reconstruct the code.",
        codeNotes.length
          ? `[CODE NOTES]\n${codeNotes.map((note) => `- ${note}`).join("\n")}\n[END CODE NOTES]`
          : "",
        "CRITICAL: Empty \"code\" field when code identifiers are detected in the transcript is a FAILURE. You MUST output reconstructed code in the \"code\" field."
      ].filter(Boolean).join("\n\n");
    } else if (codeSketch.code) {
      codeSketchBlock = [
        `[CODE SKETCH] Possible code inferred from speech:\n${codeSketch.code}\n[END CODE SKETCH]\nUse this as a starting point, verify and improve the syntax.`,
        codeNotes.length ? `[CODE NOTES]\n${codeNotes.map((note) => `- ${note}`).join("\n")}\n[END CODE NOTES]` : "",
      ].filter(Boolean).join("\n\n");
    }
    
    const textContent = [
      `Additional user instruction:\n${instructionText.trim()}`,
      contextHint
        ? [
            "IDE context available for this test:",
            contextHint,
          ].join("\n")
        : "",
      codeSketchBlock,
    ].filter(Boolean).join("\n\n");

    // Detect transcription language to force answer language while keeping scratchpad in English
    const currentLang = langSelectCode || "es-AR";
    const isSpanish = currentLang.toLowerCase().startsWith("es") || 
      /^(hola|cómo|como|estás|estas|necesito|bueno|tengo|pregunta|por|qué|que|cuando|donde|después|despues|mencionaste|correcciones|notas)/i.test(transcription);
    const responseLanguage = isSpanish ? "Spanish" : "English";

    let asrBlock = `[AUDIO TRANSCRIBED BY ASR]: ${transcription}`;
    if (state.manualTranscriptEs || state.manualTranscriptEn) {
      asrBlock = [
        "[AUDIO TRANSCRIBED BY ASR]:",
        state.manualTranscriptEs ? `- Spanish ASR (es-AR): ${state.manualTranscriptEs.trim()}` : "",
        state.manualTranscriptEn ? `- English ASR (en-US): ${state.manualTranscriptEn.trim()}` : "",
        `- Primary / Combined: ${transcription}`
      ].filter(Boolean).join("\n");
    }

    // Wait for streaming appends to finish before preparing prompt
    const hasStreamingAudio = Boolean(this.streamingSession);
    if (hasStreamingAudio) {
      await this.streamingAppendQueue;
      this.log("streaming-ready", {});
    }

    const audioContent: LanguageModelContent[] = hasStreamingAudio
      ? []
      : [{ type: "audio" as const, value: asset.blob }];

    const audioInstruction = hasStreamingAudio
      ? "[STREAMING AUDIO] Audio was streamed during recording and is already in the session context. The ASR transcript below is your base text — verify it against what you heard."
      : "[AUDIO + ASR] The audio is attached above. Read the ASR transcript below as your base text — it's the primary transcription. Listen to the audio to verify: if the ASR misheard something (e.g., 'comisa' instead of 'comilla', 'Sprint F' instead of 'printf'), correct it. Think of it as reading a draft while someone dictates: you read, you hear, you catch mismatches.";

    const prompt: LanguageModelPrompt = [
      {
        role: "user",
        content: [
          ...audioContent,
          { type: "text", value: `[Acoustic State: ${detectedMood}] [Audio Attached — listen to audio alongside ASR] [Response Language: ${responseLanguage}] (Speech Pace: ${wpm} WPM, Volume Dynamics: ${volumeStdDev.toFixed(3)}, Pause Ratio: ${(pauseRatio * 100).toFixed(1)}%)\n\n${audioInstruction}\n\n${textContent}` },
          { type: "text", value: asrBlock },
        ],
      },
    ];

    // Detect short audio or high silence ratio — flag for self-refinement
    const isShortAudio = durationMs < 5000;
    const isSilentAudio = pauseRatio > 0.5 || (volumeHistory.length > 0 && volumeStdDev < 0.01);
    if (isShortAudio || isSilentAudio) {
      this.log("short-or-silent-audio-detected", {
        durationMs,
        pauseRatio,
        volumeStdDev,
        isShortAudio,
        isSilentAudio,
      });
    }

    this.log("prompt-send", {
      mode: this.model.sessionMode,
      audioType: asset.blob.type,
      audioSize: asset.blob.size,
      useStreaming,
      instruction: instructionText,
      transcriptionSource,
      dynamicPromptVersion,
      detectedEmpathyMood: detectedMood,
      empathyWpm: wpm,
      volumeStdDev,
      pauseRatio,
      contextHint: contextHint ? { testCaseId: state.currentTestCase?.id, chars: contextHint.length } : null,
      codeSketchProvided: Boolean(codeSketch.code),
      codeNotes,
      audioInPrompt: !hasStreamingAudio,
      streamingAudio: hasStreamingAudio,
    });

    try {
      const run = await this.model.runAudioPrompt({
        prompt,
        useStreaming,
        onChunk: (text) => {
          this.store.update({ rawOutputText: text });
          onChunk(text);
        },
        audioDurationMs: asset.durationMs,
        codeDetected,
        sourceTranscript: transcription,
        localCodeSketch: codeSketch.code,
        localCodeTags: codeSketch.tags,
        existingSession: this.streamingSession ?? undefined,
      });
      this.finishRun(asset, run);
      return true;
    } catch (error) {
      this.setStatus("Error al consultar", "bad");
      const message = (error as Error).message;
      this.store.update({ rawOutputText: message });
      this.log("prompt-error", { message, stack: (error as Error).stack });
      this.recordBenchmarkFailure(asset, useStreaming, "prompt-error", message, startedAt);
      return false;
    } finally {
      this.store.update({ isPromptRunning: false });
      this.streamingSession = null; // destroyed by runAudioPrompt's finally block
    }
  }

  private recordBenchmarkFailure(
    asset: AudioAsset | null,
    useStreaming: boolean,
    reason: string,
    message: string,
    startedAt: number,
  ): void {
    if (!this.store.get().isBenchmarkRunning) return;

    const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
    const rawOutputText = `[benchmark_failed:${reason}] ${message}`;
    const outputEstimate = TokenEstimator.estimate(rawOutputText);
    const generationWindowMs = Math.max(1, elapsedMs || 1);

    const metrics = {
      usedStreaming: useStreaming,
      totalMs: elapsedMs,
      firstChunkMs: null,
      generationWindowMs,
      chunkCount: 0,
      repairPassMs: null,
      repairAttemptCount: 0,
      repairReasons: {},
      repairAttempts: [],
      fallbackUsed: false,
      outputChars: outputEstimate.chars,
      outputWords: outputEstimate.words,
      outputTokensApprox: outputEstimate.estimatedTokensByChars,
      outputTokensApproxByWords: outputEstimate.estimatedTokensByWords,
      contentTokensApprox: 0,
      tokensPerSecond: outputEstimate.estimatedTokensByChars / (generationWindowMs / 1000),
      charsPerSecond: outputEstimate.chars / (generationWindowMs / 1000),
      contentTokensPerSecond: 0,
      audioDurationMs: asset?.durationMs ?? null,
      audioSize: asset?.blob.size ?? null,
      audioType: asset?.blob.type ?? null,
      contextUsage: null,
      sessionShape: this.model.shape(),
      truncated: false,
      truncatedReason: null,
      outputTail: rawOutputText,
    };

    this.store.update({
      latestMetrics: metrics,
      rawOutputText,
      parsedResponse: null,
    });

    const report = this.reports.build();
    this.store.update({ latestReport: report });
    this.reports.persistLast(report);
    this.reports.saveHistory(report);
    this.benchmark.add(report);
    this.store.update({ benchmarkEntries: this.benchmark.read() });
    this.log("benchmark-run-recorded-failed", { reason, message, elapsedMs });
  }

  private finishRun(
    asset: AudioAsset,
    run: {
      firstPass: PromptRun;
      response: string;
      repairPassMs: number | null;
      repairAttempts: RepairAttempt[];
      fallbackUsed: boolean;
      contextUsage: unknown;
      sessionShape: import("../types.js").SessionShape | null;
    },
  ): void {
    const elapsedMs = run.firstPass.elapsedMs + (run.repairPassMs ?? 0);
    const outputEstimate = TokenEstimator.estimate(run.response);
    const generationWindowMs = run.firstPass.firstChunkMs === null ? elapsedMs : Math.max(1, elapsedMs - run.firstPass.firstChunkMs);

    const parsed = JsonTools.extractResponse(run.response) ?? {};
    if (parsed && this.pipelineTrace) {
      const trace = this.pipelineTrace;
      const parts: string[] = ["━━━ Pipeline Trace ━━━"];
      if (trace.mergeDiff) {
        parts.push(`[Merge] ${trace.mergeDiff}`);
      }
      if (trace.audioPassConfidence !== undefined) {
        parts.push(`[Audio Pass] confidence: ${trace.audioPassConfidence}, reasoning: ${(trace.audioPassReasoning ?? "").slice(0, 150)}`);
      }
      if (trace.audioPassRawResponse) {
        const raw = trace.audioPassRawResponse.length > 200 ? trace.audioPassRawResponse.slice(0, 200) + "..." : trace.audioPassRawResponse;
        parts.push(`[Audio Raw] ${raw}`);
      }
      if (trace.codeSketch) {
        parts.push(`[SpeechNormalizer] code sketch: ${trace.codeSketch}`);
      }
      if (trace.codeNotes.length) {
        parts.push(`[Code Notes] ${trace.codeNotes.join("; ")}`);
      }
      parsed.pipeline_trace = parts.join("\n");
    }
    this.pipelineTrace = null;

    const contentText = [parsed?.transcript, parsed?.code, parsed?.answer].filter(Boolean).join(" ");
    const contentEstimate = TokenEstimator.estimate(contentText);

    const metrics = {
      usedStreaming: run.firstPass.usedStreaming,
      totalMs: elapsedMs,
      firstChunkMs: run.firstPass.firstChunkMs,
      generationWindowMs: Math.round(generationWindowMs),
      chunkCount: run.firstPass.chunkCount,
      repairPassMs: run.repairPassMs,
      repairAttemptCount: run.repairAttempts.length,
      repairReasons: this.countRepairReasons(run.repairAttempts),
      repairAttempts: run.repairAttempts,
      fallbackUsed: run.fallbackUsed,
      outputChars: outputEstimate.chars,
      outputWords: outputEstimate.words,
      outputTokensApprox: outputEstimate.estimatedTokensByChars,
      outputTokensApproxByWords: outputEstimate.estimatedTokensByWords,
      contentTokensApprox: contentEstimate.estimatedTokensByChars,
      tokensPerSecond: outputEstimate.estimatedTokensByChars / (generationWindowMs / 1000),
      charsPerSecond: outputEstimate.chars / (generationWindowMs / 1000),
      contentTokensPerSecond: contentEstimate.estimatedTokensByChars / (generationWindowMs / 1000),
      audioDurationMs: asset.durationMs,
      audioSize: asset.blob.size,
      audioType: asset.blob.type,
      contextUsage: run.contextUsage,
      sessionShape: run.sessionShape,
      truncated: run.firstPass.truncated,
      truncatedReason: run.firstPass.truncatedReason,
      outputTail: run.firstPass.truncated ? this.tail(run.response, 700) : null,
    };

    this.store.update({
      latestMetrics: metrics,
      rawOutputText: run.response,
      parsedResponse: parsed,
    });

    const report = this.reports.build();
    this.store.update({ latestReport: report });
    this.reports.persistLast(report);
    this.reports.saveHistory(report);
    this.benchmark.add(report);

    const testCase = this.store.get().currentTestCase;
    if (testCase && parsed && (!testCase.expectedTranscript || !testCase.expectedCode)) {
      this.bootstrap.addRun(testCase.id, parsed.transcript ?? "", parsed.code ?? "");
    }
    
    // update benchmark entries in store to re-render
    this.store.update({ benchmarkEntries: this.benchmark.read() });

    const truncLabel = run.firstPass.truncated ? ` (truncado: ${run.firstPass.truncatedReason ?? "modelo atascado"})` : "";
    this.setStatus(`Respondio en ${elapsedMs} ms${truncLabel}`, run.firstPass.truncated ? "bad" : "ready");
    this.log("prompt-complete", { ...metrics as unknown as Record<string, unknown>, truncated: run.firstPass.truncated });
  }

  private countRepairReasons(attempts: RepairAttempt[]): Record<string, number> {
    return attempts.reduce<Record<string, number>>((acc, attempt) => {
      acc[attempt.reason] = (acc[attempt.reason] ?? 0) + 1;
      return acc;
    }, {});
  }

  private tail(text: string, maxChars: number): string {
    return text.length <= maxChars ? text : text.slice(-maxChars);
  }
}
