import { AppConfig } from "../config.js";
import type { BenchmarkEntry, CodexSummarySnapshot, Report } from "../types.js";

export class StorageService {
  readBenchmark(): BenchmarkEntry[] {
    return this.readJson<BenchmarkEntry[]>(AppConfig.storage.benchmark, []);
  }

  saveBenchmark(entries: BenchmarkEntry[]): void {
    this.writeJson(AppConfig.storage.benchmark, entries.slice(-200));
  }

  clearBenchmark(): void {
    localStorage.removeItem(AppConfig.storage.benchmark);
  }

  saveReport(report: Report): void {
    this.writeJson(AppConfig.storage.lastReport, report);
  }

  saveRunHistory(report: Report): void {
    const history = this.readJson<Report[]>(AppConfig.storage.runHistory, []);
    history.push(report);
    this.writeJson(AppConfig.storage.runHistory, history.slice(-50));
  }

  readCodexSummaryHistory(): CodexSummarySnapshot[] {
    return this.readJson<CodexSummarySnapshot[]>(AppConfig.storage.codexSummaryHistory, []);
  }

  saveCodexSummaryHistory(history: CodexSummarySnapshot[]): void {
    this.writeJson(AppConfig.storage.codexSummaryHistory, history.slice(-50));
  }

  clearCodexSummaryHistory(): void {
    localStorage.removeItem(AppConfig.storage.codexSummaryHistory);
  }

  private readJson<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private writeJson(key: string, value: unknown): void {
    localStorage.setItem(key, JSON.stringify(value, null, 2));
  }
}
