import { AppConfig } from "../config.js";
import type { BenchmarkEntry, Report } from "../types.js";
import { DefaultDataset } from "../data/default-dataset.js";
import { BenchmarkStatistics, BenchmarkSummary } from "./benchmark-statistics.js";
import { BenchmarkDiagnostics, CalculatedDiagnostics } from "./benchmark-diagnostics.js";

export type { CalculatedDiagnostics };

export class BenchmarkExporter {
  exportPayload(entries: BenchmarkEntry[]): {
    promptVersion: string;
    generatedAt: string;
    count: number;
    summary: BenchmarkSummary;
    entries: BenchmarkEntry[];
  } {
    return {
      promptVersion: AppConfig.promptVersion,
      generatedAt: new Date().toISOString(),
      count: entries.length,
      summary: BenchmarkStatistics.summarize(entries),
      entries,
    };
  }

  exportCodexSummary(entries: BenchmarkEntry[], latestReport: Report | null): unknown {
    const summary = BenchmarkStatistics.summarize(entries);
    return {
      kind: "ducksugar-codex-summary",
      promptVersion: AppConfig.promptVersion,
      generatedAt: new Date().toISOString(),
      summary: {
        runs: entries.length,
        transcriptAvg: summary.transcriptAvg,
        transcriptMin: summary.transcriptMin,
        transcriptMax: summary.transcriptMax,
        codeAvg: summary.codeAvg,
        codeMin: summary.codeMin,
        codeMax: summary.codeMax,
        codeScoredRuns: summary.codeScoredRuns,
        codeCoverage: summary.codeCoverage,
        codeGeneratedCount: summary.codeGeneratedCount,
        codeGenerationRate: summary.codeGenerationRate,
        usefulCodeCount: summary.usefulCodeCount,
        usefulCodeRate: summary.usefulCodeRate,
        emptyCodeCount: summary.emptyCodeCount,
        totalAvgMs: summary.totalAvg,
        firstChunkAvgMs: summary.firstChunkAvg,
        tokensPerSecondAvg: summary.tokPerSecAvg,
        contentTokensPerSecondAvg: summary.contentTokPerSecAvg,
        repairRunCount: summary.repairRunCount,
        repairRunRate: summary.repairRunRate,
        repairAttemptCount: summary.repairAttemptCount,
        repairAttemptAvg: summary.repairAttemptAvg,
        repairAcceptedCount: summary.repairAcceptedCount,
        repairRejectedCount: summary.repairRejectedCount,
        repairAcceptedRate: summary.repairAcceptedRate,
        repairImprovedCount: summary.repairImprovedCount,
        repairTieCount: summary.repairTieCount,
        repairWorseCount: summary.repairWorseCount,
        repairImprovedRate: summary.repairImprovedRate,
        repairPassAvgMs: summary.repairPassAvgMs,
        repairReasons: summary.repairReasons,
        fallbackUsedCount: summary.fallbackUsedCount,
        truncatedCount: summary.truncatedCount,
        truncatedByReason: summary.truncatedByReason,
        confidenceBuckets: summary.confidenceBuckets,
        codeTranscriptMismatches: summary.codeTranscriptMismatches,
        codeOrigins: BenchmarkDiagnostics.countEntryField(entries, (entry) => entry.code_origin ?? ""),
        codeTags: BenchmarkDiagnostics.countEntryFlags(entries, (entry) => entry.code_tags ?? []),
        qualityBuckets: BenchmarkDiagnostics.countQualityBuckets(entries),
        contextNeeds: BenchmarkDiagnostics.countEntryField(entries, (entry) => BenchmarkDiagnostics.analyzeEntry(entry).contextNeed),
        rejectionReasons: BenchmarkDiagnostics.countEntryField(entries, (entry) => BenchmarkDiagnostics.analyzeEntry(entry).rejectionReason),
        placeholderFlags: BenchmarkDiagnostics.countEntryFlags(entries, (entry) => BenchmarkDiagnostics.analyzeEntry(entry).placeholderFlags),
        hallucinationFlags: BenchmarkDiagnostics.countEntryFlags(entries, (entry) => BenchmarkDiagnostics.analyzeEntry(entry).hallucinationFlags),
        semanticMisrecognitions: BenchmarkDiagnostics.countEntryFlags(entries, (entry) => BenchmarkDiagnostics.analyzeEntry(entry).semanticMisrecognitions),
        codeHealthFlags: BenchmarkDiagnostics.countEntryFlags(entries, (entry) => BenchmarkDiagnostics.analyzeEntry(entry).codeHealthFlags),
        answerQuality: BenchmarkDiagnostics.countEntryFlags(entries, (entry) => BenchmarkDiagnostics.analyzeEntry(entry).answerQuality),
        interactionCategories: BenchmarkDiagnostics.countEntryField(entries, (entry) => BenchmarkDiagnostics.analyzeEntry(entry).interactionCategory),
        dialogueFlows: BenchmarkDiagnostics.countEntryField(entries, (entry) => BenchmarkDiagnostics.analyzeEntry(entry).dialogueFlow),
        detectedTopics: BenchmarkDiagnostics.countEntryFlags(entries, (entry) => BenchmarkDiagnostics.analyzeEntry(entry).detectedTopics),
      },
      cases: this.summarizeCases(entries),
      latest: latestReport && this.isMeaningfulReport(latestReport)
        ? this.compactLatest(latestReport)
        : this.compactEntry(entries.at(-1) ?? null),
      copyGuidance: {
        useThisFor: "quality review, prompt comparison, and asking Codex what to improve",
        useFullLogOnlyFor: "streaming, clipboard, session, parse, or UI bugs",
      },
    };
  }

