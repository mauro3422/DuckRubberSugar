import type { LanguageModelSession } from "../types.js";
import { CodeIntentGuard } from "./code-intent-guard.js";
import { JsonTools } from "./json-tools.js";

export interface CodeIntentRepairResult {
  accepted: boolean;
  responseText: string;
  parsed: ReturnType<typeof JsonTools.extractResponse>;
  issues: string[];
  repairedIssues: string[];
  reason?: string;
}

export class CodeIntentRepairer {
  async repair(
    session: LanguageModelSession,
    transcript: string,
    history: any[],
    responseText: string,
    parsed: ReturnType<typeof JsonTools.extractResponse>
  ): Promise<CodeIntentRepairResult> {
    const audit = CodeIntentGuard.audit({
      transcript,
      code: parsed?.code,
      answer: parsed?.answer,
      history,
    });

    if (!audit.hasIntent || audit.issues.length === 0) {
      return { accepted: false, responseText, parsed, issues: [], repairedIssues: [] };
    }

    const historyLines = history
      .filter((entry) => entry?.role === "user" || entry?.role === "ai")
      .slice(-10)
      .map((entry) => {
        if (entry.role === "user") return `User: ${entry.text || ""}`;
        const parts = [`Answer: ${entry.answer || ""}`];
        if (entry.code) parts.push(`Code:\n${entry.code}`);
        return `Duck: ${parts.join("\n")}`;
      })
      .join("\n");

    const repairPrompt = [
      "[CODE INTENT REPAIR]",
      "The user explicitly asked for code, but the previous response did not satisfy the code contract.",
      "Repair the response generically using the conversation context. Do not assume a fixed topic.",
      "Return ONLY valid JSON with fields: think, tags, transcript, code, answer, directed, lang, needs_context, phonetic_corrections.",
      'The "code" field must contain complete runnable code when the user asked for code.',
      'If the user asked to extend previous code, return a complete self-contained updated snippet, not only the delta.',
      "Fix these issues:",
      ...audit.issues.map((issue) => `- ${issue}`),
      "",
      "[CONVERSATION HISTORY]",
      historyLines || "(empty)",
      "[END CONVERSATION HISTORY]",
      "",
      `[CURRENT USER TRANSCRIPT]\n${transcript}`,
      "",
      "[PREVIOUS MODEL RESPONSE]",
      parsed ? JsonTools.serializeToXml(parsed) : responseText,
    ].join("\n");

    try {
      const repairedText = await this.runRepairPrompt(session, repairPrompt);
      const repairedParsed = JsonTools.extractResponse(repairedText);
      const repairedAudit = CodeIntentGuard.audit({
        transcript,
        code: repairedParsed?.code,
        answer: repairedParsed?.answer,
        history,
      });

      if (repairedParsed && repairedAudit.issues.length < audit.issues.length) {
        return {
          accepted: true,
          responseText: repairedText,
          parsed: repairedParsed,
          issues: audit.issues,
          repairedIssues: repairedAudit.issues,
        };
      }

      return {
        accepted: false,
        responseText,
        parsed,
        issues: audit.issues,
        repairedIssues: repairedAudit.issues,
        reason: repairedParsed ? "repair-not-better" : "repair-unparsed",
      };
    } catch (error) {
      return {
        accepted: false,
        responseText,
        parsed,
        issues: audit.issues,
        repairedIssues: [],
        reason: (error as Error).message,
      };
    }
  }

  private async runRepairPrompt(session: LanguageModelSession, prompt: string): Promise<string> {
    const timeoutMs = 10_000;
    if (typeof session.prompt === "function") {
      const result = await Promise.race([
        session.prompt(prompt),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (result === null) throw new Error("code intent repair timed out");
      return String(result);
    }

    if (typeof session.promptStreaming !== "function") {
      throw new Error("no prompt API available for code intent repair");
    }

    let text = "";
    const started = performance.now();
    const gen = session.promptStreaming(prompt);
    for await (const chunk of gen) {
      text = String(chunk).startsWith(text) ? String(chunk) : text + String(chunk);
      if (performance.now() - started > timeoutMs) break;
    }
    return text;
  }
}
