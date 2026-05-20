import type { LanguageModelPrompt, LanguageModelSession, PromptRun, RepairAttempt, SessionShape } from "../types.js";
import { JsonTools } from "../utils/json-tools.js";
import { LanguageModelGuard } from "./language-model-guard.js";
import { ModelSessionManager } from "./model-session-manager.js";
import { PromptExecutor } from "./prompt-executor.js";
import { ModelRepairEngine } from "./model-repair-engine.js";

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

  async initialize(
    onStatus: (text: string, kind?: string) => void,
    onLog: (type: string, data?: Record<string, unknown>) => void
  ): Promise<void> {
    await this.sessionManager.initialize(onStatus, onLog);
  }

  shape(targetSession: LanguageModelSession | null = null): SessionShape | null {
    return this.sessionManager.shape(targetSession || this.sessionManager.getBaseSession());
  }

  async runAudioPrompt(args: {
    prompt: LanguageModelPrompt;
    useStreaming: boolean;
    onChunk: (text: string) => void;
    audioDurationMs?: number | null;
    codeDetected?: boolean;
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

    const runSession = typeof baseSession.clone === "function" ? await baseSession.clone() : baseSession;

    try {
      const contextUsage = await this.executor.measureContextUsage(runSession, args.prompt);
      const firstPass = await this.executor.runPrompt(runSession, args.prompt, args.useStreaming, args.onChunk);

      let response = firstPass.truncated ? firstPass.text.trimEnd() : firstPass.text;
      let repairPassMs: number | null = null;
      const repairAttempts: RepairAttempt[] = [];
      let fallbackUsed = false;
      let parsed = JsonTools.extractResponse(response);
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
          parsed = result.parsed;
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
          parsed = result.parsed;
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
          parsed = result.parsed;
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
        response = [
          "<response>",
          `  <think>${parsed?.think ?? ""}</think>`,
          `  <tags>${parsed?.thought_tags ?? ""}</tags>`,
          `  <transcript>${parsed?.transcript ?? ""}</transcript>`,
          `  <code>${parsed?.code ?? ""}</code>`,
          "  <answer>No pude extraer una transcripcion util del audio; reintenta o graba una frase un poco mas clara.</answer>",
          `  <directed>${parsed?.is_directed ?? true}</directed>`,
          `  <lang>${parsed?.lang || "es"}</lang>`,
          "  <needs_context>true</needs_context>",
          "  <phonetic_corrections></phonetic_corrections>",
          "</response>"
        ].join("\n");
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
}
