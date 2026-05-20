import { ResponseContract } from "../config.js";
import type { LanguageModelPrompt, LanguageModelSession, RepairAttempt, RepairReason } from "../types.js";
import { JsonTools } from "../utils/json-tools.js";
import { LanguageModelGuard } from "./language-model-guard.js";
import { PromptExecutor } from "./prompt-executor.js";

export class ModelRepairEngine {
  private readonly executor: PromptExecutor;

  constructor(executor: PromptExecutor) {
    this.executor = executor;
  }

  buildRepairAttempt(
    reason: RepairReason,
    elapsedMs: number,
    accepted: boolean,
    improved: boolean,
    truncated: boolean,
    scoreBefore: number,
    scoreAfter: number,
    response: string,
  ): RepairAttempt {
    return {
      reason,
      elapsedMs,
      accepted,
      improved,
      scoreDelta: scoreAfter - scoreBefore,
      truncated,
      scoreBefore,
      scoreAfter,
      outputChars: response.length,
    };
  }

  private withExtraInstruction(prompt: LanguageModelPrompt, extraInstruction: string): LanguageModelPrompt {
    return prompt.map((message, index) => {
      if (index !== 0) return message;
      return {
        ...message,
        content: [
          { type: "text", value: extraInstruction },
          ...message.content,
        ],
      };
    });
  }

  async runAudioRetry(
    baseSession: LanguageModelSession,
    prompt: LanguageModelPrompt,
    useStreaming: boolean,
    onChunk: (text: string) => void,
    parsed: any,
    audioDurationMs?: number | null,
    codeDetected?: boolean
  ): Promise<{ response: string; parsed: any; attempt: RepairAttempt; elapsedMs: number }> {
    const startedAt = performance.now();
    const retrySession = typeof baseSession.clone === "function" ? await baseSession.clone() : baseSession;

    try {
      const firstPassCorrections = (parsed?.phonetic_corrections ?? [])
        .filter((c: string) => {
          const lower = c.toLowerCase();
          return !lower.includes("mismatched") && !lower.includes("resuelta") && !lower.includes("hablado") && !lower.includes("symbol");
        });
      const correctionsText = firstPassCorrections.length > 0
        ? [
            "We detected the following phonetic/syntax mismatches between the ASR transcript and expected code identifiers (correct and reflect these):",
            ...firstPassCorrections.map((c: any) => `- ${c}`),
            "Fix these variable names and operators in the final XML (<code> and <phonetic_corrections> tags)."
          ].join("\n")
        : "";

      const extraCodeInstruction = codeDetected
        ? "CRITICAL: Code patterns were detected in the ASR transcript. You MUST generate <code> with the reconstructed code. Empty <code> is an ERROR. Analyze the transcript and rebuild the correct syntax."
        : "";

      const negativeCodeInstruction = "CRITICAL: The <code> block must contain ONLY pure, raw programming code. Do NOT output XML/HTML tags (such as <correction> or </correction>) inside the <code> block. Never nest <correction> tags.";

      const retryPrompt = this.withExtraInstruction(prompt, [
        "The previous pass returned empty or low-quality fields.",
        "Previous draft detected:",
        `- Transcript: "${parsed?.transcript ?? ""}"`,
        `- Code: "${parsed?.code ?? ""}"`,
        `- Answer: "${parsed?.answer ?? ""}"`,
        correctionsText,
        extraCodeInstruction,
        negativeCodeInstruction,
        "Re-read the ASR transcript carefully. Merge the correct info from the previous draft with the transcript text.",
        "If the ASR transcript mentions elements like parentheses, quotes, colons, braces, etc., translate these operators correctly into the code.",
        "Update the 'phonetic_corrections' list with detected and resolved discrepancies.",
        "Return ONLY the requested XML inside <response>...</response>. Do not use Markdown code fences. Do not leave transcript empty if the transcript contains speech. Do not copy instructions.",
      ].filter(Boolean).join("\n"));

      const retry = await this.executor.runPrompt(retrySession, retryPrompt, useStreaming, onChunk);
      const retryResponse = retry.truncated ? retry.text.trimEnd() : retry.text;
      const retryParsed = JsonTools.extractResponse(retryResponse);

      const scoreBefore = LanguageModelGuard.parsedContentScore(parsed);
      const scoreAfter = LanguageModelGuard.parsedContentScore(retryParsed);
      const accepted = scoreAfter >= scoreBefore;
      const improved = scoreAfter > scoreBefore;

      const elapsedMs = Math.round(performance.now() - startedAt);
      const attempt = this.buildRepairAttempt(
        "asr_text_retry",
        elapsedMs,
        accepted,
        improved,
        retry.truncated,
        scoreBefore,
        scoreAfter,
        retryResponse
      );

      return {
        response: accepted ? retryResponse : JsonTools.serializeToXml(parsed),
        parsed: accepted ? retryParsed : parsed,
        attempt,
        elapsedMs
      };
    } finally {
      if (retrySession !== baseSession && typeof retrySession.destroy === "function") {
        retrySession.destroy();
      }
    }
  }

