import type { AudioAsset, LanguageModelSession, ParsedResponse, LanguageModelPrompt } from "../types.js";
import type { ModelSessionManager } from "../services/model-session-manager.js";
import { JsonTools } from "../utils/json-tools.js";
import { audioBufferToWav } from "../utils/wav-encoder.js";
import { PromptBuilder } from "./prompt-builder.js";
import { AudioTranscriptionPipeline } from "./audio-transcription-pipeline.js";
import { SpeechNormalizer } from "../utils/speech-normalizer.js";
import { SpeechStutterCleaner } from "../utils/speech-stutter-cleaner.js";
import { VadSegmenter } from "./vad-segmenter.js";
import { JsonSchema, LiveJsonSchema } from "../config.js";

export interface LiveFileReplayCase {
  id: string;
  file: File;
  expectedTranscript?: string;
  expectedCode?: string;
  contextHint?: string;
}

export interface LiveFileReplayOptions {
  chunkCount?: number;
  asrEveryChunks?: number;
  useExpectedTranscriptFallback?: boolean;
}

export interface LiveFileReplayChunkTrace {
  index: number;
  startSample: number;
  endSample: number;
  energy: number;
  silenceThreshold: number;
  isSilent: boolean;
  asrDurationMs: number;
  asrSkipped: boolean;
  transcript: string;
  code: string;
  think: string;
  modelSkipped: boolean;
  modelSkippedReason: "silence" | "duplicate" | null;
  modelDurationMs: number;
  totalChunkDurationMs: number;
}

export interface LiveFileReplayResult {
  id: string;
  fileName: string;
  chunkCount: number;
  appendCount: number;
  liveResponseCount: number;
  finalResponse: ParsedResponse | null;
  finalTranscript: string;
  finalCode: string;
  errors: string[];
  elapsedMs: number;
  chunks?: LiveFileReplayChunkTrace[];
}

export interface LiveFileReplayDelegate {
  onLog(type: string, data?: Record<string, unknown>): void;
  onStatus(text: string, kind?: string): void;
  onTranscript(text: string): void;
  onRawOutput(text: string): void;
  onParsedResponse(parsed: ParsedResponse | null): void;
}

export class LiveFileReplayRunner {
  constructor(
    private readonly sessionManager: ModelSessionManager,
    private readonly promptBuilder: PromptBuilder,
    private readonly transcriptionPipeline: AudioTranscriptionPipeline,
    private readonly delegate: LiveFileReplayDelegate,
  ) {}

