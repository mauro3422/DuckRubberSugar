/**
 * LiveChatHandler — Maneja el procesamiento de chunks de audio en modo live chat.
 * Responsabilidad única: recibir chunks, transcribirlos y enviarlos al modelo.
 */
import type { AudioViewDelegate } from "../services/audio-service.js";
import { AudioService } from "../services/audio-service.js";
import { JsonTools } from "../utils/json-tools.js";
import { CodeIntentRepairer } from "../utils/code-intent-repairer.js";
import { PromptBuilder } from "./prompt-builder.js";
import type { ModelSessionManager } from "../services/model-session-manager.js";
import { AudioTranscriptionPipeline } from "./audio-transcription-pipeline.js";
import type { LanguageModelSession } from "../types.js";
import { SpeechStutterCleaner } from "../utils/speech-stutter-cleaner.js";

export interface LiveChatDelegate {
  setStatus(text: string, kind: string): void;
  setExpectedTranscript(text: string, turnId?: number): void;
  setRawOutput(text: string, turnId?: number): void;
  setPromptRunning(running: boolean, turnId?: number): void;
  setParsedResponse(parsed: unknown, turnId?: number): void;
  onLog(type: string, data?: Record<string, unknown>): void;
  getHistory?(): any[];
}

export interface LiveChatOptions {
  chunkDurationMs?: number;
  liveProcessMinIntervalMs?: number;
  finalizeDrainDelayMs?: number;
  finalResponseWaitMs?: number;
  isSmokeTest?: boolean;
}

export class LiveChatHandler {
  private accumulatedBlobs: Blob[] = [];
  private accumulatedTranscript = "";
  private lastTranscript = "";
  private lastProcessedTranscript = "";
  private processing = false;
  private finalizing = false;
  private chunkIndex = 0;
  private liveSession: LanguageModelSession | null = null;
  private responseBusy = false;
  private pendingTranscript = "";
  private lastLiveProcessAt = 0;
  private currentTurnId = 0;
  private lastBackgroundPromise: Promise<void> | null = null;
  private readonly codeIntentRepairer = new CodeIntentRepairer();

  constructor(
    private readonly audio: AudioService,
    private readonly sessionManager: ModelSessionManager,
    private readonly promptBuilder: PromptBuilder,
    private readonly transcriptionPipeline: AudioTranscriptionPipeline,
    private readonly delegate: LiveChatDelegate,
    private readonly options: LiveChatOptions = {}
  ) {}

  get isProcessing(): boolean { return this.processing; }

  async start(audioDelegate: AudioViewDelegate, lang = "es-AR"): Promise<void> {
    this.currentTurnId++;
    const turnId = this.currentTurnId;
    this.reset();
    this.processing = true;
    const cloned = await this.sessionManager.cloneSession();
    if (turnId !== this.currentTurnId) {
      if (cloned && typeof cloned.destroy === "function") cloned.destroy();
      this.delegate.onLog("live-chat-turn-mismatch-aborted", { expectedTurnId: turnId, currentTurnId: this.currentTurnId, method: "start:cloneSession" });
      return;
    }
    this.liveSession = cloned;
    if (!this.liveSession) {
      this.delegate.setStatus("No hay sesion de modelo para live chat", "bad");
      this.delegate.onLog("live-chat-clone-failed");
      this.processing = false;
      return;
    }

    this.delegate.setStatus("Modo live chat activo - hablando...", "");
    this.delegate.onLog("live-chat-started", { lang });

    await this.audio.startChunked(
      {
        ...audioDelegate,
        onSpeechFragment: (finalText: string, interimText: string) => {
          audioDelegate.onSpeechFragment?.(finalText, interimText);
          this.handleSpeechFragment(finalText, interimText);
        },
        onAudioChunk: (chunkBlob: Blob, elapsedMs: number, chunkIndex: number) => {
          this.handleChunk(chunkBlob, elapsedMs, chunkIndex);
        },
      },
      (type, data) => this.delegate.onLog(type, data),
      lang,
      this.options.chunkDurationMs ?? 1200,
      () => {
        if (this.processing) {
          this.delegate.setStatus("Silencio detectado - procesando...", "");
          this.delegate.onLog("vad-auto-stop-triggered");
          void this.finishTurn("vad");
        }
      }
    );
  }

  stop(): void {
    void this.finishTurn("manual");
  }

  private reset(): void {
    this.accumulatedBlobs = [];
    this.accumulatedTranscript = "";
    this.lastTranscript = "";
    this.lastProcessedTranscript = "";
    this.finalizing = false;
    this.chunkIndex = 0;
    this.liveSession = null;
    this.responseBusy = false;
    this.pendingTranscript = "";
    this.lastLiveProcessAt = 0;
  }

