import type { BenchmarkEntry, Report } from "../types.js";
import { DefaultDataset } from "../data/default-dataset.js";
import { CodeAnalysis } from "../utils/code-analysis.js";
import { LanguageModelGuard } from "./language-model-guard.js";
import { DialogueAnalyzer } from "../utils/dialogue-analyzer.js";

export type CalculatedDiagnostics = {
  rejectionReason: string;
  placeholderFlags: string[];
  hallucinationFlags: string[];
  semanticMisrecognitions: string[];
  codeHealthFlags: string[];
  contextNeed: string;
  qualityBucket: string;
  answerLanguage: string;
  answerLanguageMatchesUser: boolean;
  answerQuality: string[];

  // Dialogue analysis fields
  interactionCategory: string;
  dialogueFlow: string;
  detectedTopics: string[];
  suggestedQuestions: string[];
};

export class BenchmarkDiagnostics {
  static analyzeReport(report: Report): CalculatedDiagnostics {
    const parsed = report.parsed || {};
    return this.calculateDiagnostics({
      rawOutput: report.rawOutput,
      probableCode: parsed.code ?? "",
      transcription: parsed.transcript ?? "",
      answer: parsed.answer ?? "",
      generalAnswer: "",
      needsContext: parsed.needs_context ?? false,
      expectedCode: report.expectedCode ?? null,
      intent: "",
      detectedLanguage: parsed.lang ?? "",
      nextAction: parsed.needs_context ? "ask_show_code" : "",
      diagnosticTags: [],
      transcriptSimilarity: report.transcriptDiff?.similarity ?? null,
      codeSimilarity: report.codeDiff?.similarity ?? null,
      truncated: report.metrics?.truncated ?? false,
      thoughtTags: parsed.thought_tags ?? "",
    });
  }

  static analyzeEntry(entry: BenchmarkEntry): CalculatedDiagnostics {
    return this.calculateDiagnostics({
      rawOutput: [entry.rawOutputHead, entry.rawOutputTail, entry.code, entry.transcript, entry.outputTail].filter(Boolean).join("\n"),
      probableCode: entry.code ?? "",
      transcription: entry.transcript ?? "",
      answer: entry.answer ?? "",
      generalAnswer: "",
      needsContext: entry.needs_context ?? false,
      expectedCode: this.expectedCodeForEntry(entry),
      intent: "",
      detectedLanguage: entry.lang ?? "",
      nextAction: entry.needs_context ? "ask_show_code" : "",
      diagnosticTags: [],
      transcriptSimilarity: entry.transcriptSimilarity,
      codeSimilarity: entry.codeSimilarity,
      truncated: entry.truncated,
      thoughtTags: entry.thought_tags ?? "",
    });
  }

  private static calculateDiagnostics(input: {
    rawOutput: string;
    probableCode: string;
    transcription: string;
    answer: string;
    generalAnswer: string;
    needsContext: boolean;
    expectedCode: string | null;
    intent: string;
    detectedLanguage: string;
    nextAction: string;
    diagnosticTags: string[];
    transcriptSimilarity: number | null;
    codeSimilarity: number | null;
    truncated: boolean;
    thoughtTags?: string;
  }): CalculatedDiagnostics {
    const placeholderFlags = this.detectPlaceholderFlags(input.probableCode);
    const semanticMisrecognitions = this.detectSemanticMisrecognitions(input.rawOutput, input.probableCode, input.transcription);
    const hallucinationFlags = this.detectHallucinationFlags(input.rawOutput, input.probableCode, input.transcription, input.expectedCode);
    const codeHealthFlags = this.detectCodeHealthFlags(input.rawOutput, input.probableCode, input.transcription);
    const rejectionReason = this.detectRejectionReason(input.probableCode, input.diagnosticTags, input.expectedCode, input.intent);
    const detectedLanguage = this.normalizeLanguage(input.detectedLanguage);
    const answerLanguage = this.detectAnswerLanguage(input.answer);
    const answerLanguageMatchesUser = !answerLanguage || !detectedLanguage || answerLanguage === detectedLanguage;
    const answerQuality = this.detectAnswerQuality(input.answer, input.generalAnswer, input.nextAction, answerLanguageMatchesUser);
    const contextNeed = this.detectContextNeed(input);
    const qualityBucket = this.detectQualityBucket({
      ...input,
      rejectionReason,
      placeholderFlags,
      hallucinationFlags,
    });

    const analysis = DialogueAnalyzer.analyze({
      transcript: input.transcription,
      code: input.probableCode,
      thought_tags: input.thoughtTags ?? "",
      answer: input.answer,
      needs_context: input.needsContext,
    });

    return {
      rejectionReason,
      placeholderFlags,
      hallucinationFlags,
      semanticMisrecognitions,
      codeHealthFlags,
      contextNeed,
      qualityBucket,
      answerLanguage,
      answerLanguageMatchesUser,
      answerQuality,
      interactionCategory: analysis.category,
      dialogueFlow: analysis.flow,
      detectedTopics: analysis.detectedTopics,
      suggestedQuestions: analysis.suggestedQuestions,
    };
  }