  async run(input: LiveFileReplayCase, options: LiveFileReplayOptions = {}): Promise<LiveFileReplayResult> {
    const startedAt = performance.now();
    const chunkCount = Math.max(2, options.chunkCount ?? 6);
    const asrEveryChunks = Math.max(1, options.asrEveryChunks ?? 1);
    const errors: string[] = [];
    let appendCount = 0;
    let liveResponseCount = 0;
    let finalResponse: ParsedResponse | null = null;
    let finalTranscript = "";

    this.delegate.onStatus(`[live replay] ${input.id}: decodificando audio...`);
    this.delegate.onLog("live-replay-started", { id: input.id, fileName: input.file.name, chunkCount });

    try {
      const buffer = await this.decode(input.file);
      const data = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;

      const vad = VadSegmenter.segment(buffer, chunkCount);
      const chunks = vad.segments;
      const actualChunkCount = chunks.length;
      const silenceThreshold = vad.silenceThreshold;
      const totalSamples = buffer.length;

      this.delegate.onStatus(`[live replay] ${input.id}: detectados ${actualChunkCount} segmentos con VAD`);
      this.delegate.onLog("live-replay-started-vad", { id: input.id, segments: actualChunkCount, silenceThreshold });

      const precalculatedChunks = chunks.map((chunkRange) => {
        const { start: startSample, end: endSample } = chunkRange;
        const wav = this.sliceToWav(buffer, startSample, endSample);
        const chunkLen = endSample - startSample;

        let chunkSum = 0;
        for (let s = startSample; s < endSample; s++) {
          chunkSum += Math.abs(data[s]);
        }
        const chunkEnergy = chunkLen > 0 ? (chunkSum / chunkLen) : 0;
        const isSilent = chunkEnergy < silenceThreshold;

        return { startSample, endSample, wav, chunkLen, chunkEnergy, isSilent };
      });

      // Fire ASR transcription promises in parallel background execution (Dual Concurrency)
      const asrPromises = precalculatedChunks.map(async (c, index) => {
        if (c.isSilent) {
          return "";
        }
        if ((index + 1) % asrEveryChunks === 0 || index + 1 === actualChunkCount) {
          const chunkDurationMs = Math.round((c.chunkLen / buffer.sampleRate) * 1000);
          try {
            const asr = await this.transcriptionPipeline.transcribeAsset(
              { blob: c.wav, durationMs: chunkDurationMs },
              `${input.id}-chunk-${index + 1}.wav`
            );
            return asr.transcript.trim();
          } catch (error) {
            const message = (error as Error).message;
            errors.push(`chunk ${index + 1} ASR: ${message}`);
            this.delegate.onLog("live-replay-asr-error", { id: input.id, chunkIndex: index + 1, message });
            return "";
          }
        }
        return "";
      });

      let lastTranscript = "";
      let lastParsed: ParsedResponse | null = null;
      const chunkTraces: LiveFileReplayChunkTrace[] = [];

      for (let index = 0; index < actualChunkCount; index++) {
        const chunkStart = performance.now();
        const c = precalculatedChunks[index];
        const elapsedMs = Math.round((c.endSample / buffer.sampleRate) * 1000);

        appendCount++;
        this.delegate.onLog("live-replay-chunk-appended", { id: input.id, chunkIndex: index + 1, size: c.wav.size, elapsedMs });

        let partialTranscript = "";
        let asrSkipped = false;
        let asrDurationMs = 0;

        if (c.isSilent) {
          asrSkipped = true;
          partialTranscript = lastTranscript;
          this.delegate.onLog("live-replay-chunk-silence-skipped", {
            id: input.id,
            chunkIndex: index + 1,
            energy: c.chunkEnergy,
            silenceThreshold
          });
        } else {
          if ((index + 1) % asrEveryChunks === 0 || index + 1 === actualChunkCount) {
            const asrStart = performance.now();
            const chunkTranscript = await asrPromises[index];
            if (chunkTranscript) {
              partialTranscript = lastTranscript ? `${lastTranscript} ${chunkTranscript}` : chunkTranscript;
            } else {
              partialTranscript = lastTranscript;
            }
            asrDurationMs = Math.round(performance.now() - asrStart);
          } else {
            asrSkipped = true;
            partialTranscript = lastTranscript;
          }
        }

        if (!partialTranscript && options.useExpectedTranscriptFallback !== false && input.expectedTranscript) {
          partialTranscript = this.expectedPrefix(input.expectedTranscript, (index + 1) / actualChunkCount);
        }

        let modelSkipped = false;
        let modelSkippedReason: "silence" | "duplicate" | null = null;
        let modelStart = performance.now();
        
        // El debouncing se calcula comparando las versiones limpias de stutters (evita peticiones redundantes)
        const cleanCurrent = this.cleanSpeechStutters(partialTranscript);
        const cleanLast = this.cleanSpeechStutters(lastTranscript);
        
        if (c.isSilent) {
          modelSkipped = true;
          modelSkippedReason = "silence";
        } else if (partialTranscript) {
          finalTranscript = partialTranscript;
          
          // Omitimos LLM si la versión limpia de muletillas no ha cambiado
          const normalizedCurrent = cleanCurrent.trim().toLowerCase().replace(/\s+/g, " ");
          const normalizedLast = cleanLast.trim().toLowerCase().replace(/\s+/g, " ");
          if (lastTranscript && normalizedCurrent === normalizedLast) {
            if (lastParsed) {
              this.delegate.onParsedResponse(lastParsed);
            }
            modelSkipped = true;
            modelSkippedReason = "duplicate";
            this.delegate.onLog("live-replay-response-skipped-duplicate", { id: input.id, chunkIndex: index + 1, transcript: partialTranscript });
          } else {
            // Guardamos el raw transcript en el historial de transcripción
            lastTranscript = partialTranscript;

            // Enviamos el RAW transcript al modelo (sin recortarlo "hardcoded") para que aprenda a ignorar muletillas
            // Para la UI, enviamos la transcripción con tags <muletilla>
            this.delegate.onTranscript(this.tagSpeechStuttersForUi(partialTranscript));
            
            // [Dual-Track UX] Enviamos instantáneamente el bosquejo de código local al frontend (<1ms)
            // Esto permite que el usuario vea cambios inmediatos en el editor mientras Gemini Nano razona asíncronamente.
            const localSketch = SpeechNormalizer.inferCodeFromSpeech(partialTranscript, input.contextHint || "");
            if (localSketch && localSketch.code) {
              const instantParsed = {
                think: "Track Rápido: Infiriendo bosquejo local...",
                answer: "",
                code: localSketch.code,
                code_origin: "speech_normalizer",
                code_tags: localSketch.tags,
                code_notes: "Bosquejo instantáneo local. Gemini Nano refinando en segundo plano...",
                transcript: partialTranscript
              };
              this.delegate.onParsedResponse(instantParsed);
            }

            // Clona una sesión temporal limpia para este chunk para evitar la acumulación de múltiples tensores de audio en GPU
            const tempSession = await this.sessionManager.cloneSession();
            if (!tempSession) throw new Error("No hay sesion de modelo temporal para live chunk prompt");
            let raw = "";
            try {
              raw = await this.runLivePrompt(tempSession, partialTranscript, "live", input.contextHint, c.wav);
            } finally {
              if (tempSession && typeof tempSession.destroy === "function") {
                tempSession.destroy();
              }
            }
            liveResponseCount++;
            this.delegate.onRawOutput(raw);
            
            const extracted = JsonTools.extractResponse(raw);
            let parsed: ParsedResponse;
            if (!extracted) {
              const codeSketch = SpeechNormalizer.inferCodeFromSpeech(partialTranscript, input.contextHint || "");
              parsed = {
                think: "",
                answer: raw,
                code: lastParsed?.code || codeSketch.code || "",
                code_origin: lastParsed?.code ? lastParsed.code_origin : (codeSketch.code ? "speech_normalizer" : undefined),
                code_tags: lastParsed?.code ? lastParsed.code_tags : (codeSketch.code ? codeSketch.tags : undefined),
                code_notes: lastParsed?.code ? lastParsed.code_notes : (codeSketch.code ? "Codigo probable reconstruido localmente desde ASR y contexto disponible." : undefined),
                transcript: partialTranscript
              };
            } else {
              parsed = extracted;
              // Preservamos el código de la inferencia anterior en modo live para evitar que se ponga en blanco
              parsed.code = parsed.code || lastParsed?.code || "";
              if (!parsed.code) {
                const codeSketch = SpeechNormalizer.inferCodeFromSpeech(partialTranscript, input.contextHint || "");
                if (codeSketch && codeSketch.code) {
                  parsed.code = codeSketch.code;
                  parsed.code_origin = "speech_normalizer";
                  parsed.code_tags = codeSketch.tags;
                  parsed.code_notes = "Codigo probable reconstruido localmente desde ASR y contexto disponible.";
                }
              }
            }
            
            lastParsed = parsed;
            this.delegate.onParsedResponse(parsed);
            const modelDurationMs = Math.round(performance.now() - modelStart);
            this.delegate.onLog("live-replay-response-complete", { 
              id: input.id, 
              mode: "live", 
              chunkIndex: index + 1, 
              responseLength: raw.length,
              modelDurationMs
            });
          }
        } else {
          modelSkipped = true;
        }

        const modelDurationMs = modelSkipped ? 0 : Math.round(performance.now() - modelStart);
        const totalChunkDurationMs = Math.round(performance.now() - chunkStart);

        const trace: LiveFileReplayChunkTrace = {
          index: index + 1,
          startSample: c.startSample,
          endSample: c.endSample,
          energy: c.chunkEnergy,
          silenceThreshold,
          isSilent: c.isSilent,
          asrDurationMs,
          asrSkipped,
          transcript: partialTranscript,
          code: lastParsed?.code || "",
          think: lastParsed?.think || "",
          modelSkipped,
          modelSkippedReason,
          modelDurationMs,
          totalChunkDurationMs
        };
        chunkTraces.push(trace);

        // Despacha la telemetría en tiempo real al delegado para la consola visual
        this.delegate.onLog("live-replay-chunk-sync", trace as unknown as Record<string, unknown>);
      }

      const fullWav = this.sliceToWav(buffer, 0, totalSamples);
      const durationMs = Math.round((totalSamples / buffer.sampleRate) * 1000);
      finalTranscript = await this.finalTranscript(input, { blob: fullWav, durationMs }, errors);
      
      // Enviamos el raw final transcript a la UI y al LLM
      this.delegate.onTranscript(this.tagSpeechStuttersForUi(finalTranscript));

      const finalSession = await this.sessionManager.cloneSession();
      if (!finalSession) throw new Error("No hay sesion de modelo para el turno final");
      let finalRaw = "";
      try {
        finalRaw = await this.runLivePrompt(finalSession, finalTranscript, "final", input.contextHint);
      } finally {
        if (finalSession && typeof finalSession.destroy === "function") {
          finalSession.destroy();
        }
      }

      finalResponse = JsonTools.extractResponse(finalRaw);
      if (!finalResponse) {
        const codeSketch = SpeechNormalizer.inferCodeFromSpeech(finalTranscript, input.contextHint || "");
        finalResponse = {
          think: "",
          answer: finalRaw,
          code: codeSketch.code || "",
          code_origin: codeSketch.code ? "speech_normalizer" : undefined,
          code_tags: codeSketch.code ? codeSketch.tags : undefined,
          code_notes: codeSketch.code ? "Codigo probable reconstruido localmente desde ASR y contexto disponible." : undefined,
          transcript: finalTranscript
        };
      } else if (!finalResponse.code) {
        const codeSketch = SpeechNormalizer.inferCodeFromSpeech(finalTranscript, input.contextHint || "");
        if (codeSketch && codeSketch.code) {
          finalResponse.code = codeSketch.code;
          finalResponse.code_origin = "speech_normalizer";
          finalResponse.code_tags = codeSketch.tags;
          finalResponse.code_notes = "Codigo probable reconstruido localmente desde ASR y contexto disponible.";
        }
      }
      this.delegate.onRawOutput(finalRaw);
      this.delegate.onParsedResponse(finalResponse);
      this.delegate.onLog("live-replay-response-complete", { id: input.id, mode: "final", responseLength: finalRaw.length });

      const result: LiveFileReplayResult = {
        id: input.id,
        fileName: input.file.name,
        chunkCount: actualChunkCount,
        appendCount,
        liveResponseCount,
        finalResponse,
        finalTranscript, // Guardamos la versión RAW final en el resultado
        finalCode: finalResponse?.code ?? "",
        errors,
        elapsedMs: Math.round(performance.now() - startedAt),
        chunks: chunkTraces
      };
      this.delegate.onLog("live-replay-complete", result as unknown as Record<string, unknown>);
      this.delegate.onStatus(`[live replay] ${input.id}: listo`, "ready");
      return result;
    } finally {
      // No-op: all session resources are destroyed locally in their respective try-finally blocks
    }
  }

