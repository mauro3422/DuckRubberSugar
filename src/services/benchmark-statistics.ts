import type { BenchmarkEntry } from "../types.js";
import { CodeAnalysis } from "../utils/code-analysis.js";
import { LanguageModelGuard } from "./language-model-guard.js";
import { DefaultDataset } from "../data/default-dataset.js";

export type BenchmarkSummary = {
  transcriptAvg: number | null;
  transcriptMin: number | null;
  transcriptMax: number | null;
  codeAvg: number | null;
  codeMin: number | null;
  codeMax: number | null;
  codeScoredRuns: number;
  codeCoverage: number;
  codeGeneratedCount: number;
  codeGenerationRate: number;
  usefulCodeCount: number;
  usefulCodeRate: number;
  emptyCodeCount: number;
  totalAvg: number | null;
  firstChunkAvg: number | null;
  tokPerSecAvg: number | null;
  contentTokPerSecAvg: number | null;
  repairRunCount: number;
  repairRunRate: number;
  repairAttemptCount: number;
  repairAttemptAvg: number | null;
  repairAcceptedCount: number;
  repairRejectedCount: number;
  repairAcceptedRate: number;
  repairImprovedCount: number;
  repairTieCount: number;
  repairWorseCount: number;
  repairImprovedRate: number;
  repairPassAvgMs: number | null;
  repairReasons: Record<string, number>;
  fallbackUsedCount: number;
  truncatedCount: number;
  truncatedByReason: Record<string, number>;
  confidenceBuckets: {
    high: number;
    doubt_flagged: number;
    casual_chat: number;
  };
  codeTranscriptMismatches: {
    total: number;
    byType: Record<string, number>;
  };
};

export class BenchmarkStatistics {
  static summarize(entries: BenchmarkEntry[]): BenchmarkSummary {
    const transcript = entries.map((entry) => entry.transcriptSimilarity);
    const code = entries.map((entry) => entry.codeSimilarity);
    const transcriptRange = this.minMax(transcript);
    const codeRange = this.minMax(code);
    const codeScoredRuns = code.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).length;
    const codeGeneratedCount = entries.filter((entry) => (entry.code ?? "").trim()).length;
    const usefulCodeCount = entries.filter((entry) => this.looksUsefulCode(entry.code ?? "")).length;
    const repairAttemptCount = entries.reduce((sum, entry) => sum + (entry.repairAttemptCount ?? 0), 0);
    const repairAcceptedCount = entries.reduce((sum, entry) => sum + (entry.repairAttempts ?? []).filter((attempt) => attempt.accepted).length, 0);
    const repairImprovedCount = entries.reduce((sum, entry) => sum + (entry.repairAttempts ?? []).filter((attempt) => this.repairDelta(attempt) > 0).length, 0);
    const repairTieCount = entries.reduce((sum, entry) => sum + (entry.repairAttempts ?? []).filter((attempt) => this.repairDelta(attempt) === 0).length, 0);
    const repairWorseCount = entries.reduce((sum, entry) => sum + (entry.repairAttempts ?? []).filter((attempt) => this.repairDelta(attempt) < 0).length, 0);

    let high = 0;
    let doubt_flagged = 0;
    let casual_chat = 0;
    let mismatchTotal = 0;
    const mismatchTypeCounts: Record<string, number> = {};

    for (const entry of entries) {
      const codeStr = (entry.code ?? "").trim();
      const transcriptStr = (entry.transcript ?? "").trim();
      const caseId = entry.caseId || "";
      const expectedCode = DefaultDataset.cases.find((tc) => tc.id === caseId || tc.fileName === entry.fileName)?.expectedCode ?? "";

      const mismatches = LanguageModelGuard.detectTranscriptCodeMismatch(transcriptStr, codeStr);
      const hasMismatches = mismatches.length > 0;
      const hasDoubtTags = /(duda|dudas|corregir|incompleto|interrumpido|error|ambiguo|confuso)/i.test(entry.thought_tags ?? "");
      const isHighSimilarity = (entry.transcriptSimilarity ?? 0) >= 0.65 && (entry.codeSimilarity ?? 0) >= 0.65;

      if (!expectedCode && !codeStr) {
        casual_chat += 1;
      } else if (hasDoubtTags || hasMismatches) {
        doubt_flagged += 1;
      } else if (isHighSimilarity) {
        high += 1;
      } else {
        high += 1;
      }

      if (hasMismatches) {
        mismatchTotal += 1;
        for (const m of mismatches) {
          mismatchTypeCounts[m] = (mismatchTypeCounts[m] ?? 0) + 1;
        }
      }
    }

