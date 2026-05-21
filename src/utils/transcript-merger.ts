export type ModelTranscription = {
  transcript: string;
  phonetic_corrections?: any[];
  error?: string;
  confidence?: number;
  reasoning?: string;
  rawResponse?: string;
};

type Correction = { original: string; corrected: string; confidence: number };

export class TranscriptMerger {
  merge(asrTranscript: string, modelTranscription: ModelTranscription): {
    transcript: string;
    correctionsApplied: string[];
  } {
    if (!asrTranscript) {
      return { transcript: modelTranscription.transcript || "", correctionsApplied: [] };
    }

    const corrections = this.parseCorrections(modelTranscription.phonetic_corrections);
    const applied: string[] = [];
    let result = asrTranscript;

    for (const c of corrections) {
      if (c.confidence < 0.6) continue;
      const orig = c.original.trim();
      const corr = c.corrected.trim();
      if (!orig || !corr) continue;
      const escaped = this.escapeRegex(orig);
      const re = new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'gi');
      if (re.test(result)) {
        result = result.replace(re, (match, before) => `${before}${corr}`);
        applied.push(`${c.original} → ${c.corrected} (${c.confidence})`);
      }
    }

    return { transcript: result, correctionsApplied: applied };
  }

  private parseCorrections(corrections?: any[]): Correction[] {
    if (!corrections || corrections.length === 0) return [];
    const result: Correction[] = [];
    for (const c of corrections) {
      if (typeof c === "object" && c !== null && c.original && c.corrected) {
        result.push({ original: c.original, corrected: c.corrected, confidence: c.confidence ?? 1 });
      } else if (typeof c === "string") {
        const parsed = this.parseStringFormat(c);
        if (parsed) result.push(parsed);
      }
    }
    return result;
  }

  private parseStringFormat(text: string): Correction | null {
    const m = text.match(/ASR:\s*['"]?([^'"→]+?)['"]?\s*[→➔]\s*(?:correction:\s*)?['"]?([^'"→]+?)['"]?\s*(?:\(|$)/i);
    if (!m) return null;
    const original = m[1].trim();
    const corrected = m[2].trim();
    if (!original || !corrected || original === corrected) return null;
    return { original, corrected, confidence: 1 };
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