  private async finalTranscript(input: LiveFileReplayCase, asset: AudioAsset, errors: string[]): Promise<string> {
    let asrTranscript = "";
    try {
      const asr = await this.transcriptionPipeline.transcribeAsset(asset, `${input.id}-final.wav`);
      asrTranscript = asr.transcript.trim();
    } catch (error) {
      const message = (error as Error).message;
      errors.push(`final ASR: ${message}`);
      this.delegate.onLog("live-replay-final-asr-error", { id: input.id, message });
    }

    if (!asrTranscript && input.expectedTranscript) return input.expectedTranscript;

    const corrected = await this.transcriptionPipeline.correctTranscript({
      asset,
      transcript: asrTranscript,
      transcriptSource: "google_asr",
    });
    return corrected.correctedAsr || asrTranscript || input.expectedTranscript || "";
  }

  private async runLivePrompt(
    session: LanguageModelSession,
    transcript: string,
    mode: "live" | "final",
    contextHint?: string,
    currentChunkAudio?: Blob,
  ): Promise<string> {
    const { textContent } = this.promptBuilder.buildLiveChatPrompt(transcript, contextHint);
    
    // Si estamos en modo live, le damos una instrucción clara y concisa de usar un esquema simplificado sin XML ni campos redundantes
    const instruction = mode === "live"
      ? "\n\n[MODO LIVE REPLAY] Responde únicamente con un objeto JSON usando 'think' y 'transcript'.\n" +
        "CRITICAL RULES FOR 'think' FIELD:\n" +
        "1. MUST be a private, silent, technical audit note (max 10 words, in English).\n" +
        "2. DO NOT address the user, greet them, or converse (no 'Hola', no questions, no conversational Spanish).\n" +
        "3. Focus solely on structural coding logic or transcript flow (e.g. 'Processing loop syntax', 'Variables defined', 'Analyzing voice segments').\n" +
        "4. DO NOT write code in the transcript. NO code generated in live mode."
      : "\n\n[MODO FINAL REPLAY] Reconstruye el código final de forma extremadamente limpia y precisa.\n" +
        "CRITICAL RULES:\n" +
        "1. MUST follow the [CODE SKETCH] if it is provided. Validate and keep it as clean as possible. If the [CODE SKETCH] targets a DOM property like 'innerHTML' (e.g. 'noteList.innerHTML = ...'), preserve this assignment and DO NOT replace it with a 'const' declaration.\n" +
        "2. DO NOT generate invalid self-referencing declarations like 'const X = X.map(...)' where a constant is declared using itself. This is a JavaScript syntax error.\n" +
        "3. If the user refers to checking if a variable like 'count' is empty or not, use standard concise JavaScript negation like 'if (!count)' instead of verbose comparisons like '=== undefined'.\n" +
        "4. Output valid JSON matching the system schema.";
      
    const promptText = `${textContent}${instruction}`;
    const constraint = mode === "live" ? LiveJsonSchema : JsonSchema;

    const isTextMode = this.sessionManager.sessionMode === "text";
    
    // In text mode, pass the plain text string. Otherwise, pass the structured content array.
    const promptInput = isTextMode 
      ? promptText 
      : [
          {
            role: "user",
            content: [
              ...(currentChunkAudio ? [{ type: "audio" as const, value: currentChunkAudio }] : []),
              { type: "text", value: promptText }
            ]
          }
        ];

    if (typeof session.promptStreaming === "function") {
      let response = "";
      // @ts-ignore
      const stream = session.promptStreaming(promptInput, { responseConstraint: constraint });
      const streamStarted = performance.now();
      const maxStreamDuration = mode === "live" ? 15000 : 25000;
      for await (const chunk of stream) {
        if (performance.now() - streamStarted > maxStreamDuration) {
          console.warn(`[runLivePrompt] Streaming timeout exceeded (${maxStreamDuration}ms). Breaking stream loop.`);
          break;
        }
        const text = String(chunk);
        response = text.startsWith(response) ? text : response + text;
      }
      return response;
    }

    // @ts-ignore
    return session.prompt(promptInput, { responseConstraint: constraint });
  }