  static expectedCodeForEntry(entry: BenchmarkEntry): string | null {
    const caseId = entry.caseId || this.inferCaseId(entry);
    return DefaultDataset.cases.find((testCase) => testCase.id === caseId)?.expectedCode ?? null;
  }

  static inferCaseId(entry: BenchmarkEntry): string | null {
    if (entry.fileName) {
      return DefaultDataset.cases.find((testCase) => testCase.fileName === entry.fileName)?.id ?? null;
    }
    if (entry.audioDurationMs == null) return null;
    const match = DefaultDataset.cases.find((testCase) => {
      if (testCase.fileName === "Prueba0.weba") return Math.abs(entry.audioDurationMs! - 24901) < 1000;
      if (testCase.fileName === "prueba 2.wav") return Math.abs(entry.audioDurationMs! - 42512) < 1000;
      if (testCase.fileName === "prueba 3.wav") return Math.abs(entry.audioDurationMs! - 62352) < 1000;
      return false;
    });
    return match?.id ?? null;
  }

  static detectRejectionReason(probableCode: string, diagnosticTags: string[], expectedCode: string | null, intent: string): string {
    if (diagnosticTags.includes("probable_code_rejected_as_prose")) return "prose_not_code";
    if (!probableCode.trim() && expectedCode?.trim()) return "empty_probable_code";
    if (!probableCode.trim() && ["dictated_code", "reading_code"].includes(intent)) return "empty_probable_code";
    if (this.detectPlaceholderFlags(probableCode).length) return "placeholder";
    return "";
  }