  private summarizeCases(entries: BenchmarkEntry[]): unknown[] {
    return Array.from(this.groupEntries(entries).entries()).map(([key, group]) => {
      const datasetCase = DefaultDataset.cases.find((testCase) => testCase.id === key);
      const groupSummary = BenchmarkStatistics.summarize(group);
      return {
        caseId: datasetCase?.id ?? key,
        fileName: datasetCase?.fileName ?? group[0]?.fileName ?? null,
        runs: group.length,
        expectedCode: datasetCase?.expectedCode ?? null,
        expectedTranscriptChars: datasetCase?.expectedTranscript.length ?? null,
        transcriptAvg: groupSummary.transcriptAvg,
        codeAvg: groupSummary.codeAvg,
        codeScoredRuns: groupSummary.codeScoredRuns,
        codeCoverage: groupSummary.codeCoverage,
        codeGeneratedCount: groupSummary.codeGeneratedCount,
        codeGenerationRate: groupSummary.codeGenerationRate,
        usefulCodeCount: groupSummary.usefulCodeCount,
        usefulCodeRate: groupSummary.usefulCodeRate,
        emptyCodeCount: groupSummary.emptyCodeCount,
        repairRunCount: groupSummary.repairRunCount,
        repairRunRate: groupSummary.repairRunRate,
        repairAttemptCount: groupSummary.repairAttemptCount,
        repairAcceptedCount: groupSummary.repairAcceptedCount,
        repairRejectedCount: groupSummary.repairRejectedCount,
        repairAcceptedRate: groupSummary.repairAcceptedRate,
        repairImprovedCount: groupSummary.repairImprovedCount,
        repairTieCount: groupSummary.repairTieCount,
        repairWorseCount: groupSummary.repairWorseCount,
        repairImprovedRate: groupSummary.repairImprovedRate,
        repairPassAvgMs: groupSummary.repairPassAvgMs,
        repairReasons: groupSummary.repairReasons,
        fallbackUsedCount: groupSummary.fallbackUsedCount,
        qualityBuckets: BenchmarkDiagnostics.countQualityBuckets(group),
        bestRun: this.compactEntry(BenchmarkDiagnostics.pickBest(group)),
        worstRun: this.compactEntry(BenchmarkDiagnostics.pickWorst(group)),
        commonFailures: BenchmarkDiagnostics.detectCommonFailures(group),
      };
    });
  }