    return {
      transcriptAvg: this.average(transcript),
      transcriptMin: transcriptRange.min,
      transcriptMax: transcriptRange.max,
      codeAvg: this.average(code),
      codeMin: codeRange.min,
      codeMax: codeRange.max,
      codeScoredRuns,
      codeCoverage: entries.length ? codeScoredRuns / entries.length : 0,
      codeGeneratedCount,
      codeGenerationRate: entries.length ? codeGeneratedCount / entries.length : 0,
      usefulCodeCount,
      usefulCodeRate: entries.length ? usefulCodeCount / entries.length : 0,
      emptyCodeCount: entries.filter((entry) => !(entry.code ?? "").trim()).length,
      totalAvg: this.average(entries.map((entry) => entry.totalMs)),
      firstChunkAvg: this.average(entries.map((entry) => entry.firstChunkMs)),
      tokPerSecAvg: this.average(entries.map((entry) => entry.tokensPerSecond)),
      contentTokPerSecAvg: this.average(entries.map((entry) => entry.contentTokensPerSecond)),
      repairRunCount: entries.filter((entry) => (entry.repairAttemptCount ?? 0) > 0).length,
      repairRunRate: entries.length ? entries.filter((entry) => (entry.repairAttemptCount ?? 0) > 0).length / entries.length : 0,
      repairAttemptCount,
      repairAttemptAvg: this.average(entries.map((entry) => entry.repairAttemptCount ?? 0)),
      repairAcceptedCount,
      repairRejectedCount: repairAttemptCount - repairAcceptedCount,
      repairAcceptedRate: repairAttemptCount ? repairAcceptedCount / repairAttemptCount : 0,
      repairImprovedCount,
      repairTieCount,
      repairWorseCount,
      repairImprovedRate: repairAttemptCount ? repairImprovedCount / repairAttemptCount : 0,
      repairPassAvgMs: this.average(entries.map((entry) => entry.repairPassMs ?? null)),
      repairReasons: this.countRepairReasons(entries),
      fallbackUsedCount: entries.filter((entry) => entry.fallbackUsed).length,
      truncatedCount: entries.filter((entry) => entry.truncated).length,
      truncatedByReason: this.countTruncatedByReason(entries),
      confidenceBuckets: {
        high,
        doubt_flagged,
        casual_chat,
      },
      codeTranscriptMismatches: {
        total: mismatchTotal,
        byType: mismatchTypeCounts,
      },
    };
  }

  private static average(values: Array<number | null>): number | null {
    const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  private static minMax(values: Array<number | null>): { min: number | null; max: number | null } {
    const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (!valid.length) return { min: null, max: null };
    return { min: Math.min(...valid), max: Math.max(...valid) };
  }

  private static looksUsefulCode(code: string): boolean {
    const text = code.trim();
    if (!text) return false;
    if (/^console\.log\s*;?$/i.test(text)) return false;
    if (/^console\.log\s*\(\s*$/i.test(text)) return false;
    if (/^console\.log\s*\(\s*\(\s*\)\s*=>/i.test(text)) return false;
    if (/=>\s*\{\s*[\p{L}\s]+[.!?]?\s*\}/u.test(text)) return false;
    if (/\{\s*(?:prueba|codigo|c[oó]digo|exitosa|hola|mundo)\b[^"'`]*\}/iu.test(text)) return false;
    if (this.looksLikeProseCode(text)) return false;
    if (CodeAnalysis.hasUnbalancedDelimiters(text)) return false;
    return true;
  }

  private static looksLikeProseCode(value: string): boolean {
    const text = value.trim().toLowerCase();
    if (/^(hola|estoy|necesito|bueno|okay)\b/.test(text)) return true;
    if (/[?¿]/.test(value)) return true;

    const words = text.match(/\b[a-záéíóúñ]{3,}\b/gi) ?? [];
    const proseHits = (text.match(/\b(hola|estas|estoy|haciendo|mediante|todavia|todavía|modelo|codigo|código|ahora|parte|donde|despues|después|toca|contador|equivoco|necesito|bueno|okay|chao)\b/g) ?? []).length;
    const syntaxHits = (value.match(/[()[\]{}=;:]|=>|\./g) ?? []).length;
    return words.length >= 18 && proseHits >= 4 && syntaxHits < proseHits + 4;
  }

  private static countTruncatedByReason(entries: BenchmarkEntry[]): Record<string, number> {
    return entries.reduce<Record<string, number>>((acc, entry) => {
      if (!entry.truncated) return acc;
      const reason = entry.truncatedReason ?? "unknown";
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});
  }

  private static countRepairReasons(entries: BenchmarkEntry[]): Record<string, number> {
    return entries.reduce<Record<string, number>>((acc, entry) => {
      for (const [reason, count] of Object.entries(entry.repairReasons ?? {})) {
        acc[reason] = (acc[reason] ?? 0) + count;
      }
      return acc;
    }, {});
  }

  private static repairDelta(attempt: { scoreDelta?: number | null; scoreBefore: number | null; scoreAfter: number | null }): number {
    if (typeof attempt.scoreDelta === "number" && Number.isFinite(attempt.scoreDelta)) return attempt.scoreDelta;
    if (typeof attempt.scoreBefore === "number" && typeof attempt.scoreAfter === "number") {
      return attempt.scoreAfter - attempt.scoreBefore;
    }
    return 0;
  }
}
