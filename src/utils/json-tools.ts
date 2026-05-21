import type { ParsedResponse } from "../types.js";
import { SpeechNormalizer } from "./speech-normalizer.js";
import { DialogueAnalyzer } from "./dialogue-analyzer.js";

/**
 * JSON extraction and response enrichment.
 * Speech normalization is delegated to SpeechNormalizer (SRP).
 * 
 * The model is the PRIMARY source of code reconstruction.
 * SpeechNormalizer only applies universal symbol corrections (operators, punctuation)
 * as a fallback when the model returns empty or raw spoken punctuation in code.
 */
export class JsonTools {
  static extractResponse(text: string): ParsedResponse | null {
    let trimmed = text.trim();

    // Strip markdown JSON code fences (```json ... ```)
    trimmed = trimmed.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1").trim();

    // Try JSON parse first (JSON+RC format)
    if (trimmed.startsWith("{")) {
      try {
        const json = JSON.parse(trimmed);
        if (json && typeof json === "object" && ("code" in json || "transcript" in json || "think" in json || "tags" in json)) {
          const tags = Array.isArray(json.tags) ? json.tags.join(", ") : (typeof json.tags === "string" ? json.tags : "");
          const parsed: ParsedResponse = {
            think: typeof json.think === "string" ? json.think : "",
            thought_tags: tags,
            transcript: typeof json.transcript === "string" ? json.transcript : "",
            code: typeof json.code === "string" ? this.applyUniversalSymbolFix(json.code) : "",
            answer: typeof json.answer === "string" ? json.answer : "",
            is_directed: json.directed === true || json.directed === "true",
            lang: typeof json.lang === "string" ? json.lang : "es",
            needs_context: json.needs_context === true || json.needs_context === "true",
            phonetic_corrections: Array.isArray(json.phonetic_corrections) ? json.phonetic_corrections.filter((c: unknown) => typeof c === "string") : undefined,
            confidence: typeof json.confidence === "number" ? json.confidence : undefined,
            reasoning: typeof json.reasoning === "string" ? json.reasoning : undefined,
          };
          return this.enrichParsedResponse(parsed);
        }
      } catch {
        // Not valid JSON — fall through to XML parsing
      }
    }

    // Fallback: XML extraction (legacy/repair rounds)
    const extractTag = (tag: string): string => {
      const pattern = new RegExp(`<${tag}>([\\s\\S]*?)(?:</${tag}>|$)`, "i");
      const m = trimmed.match(pattern);
      return m ? m[1].trim() : "";
    };

    const extractCorrections = (): string[] => {
      const correctionsBlock = extractTag("phonetic_corrections");
      if (!correctionsBlock) return [];
      const pattern = /<correction>([\s\S]*?)(?:<\/correction>|$)/gi;
      const matches: string[] = [];
      let match;
      while ((match = pattern.exec(correctionsBlock)) !== null) {
        const cleanCorrection = match[1]
          .replace(/<\/?correction>/g, "")
          .trim();
        if (cleanCorrection) matches.push(cleanCorrection);
      }
      return matches;
    };

    const think = extractTag("think");
    const transcript = extractTag("transcript");
    
    if (!think && !transcript && !trimmed.includes("<response>") && !trimmed.includes("<code>") && !trimmed.includes("<answer>")) {
      return null;
    }

    const rawConfidence = parseFloat(extractTag("confidence"));
    const parsed: ParsedResponse = {
      think,
      thought_tags: extractTag("tags"),
      transcript,
      code: this.stripXmlFromCode(extractTag("code")),
      answer: this.stripNestedResponseTags(extractTag("answer")),
      is_directed: extractTag("directed").toLowerCase() === "true" || extractTag("directed") === "1",
      lang: extractTag("lang") || "es",
      needs_context: extractTag("needs_context").toLowerCase() === "true" || extractTag("needs_context") === "1",
      phonetic_corrections: extractCorrections(),
      confidence: isFinite(rawConfidence) ? rawConfidence : undefined,
      reasoning: extractTag("reasoning") || undefined,
    };

    return this.enrichParsedResponse(parsed);
  }