  private handleChunk(chunkBlob: Blob, elapsedMs: number, chunkIndex: number): void {
    if (!this.processing && !this.finalizing) return;

    this.accumulatedBlobs.push(chunkBlob);
    this.chunkIndex = chunkIndex;

    this.delegate.onLog("audio-chunk-received", { chunkIndex, size: chunkBlob.size, elapsedMs });
    this.delegate.onLog("live-audio-chunk-appended", { chunkIndex, size: chunkBlob.size, elapsedMs });
  }

  private handleSpeechFragment(finalText: string, interimText: string): void {
    if (!this.processing || this.finalizing || this.lastProcessedTranscript) return;

    const transcript = [finalText, interimText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!transcript || transcript === this.lastTranscript) return;

    this.lastTranscript = transcript;
    this.accumulatedTranscript = transcript;
    this.delegate.setExpectedTranscript(transcript, this.currentTurnId);

    const wordCount = this.countWords(transcript);
    const processedWords = this.countWords(this.lastProcessedTranscript);
    if (wordCount < 3 || wordCount - processedWords < 3) return;

    const now = performance.now();
    if (now - this.lastLiveProcessAt < (this.options.liveProcessMinIntervalMs ?? 1800)) {
      this.pendingTranscript = transcript;
      return;
    }

    this.lastLiveProcessAt = now;
    void this.processTranscript(transcript, "live");
  }

  private async finishTurn(reason: "manual" | "vad"): Promise<void> {
    if (!this.processing || this.finalizing) return;
    this.finalizing = true;
    this.processing = false; // Mark as no longer processing immediately to block re-entry at first stage
    const turnId = this.currentTurnId;

    // 1. Instantly stop chunked audio recording to release microphone and capture buffers
    this.audio.stopChunked((type, data) => this.delegate.onLog(type, data));

    // Wait a very small delay to drain any pending chunks
    await this.sleep(this.options.finalizeDrainDelayMs ?? 250);

    // Capture the state for this turn
    const hadAudio = this.accumulatedBlobs.length > 0;
    const fallbackTranscript = (this.accumulatedTranscript || this.audio.micTranscription || "").trim();
    const accumulatedBlobsCopy = [...this.accumulatedBlobs];
    const chunkIndexCopy = this.chunkIndex;
    const liveSessionCopy = this.liveSession;
    const lastProcessedTranscriptCopy = this.lastProcessedTranscript;
    const historyCopy = this.delegate.getHistory ? [...this.delegate.getHistory()] : [];

    // Reset current turn references in the handler so it's ready for the next turn
    this.accumulatedBlobs = [];
    this.accumulatedTranscript = "";
    this.lastTranscript = "";
    this.lastProcessedTranscript = "";
    this.liveSession = null;
    this.chunkIndex = 0;
    this.finalizing = false;

    if (!hadAudio && !fallbackTranscript) {
      this.delegate.setStatus("Live chat detenido", "ready");
      this.delegate.onLog("live-chat-stopped", { reason, hadAudio });
      if (liveSessionCopy && typeof liveSessionCopy.destroy === "function") {
        liveSessionCopy.destroy();
      }
      return;
    }

    // 2. Instantly notify that the current turn has stopped listening, allowing UI to start next turn immediately
    this.delegate.onLog("live-chat-stopped", { reason, hadAudio });

    // 3. Process the transcription and final model invocation asynchronously in the background!
    this.lastBackgroundPromise = this.processBackgroundASRAndPrompt(
      turnId,
      hadAudio,
      accumulatedBlobsCopy,
      chunkIndexCopy,
      liveSessionCopy,
      fallbackTranscript,
      reason,
      lastProcessedTranscriptCopy,
      historyCopy
    );
  }