  static detectPlaceholderFlags(probableCode: string): string[] {
    const flags = new Set<string>();
    const text = probableCode.trim().toLowerCase();
    if (!text) flags.add("empty_code");
    if (text === "..." || text === "[...]" || text === "[ininteligible]" || text === "<stdin>") flags.add("placeholder_code");
    if (text === "undefined" || text === "null" || text === "nan") flags.add("invalid_literal_code");
    if (/^```/.test(text) && !text.includes("printf") && !text.includes("notasfiltradas")) flags.add("possibly_wrong_language_fence");
    return Array.from(flags);
  }

  static detectHallucinationFlags(rawOutput: string, probableCode: string, transcription: string, expectedCode: string | null): string[] {
    const flags = new Set<string>();
    const combined = `${rawOutput}\n${probableCode}\n${transcription}`.toLowerCase();
    const code = probableCode.toLowerCase();
    if (/[\u0400-\u04ff]/.test(rawOutput) || /\b(no additional|instruction|instrucci[oó]n adicional|system prompt)\b/i.test(rawOutput)) {
      flags.add("prompt_or_language_leak");
    }
    if (/\[literal transcription\b/i.test(combined) || /literal transcription in the spoken language/i.test(combined)) {
      flags.add("prompt_or_language_leak");
    }
    if (["readline", "baseuri", "localhost", "queryselectorall", "whitelist"].some((needle) => code.includes(needle))) {
      flags.add("unrelated_js_api");
    }
    if (expectedCode && probableCode.length > Math.max(200, expectedCode.length * 2.5)) {
      flags.add("overgenerated_code");
    }
    return Array.from(flags);
  }

  static detectSemanticMisrecognitions(rawOutput: string, probableCode: string, transcription: string): string[] {
    const flags = new Set<string>();
    const combined = `${rawOutput}\n${probableCode}\n${transcription}`.toLowerCase();
    if (/\b(node\.?js|nodejs)\s*[.\s-]*(net|com|http|html)\b/i.test(combined)) flags.add("misheard_identifier_as_domain");
    if (/\b(whitelist|lista|list)\s*[.\s-]*(com|net|html|http)\b/i.test(combined)) flags.add("identifier_confused_with_url");
    if (/\burl(s)?\b/i.test(combined) && /\bfiltrad/.test(combined)) flags.add("identifier_confused_with_url");
    if (/\b(internet html|en el html|\.html)\b/i.test(combined) && /\b(innerhtml|list|lista|note|notas?)\b/i.test(combined)) {
      flags.add("html_innerhtml_confusion");
    }
    if (/\b(usuario|activadas|activarlas|activar clases)\b/i.test(combined)) flags.add("active_identifier_confusion");
    return Array.from(flags);
  }

  static detectCodeHealthFlags(rawOutput: string, probableCode: string, transcription: string): string[] {
    const flags = new Set<string>();
    const code = probableCode.trim();
    if (!code) return [];
    if (!transcription.trim()) flags.add("code_without_transcript");
    if (CodeAnalysis.hasUnbalancedDelimiters(code)) flags.add("unbalanced_delimiters");
    if (/=>\s*\{\s*[\p{L}\s]+[.!?]?\s*\}/u.test(code)) flags.add("natural_language_arrow_body");
    if (/\{\s*(?:prueba|codigo|c[oó]digo|exitosa|hola|mundo)\b[^"'`]*\}/iu.test(code)) flags.add("unquoted_words_in_block");
    if (/\(\s*\(\s*\)\s*=>/i.test(code) && !/flecha|arrow|=>/i.test(transcription) && !/flecha|arrow|=>/i.test(rawOutput)) {
      flags.add("arrow_function_not_supported_by_transcript");
    }
    if (/^console\.log\s*\(\s*\(\s*\)\s*=>/i.test(code)) flags.add("probable_overgenerated_callback");
    if (this.looksLikeProseCode(code)) flags.add("probable_prose_in_code");

    // Add mismatches from LanguageModelGuard
    const mismatches = LanguageModelGuard.detectTranscriptCodeMismatch(transcription, code);
    for (const mismatch of mismatches) {
      flags.add(mismatch);
    }

    return Array.from(flags);
  }

  static detectAnswerLanguage(answer: string): string {
    const text = answer.trim().toLowerCase();
    if (!text) return "";
    const englishHits = this.countMatches(text, /\b(the|you|your|working|trying|could|please|show|code|understand|sounds|like|with)\b/g);
    const spanishHits = this.countMatches(text, /\b(el|la|los|las|que|estas|est[aá]s|trabajando|intentando|podr[ií]as|mostrar|c[oó]digo|entiendo|parece)\b/g);
    if (englishHits >= 3 && englishHits > spanishHits) return "en";
    if (spanishHits >= 3 && spanishHits >= englishHits) return "es";
    return "";
  }

  static normalizeLanguage(value: string): string {
    const text = value.trim().toLowerCase();
    if (["es", "spa", "spanish", "español", "espanol"].includes(text)) return "es";
    if (["en", "eng", "english", "inglés", "ingles"].includes(text)) return "en";
    return text;
  }

  static detectAnswerQuality(answer: string, generalAnswer: string, nextAction: string, answerLanguageMatchesUser: boolean): string[] {
    const flags = new Set<string>();
    const text = answer.trim();
    const lower = text.toLowerCase();
    if (!text) {
      flags.add("answer_empty");
      return Array.from(flags);
    }
    if (!answerLanguageMatchesUser) flags.add("answer_language_mismatch");
    if (/\b(show me|could you show|please show|mostrar|mu[eé]strame|pasame|pega)\b/i.test(text) || nextAction === "ask_show_code") {
      flags.add("answer_asks_for_context");
    }
    if (/\b(working with|trying to|parece que|est[aá]s trabajando|intentando)\b/i.test(text) && text.length < 260) {
      flags.add("answer_overgeneric");
    }
    if (generalAnswer.trim() && this.normalizeText(generalAnswer) === this.normalizeText(answer)) {
      flags.add("answer_duplicates_general_answer");
    }
    if (text.length > 450) flags.add("answer_too_long");
    return Array.from(flags);
  }

  static detectContextNeed(input: {
    probableCode: string;
    transcription: string;
    needsContext: boolean;
    expectedCode: string | null;
    diagnosticTags: string[];
    transcriptSimilarity: number | null;
    codeSimilarity: number | null;
  }): string {
    const transcript = input.transcription.toLowerCase();
    const conversationalMarkers = /\b(estoy leyendo|parte donde|ahora estoy|despues|despu[eé]s|me toca|contador|si no me equivoco)\b/i;
    if (input.needsContext) return "needs_code_context_or_repeat";
    if (conversationalMarkers.test(transcript)) return "needs_previous_code_or_screen_context";
    if (input.expectedCode?.trim() && !input.probableCode.trim()) return "needs_code_context_or_repeat";
    if (input.diagnosticTags.includes("code_tokens_unclear") || (input.transcriptSimilarity ?? 1) < 0.5) {
      return "needs_clearer_audio_or_repeat";
    }
    if (input.codeSimilarity !== null && input.codeSimilarity < 0.35) return "needs_code_context_or_repeat";
    return "standalone_audio_ok";
  }

  static detectQualityBucket(input: {
    probableCode: string;
    expectedCode: string | null;
    transcriptSimilarity: number | null;
    codeSimilarity: number | null;
    truncated: boolean;
    rejectionReason: string;
    placeholderFlags: string[];
    hallucinationFlags: string[];
  }): string {
    if (input.truncated) return "truncated";
    if (input.hallucinationFlags.length) return "unsafe_hallucination";
    if (input.expectedCode?.trim()) {
      if (input.rejectionReason || input.placeholderFlags.length || !input.probableCode.trim()) return "bad_code";
      if (input.codeSimilarity !== null && input.codeSimilarity >= 0.65) return "good";
      if (input.codeSimilarity !== null && input.codeSimilarity >= 0.35) return "usable_with_questions";
      if ((input.transcriptSimilarity ?? 1) < 0.35) return "bad_transcript";
      return "bad_code";
    }
    if ((input.transcriptSimilarity ?? 1) < 0.35) return "bad_transcript";
    if (input.codeSimilarity !== null && input.codeSimilarity < 0.35) return "bad_code";
    if ((input.codeSimilarity ?? 0) >= 0.65 || (input.transcriptSimilarity ?? 0) >= 0.8) return "good";
    return "usable_with_questions";
  }

  static countQualityBuckets(entries: BenchmarkEntry[]): Record<string, number> {
    return entries.reduce<Record<string, number>>((acc, entry) => {
      const bucket = this.analyzeEntry(entry).qualityBucket;
      acc[bucket] = (acc[bucket] ?? 0) + 1;
      return acc;
    }, {});
  }

  static countEntryField(entries: BenchmarkEntry[], getValue: (entry: BenchmarkEntry) => string): Record<string, number> {
    return entries.reduce<Record<string, number>>((acc, entry) => {
      const value = getValue(entry);
      if (!value) return acc;
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {});
  }

  static countEntryFlags(entries: BenchmarkEntry[], getFlags: (entry: BenchmarkEntry) => string[]): Record<string, number> {
    return entries.reduce<Record<string, number>>((acc, entry) => {
      for (const flag of getFlags(entry)) {
        if (!flag) continue;
        acc[flag] = (acc[flag] ?? 0) + 1;
      }
      return acc;
    }, {});
  }

  static pickBest(entries: BenchmarkEntry[]): BenchmarkEntry | null {
    return this.pickByScore(entries, "best");
  }

  static pickWorst(entries: BenchmarkEntry[]): BenchmarkEntry | null {
    return this.pickByScore(entries, "worst");
  }

  private static pickByScore(entries: BenchmarkEntry[], mode: "best" | "worst"): BenchmarkEntry | null {
    const scored = entries.filter((entry) => this.entryScore(entry) !== null);
    if (!scored.length) return entries[0] ?? null;
    return scored.reduce((picked, entry) => {
      const pickedScore = this.entryScore(picked) ?? 0;
      const entryScore = this.entryScore(entry) ?? 0;
      return mode === "best"
        ? entryScore > pickedScore ? entry : picked
        : entryScore < pickedScore ? entry : picked;
    });
  }

  private static entryScore(entry: BenchmarkEntry): number | null {
    if (entry.codeSimilarity !== null) return entry.codeSimilarity;
    return entry.transcriptSimilarity;
  }

  static detectCommonFailures(entries: BenchmarkEntry[]): string[] {
    const failures: string[] = [];
    const ratio = (predicate: (entry: BenchmarkEntry) => boolean): number => {
      if (!entries.length) return 0;
      return entries.filter(predicate).length / entries.length;
    };
    if (ratio((entry) => (entry.transcriptSimilarity ?? 1) < 0.5) >= 0.5) {
      failures.push("low_transcript_similarity");
    }
    if (ratio((entry) => entry.codeSimilarity !== null && entry.codeSimilarity < 0.35) >= 0.5) {
      failures.push("low_code_similarity");
    }
    if (ratio((entry) => !(entry.code ?? '').trim()) >= 0.5) {
      failures.push("empty_probable_code");
    }
    if (ratio((entry) => this.looksLikePlaceholderCode(entry.code ?? '')) >= 0.25) {
      failures.push("placeholder_or_rejected_code");
    }
    if (ratio((entry) => this.looksHallucinated(entry.code ?? '')) >= 0.25) {
      failures.push("probable_code_hallucination");
    }
    if (ratio((entry) => (this.analyzeEntry(entry).placeholderFlags).length > 0) >= 0.25) {
      failures.push("placeholder_flags_present");
    }
    if (ratio((entry) => (this.analyzeEntry(entry).hallucinationFlags).length > 0) >= 0.25) {
      failures.push("hallucination_flags_present");
    }
    if (ratio((entry) => (this.analyzeEntry(entry).semanticMisrecognitions).length > 0) >= 0.25) {
      failures.push("semantic_misrecognition");
    }
    if (ratio((entry) => (this.analyzeEntry(entry).codeHealthFlags).length > 0) >= 0.25) {
      failures.push("code_health_flags_present");
    }
    if (ratio((entry) => (this.analyzeEntry(entry).qualityBucket) === "unsafe_hallucination") >= 0.25) {
      failures.push("unsafe_hallucination");
    }
    if (ratio((entry) => (this.analyzeEntry(entry).contextNeed) !== "standalone_audio_ok") >= 0.5) {
      failures.push("context_needed");
    }
    if (ratio((entry) => (this.analyzeEntry(entry).answerQuality).includes("answer_language_mismatch")) >= 0.25) {
      failures.push("answer_language_mismatch");
    }
    if (ratio((entry) => (this.analyzeEntry(entry).answerQuality).includes("answer_overgeneric")) >= 0.5) {
      failures.push("answer_overgeneric");
    }
    return failures;
  }

  private static looksLikePlaceholderCode(value: string): boolean {
    return this.detectPlaceholderFlags(value).length > 0;
  }

  private static looksHallucinated(value: string): boolean {
    const text = value.toLowerCase();
    return ["readline", "whitelist", "baseuri", "localhost", "queryselectorall"].some((needle) => text.includes(needle));
  }

  private static looksLikeProseCode(value: string): boolean {
    const text = value.trim().toLowerCase();
    if (!text) return false;
    if (/^(hola|estoy|necesito|bueno|okay)\b/.test(text)) return true;
    if (/[?¿]/.test(value)) return true;

    const words = text.match(/\b[a-záéíóúñ]{3,}\b/gi) ?? [];
    const proseHits = this.countMatches(text, /\b(hola|estas|estoy|haciendo|mediante|todavia|todavía|modelo|codigo|código|ahora|parte|donde|despues|después|toca|contador|equivoco|necesito|bueno|okay|chao)\b/g);
    const syntaxHits = (value.match(/[()[\]{}=;:]|=>|\./g) ?? []).length;
    return words.length >= 18 && proseHits >= 4 && syntaxHits < proseHits + 4;
  }

  static countMatches(text: string, pattern: RegExp): number {
    return text.match(pattern)?.length ?? 0;
  }

  static normalizeText(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
  }
}