  private groupEntries(entries: BenchmarkEntry[]): Map<string, BenchmarkEntry[]> {
    const groups = new Map<string, BenchmarkEntry[]>();
    for (const entry of entries) {
      const key = entry.caseId || BenchmarkDiagnostics.inferCaseId(entry) || `audio-${Math.round((entry.audioDurationMs ?? 0) / 1000)}s`;
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return groups;
  }

  private compactLatest(report: Report): unknown {
    const parsed = report.parsed || {};
    const diagnostics = BenchmarkDiagnostics.analyzeReport(report);
    return {
      generatedAt: report.generatedAt,
      caseId: report.testCase?.id ?? null,
      fileName: report.testCase?.fileName ?? null,
      metrics: {
        totalMs: report.metrics?.totalMs ?? null,
        firstChunkMs: report.metrics?.firstChunkMs ?? null,
        audioDurationMs: report.metrics?.audioDurationMs ?? null,
        outputTokensApprox: report.metrics?.outputTokensApprox ?? null,
        contentTokensPerSecond: report.metrics?.contentTokensPerSecond ?? null,
        truncated: report.metrics?.truncated ?? false,
        truncatedReason: report.metrics?.truncatedReason ?? null,
        contextUsage: report.metrics?.contextUsage ?? null,
        repairPassMs: report.metrics?.repairPassMs ?? null,
        repairAttemptCount: report.metrics?.repairAttemptCount ?? 0,
        repairReasons: report.metrics?.repairReasons ?? {},
        fallbackUsed: report.metrics?.fallbackUsed ?? false,
      },
      scores: {
        transcriptSimilarity: report.transcriptDiff?.similarity ?? null,
        transcriptDistance: report.transcriptDiff?.distance ?? null,
        codeSimilarity: report.codeDiff?.similarity ?? null,
        codeDistance: report.codeDiff?.distance ?? null,
      },
      parsed: {
        is_directed: parsed.is_directed,
        lang: parsed.lang ?? "",
        needs_context: parsed.needs_context ?? false,
        code: parsed.code ?? "",
        code_origin: parsed.code_origin ?? "",
        code_tags: parsed.code_tags ?? [],
        transcript: this.compactText(parsed.transcript ?? "", 320),
        answer: this.compactText(parsed.answer ?? "", 320),
        interaction_category: parsed.interaction_category ?? "",
        dialogue_flow: parsed.dialogue_flow ?? "",
        detected_topics: parsed.detected_topics ?? [],
        suggested_questions: (parsed.suggested_questions ?? []).slice(0, 3),
        phonetic_corrections: (parsed.phonetic_corrections ?? []).slice(0, 5),
      },
      calculatedDiagnostics: diagnostics,
      expected: {
        transcriptChars: report.expectedTranscript.length,
        code: report.expectedCode,
      },
    };
  }

  private compactEntry(entry: BenchmarkEntry | null): unknown {
    if (!entry) return null;
    const diagnostics = BenchmarkDiagnostics.analyzeEntry(entry);
    return {
      at: entry.at,
      totalMs: entry.totalMs,
      firstChunkMs: entry.firstChunkMs,
      transcriptSimilarity: entry.transcriptSimilarity,
      codeSimilarity: entry.codeSimilarity,
      is_directed: entry.is_directed,
      lang: entry.lang,
      needs_context: entry.needs_context,
      rejectionReason: diagnostics.rejectionReason,
      placeholderFlags: diagnostics.placeholderFlags,
      hallucinationFlags: diagnostics.hallucinationFlags,
      semanticMisrecognitions: diagnostics.semanticMisrecognitions,
      codeHealthFlags: diagnostics.codeHealthFlags,
      contextNeed: diagnostics.contextNeed,
      qualityBucket: diagnostics.qualityBucket,
      answerLanguage: diagnostics.answerLanguage,
      answerLanguageMatchesUser: diagnostics.answerLanguageMatchesUser,
      answerQuality: diagnostics.answerQuality,
      interaction_category: entry.interaction_category ?? "",
      dialogue_flow: entry.dialogue_flow ?? "",
      detected_topics: entry.detected_topics ?? [],
      suggested_questions: (entry.suggested_questions ?? []).slice(0, 3),
      phonetic_corrections: (entry.phonetic_corrections ?? []).slice(0, 5),
      code: entry.code,
      code_origin: entry.code_origin,
      code_tags: entry.code_tags,
      repairPassMs: entry.repairPassMs ?? null,
      repairAttemptCount: entry.repairAttemptCount ?? 0,
      repairReasons: entry.repairReasons ?? {},
      fallbackUsed: entry.fallbackUsed ?? false,
      transcript: this.compactText(entry.transcript ?? "", 220),
      truncated: entry.truncated,
      failure: entry.outputTail?.startsWith("[benchmark_failed") ? entry.outputTail : null,
    };
  }

  private isMeaningfulReport(report: Report): boolean {
    const parsed = report.parsed || {};
    return Boolean(
      report.metrics ||
        parsed.transcript?.trim() ||
        parsed.code?.trim() ||
        parsed.answer?.trim() ||
        report.transcriptDiff ||
        report.codeDiff,
    );
  }

  private compactText(text: string, maxChars: number): string {
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...`;
  }
}
