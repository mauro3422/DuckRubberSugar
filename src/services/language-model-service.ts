import { AppConfig, TranscriptionSchema } from "../config.js";
import type { LanguageModelPrompt, LanguageModelSession, PromptRun, RepairAttempt, SessionShape } from "../types.js";
import { JsonTools } from "../utils/json-tools.js";
import { LanguageModelGuard } from "./language-model-guard.js";
import { ModelSessionManager } from "./model-session-manager.js";
import { PromptExecutor } from "./prompt-executor.js";
import { ModelRepairEngine } from "./model-repair-engine.js";
import type { ModelTranscription } from "../utils/transcript-merger.js";

export class LanguageModelService {
  private readonly sessionManager: ModelSessionManager;
  private readonly executor: PromptExecutor;
  private readonly repairEngine: ModelRepairEngine;

  constructor() {
    this.sessionManager = new ModelSessionManager();
    this.executor = new PromptExecutor();
    this.repairEngine = new ModelRepairEngine(this.executor);
  }

  get sessionMode(): string {
    return this.sessionManager.sessionMode;
  }

  get hasAudioSession(): boolean {
    return this.sessionManager.hasAudioSession;
  }

  get hasSession(): boolean {
    return this.sessionManager.hasSession;
  }

  getSessionManager(): ModelSessionManager {
    return this.sessionManager;
  }

  async initialize(
    onStatus: (text: string, kind?: string) => void,
    onLog: (type: string, data?: Record<string, unknown>) => void
  ): Promise<void> {
    await this.sessionManager.initialize(onStatus, onLog);
  }

  shape(targetSession: LanguageModelSession | null = null): SessionShape | null {
    return this.sessionManager.shape(targetSession || this.sessionManager.getBaseSession());
  }