  private static stripXmlFromCode(code: string): string {
    if (!code) return "";

    let cleaned = code;

    // Fix 0: Unescape HTML entities in XML mode (Gemini Nano sometimes escapes & to &amp;)
    cleaned = cleaned.replace(/&amp;/g, "&");

    // Fix 1: Strip leading '>' prefix (Gemini Nano bug: confunde <code> con HTML blockquote)
    cleaned = cleaned.replace(/^[>\s]+/, "");

    // Fix 2: Fix malformed XML closing tags like </<code>> → </code>
    cleaned = cleaned.replace(/<\/\s*<\s*([a-zA-Z_][\w-]*)\s*>/g, "</$1>");
    cleaned = cleaned.replace(/<\s*>\s*/g, "");

    // Regex matches string literals (double quote, single quote, template literal) OR any XML/HTML tag
    const pattern = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|<\/?[a-zA-Z_][\w-]*[^>]*>/g;

    cleaned = cleaned.replace(pattern, (match) => {
      if (match.startsWith('"') || match.startsWith("'") || match.startsWith('`')) {
        return match;
      }
      return "";
    });

    // Remove any partial/incomplete tag at the very end of the string
    cleaned = cleaned.replace(/\s*<\/?(?:[a-zA-Z_]*)$/g, "");

    // Fix 3: Strip any remaining stray '>' that came from malformed XML
    cleaned = cleaned.replace(/^[>\s]+/g, "");

    return cleaned.trim();
  }

  private static enrichParsedResponse(parsed: ParsedResponse | null): ParsedResponse | null {
    if (!parsed) return null;
    parsed = this.expandCompactResponse(parsed as ParsedResponse & Record<string, unknown>);
    parsed = this.sanitizeThoughtTags(parsed);

    let result: ParsedResponse = parsed;
    const existingCode = (parsed.code ?? "").trim();

    if (!existingCode || this.containsRawPunctuationWords(existingCode)) {
      // Model returned empty or raw spoken punctuation — apply universal symbol normalization
      const transcriptInference = SpeechNormalizer.inferCodeFromSpeech(parsed.transcript ?? "");
      const answerInference = !transcriptInference.code ? SpeechNormalizer.inferCodeFromSpeech(parsed.answer ?? "") : null;
      const inference = transcriptInference.code ? transcriptInference : answerInference;

      if (inference?.code) {
        result = {
          ...parsed,
          code: inference.code,
          code_origin: "speech_normalizer",
          code_tags: inference.tags,
          code_notes: "Codigo probable reconstruido localmente desde tokens hablados (solo correccion universal de simbolos).",
        };
      } else {
        result = existingCode 
          ? { ...parsed, code_origin: parsed.code_origin ?? "model" }
          : parsed;
      }
    } else {
      // Model returned code — apply universal symbol corrections to fix raw punctuation if any
      result = {
        ...parsed,
        code: this.applyUniversalSymbolFix(existingCode),
        code_origin: parsed.code_origin ?? "model",
      };
    }

    // Fix common JSON output quirks (missing parens, escaped $, comma before ;)
    result = {
      ...result,
      code: this.applyJsonFormatFixes(result.code ?? ""),
    };

    // Bug fix: restore $variable when model incorrectly converted to %s
    // (Gemini Nano over-applies printf formatting knowledge)
    result = {
      ...result,
      code: this.restoreDollarVariables(result.code ?? "", parsed.transcript ?? "", parsed.answer ?? ""),
    };

    // Dialogue Analysis Enrichment
    const analysis = DialogueAnalyzer.analyze(result);
    result.interaction_category = analysis.category;
    result.dialogue_flow = analysis.flow;
    result.detected_topics = analysis.detectedTopics;
    result.suggested_questions = analysis.suggestedQuestions;
    result.phonetic_corrections = analysis.phoneticCorrections;

    return result;
  }

