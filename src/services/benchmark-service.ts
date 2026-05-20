import { StorageService } from "./storage-service.js";
import type { BenchmarkEntry, CodexSummarySnapshot, Report } from "../types.js";
import { BenchmarkRepository } from "./benchmark-repository.js";
import { BenchmarkStatistics, BenchmarkSummary } from "./benchmark-statistics.js";
import { BenchmarkExporter } from "./benchmark-exporter.js";
import { BenchmarkMapper } from "./benchmark-mapper.js";
import { AppConfig } from "../config.js";

export type { BenchmarkSummary };

export class BenchmarkService {
  private readonly repository: BenchmarkRepository;
  private readonly exporter: BenchmarkExporter;

  constructor(private readonly storage: StorageService) {
    this.repository = new BenchmarkRepository(storage);
    this.exporter = new BenchmarkExporter();
  }

  static summarize(entries: BenchmarkEntry[]): BenchmarkSummary {
    return BenchmarkStatistics.summarize(entries);
  }

  read(): BenchmarkEntry[] {
    return this.repository.read();
  }

  add(report: Report): BenchmarkEntry[] {
    const entry = BenchmarkMapper.fromReport(report);
    return this.repository.add(entry);
  }

  clear(): void {
    const entries = this.read();
    if (entries.length > 0) {
      const summary = BenchmarkStatistics.summarize(entries);
      const lastEntry = entries[entries.length - 1];
      const runPromptVersion = lastEntry?.promptVersion || AppConfig.promptVersion;
      const snapshot: CodexSummarySnapshot = {
        promptVersion: runPromptVersion,
        generatedAt: new Date().toISOString(),
        runs: entries.length,
        transcriptAvg: summary.transcriptAvg,
        codeAvg: summary.codeAvg,
        repairRunRate: summary.repairRunRate,
        tokPerSecAvg: summary.tokPerSecAvg,
      };
      const history = this.storage.readCodexSummaryHistory();
      history.push(snapshot);
      this.storage.saveCodexSummaryHistory(history);
    }
    this.repository.clear();
  }

  readHistory(): CodexSummarySnapshot[] {
    return this.storage.readCodexSummaryHistory();
  }

  clearHistory(): void {
    this.storage.clearCodexSummaryHistory();
  }

  exportPayload(): {
    promptVersion: string;
    generatedAt: string;
    count: number;
    summary: BenchmarkSummary;
    entries: BenchmarkEntry[];
  } {
    const entries = this.read();
    return this.exporter.exportPayload(entries);
  }

  exportCodexSummary(latestReport: Report | null): unknown {
    const entries = this.read();
    return this.exporter.exportCodexSummary(entries, latestReport);
  }
}
 