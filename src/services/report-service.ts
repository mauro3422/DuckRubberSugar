import { AppConfig } from "../config.js";
import type { EventLog, Metrics, Report, TestCase } from "../types.js";
import { JsonTools } from "../utils/json-tools.js";
import { NumberTools } from "../utils/number-tools.js";
import { SimilarityService } from "./similarity-service.js";
import { StorageService } from "./storage-service.js";

export class ReportService {
  constructor(
    private readonly storage: StorageService,
    private readonly getSnapshot: () => {
      sessionMode: string;
      promptVersion: string;
      metrics: Metrics | null;
      rawOutput: string;
      expectedTranscript: string;
      expectedCode: string;
      testCase: Pick<TestCase, "id" | "fileName"> | null;
      events: EventLog[];
    },
  ) {}

  build(): Report {
    const snapshot = this.getSnapshot();
    const parsed = JsonTools.extractResponse(snapshot.rawOutput);
    const transcriptDiff = parsed?.transcript
      ? SimilarityService.compareTranscript(snapshot.expectedTranscript, parsed.transcript)
      : null;
    const expectedCode = snapshot.expectedCode;
    const codeDiff = SimilarityService.compareCode(expectedCode, parsed?.code);
    return {
      generatedAt: new Date().toISOString(),
      promptVersion: snapshot.promptVersion,
      testCase: snapshot.testCase,
      location: window.location.href,
      userAgent: navigator.userAgent,
      chromeLanguageModel: {
        present: "LanguageModel" in window,
        sessionMode: snapshot.sessionMode,
      },
      metrics: snapshot.metrics,
      parsed,
      expectedTranscript: snapshot.expectedTranscript,
      transcriptDiff,
      expectedCode,
      codeDiff,
      rawOutput: snapshot.rawOutput,
      events: snapshot.events,
    };
  }

  persistLast(report: Report): void {
    this.storage.saveReport(report);
  }

  saveHistory(report: Report): void {
    this.storage.saveRunHistory(report);
  }

  summary(report: Report): string {
    const metrics = report.metrics;
    const parsed = report.parsed || {};
    const transcriptDiff = report.transcriptDiff;
    const codeDiff = report.codeDiff;
    return [
      "DuckRubber Nano Probe summary",
      `Generated: ${report.generatedAt}`,
      `URL: ${report.location}`,
      `UA: ${report.userAgent}`,
      `Session mode: ${report.chromeLanguageModel.sessionMode}`,
      `Streaming: ${metrics?.usedStreaming ?? "n/a"}`,
      `Total: ${NumberTools.format(metrics?.totalMs, 0)} ms`,
      `First chunk: ${metrics?.firstChunkMs == null ? "n/a" : `${NumberTools.format(metrics.firstChunkMs, 0)} ms`}`,
      `Audio: ${NumberTools.format((metrics?.audioDurationMs ?? 0) / 1000, 1)} s, ${metrics?.audioSize ?? 0} bytes, ${metrics?.audioType ?? "n/a"}`,
      `Output: ${metrics?.outputChars ?? 0} chars, ${metrics?.outputWords ?? 0} words, ~${metrics?.outputTokensApprox ?? 0} tokens`,
      `Speed: ${NumberTools.format(metrics?.tokensPerSecond, 2)} tok/s approx, ${NumberTools.format(metrics?.charsPerSecond, 1)} chars/s`,
      `Content speed: ${NumberTools.format(metrics?.contentTokensPerSecond, 2)} tok/s (parsed fields only)`,
      `Chunks: ${metrics?.chunkCount ?? "n/a"}`,
      `Repair attempts: ${metrics?.repairAttemptCount ?? 0} (${JSON.stringify(metrics?.repairReasons ?? {})}), improved ${(metrics?.repairAttempts ?? []).filter((attempt) => attempt.improved).length}, ${metrics?.repairPassMs ?? 0} ms`,
      `Fallback used: ${metrics?.fallbackUsed ? "true" : "false"}`,
      `Truncated: ${metrics?.truncated ? metrics.truncatedReason ?? "yes" : "false"}`,
      `Context usage: ${JSON.stringify(metrics?.contextUsage ?? null)}`,
      `Transcript match: ${
        transcriptDiff
          ? `${NumberTools.format(transcriptDiff.similarity * 100, 1)}%, distance ${transcriptDiff.distance}/${Math.max(transcriptDiff.referenceWords, transcriptDiff.hypothesisWords)}`
          : "n/a"
      }`,
      `Code match: ${
        codeDiff
          ? `${NumberTools.format(codeDiff.similarity * 100, 1)}%, distance ${codeDiff.distance}/${Math.max(codeDiff.referenceWords, codeDiff.hypothesisWords)}`
          : "n/a"
      }`,
      "",
      "Transcription:",
      parsed.transcript || "",
      "",
      "Detected language:",
      parsed.lang || "",
      "",
      "Directed to Assistant:",
      parsed.is_directed !== undefined ? String(parsed.is_directed) : "unknown",
      "",
      "Probable code:",
      parsed.code || "",
      "",
      "Answer:",
      parsed.answer || "",
      "",
      "Output tail:",
      metrics?.outputTail || "",
    ].join("\n");
  }
}