  /**
   * Apply only universal symbol corrections to existing code.
   * No variable name replacements — just fix raw spoken punctuation that the model may have left verbatim.
   */
  private static applyUniversalSymbolFix(code: string): string {
    if (!code) return code;
    return code
      .replace(/\b(?:abrir\s+parentesis|open\s+paren(?:thesis)?)\b/gi, "(")
      .replace(/\b(?:cerrar\s+parentesis|close\s+paren(?:thesis)?|closing\s+paren(?:thesis)?)\b/gi, ")")
      .replace(/\b(?:parentesis|paren(?:thesis)?)\b/gi, "")
      .replace(/\b(?:comillas?|quote|quotes?)\b/gi, "\"")
      .replace(/\b(?:punto\s+y\s+coma|semicolon)\b/gi, ";")
      .replace(/\b(?:dos\s+puntos|colon)\b/gi, ":")
      .replace(/\b(?:coma|comma)\b/gi, ",")
      .replace(/\b(?:igual\s+igual\s+igual|triple\s+equals?)\b/gi, "===")
      .replace(/\b(?:igual\s+igual|double\s+equals?)\b/gi, "==")
      .replace(/\b(?:igual|equals?)\b/gi, "=")
      .replace(/\b(?:flecha|arrow)\b/gi, "=>")
      .replace(/\b(?:punto|dot)\b/gi, ".")
      .replace(/\b(?:abrir\s+llave|open\s+brace|llave\s+abre)\b/gi, "{")
      .replace(/\b(?:cerrar\s+llave|close\s+brace|llave\s+cierra)\b/gi, "}")
      .replace(/\b(?:abrir\s+corchete|open\s+bracket|corchete\s+abre)\b/gi, "[")
      .replace(/\b(?:cerrar\s+corchete|close\s+bracket|corchete\s+cierra)\b/gi, "]")
      .replace(/\s*([().,;:={}[\]"'<>])\s*/g, "$1")
      .replace(/\s*=>\s*/g, " => ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Apply fixes for common JSON output quirks from Gemini Nano.
   * These are model-level issues specific to JSON+responseConstraint output.
   */
  private static applyJsonFormatFixes(code: string): string {
    if (!code) return code;
    return code
      // Fix 1: Comma before ; or ) or at end: `if (!count),` → `if (!count)`
      .replace(/,(\s*[;)])/g, '$1')
      .replace(/,\s*$/, '')
      // Fix 2: Missing parentheses around string literal in function call: `printf "hola"` → `printf("hola")`
      .replace(/(\b(?:printf?|console\.log|print|write|writeln|alert|confirm|prompt)\s+)("(?:[^"\\]|\\.)*")/gi, '$1($2)')
      .replace(/(\b(?:printf?|console\.log|print|write|writeln|alert|confirm|prompt)\s+)('(?:[^'\\]|\\.)*')/gi, '$1($2)')
      // Fix 3: Unescape dollar sign: `\$var` → `$var` (Gemini Nano escapes $ in JSON strings)
      .replace(/\\\$/g, '$')
      // Fix 4: Double dollar: `$$var` → `$var` (model doubles $ thinking it needs escaping)
      .replace(/\$\$/g, '$');
  }

  /**
   * Check if the code still contains raw spoken punctuation words (e.g. "parentesis", "comillas").
   * If so, universal symbol fix should be applied.
   */
  /**
   * Restore $variable when the model incorrectly converted it to %s or removed the dollar sign.
   * Example: transcript mentions "dollar name" / "signo pesos variable" but model returned %s.
   */
  private static restoreDollarVariables(code: string, transcript: string, answer: string): string {
    if (!code || code.includes("$")) return code;
    if (/%s/.test(code) || /%d/.test(code)) {
      const combined = `${transcript} ${answer}`.toLowerCase();
      const hasDollarMention = /\b(signo\s+pesos?|dolar|dólar|dollar|signo\s+dolar|pesos)\b/i.test(combined);
      if (hasDollarMention) {
        // Replace format specifiers with $ if we can find the variable name in transcript
        const varMatch = combined.match(/\b(signo\s+pesos?|dolar|dólar|dollar|pesos)\s+([a-zA-Z_]\w*)\b/i);
        if (varMatch) {
          return code.replace(/%[sd]/g, `$${varMatch[2]}`);
        }
        return code.replace(/%[sd]/g, "$");
      }
    }
    return code;
  }

  private static containsRawPunctuationWords(code: string): boolean {
    return /\b(parentesis?|parenthesis|paren|comillas?|comisa|quotes?|llaves?|braces?|curly\s+braces?|corchetes?|brackets?|punto\s+y\s+coma|semicolon|signo\s+de\s+interrogacion|chaves?|colchetes?|ponto\s+e\s+virgula|igual(es)?|equals?|flecha|arrow)\b/i.test(code);
  }

  private static expandCompactResponse(parsed: ParsedResponse & Record<string, unknown>): ParsedResponse {
    const { tg, t, c, a, d, l, n, tags, directed, th, think, ...rest } = parsed;
    return {
      ...rest,
      think: parsed.think ?? this.asString(think) ?? this.asString(th),
      thought_tags: parsed.thought_tags ?? this.asString(tags) ?? this.asString(tg),
      transcript: parsed.transcript ?? this.asString(t),
      code: parsed.code ?? this.asString(c),
      answer: parsed.answer ?? this.asString(a),
      is_directed: parsed.is_directed ?? this.asBoolean(directed) ?? this.asBoolean(d),
      lang: parsed.lang ?? this.asString(l),
      needs_context: parsed.needs_context ?? this.asBoolean(n),
      phonetic_corrections: parsed.phonetic_corrections ?? (Array.isArray(parsed.pc) ? parsed.pc : undefined),
    };
  }

  static compactResponse(parsed: ParsedResponse | null): Record<string, unknown> {
    return {
      think: parsed?.think ?? "",
      tags: parsed?.thought_tags ?? "",
      transcript: parsed?.transcript ?? "",
      code: parsed?.code ?? "",
      answer: parsed?.answer ?? "",
      directed: parsed?.is_directed ?? true,
      lang: parsed?.lang || "es",
      needs_context: parsed?.needs_context ?? false,
      phonetic_corrections: parsed?.phonetic_corrections ?? [],
    };
  }

  static serializeToXml(parsed: ParsedResponse | null): string {
    if (!parsed) return "";
    const corrections = (parsed.phonetic_corrections ?? [])
      .map(c => {
        const cleanCorrection = c.replace(/<\/?correction>/g, "").trim();
        return `    <correction>${cleanCorrection}</correction>`;
      })
      .join("\n");
    return [
      "<response>",
      `  <think>${parsed.think ?? ""}</think>`,
      `  <tags>${parsed.thought_tags ?? ""}</tags>`,
      `  <transcript>${parsed.transcript ?? ""}</transcript>`,
      `  <code>${parsed.code ?? ""}</code>`,
      `  <answer>${parsed.answer ?? ""}</answer>`,
      `  <directed>${parsed.is_directed ?? true}</directed>`,
      `  <lang>${parsed.lang ?? "es"}</lang>`,
      `  <needs_context>${parsed.needs_context ?? false}</needs_context>`,
      "  <phonetic_corrections>",
      corrections,
      "  </phonetic_corrections>",
      "</response>"
    ].join("\n");
  }

  private static asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private static asBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
  }

  private static stripNestedResponseTags(value: string): string {
    const knownTags = "response|think|tags|transcript|code|answer|directed|lang|needs_context|phonetic_corrections|correction";
    return value
      .replace(new RegExp(`<(${knownTags})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "gi"), "")
      .replace(new RegExp(`<\\/?(?:${knownTags})\\b[^>]*>`, "gi"), "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static sanitizeThoughtTags(parsed: ParsedResponse): ParsedResponse {
    const tags = (parsed.thought_tags ?? "").trim();
    if (!tags) return parsed;

    const transcript = (parsed.transcript ?? "").trim();
    if (transcript && this.looksLikeTranscriptCopy(tags, transcript)) {
      return { ...parsed, thought_tags: this.shortTagsFromText(tags) };
    }

    const words = tags.split(/\s+/).filter(Boolean);
    if (words.length > 16 || tags.length > 120 || /[.!?¿¡]/.test(tags)) {
      return { ...parsed, thought_tags: this.shortTagsFromText(tags) };
    }

    // Map common LLM-generated non-standard tags to standardized vocabulary
    const standardized = this.normalizeThoughtTags(tags);
    if (standardized !== tags) {
      return { ...parsed, thought_tags: standardized };
    }

    return parsed;
  }

  private static normalizeThoughtTags(tags: string): string {
    const tagList = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    const mapped = tagList.map((tag) => {
      // Map conversational/social tags to standard
      if (/^(saludo|charla|conversacion|bienestar|casual|saludar|conversar|dialogo)$/.test(tag)) return "charla";
      if (/^(codigo|código|programación|programacion|code|programming)$/.test(tag)) return "code_related";
      // Map print-related tags
      if (/^(print|printing|impresión|impresion|imprimir|printf)$/.test(tag)) return "spoken_print_call";
      // Map condition tags
      if (/^(condition|condición|condicion|conditional)$/.test(tag)) return "condition";
      // Map variable tags
      if (/^(variable|asignación|asignacion|assign|assignment)$/.test(tag)) return "assign_or_compare";
      // Map function tags
      if (/^(function|función|funcion|arrow)$/.test(tag)) return "arrow_function";
      // Map DOM tags
      if (/^(html|innerhtml|dom|render)$/.test(tag)) return "render_html";
      // Map filter/map tags
      if (/^(filter|filtrar|filtro)$/.test(tag)) return "filter";
      if (/^(map|mapear)$/.test(tag)) return "map";
      return tag;
    });
    return mapped.join(", ");
  }

  private static looksLikeTranscriptCopy(tags: string, transcript: string): boolean {
    const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const a = normalize(tags);
    const b = normalize(transcript);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length > 80 && b.includes(a.slice(0, 80))) return true;
    const tagWords = new Set(a.split(/\s+/).filter((word) => word.length > 2));
    const transcriptWords = new Set(b.split(/\s+/).filter((word) => word.length > 2));
    if (tagWords.size < 8) return false;
    const overlap = Array.from(tagWords).filter((word) => transcriptWords.has(word)).length;
    return overlap / tagWords.size > 0.75;
  }

  private static shortTagsFromText(text: string): string {
    const codeClues = text.match(/\b(console\.log|printf?|if|not|count|noteList|noteCount|notasFiltradas|map|innerHTML|textContent|activeClass|noteActiveId|nota\.id|length|const|=>|===|==|parentesis|comillas?|punto|flecha|arrow|charla|saludo|conversacion|casual)\b/gi) ?? [];
    const seen = new Set<string>();
    const tags = codeClues
      .map((tag) => tag.trim())
      .filter((tag) => {
        const key = tag.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
    return tags.join(", ");
  }

  /**
   * Extract individual fields from a truncated JSON string.
   * Handles cases where the model got stuck mid-generation and the JSON is incomplete.
   * Returns null if no meaningful fields could be extracted.
   */
  static salvagePartialJson(text: string): ParsedResponse | null {
    if (
      !text.includes('"think"') &&
      !text.includes('"th"') &&
      !text.includes('"lang"') &&
      !text.includes('"l"') &&
      !text.includes('"transcript"') &&
      !text.includes('"t"') &&
      !text.includes('"code"') &&
      !text.includes('"c"') &&
      !text.includes('"answer"') &&
      !text.includes('"a"') &&
      !text.includes('"thought_tags"') &&
      !text.includes('"tags"') &&
      !text.includes('"tg"')
    ) {
      return null;
    }

    const result: ParsedResponse = {};
    let found = false;

    const extractString = (key: string): string | undefined => {
      const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "s");
      const m = text.match(pattern);
      return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : undefined;
    };

    const extractBoolean = (key: string): boolean | undefined => {
      const pattern = new RegExp(`"${key}"\\s*:\\s*(true|false)`, "i");
      const m = text.match(pattern);
      return m ? m[1].toLowerCase() === "true" : undefined;
    };

    const stringFields: string[] = ["think", "th", "lang", "code", "answer", "transcript", "thought_tags", "tags", "l", "c", "a", "t", "tg"];
    
    for (const field of stringFields) {
      const value = extractString(field);
      if (value !== undefined) {
        (result as Record<string, unknown>)[field] = value;
        found = true;
      }
    }

    const isDirected = extractBoolean("is_directed");
    if (isDirected !== undefined) {
      result.is_directed = isDirected;
      found = true;
    }

    const compactDirected = extractBoolean("d");
    if (compactDirected !== undefined) {
      (result as Record<string, unknown>).d = compactDirected;
      found = true;
    }

    const hybridDirected = extractBoolean("directed");
    if (hybridDirected !== undefined) {
      (result as Record<string, unknown>).directed = hybridDirected;
      found = true;
    }

    const needsContext = extractBoolean("needs_context");
    if (needsContext !== undefined) {
      result.needs_context = needsContext;
      found = true;
    }

    const compactNeedsContext = extractBoolean("n");
    if (compactNeedsContext !== undefined) {
      (result as Record<string, unknown>).n = compactNeedsContext;
      found = true;
    }

    return found ? result : null;
  }

  /**
   * Extract response from the audio transcription pass.
   * Simple JSON-first extraction WITHOUT enrichParsedResponse (DialogueAnalyzer overwrites fields).
   */
  static extractAudioResponse(text: string): { transcript: string; phonetic_corrections?: any[]; confidence?: number; reasoning?: string } | null {
    let trimmed = text.trim();

    // Strip markdown JSON code fences
    trimmed = trimmed.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1").trim();

    // Try JSON parse first
    if (trimmed.startsWith("{")) {
      try {
        const json = JSON.parse(trimmed);
        if (json && typeof json === "object" && typeof json.transcript === "string") {
          return {
            transcript: json.transcript,
            phonetic_corrections: Array.isArray(json.phonetic_corrections) ? json.phonetic_corrections : undefined,
            confidence: typeof json.confidence === "number" ? json.confidence : undefined,
            reasoning: typeof json.reasoning === "string" ? json.reasoning : undefined,
          };
        }
      } catch {
        // Fall through to XML parsing
      }
    }

    // XML fallback
    const extractTag = (tag: string): string => {
      const pattern = new RegExp(`<${tag}>([\\s\\S]*?)(?:</${tag}>|$)`, "i");
      const m = trimmed.match(pattern);
      return m ? m[1].trim() : "";
    };

    const transcript = extractTag("transcript");
    if (!transcript) return null;

    const corrections: string[] = [];
    const correctionPattern = /<correction>([\s\S]*?)(?:<\/correction>|$)/gi;
    let match;
    while ((match = correctionPattern.exec(trimmed)) !== null) {
      const clean = match[1].replace(/<\/?correction>/g, "").trim();
      if (clean) corrections.push(clean);
    }

    const rawConfidence = parseFloat(extractTag("confidence"));

    return {
      transcript,
      phonetic_corrections: corrections.length > 0 ? corrections : undefined,
      confidence: isFinite(rawConfidence) ? rawConfidence : undefined,
      reasoning: extractTag("reasoning") || undefined,
    };
  }
}