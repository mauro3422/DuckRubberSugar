import { AppConfig } from "../config.js";
import type { BenchmarkEntry, Report } from "../types.js";
import { BenchmarkDiagnostics } from "./benchmark-diagnostics.js";

export class BenchmarkMapper {
  static fromReport(report: Report): BenchmarkEntry {
    const parsed = report.parsed || {};
    // diagnostics are calculated here but not actively persisted to the DB row
    // they are computed at export time by BenchmarkExporter
    // const diagnostics = BenchmarkDiagnostics.analyzeReport(report); 

    return {
      at: report.generatedAt,
      promptVersion: report.promptVersion,
      caseId: report.testCase?.id,
      fileName: report.testCase?.fileName,
      audioSize: report.metrics?.audioSize ?? null,
      audioDurationMs: report.metrics?.audioDurationMs ?? null,
      totalMs: report.metrics?.totalMs ?? null,
      firstChunkMs: report.metrics?.firstChunkMs ?? null,
      tokensPerSecond: report.metrics?.tokensPerSecond ?? null,
      charsPerSecond: report.metrics?.charsPerSecond ?? null,
      transcriptSimilarity: report.transcriptDiff?.similarity ?? null,
      transcriptDistance: report.transcriptDiff?.distance ?? null,
      codeSimilarity: report.codeDiff?.similarity ?? null,
      codeDistance: report.codeDiff?.distance ?? null,
      is_directed: parsed.is_directed,
      lang: parsed.lang ?? "",
      needs_context: parsed.needs_context ?? false,
      code: parsed.code ?? "",
      code_origin: parsed.code_origin ?? "",
      code_tags: parsed.code_tags ?? [],
      transcript: parsed.transcript ?? "",
      answer: this.compactText(parsed.answer ?? "", 700),
      rawOutputHead: this.compactText(report.rawOutput, 500),
      rawOutputTail: this.tailText(report.rawOutput, 500),

      // Dialogue analysis fields
      interaction_category: parsed.interaction_category ?? "",
      dialogue_flow: parsed.dialogue_flow ?? "",
      detected_topics: parsed.detected_topics ?? [],
      suggested_questions: parsed.suggested_questions ?? [],
      phonetic_corrections: parsed.phonetic_corrections ?? [],

      contextUsage: report.metrics?.contextUsage ?? null,
      contentTokensPerSecond: report.metrics?.contentTokensPerSecond ?? null,
      repairPassMs: report.metrics?.repairPassMs ?? null,
      repairAttemptCount: report.metrics?.repairAttemptCount ?? 0,
      repairReasons: report.metrics?.repairReasons ?? {},
      repairAttempts: report.metrics?.repairAttempts ?? [],
      fallbackUsed: report.metrics?.fallbackUsed ?? false,
      truncated: report.metrics?.truncated ?? false,
      truncatedReason: report.metrics?.truncatedReason ?? null,
      outputTail: report.metrics?.outputTail ?? null,
    };
  }

  static compactText(text: string, maxChars: number): string {
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...`;
  }

  static tailText(text: string, maxChars: number): string {
    return text.length <= maxChars ? text : `...${text.slice(-maxChars)}`;
  }

  static rawOutputDiagnostics(rawOutput: string): Record<string, unknown> {
    const text = rawOutput.trim();
    return {
      rawOutputHead: this.compactText(rawOutput, 500),
      rawOutputTail: this.tailText(rawOutput, 500),
      rawLooksLikeJson: text.startsWith("{"),
      rawLooksIncompleteJson: text.startsWith("{") && !text.endsWith("}"),
      rawHasCodeKey: /"(?:code|c)"\s*:/.test(rawOutput),
      rawHasTranscriptKey: /"(?:transcript|t)"\s*:/.test(rawOutput),
      rawHasAnswerKey: /"(?:answer|a)"\s*:/.test(rawOutput),
      rawCodeField: this.extractRawJsonString(rawOutput, "code") ?? this.extractRawJsonString(rawOutput, "c"),
      rawTranscriptField: this.extractRawJsonString(rawOutput, "transcript") ?? this.extractRawJsonString(rawOutput, "t"),
    };
  }

  static extractRawJsonString(rawOutput: string, key: string): string | null {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
    const match = rawOutput.match(pattern);
    if (!match) return null;
    return this.compactText(match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"), 500);
  }
}