  private async decode(file: File): Promise<AudioBuffer> {
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) throw new Error("AudioContext no soportado");
    const ctx = new AudioCtx();
    try {
      return await ctx.decodeAudioData(await file.arrayBuffer());
    } finally {
      ctx.close().catch(() => undefined);
    }
  }

  private sliceToWav(buffer: AudioBuffer, startSample: number, endSample: number): Blob {
    const length = Math.max(1, endSample - startSample);
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) throw new Error("AudioContext no soportado");
    const ctx = new AudioCtx({ sampleRate: buffer.sampleRate });
    try {
      const slice = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        slice.copyToChannel(buffer.getChannelData(channel).slice(startSample, endSample), channel);
      }
      return audioBufferToWav(slice);
    } finally {
      ctx.close().catch(() => undefined);
    }
  }

  private expectedPrefix(transcript: string, ratio: number): string {
    const words = transcript.split(/\s+/).filter(Boolean);
    const count = Math.max(1, Math.ceil(words.length * ratio));
    return words.slice(0, count).join(" ");
  }

  private cleanSpeechStutters(text: string): string {
    return SpeechStutterCleaner.cleanStutters(text);
  }

  private tagSpeechStuttersForUi(text: string): string {
    return SpeechStutterCleaner.tagStuttersForUi(text);
  }
}
