import { AppConfig, PromptOptionsConfig } from "../config.js";
import type { LanguageModelPrompt, LanguageModelSession, PromptRun, TruncatedReason } from "../types.js";
import { LanguageModelGuard } from "./language-model-guard.js";

export class PromptExecutor {
  async measureContextUsage(targetSession: LanguageModelSession, prompt: LanguageModelPrompt): Promise<unknown> {
    if (typeof targetSession.measureContextUsage !== "function") return null;
    try {
      return await targetSession.measureContextUsage(prompt, PromptOptionsConfig);
    } catch (error) {
      return { error: (error as Error).message };
    }
  }

  async runPrompt(
    targetSession: LanguageModelSession,
    prompt: string | LanguageModelPrompt,
    allowStreaming: boolean,
    onChunk: (text: string) => void,
  ): Promise<PromptRun> {
    const usedStreaming = allowStreaming && typeof targetSession.promptStreaming === "function";
    const startedAt = performance.now();
    let firstChunkAt: number | null = null;
    let chunkCount = 0;
    let text = "";
    let truncated = false;
    let truncatedReason: TruncatedReason = null;

    if (usedStreaming && targetSession.promptStreaming) {
      const stream = targetSession.promptStreaming(prompt, PromptOptionsConfig);
      let lastMeaningfulAt = performance.now();
      let lastMeaningfulSignature = "";
      let noProgressChunkStreak = 0;
      let nonMeaningfulGrowth = 0;

      for await (const chunk of stream) {
        const now = performance.now();
        chunkCount += 1;
        if (firstChunkAt === null) firstChunkAt = now;
        const textChunk = String(chunk);
        const newText = textChunk.startsWith(text) ? textChunk : text + textChunk;

        const newMeaningfulSignature = LanguageModelGuard.meaningfulSignature(newText);

        if (newMeaningfulSignature !== lastMeaningfulSignature) {
          lastMeaningfulAt = now;
          lastMeaningfulSignature = newMeaningfulSignature;
          noProgressChunkStreak = 0;
          nonMeaningfulGrowth = 0;
        } else {
          noProgressChunkStreak += 1;
          nonMeaningfulGrowth += Math.max(0, newText.length - text.length);
        }
        text = newText;
        onChunk(text);

        if (LanguageModelGuard.hasRepetitionLoop(text)) {
          truncated = true;
          truncatedReason = "repetition_stream";
          break;
        }
        if (noProgressChunkStreak >= 30 || nonMeaningfulGrowth >= 80 || LanguageModelGuard.hasTerminatorLoop(text)) {
          truncated = true;
          truncatedReason = "blank_stream";
          break;
        }
        if (now - lastMeaningfulAt > AppConfig.streaming.staleMs) {
          truncated = true;
          truncatedReason = "stale_stream";
          break;
        }
        if (now - startedAt > AppConfig.streaming.maxStreamMs) {
          truncated = true;
          truncatedReason = "max_stream_ms";
          break;
        }
      }
    } else {
      const timeoutMs = AppConfig.streaming.maxStreamMs;
      const result = await Promise.race([
        targetSession.prompt(prompt, PromptOptionsConfig),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (result === null) {
        truncated = true;
        truncatedReason = "non_stream_timeout";
      } else {
        text = result;
      }
    }

    return {
      text,
      usedStreaming,
      firstChunkMs: firstChunkAt === null ? null : Math.round(firstChunkAt - startedAt),
      chunkCount,
      elapsedMs: Math.round(performance.now() - startedAt),
      truncated,
      truncatedReason,
    };
  }
}
