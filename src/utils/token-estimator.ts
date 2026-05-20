export class TokenEstimator {
  static estimate(text: string): {
    chars: number;
    words: number;
    estimatedTokensByChars: number;
    estimatedTokensByWords: number;
  } {
    const trimmed = String(text || "").trim();
    if (!trimmed) return { chars: 0, words: 0, estimatedTokensByChars: 0, estimatedTokensByWords: 0 };
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    const chars = trimmed.length;
    return {
      chars,
      words,
      estimatedTokensByChars: Math.ceil(chars / 4),
      estimatedTokensByWords: Math.ceil(words / 0.75),
    };
  }
}