  private async processBackgroundASRAndPrompt(
    turnId: number,
    hadAudio: boolean,
    accumulatedBlobs: Blob[],
    chunkIndex: number,
    liveSession: LanguageModelSession | null,
    fallbackTranscript: string,
    reason: "manual" | "vad",
    lastProcessedTranscriptCopy?: string,
    capturedHistory?: any[]
  ): Promise<void> {
    this.delegate.setStatus("Transcribiendo turno...", "");
    try {
      const type = accumulatedBlobs[0]?.type || "audio/webm";
      const accumulatedBlob = new Blob(accumulatedBlobs, { type });
      let rawTranscript = fallbackTranscript;
      
      if (hadAudio) {
        try {
          const result = await this.transcriptionPipeline.transcribeFile(
            new File([accumulatedBlob], `live-turn-${chunkIndex}.webm`, { type })
          );
          rawTranscript = result.transcript || fallbackTranscript;
        } catch (err) {
          this.delegate.onLog("live-chat-asr-error", { message: (err as Error).message });
        }
      }

      const corrected = rawTranscript && hadAudio
        ? await this.transcriptionPipeline.correctTranscript({
            asset: { blob: accumulatedBlob, durationMs: null },
            transcript: rawTranscript,
            transcriptSource: rawTranscript === fallbackTranscript ? "mic" : "google_asr",
          })
        : null;

      const newTranscript = corrected?.correctedAsr || rawTranscript;

      if (newTranscript.length > 0) {
        // Compare with the last processed live transcript if it exists
        const referenceTranscript = (lastProcessedTranscriptCopy || fallbackTranscript || "").trim();
        const normNew = this.normalizeTranscript(newTranscript);
        const normRef = this.normalizeTranscript(referenceTranscript);

        const isShorter = referenceTranscript && (this.countWords(normNew) < this.countWords(normRef));

        if (isShorter) {
          this.delegate.onLog("live-chat-transcript-update-skipped", {
            newTranscript,
            referenceTranscript,
            reason: "final-asr-is-shorter"
          });
          this.delegate.setStatus("Listo (conservado live más completo)", "ready");
          return;
        }

        const isPastTurn = (turnId !== this.currentTurnId);
        const hasLiveResponse = !!lastProcessedTranscriptCopy;

        this.delegate.onLog("live-chat-transcript-updated", {
          transcript: newTranscript,
          rawTranscript,
          mergeDiff: corrected?.mergeDiff ?? null,
          chunkIndex: chunkIndex,
        });
        
        this.delegate.setExpectedTranscript(newTranscript, turnId);

        if (isPastTurn && hasLiveResponse) {
          this.delegate.setStatus("Listo (conservado live)", "ready");
          this.delegate.onLog("live-chat-response-skipped-final-past-turn", {
            transcript: newTranscript,
            lastProcessed: lastProcessedTranscriptCopy,
            reason: "past-turn-with-live-response"
          });
          return;
        }

        await this.processTranscript(newTranscript, "final", turnId, liveSession, lastProcessedTranscriptCopy, capturedHistory);
      } else {
        this.delegate.setStatus("Live chat detenido sin transcripcion", "ready");
      }
    } catch (err) {
      this.delegate.onLog("live-chat-transcription-error", { message: (err as Error).message });
      this.delegate.setStatus("Error transcribiendo live chat", "bad");
    } finally {
      // Destroy background/previous session
      if (liveSession && typeof liveSession.destroy === "function") {
        liveSession.destroy();
      }
    }
  }