  async runJsonRepair(
    baseSession: LanguageModelSession,
    response: string,
    onChunk: (text: string) => void,
    bestParsed: any
  ): Promise<{ response: string; parsed: any; attempt: RepairAttempt; elapsedMs: number }> {
    const startedAt = performance.now();
    const repairSession = typeof baseSession.clone === "function" ? await baseSession.clone() : baseSession;

    try {
      const repairPrompt = [
        ResponseContract,
        "",
        "The previous pass returned this text without valid XML formatting. Treat it as a candidate transcript if it looks like what the user said.",
        "Now generate ONLY the requested XML inside <response>...</response>.",
        "",
        "Previous pass text:",
        response,
      ].join("\n");

      const repair = await this.executor.runPrompt(repairSession, repairPrompt, true, onChunk);
      const repairResponse = repair.text;
      const repairParsed = JsonTools.extractResponse(repairResponse);

      const scoreBefore = LanguageModelGuard.parsedContentScore(bestParsed);
      const scoreAfter = LanguageModelGuard.parsedContentScore(repairParsed);
      const accepted = scoreAfter >= scoreBefore;
      const improved = scoreAfter > scoreBefore;

      const elapsedMs = Math.round(performance.now() - startedAt);
      const attempt = this.buildRepairAttempt(
        "json_repair",
        elapsedMs,
        accepted,
        improved,
        repair.truncated,
        scoreBefore,
        scoreAfter,
        repairResponse
      );

      return {
        response: accepted ? repairResponse : response,
        parsed: accepted ? repairParsed : bestParsed,
        attempt,
        elapsedMs
      };
    } finally {
      if (repairSession !== baseSession && typeof repairSession.destroy === "function") {
        repairSession.destroy();
      }
    }
  }

  async runSelfRefinement(
    baseSession: LanguageModelSession,
    parsed: any,
    useStreaming: boolean,
    onChunk: (text: string) => void
  ): Promise<{ response: string; parsed: any; attempt: RepairAttempt; elapsedMs: number }> {
    const startedAt = performance.now();
    const refinementSession = typeof baseSession.clone === "function" ? await baseSession.clone() : baseSession;

    try {
      const firstPassCorrections = (parsed?.phonetic_corrections ?? [])
        .filter((c: string) => {
          const lower = c.toLowerCase();
          return !lower.includes("mismatched") && !lower.includes("resuelta") && !lower.includes("hablado") && !lower.includes("symbol");
        });
      const correctionsText = firstPassCorrections.length > 0
        ? [
            "We detected the following phonetic/syntax corrections or mismatches in your initial draft:",
            ...firstPassCorrections.map((c: any) => `- ${c}`),
            "Please fix these variable and operator names in the final code and transcript, and reflect the resolved/mismatched corrections inside the 'phonetic_corrections' XML structure using <correction> tags."
          ].join("\n")
        : "";

      const cleanParsed = parsed ? {
        ...parsed,
        phonetic_corrections: (parsed.phonetic_corrections ?? []).filter((c: string) => {
          const lower = c.toLowerCase();
          return !lower.includes("mismatched") && !lower.includes("resuelta") && !lower.includes("hablado") && !lower.includes("symbol");
        })
      } : null;

      const refinementPrompt = [
        "You are DuckRubber in cognitive self-refinement mode.",
        "Analyze your previous draft XML and return corrected XML enclosed in <response> with exactly these elements: think, tags, transcript, code, answer, directed, lang, needs_context, phonetic_corrections.",
        "1. Fix any unclosed quotes, floating double quotes, or broken escape characters inside code.",
        "2. Balance all parentheses, curly braces, and square brackets in code that were left open or dangling.",
        "3. Translate any raw spoken punctuation or phonetic operators in code (e.g. parentesis, comillas, dos puntos, igual igual, llave) into code syntax.",
        correctionsText,
        "4. Keep tags first, then transcript, code, answer, directed, lang, needs_context, phonetic_corrections.",
        "5. tags must be at most 8 comma-separated clues; never copy transcript into tags.",
        "6. In 'phonetic_corrections', list the final resolved or mismatched phonetic corrections inside <correction> tags.",
        "7. The <code> block must contain ONLY pure, raw programming code. Do NOT output XML/HTML tags (such as <correction> or </correction>) inside the <code> block. Never nest <correction> tags.",
        "8. Return ONLY the complete, valid XML structure. No markdown backticks, no pre-text, no post-text, and no explanation.",
        "",
        "Previous draft XML to refine:",
        JsonTools.serializeToXml(cleanParsed),
      ].filter(Boolean).join("\n");

      const refinement = await this.executor.runPrompt(refinementSession, refinementPrompt, useStreaming, onChunk);
      const refinementResponse = refinement.truncated ? refinement.text.trimEnd() : refinement.text;
      const refinementParsed = JsonTools.extractResponse(refinementResponse);

      const scoreBefore = LanguageModelGuard.parsedContentScore(parsed);
      const scoreAfter = LanguageModelGuard.parsedContentScore(refinementParsed);
      const accepted = scoreAfter >= scoreBefore;
      const improved = scoreAfter > scoreBefore;

      const elapsedMs = Math.round(performance.now() - startedAt);
      const attempt = this.buildRepairAttempt(
        "self_refinement",
        elapsedMs,
        accepted,
        improved,
        refinement.truncated,
        scoreBefore,
        scoreAfter,
        refinementResponse
      );

      return {
        response: accepted ? refinementResponse : JsonTools.serializeToXml(parsed),
        parsed: accepted ? refinementParsed : parsed,
        attempt,
        elapsedMs
      };
    } finally {
      if (refinementSession !== baseSession && typeof refinementSession.destroy === "function") {
        refinementSession.destroy();
      }
    }
  }
}