  async runAudioTranscription(args: {
    audioBlob: Blob;
    asrTranscript: string;
    audioDurationMs: number | null;
  }): Promise<ModelTranscription | null> {
    const baseSession = this.sessionManager.getBaseSession();
    if (!baseSession) return null;

    let runSession: LanguageModelSession | null = null;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          runSession = typeof baseSession.clone === "function"
            ? await baseSession.clone()
            : baseSession;
          break;
        } catch (e) {
          if (attempt === 0) await new Promise(r => setTimeout(r, 500));
          else throw e;
        }
      }
      if (!runSession) return { transcript: "", error: "failed to clone session after retry" };

      const prompt: LanguageModelPrompt = [{
        role: "user",
        content: [
          { type: "audio", value: args.audioBlob },
          { type: "text", value: [
            `[System note: The user is dictating code. Listen to the audio and produce the BEST POSSIBLE transcription.`,
            `You have two sources of truth:`,
            `1) The audio (what you hear)`,
            `2) Your knowledge of code syntax and common dictation patterns`,
            ``,
            `The ASR transcript below is a draft. It may contain mishearings.`,
            `Use your code knowledge to spot transcription errors that "make no sense in code":`,
            `- "comisa" → "comilla" (quote word, not the quote symbol itself)`,
            `- "parentesis" is fine (it stays as the word "parentesis")`,
            `- "coma" is fine (it stays as the word "coma")`,
            `- merged words like "mundocomisa" → "mundo comisa"`,
            ``,
            `CRITICAL: transcript is a VERBATIM RECORDING of what the user said, like a court reporter.`,
            `Do NOT interpret, compile, or rewrite what you hear — just write the WORDS.`,
            `If the user says "comilla", write the WORD "comilla", NOT the symbol ".`,
            `If the user says "parentesis", write the WORD "parentesis", NOT the symbol (.`,
            `If the user says "punto y coma", write the WORDS "punto y coma", NOT the symbol ;.`,
            ``,
            `PRESERVE CODE IDENTIFIERS: Do NOT "correct" English code keywords or variable names`,
            `used in Spanish speech (e.g., "count", "list", "map", "set", "get", "id", "key", "value")`,
            `to Spanish words like "conteo", "lista", "mapa", etc. These are valid JavaScript identifiers.`,
            `Only correct phonetic mishearings (e.g., "comisa" → "comilla", "Sprint" → "printf").`,
            `Never change "count" to "conteo" or "list" to "lista".`,
            `EXAMPLE - WRONG: "printf \"Hola mundo\"" → this is compiled code, NOT transcription.`,
            `EXAMPLE - RIGHT: "printf paréntesis comilla Hola mundo comilla paréntesis" → these are spoken words.`,
            `The system's SpeechNormalizer converts these words to code symbols later. Do NOT do its job.`,
            ``,
            `Even if you HEAR the same as the ASR, ask yourself: does this make sense in code?`,
            `If not, correct it to what the user almost certainly meant.`,
            ``,
            `Output valid JSON with:`,
            `  "transcript": the spoken words the user said (natural language, NOT code),`,
            `  "phonetic_corrections": array of objects, each { "original": "<ASR word>", "corrected": "<your correction>", "confidence": 0.95 },`,
            `  "confidence": number 0-1 how sure you are of your corrected transcript,`,
            `  "reasoning": what you changed and why (code context).]`,
            ``,
            `ASR draft transcription:`,
            args.asrTranscript,
          ].join("\n") },
        ],
      }];

      const TIMEOUT_MS = 15_000;
      const response = await Promise.race([
        runSession.prompt(prompt, { responseConstraint: TranscriptionSchema }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("Audio pass timed out after 30s")), TIMEOUT_MS)
        ),
      ]);

      if (!response || !response.trim()) return { transcript: "", error: "empty response" };

      const parsed = JsonTools.extractAudioResponse(response);
      if (!parsed) return { transcript: "", error: `extractAudioResponse failed: ${response.slice(0, 200)}`, rawResponse: response.slice(0, 800) };

      return {
        transcript: parsed.transcript ?? "",
        phonetic_corrections: parsed.phonetic_corrections ?? [],
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
        rawResponse: response.slice(0, 800),
      };
    } catch (error) {
      return { transcript: "", error: `exception: ${(error as Error).message?.slice(0, 200) ?? "unknown"}` };
    } finally {
      if (runSession && runSession !== baseSession && typeof runSession.destroy === "function") {
        try { runSession.destroy(); } catch { /* ignore */ }
      }
    }
  }

  async runAudioPrompt(args: {
    prompt: LanguageModelPrompt;
    useStreaming: boolean;
    onChunk: (text: string) => void;
    audioDurationMs?: number | null;
    codeDetected?: boolean;
    sourceTranscript?: string;
    localCodeSketch?: string;
    localCodeTags?: string[];
    existingSession?: LanguageModelSession;
  }): Promise<{
    firstPass: PromptRun;
    response: string;
    repairPassMs: number | null;
    repairAttempts: RepairAttempt[];
    fallbackUsed: boolean;
    contextUsage: unknown;
    sessionShape: SessionShape | null;
  }> {
    const baseSession = this.sessionManager.getBaseSession();
    if (!baseSession) throw new Error("No hay sesion activa");

    const runSession = args.existingSession
      ?? (typeof baseSession.clone === "function" ? await baseSession.clone() : baseSession);

    try {
      const contextUsage = await this.executor.measureContextUsage(runSession, args.prompt);
      const firstPass = await this.executor.runPrompt(runSession, args.prompt, args.useStreaming, args.onChunk);

      let response = firstPass.truncated ? firstPass.text.trimEnd() : firstPass.text;
      let repairPassMs: number | null = null;
      const repairAttempts: RepairAttempt[] = [];
      let fallbackUsed = false;
      let parsed = this.hydrateParsed(JsonTools.extractResponse(response), args.sourceTranscript, args.localCodeSketch, args.localCodeTags);
      if (parsed) response = JsonTools.serializeToXml(parsed);
      let bestResponse = response;
      let bestParsed = parsed;

      // Skip repair if first pass was truncated — session is likely in bad state
      if (!firstPass.truncated && LanguageModelGuard.needsAudioRetry(parsed, args.audioDurationMs, args.codeDetected)) {
        try {
          const result = await this.repairEngine.runAudioRetry(
            baseSession,
            args.prompt,
            args.useStreaming,
            args.onChunk,
            bestParsed,
            args.audioDurationMs,
            args.codeDetected
          );
          response = result.response;
          parsed = this.hydrateParsed(result.parsed, args.sourceTranscript, args.localCodeSketch, args.localCodeTags);
          response = parsed ? JsonTools.serializeToXml(parsed) : result.response;
          bestResponse = response;
          bestParsed = parsed;
          repairAttempts.push(result.attempt);
          repairPassMs = (repairPassMs ?? 0) + result.elapsedMs;
        } catch (error) {
          console.error("Error during asr_text_retry:", error);
          repairAttempts.push({
            reason: "asr_text_retry",
            elapsedMs: 0,
            accepted: false,
            improved: false,
            scoreDelta: 0,
            truncated: true,
            scoreBefore: LanguageModelGuard.parsedContentScore(bestParsed),
            scoreAfter: 0,
            outputChars: 0,
          });
        }
      }

      if (!firstPass.truncated && !parsed) {
        try {
          const result = await this.repairEngine.runJsonRepair(
            baseSession,
            response,
            args.onChunk,
            bestParsed
          );
          response = result.response;
          parsed = this.hydrateParsed(result.parsed, args.sourceTranscript, args.localCodeSketch, args.localCodeTags);
          response = parsed ? JsonTools.serializeToXml(parsed) : result.response;
          bestResponse = response;
          bestParsed = parsed;
          repairAttempts.push(result.attempt);
          repairPassMs = (repairPassMs ?? 0) + result.elapsedMs;
        } catch (error) {
          console.error("Error during json_repair:", error);
          repairAttempts.push({
            reason: "json_repair",
            elapsedMs: 0,
            accepted: false,
            improved: false,
            scoreDelta: 0,
            truncated: true,
            scoreBefore: LanguageModelGuard.parsedContentScore(bestParsed),
            scoreAfter: 0,
            outputChars: 0,
          });
        }
      }

      // Cognitive Self-Refinement Pass (Dual-Pass)
      if (!firstPass.truncated && parsed && LanguageModelGuard.needsRefinementPass(parsed)) {
        try {
          const result = await this.repairEngine.runSelfRefinement(
            baseSession,
            bestParsed,
            args.useStreaming,
            args.onChunk
          );
          response = result.response;
          parsed = this.hydrateParsed(result.parsed, args.sourceTranscript, args.localCodeSketch, args.localCodeTags);
          response = parsed ? JsonTools.serializeToXml(parsed) : result.response;
          bestResponse = response;
          bestParsed = parsed;
          repairAttempts.push(result.attempt);
          repairPassMs = (repairPassMs ?? 0) + result.elapsedMs;
        } catch (error) {
          console.error("Error during self_refinement:", error);
          repairAttempts.push({
            reason: "self_refinement",
            elapsedMs: 0,
            accepted: false,
            improved: false,
            scoreDelta: 0,
            truncated: true,
            scoreBefore: LanguageModelGuard.parsedContentScore(bestParsed),
            scoreAfter: 0,
            outputChars: 0,
          });
        }
      }

      if (LanguageModelGuard.needsVisibleEmptyFallback(parsed)) {
        fallbackUsed = true;
        response = JSON.stringify({
          think: parsed?.think ?? "",
          tags: parsed?.thought_tags ?? "",
          transcript: parsed?.transcript ?? "",
          code: parsed?.code ?? "",
          answer: "No pude extraer una transcripcion util del audio; reintenta o graba una frase un poco mas clara.",
          directed: parsed?.is_directed ?? true,
          lang: parsed?.lang || "es",
          needs_context: true,
        });
      }

      return {
        firstPass,
        response,
        repairPassMs,
        repairAttempts,
        fallbackUsed,
        contextUsage,
        sessionShape: this.shape(runSession),
      };
    } finally {
      if (runSession !== baseSession && typeof runSession.destroy === "function") {
        runSession.destroy();
      }
    }
  }

  private hydrateParsed<T extends ReturnType<typeof JsonTools.extractResponse>>(
    parsed: T,
    sourceTranscript?: string,
    localCodeSketch?: string,
    localCodeTags?: string[],
  ): T {
    if (!parsed) return parsed;
    const patch: Record<string, unknown> = {};
    const localCode = localCodeSketch?.trim() ?? "";
    const modelCode = (parsed.code ?? "").trim();
    const trustedLocalCode = Boolean(
      localCode &&
      (localCodeTags ?? []).some((tag) =>
        [
          "spoken_print_call",
          "spoken_not_condition",
          "context_lexicon_reconstruction",
          "spoken_symbol_normalization",
        ].includes(tag)
      )
    );

    if (sourceTranscript?.trim()) {
      patch.transcript = sourceTranscript.trim();
    }

    if (trustedLocalCode && this.shouldPreferLocalCode(modelCode, localCode, localCodeTags ?? [])) {
      patch.code = localCode;
      patch.code_origin = "speech_normalizer";
      patch.code_tags = localCodeTags ?? [];
      patch.code_notes = modelCode
        ? "Codigo probable local usado porque la salida del modelo agrego estructura/prosa o contradijo el sketch ASR."
        : "Codigo probable reconstruido localmente desde ASR y contexto disponible.";
    } else if (localCode && !modelCode) {
      patch.code = localCode;
      patch.code_origin = "speech_normalizer";
      patch.code_tags = localCodeTags ?? [];
      patch.code_notes = "Codigo probable reconstruido localmente desde ASR y contexto disponible.";
    }

    return Object.keys(patch).length ? { ...parsed, ...patch } as T : parsed;
  }

  private shouldPreferLocalCode(modelCode: string, localCode: string, localCodeTags: string[]): boolean {
    if (!localCode) return false;
    if (!modelCode) return true;

    const model = modelCode.trim();
    const local = localCode.trim();
    const lowerModel = model.toLowerCase();
    const lowerLocal = local.toLowerCase();

    if (model === local) return false;

    // Bug fix: model prefixed code with '>' (Gemini Nano HTML blockquote confusion)
    if (/^[>\s]+/.test(model)) return true;
    if (/[¿?]/.test(model)) return true;
    if (/\b(?:necesito|puedes|podrias|entendido|confirmar|contexto|algoritmo|quieres|qué quieres|what programming language)\b/i.test(model)) return true;
    if (/\btrue\s+es\s+(?:true|false)\b/i.test(model)) return true;
    if (/\/\/\s*(?:code to execute|add your logic|todo|your logic)/i.test(model)) return true;
    if (model.length > Math.max(local.length * 2.2, local.length + 35)) return true;

    // Bug fix: model dropped let/const/var declaration keyword
    if (/^(let|const|var)\s/i.test(local) && !/^(let|const|var)\s/i.test(model)) {
      return true;
    }

    // Bug fix: model replaced $variable with %s (e.g. printf("hello %s") instead of printf("hello $name"))
    if (/\$\w+/.test(local) && /%s/.test(model) && !/\$\w+/.test(model)) {
      return true;
    }

    if (localCodeTags.includes("spoken_not_condition")) {
      const localIdentifier = lowerLocal.match(/if\s*\(!\s*([a-z_$][\w$]*)\s*\)/i)?.[1];
      const modelIdentifier = lowerModel.match(/if\s*\(!\s*([a-z_$][\w$]*)\s*\)/i)?.[1];
      if (localIdentifier && modelIdentifier && localIdentifier !== modelIdentifier) return true;
    }

    if (localCodeTags.includes("spoken_print_call")) {
      if (/^#include\b|int\s+main\s*\(/i.test(model)) return true;
      if (lowerModel.includes("printf") && lowerLocal.includes("printf") && model !== local) return true;
    }

    return false;
  }
}