  private async processTranscript(
    transcript: string,
    mode: "live" | "final" = "live",
    turnId: number = this.currentTurnId,
    backgroundSession: LanguageModelSession | null = null,
    lastProcessedCopy?: string,
    capturedHistory?: any[]
  ): Promise<void> {
    if (!transcript) return;

    // ASR synchronization: Wait for previous turn's ASR to complete if any
    if (mode === "live" && this.lastBackgroundPromise && turnId > 1) {
      try {
        await Promise.race([
          this.lastBackgroundPromise,
          this.sleep(2000) // 2s safety timeout
        ]);
      } catch (err) {
        this.delegate.onLog("live-chat-sync-wait-error", { message: (err as Error).message });
      }
    }
    if (mode === "live" && transcript === this.lastProcessedTranscript) return;

    const referenceProcessedTranscript = mode === "final" ? (lastProcessedCopy ?? "") : this.lastProcessedTranscript;

    if (mode === "final" && referenceProcessedTranscript && !this.options.isSmokeTest) {
      const normNew = this.normalizeTranscript(transcript);
      const normLast = this.normalizeTranscript(referenceProcessedTranscript);
      const diff = Math.abs(this.countWords(normNew) - this.countWords(normLast));
      if (diff < 2) {
        this.delegate.setStatus("Listo (conservado live)", "ready");
        this.delegate.onLog("live-chat-response-skipped-final-duplicate", {
          transcript,
          lastProcessed: referenceProcessedTranscript,
          reason: "trivial-difference"
        });
        return;
      }
    }

    const isActiveTurn = (turnId === this.currentTurnId);

    if (isActiveTurn && this.responseBusy) {
      if (mode === "final") {
        const deadline = performance.now() + (this.options.finalResponseWaitMs ?? 8000);
        while (this.responseBusy && performance.now() < deadline) {
          await this.sleep(100);
          if (turnId !== this.currentTurnId) {
            this.delegate.onLog("live-chat-turn-mismatch-aborted", { expectedTurnId: turnId, currentTurnId: this.currentTurnId, method: "processTranscript:responseBusyWait" });
            return;
          }
        }
        if (turnId !== this.currentTurnId) return;
        if (!this.responseBusy) return this.processTranscript(transcript, mode, turnId, backgroundSession, lastProcessedCopy, capturedHistory);
      }
      this.pendingTranscript = transcript;
      return;
    }

    if (isActiveTurn) {
      this.responseBusy = true;
    }

    try {
      const runSession = backgroundSession ?? this.liveSession ?? await this.sessionManager.cloneSession();
      if (isActiveTurn && turnId !== this.currentTurnId) {
        this.delegate.onLog("live-chat-turn-mismatch-aborted", { expectedTurnId: turnId, currentTurnId: this.currentTurnId, method: "processTranscript:cloneSession" });
        return;
      }
      if (!runSession) {
        this.delegate.onLog("live-chat-clone-failed");
        return;
      }

      const history = capturedHistory ?? (this.delegate.getHistory ? this.delegate.getHistory() : []);
      const { textContent } = this.promptBuilder.buildLiveChatPrompt(transcript, undefined, true, history);
      const liveInstruction = mode === "live"
        ? "\n\nModo live: responde corto, no cierres el turno si el usuario parece seguir hablando."
        : "\n\nTurno final: usa la transcripcion corregida y entrega la mejor reconstruccion.";
      const startTime = performance.now();
      let responseText = "";

      this.delegate.setPromptRunning(true, turnId);
      this.delegate.setStatus("Procesando...", "");

      const stream = runSession.promptStreaming;
      if (typeof stream !== "function") {
        this.delegate.onLog("live-chat-no-streaming");
        this.delegate.setPromptRunning(false, turnId);
        return;
      }

      const gen = stream.call(runSession, `${textContent}${liveInstruction}`);
      for await (const chunk of gen) {
        if (isActiveTurn && turnId !== this.currentTurnId) {
          this.delegate.setPromptRunning(false, turnId);
          this.delegate.onLog("live-chat-turn-mismatch-aborted", { expectedTurnId: turnId, currentTurnId: this.currentTurnId, method: "processTranscript:streaming" });
          return;
        }
        const chunkStr = String(chunk);
        responseText = chunkStr.startsWith(responseText) ? chunkStr : responseText + chunkStr;
        this.delegate.setRawOutput(responseText, turnId);
      }

      if (isActiveTurn && turnId !== this.currentTurnId) return;
      const elapsedMs = Math.round(performance.now() - startTime);
      let parsed = JsonTools.extractResponse(responseText);
      const repair = await this.codeIntentRepairer.repair(runSession, transcript, history, responseText, parsed);
      if (repair.accepted) {
        parsed = repair.parsed;
        responseText = repair.responseText;
        this.delegate.onLog("live-chat-code-intent-repaired", {
          mode,
          issues: repair.issues,
          repairedIssues: repair.repairedIssues,
        });
      } else if (repair.issues.length > 0) {
        this.delegate.onLog("live-chat-code-intent-repair-skipped", {
          mode,
          issues: repair.issues,
          reason: repair.reason,
        });
      }
      
      if (isActiveTurn) {
        this.lastProcessedTranscript = transcript;
      }

      this.delegate.setPromptRunning(false, turnId);
      this.delegate.setStatus(`Respondio en ${elapsedMs} ms`, "ready");
      this.delegate.setRawOutput(responseText, turnId);
      this.delegate.setParsedResponse(parsed, turnId);

      this.delegate.onLog("live-chat-response-complete", { mode, elapsedMs, responseLength: responseText.length, hasParsed: !!parsed });

      if (mode === "live" && isActiveTurn && !this.options.isSmokeTest) {
        // Automatically close the turn since the AI has successfully responded to this speech fragment!
        // Any subsequent speech will start a fresh new turn.
        void this.finishTurn("vad");
      }
    } catch (err) {
      if (isActiveTurn && turnId !== this.currentTurnId) return;
      this.delegate.onLog("live-chat-processing-error", { message: (err as Error).message });
      this.delegate.setPromptRunning(false, turnId);
      this.delegate.setStatus("Error en live chat", "bad");
    } finally {
      if (isActiveTurn && turnId === this.currentTurnId) {
        this.responseBusy = false;
        const pending = this.pendingTranscript;
        this.pendingTranscript = "";
        if (pending && pending !== this.lastProcessedTranscript && this.processing && !this.finalizing) {
          window.setTimeout(() => {
            if (turnId === this.currentTurnId) {
              this.lastLiveProcessAt = performance.now();
              void this.processTranscript(pending, "live", turnId, backgroundSession, lastProcessedCopy);
            }
          }, 150);
        }
      }
    }
  }

  private normalizeTranscript(text: string): string {
    return SpeechStutterCleaner.normalizeForCompare(text);
  }

  private countWords(text: string): number {
    return SpeechStutterCleaner.countWords(text);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private destroyLiveSession(): void {
    if (this.liveSession && typeof this.liveSession.destroy === "function") {
      this.liveSession.destroy();
    }
    this.liveSession = null;
  }
}
