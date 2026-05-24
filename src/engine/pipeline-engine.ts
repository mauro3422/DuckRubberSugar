import { AppConfig } from "../config.js";
import type { AudioAsset, EventLog, LanguageModelContent, LanguageModelPrompt, LanguageModelSession, Report } from "../types.js";
import { BenchmarkService } from "../services/benchmark-service.js";
import { StorageService } from "../services/storage-service.js";
import { ReportService } from "../services/report-service.js";
import { LanguageModelService } from "../services/language-model-service.js";
import { AudioService, type AudioViewDelegate } from "../services/audio-service.js";
import { AppStore } from "../store/app-store.js";
import { TranscriptMerger } from "../utils/transcript-merger.js";
import { BootstrapMerger } from "../services/bootstrap-merger.js";
import { AudioTranscriptionPipeline } from "./audio-transcription-pipeline.js";
import { AudioRecordingManager, type AudioRecordingDelegate } from "./audio-recording-manager.js";
import { EmpathyEngine } from "./empathy-engine.js";
import { BenchmarkRecorder, type BenchmarkDeps } from "./benchmark-recorder.js";
import { PipelineTrace } from "./pipeline-trace.js";
import { PromptBuilder } from "./prompt-builder.js";
import { LiveChatHandler, type LiveChatDelegate } from "./live-chat-handler.js";
import type { LiveFileReplayCase, LiveFileReplayOptions, LiveFileReplayResult } from "./live-file-replay-runner.js";

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

  readonly transcriptionPipeline: AudioTranscriptionPipeline;
  readonly empathyEngine = new EmpathyEngine();
  readonly benchmarkRecorder: BenchmarkRecorder;
  readonly promptBuilder = new PromptBuilder();
  readonly recording: AudioRecordingManager;

  private liveChatHandler: LiveChatHandler | null = null;

  private readonly pipelineTrace = new PipelineTrace();

  private streamingSession: LanguageModelSession | null = null;
  private streamingAppendQueue: Promise<void> = Promise.resolve();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly store: AppStore) {
    this.transcriptionPipeline = new AudioTranscriptionPipeline(this.model, (type, data) => this.log(type, data));
    this.benchmarkRecorder = new BenchmarkRecorder(this.createBenchmarkDeps());
    this.recording = new AudioRecordingManager(this.audio, this.transcriptionPipeline, this.createRecordingDelegate());
  }

  private createRecordingDelegate(): AudioRecordingDelegate {
    return {
      setStatus: (text, kind) => this.setStatus(text, kind),
      log: (type, data) => this.log(type, data),
      storeUpdate: (updates) => this.store.update(updates),
      storeGet: () => this.store.get(),
    };
  }

  private createBenchmarkDeps(): BenchmarkDeps {
    return {
      buildReport: () => this.reports.build(),
      persistLast: (report: Report) => this.reports.persistLast(report),
      saveHistory: (report: Report) => this.reports.saveHistory(report),
      addBenchmark: (report: Report) => this.benchmark.add(report),
      readBenchmarks: () => this.benchmark.read() as unknown[],
      addBootstrapRun: (id, transcript, code) => this.bootstrap.addRun(id, transcript, code),
      onUpdate: (updates) => this.store.update(updates),
      onLog: (type, data) => this.log(type, data),
      onSetStatus: (text, kind) => this.setStatus(text, kind),
      getState: () => {
        const s = this.store.get();
        return {
          isBenchmarkRunning: s.isBenchmarkRunning,
          currentTestCase: s.currentTestCase
            ? { id: s.currentTestCase.id, expectedTranscript: s.currentTestCase.expectedTranscript, expectedCode: s.currentTestCase.expectedCode }
            : undefined,
        };
      },
    };
  }

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
    if (this.model.hasSession) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
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
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  async resetModelSession(): Promise<void> {
    await this.model.getSessionManager().resetBaseSession();
  }

  async startRecording(delegate: import("../services/audio-service.js").AudioViewDelegate, lang = "es-AR"): Promise<void> {
    await this.initializeModel();
    if (!this.model.hasSession) return;

    this.recording.clearTyping();
    this.recording.audioTranscriptionRequestId += 1;
    this.recording.audioTranscriptionPromise = null;
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
              const content: LanguageModelContent[] = this.model.sessionMode === "text"
                ? [{ type: "text", value: `[Audio chunk at ${elapsedMs}ms — continue listening]` }]
                : [
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
      this.recording.startTypingAnimation(liveTranscript, "Transcripción en vivo lista");
    } else {
      // Fallback: If live transcript is empty/silent, probe Python ASR
      this.store.update({
        audioStateText: "Procesando audio...",
        expectedTranscript: "",
        manualTranscript: "",
        isTranscribingAudio: true,
      });
      this.setStatus("Transcribiendo grabacion con Google ASR...");
      await this.recording.transcribeRecordedAudio();
    }
  }

  loadAudioFile(file: File, delegate: import("../services/audio-service.js").AudioViewDelegate): void {
    this.recording.loadAudioFile(file, delegate);
  }



  async sendAudio(instructionText: string, useStreaming: boolean, onChunk: (text: string) => void, langSelectCode?: string): Promise<boolean> {
    const startedAt = performance.now();
    this.pipelineTrace.clear();
    let asset = this.audio.asset;
    if (!asset) {
      this.setStatus("Sin audio", "bad");
      this.benchmarkRecorder.recordFailure(null, useStreaming, "missing-audio", "Sin audio", startedAt, this.model.shape());
      return false;
    }
    await this.audio.waitForDurationReady();
    asset = this.audio.asset;
    if (!asset) {
      this.setStatus("Sin audio", "bad");
      this.benchmarkRecorder.recordFailure(null, useStreaming, "missing-audio", "Sin audio", startedAt, this.model.shape());
      return false;
    }
    await this.initializeModel();
    if (!this.model.hasSession) {
      this.setStatus("Modelo no disponible", "bad");
      this.log("send-blocked", { reason: "missing-session" });
      this.benchmarkRecorder.recordFailure(asset, useStreaming, "missing-session", "Modelo no disponible", startedAt, this.model.shape());
      return false;
    }

    let state = this.store.get();
    if (state.isTranscribingAudio && !state.manualTranscript?.trim() && this.recording.audioTranscriptionPromise) {
      this.setStatus("Esperando Google ASR...");
      await this.recording.audioTranscriptionPromise;
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
      this.benchmarkRecorder.recordFailure(asset, useStreaming, "missing-google-asr-transcription", "Falta transcripcion de Google ASR", startedAt, this.model.shape());
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
    const empathyResult = this.empathyEngine.analyze({
      transcription,
      durationMs,
      volumeHistory: this.audio.recordedVolumeHistory,
      silencePauseCount: this.audio.silencePauseCount,
    });
    const { wpm, volumeStdDev, pauseRatio, detectedMood } = empathyResult;

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

    // Use PromptBuilder for code pattern analysis + full prompt construction
    const { prompt, codeDetected, codeSketch, codeNotes } = this.promptBuilder.buildPrompt({
      instructionText,
      contextHint,
      transcription,
      transcriptionSource,
      manualTranscriptEs: state.manualTranscriptEs,
      manualTranscriptEn: state.manualTranscriptEn,
      langSelectCode,
      hasStreamingAudio: Boolean(this.streamingSession),
      assetBlob: asset.blob,
      detectedMood,
      wpm,
      volumeStdDev,
      pauseRatio,
    });

    // Save pipeline trace for display in AcoCoT card
    this.pipelineTrace.set({
      originalAsr,
      correctedAsr: transcription,
      audioPassConfidence: modelTranscription?.confidence,
      audioPassReasoning: modelTranscription?.reasoning,
      audioPassRawResponse: modelTranscription?.rawResponse,
      mergeDiff,
      codeSketch: codeSketch.code,
      codeNotes,
    });
    this.pipelineTrace.log();
    this.log("pipeline-trace", {
      originalAsr,
      correctedAsr: transcription,
      mergeDiff,
      audioPassConfidence: modelTranscription?.confidence,
      audioPassReasoning: modelTranscription?.reasoning?.slice(0, 200),
      codeSketch: codeSketch.code,
      codeNotes,
    });

    // Wait for streaming appends to finish before executing prompt
    const hasStreamingAudio = Boolean(this.streamingSession);
    if (hasStreamingAudio) {
      await this.streamingAppendQueue;
      this.log("streaming-ready", {});
    }

    // Detect short audio or high silence ratio — flag for self-refinement
    const { isShortAudio, isSilentAudio } = this.empathyEngine.detectAudioAnomalies(
      durationMs, pauseRatio, volumeStdDev, this.audio.recordedVolumeHistory.length
    );
    if (isShortAudio || isSilentAudio) {
      this.log("short-or-silent-audio-detected", {
        durationMs, pauseRatio, volumeStdDev, isShortAudio, isSilentAudio,
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
      this.benchmarkRecorder.recordSuccess(asset, run, this.pipelineTrace);
      return true;
    } catch (error) {
      this.setStatus("Error al consultar", "bad");
      const message = (error as Error).message;
      this.store.update({ rawOutputText: message });
      this.log("prompt-error", { message, stack: (error as Error).stack });
      this.benchmarkRecorder.recordFailure(asset, useStreaming, "prompt-error", message, startedAt, this.model.shape());
      return false;
    } finally {
      this.store.update({ isPromptRunning: false });
      this.streamingSession = null; // destroyed by runAudioPrompt's finally block
    }
  }



  async replayLiveAudioFile(input: LiveFileReplayCase, options: LiveFileReplayOptions = {}): Promise<LiveFileReplayResult> {
    await this.initializeModel();
    const { LiveFileReplayRunner } = await import("./live-file-replay-runner.js");

    const promptBuilder = this.promptBuilder;
    const transcriptionPipeline = this.transcriptionPipeline;

    const runner = new LiveFileReplayRunner(
      this.model.getSessionManager(),
      promptBuilder,
      transcriptionPipeline,
      {
        onLog: (type, data) => this.log(type, data),
        onStatus: (text, kind) => this.setStatus(text, kind),
        onTranscript: (text) => this.store.update({ expectedTranscript: text }),
        onRawOutput: (text) => this.store.update({ rawOutputText: text }),
        onParsedResponse: (parsed) => this.store.update({ parsedResponse: parsed }),
      }
    );

    return runner.run(input, options);
  }

  async startLiveChat(delegate: AudioViewDelegate, onLog: (type: string, data?: Record<string, unknown>) => void, lang = "es-AR"): Promise<void> {
    const liveChatDelegate: LiveChatDelegate = {
      setStatus: (text, kind) => this.setStatus(text, kind),
      setExpectedTranscript: (text) => this.store.update({ expectedTranscript: text }),
      setRawOutput: (text) => this.store.update({ rawOutputText: text }),
      setPromptRunning: (running) => this.store.update({ isPromptRunning: running }),
      setParsedResponse: (parsed) => this.store.update({ parsedResponse: parsed as any }),
      onLog: (type, data) => { onLog(type, data); this.log(type, data); },
    };

    this.liveChatHandler?.stop();

    this.liveChatHandler = new LiveChatHandler(
      this.audio,
      this.model.getSessionManager(),
      this.promptBuilder,
      this.transcriptionPipeline,
      liveChatDelegate,
      { chunkDurationMs: 3000 }
    );

    this.store.update({ statusText: "Modo live chat activo - hablando...", statusKind: "" });
    onLog("live-chat-started", { lang });

    await this.liveChatHandler.start(delegate, lang);
  }

  stopLiveChat(onLog: (type: string, data?: Record<string, unknown>) => void): void {
    this.liveChatHandler?.stop();
    this.liveChatHandler = null;
    this.store.update({ statusText: "Live chat detenido", statusKind: "ready" });
    onLog("live-chat-stopped");
  }
}