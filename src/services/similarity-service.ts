import type { CodeDiff, TranscriptDiff } from "../types.js";

export class SimilarityService {
  static compareTranscript(reference: string, hypothesis: string): TranscriptDiff | null {
    return this.compareTokens(this.normalizeTranscript(reference), this.normalizeTranscript(hypothesis));
  }

  static compareCode(expectedCode: string, probableCode: string | undefined): CodeDiff | null {
    if (!expectedCode.trim() || !probableCode?.trim()) return null;
    const diff = this.compareTokens(this.tokenizeCode(expectedCode), this.tokenizeCode(probableCode));
    return diff ? { ...diff, expectedCode, probableCode } : null;
  }

  private static compareTokens(referenceTokens: string[], hypothesisTokens: string[]): TranscriptDiff | null {
    if (!referenceTokens.length || !hypothesisTokens.length) return null;
    const distance = this.levenshtein(referenceTokens, hypothesisTokens);
    const denominator = Math.max(referenceTokens.length, hypothesisTokens.length, 1);
    return {
      referenceWords: referenceTokens.length,
      hypothesisWords: hypothesisTokens.length,
      distance,
      similarity: Math.max(0, 1 - distance / denominator),
    };
  }

  private static normalizeTranscript(text: string): string[] {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
  }

  private static tokenizeCode(code: string): string[] {
    return (
      code
        .toLowerCase()
        .match(/[a-z_]\w*|\d+(?:\.\d+)?|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|==|!=|<=|>=|&&|\|\||[(){}\[\];:,.=+\-*/<>]/g) ?? []
    );
  }

  private static levenshtein(a: string[], b: string[]): number {
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    let current = Array.from({ length: b.length + 1 }, () => 0);

    for (let i = 1; i <= a.length; i += 1) {
      current[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      }
      [previous, current] = [current, previous];
    }

    return previous[b.length];
  }
}
