const STUTTER_PATTERN = /\b(bueno|eh|este|o sea|poronga|como poronga|a ver|o sea que|digamos|no sé|ponele|entendes|ya no|pero bueno|bueno eso|eh o sea|o sea como)\b/gi;

export class SpeechStutterCleaner {
  static cleanStutters(text: string): string {
    return text
      .replace(STUTTER_PATTERN, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  static normalizeForCompare(text: string): string {
    return this.cleanStutters(text)
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?¿¡]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  static tagStuttersForUi(text: string): string {
    return text.replace(STUTTER_PATTERN, "<muletilla>$1</muletilla>");
  }

  static countWords(text: string): number {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  }
}
