type BootstrapRun = {
  transcript: string;
  code: string;
  timestamp: number;
};

type BootstrapEntry = {
  caseId: string;
  runs: BootstrapRun[];
  mergedTranscript?: string;
  mergedCode?: string;
  isStable: boolean;
  runCount: number;
};

const STORAGE_KEY = "ducksugar_bootstrap_v1";
const STABILITY_THRESHOLD = 10;
const MIN_RUNS_FOR_MERGE = 3;

export class BootstrapMerger {
  private data = new Map<string, BootstrapEntry>();

  constructor() {
    this.load();
  }

  addRun(caseId: string, transcript: string, code: string): void {
    if (!this.data.has(caseId)) {
      this.data.set(caseId, { caseId, runs: [], isStable: false, runCount: 0 });
    }
    const entry = this.data.get(caseId)!;
    entry.runs.push({ transcript, code, timestamp: Date.now() });
    entry.runCount = entry.runs.length;

    if (entry.runCount >= MIN_RUNS_FOR_MERGE) {
      this.merge(entry);
    }

    if (entry.runCount >= STABILITY_THRESHOLD && entry.mergedTranscript && entry.mergedCode) {
      entry.isStable = true;
    }

    this.save();
  }

  getMerged(caseId: string): { transcript: string; code: string } | null {
    const entry = this.data.get(caseId);
    if (!entry || entry.runCount < MIN_RUNS_FOR_MERGE) return null;
    if (!entry.mergedTranscript && !entry.mergedCode) return null;
    return {
      transcript: entry.mergedTranscript ?? "",
      code: entry.mergedCode ?? "",
    };
  }

  isStable(caseId: string): boolean {
    return this.data.get(caseId)?.isStable ?? false;
  }

  getRunCount(caseId: string): number {
    return this.data.get(caseId)?.runCount ?? 0;
  }

  getProgress(caseId: string): { current: number; target: number } | null {
    const entry = this.data.get(caseId);
    if (!entry) return null;
    return { current: entry.runCount, target: STABILITY_THRESHOLD };
  }

  private merge(entry: BootstrapEntry): void {
    entry.mergedTranscript = this.mergeTranscripts(entry.runs.map((r) => r.transcript));
    entry.mergedCode = this.mergeCodes(entry.runs.map((r) => r.code));
  }

  private mergeTranscripts(transcripts: string[]): string {
    const valid = transcripts.filter((t) => t.trim().length > 0);
    if (valid.length === 0) return "";

    const wordStats = new Map<string, { count: number; positions: number[] }>();
    const threshold = Math.max(2, Math.ceil(valid.length * 0.4));

    for (const t of valid) {
      const words = t.toLowerCase().split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (!wordStats.has(w)) wordStats.set(w, { count: 0, positions: [] });
        wordStats.get(w)!.count++;
        wordStats.get(w)!.positions.push(i);
      }
    }

    const candidates: { word: string; avgPos: number; count: number }[] = [];
    for (const [word, stat] of wordStats) {
      if (stat.count >= threshold) {
        const avgPos = stat.positions.reduce((a, b) => a + b, 0) / stat.positions.length;
        candidates.push({ word, avgPos, count: stat.count });
      }
    }

    candidates.sort((a, b) => a.avgPos - b.avgPos);
    return candidates.map((c) => c.word).join(" ");
  }

  private mergeCodes(codes: string[]): string {
    const valid = codes.filter((c) => c.trim().length > 0);
    if (valid.length === 0) return "";

    const freq = new Map<string, { count: number; original: string }>();
    for (const c of valid) {
      const norm = this.normalizeCode(c);
      if (!freq.has(norm)) freq.set(norm, { count: 0, original: c });
      freq.get(norm)!.count++;
    }

    let bestCount = 0;
    let bestCode = "";
    for (const [, { count, original }] of freq) {
      if (count > bestCount) {
        bestCount = count;
        bestCode = original;
      }
    }

    const threshold = Math.max(2, Math.ceil(valid.length * 0.4));
    if (bestCount >= threshold) return bestCode;

    return valid.reduce((a, b) => (a.length >= b.length ? a : b));
  }

  private normalizeCode(code: string): string {
    return code.trim().replace(/\s+/g, " ").toLowerCase();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as BootstrapEntry[];
        for (const entry of parsed) {
          this.data.set(entry.caseId, entry);
        }
      }
    } catch { /* ignore */ }
  }

  private save(): void {
    try {
      const arr = Array.from(this.data.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch { /* ignore */ }
  }

  clear(): void {
    this.data.clear();
    this.save();
  }
}
