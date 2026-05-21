import { JsonTools } from "../utils/json-tools.js";
import { CodeAnalysis } from "../utils/code-analysis.js";

export class LanguageModelGuard {
  static hasRepetitionLoop(text: string): boolean {
    const tail = text.slice(-1200);
    if (this.hasInvisibleCharacterLoop(tail)) return true;
    if (this.hasRepeatedSingleCharacterLoop(tail)) return true;
    if (/(,\s*"[^"]{0,24}"){30,}/.test(tail)) return true;
    if (/(""\s*,\s*){20,}/.test(tail)) return true;
    if (this.hasRepeatedPhrase(tail)) return true;

    const tokens = tail
      .split(/[\s,\[\]]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0 && token.length <= 32);
    if (tokens.length < 40) return false;

    const last = tokens[tokens.length - 1];
    if (!last) return false;
    let repeated = 0;
    for (let index = tokens.length - 1; index >= 0 && tokens[index] === last; index -= 1) {
      repeated += 1;
    }
    return repeated >= 30;
  }

  static needsAudioRetry(parsed: ReturnType<typeof JsonTools.extractResponse>, audioDurationMs?: number | null, codeDetected?: boolean): boolean {
    if (!parsed) return false;
    if (parsed.is_directed === false) return false;

    const transcript = (parsed.transcript ?? "").trim();
    const code = (parsed.code ?? "").trim();
    const answer = (parsed.answer ?? "").trim();
    if (!transcript && !code && !answer) return true;
    if (!transcript && (code || answer)) return true;
    if (this.isContractPlaceholder(transcript)) return true;

    // Trigger retry if transcript ends in an open/incomplete punctuation/bracket
    if (/[{([,.\-\+]$/.test(transcript)) return true;

    // If audio is relatively long (> 5s) but transcript is extremely short (< 15 chars)
    if (audioDurationMs && audioDurationMs > 5000 && transcript.length < 15) {
      return true;
    }

    // CRITICAL: If code patterns were detected in the ASR transcript but model skipped <code> — retry
    if (codeDetected && !code) return true;

    return false;
  }

  static parsedContentScore(parsed: ReturnType<typeof JsonTools.extractResponse>): number {
    if (!parsed) return 0;
    const transcript = (parsed.transcript ?? "").trim();
    const code = (parsed.code ?? "").trim();
    const answer = (parsed.answer ?? "").trim();
    let score = 0;
    if (transcript && !this.isContractPlaceholder(transcript)) score += Math.min(120, transcript.length);
    if (code) score += 80 + Math.min(80, code.length);
    if (answer) score += 40 + Math.min(80, answer.length);
    return score;
  }

  static needsVisibleEmptyFallback(parsed: ReturnType<typeof JsonTools.extractResponse>): boolean {
    if (!parsed) return true;
    if (parsed.is_directed === false) return false;
    const transcript = (parsed.transcript ?? "").trim();
    const code = (parsed.code ?? "").trim();
    const answer = (parsed.answer ?? "").trim();
    return (!transcript && !code && !answer) || this.isContractPlaceholder(transcript);
  }

  static isContractPlaceholder(value: string): boolean {
    const text = value.trim().toLowerCase();
    if (!text) return false;
    if (/^\[literal transcription\b/.test(text)) return true;
    if (text.includes("literal transcription in the spoken language")) return true;
    if (text.includes("use [ininteligible] only for unclear audio")) return true;
    return false;
  }

  static hasTerminatorLoop(text: string): boolean {
    const tail = text.slice(-800).toLowerCase();
    if (/(<\|(?:end|eot|eos|endoftext|end_of_text)[^>]*\|>\s*){2,}$/i.test(tail)) return true;
    if (/(<\/s>\s*){4,}$/i.test(tail)) return true;
    if (/(\[end\]\s*){4,}$/i.test(tail)) return true;
    return false;
  }

  static hasRepeatedPhrase(text: string): boolean {
    const normalized = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_$.]+/gu, " ")
      .trim();
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length < 24) return false;

    for (let size = 2; size <= 8; size += 1) {
      if (words.length < size * 6) continue;
      const phrase = words.slice(-size).join(" ");
      let repeats = 1;
      for (let end = words.length - size; end >= size; end -= size) {
        if (words.slice(end - size, end).join(" ") !== phrase) break;
        repeats += 1;
      }
      if (repeats >= 6) return true;
    }

    return false;
  }

  static meaningfulSignature(text: string): string {
    return text
      .replace(/[\p{C}\p{Z}]+/gu, " ")
      .trimEnd();
  }

  static hasInvisibleCharacterLoop(text: string): boolean {
    const tail = text.slice(-300);
    const invisibleRuns = tail.match(/[\p{C}\p{Zs}\u200B-\u200D\u2060\uFEFF]+/gu) ?? [];
    const longestRun = invisibleRuns.reduce((max, run) => Math.max(max, run.length), 0);
    if (longestRun >= 80) return true;

    const stripped = tail.replace(/[\p{C}\p{Zs}\u200B-\u200D\u2060\uFEFF]/gu, "");
    return tail.length >= 180 && stripped.length / tail.length < 0.08;
  }

  static hasRepeatedSingleCharacterLoop(text: string): boolean {
    if (text.length < 120) return false;
    const tail = text.slice(-240);
    const match = tail.match(/([\s\S])\1{79,}$/u);
    if (!match) return false;
    return !/[A-Za-z0-9"'{}[\]:,._-]/.test(match[1]);
  }

  static hasUnbalancedQuotes(code: string): boolean {
    if (!code) return false;
    let singleQuoteCount = 0;
    let doubleQuoteCount = 0;
    let backtickCount = 0;
    let escaped = false;

    for (const char of code) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === "'") singleQuoteCount += 1;
      if (char === '"') doubleQuoteCount += 1;
      if (char === '`') backtickCount += 1;
    }
    return (singleQuoteCount % 2 !== 0) || (doubleQuoteCount % 2 !== 0) || (backtickCount % 2 !== 0);
  }

  static detectTranscriptCodeMismatch(transcript: string, code: string): string[] {
    const mismatches: string[] = [];
    const normTranscript = transcript.toLowerCase();
    const normCode = code.toLowerCase();

    // 1. Paréntesis (parentesis, parenthesis, paren, parênteses)
    if (/\b(parentesis?|parenthesis|paren|parênteses)\b/i.test(normTranscript)) {
      if (!code.includes("(") && !code.includes(")")) {
        mismatches.push("missing_parentheses");
      }
    }

    // 2. Comillas (comillas, comilla, comisa, quotes, quote, aspas)
    if (/\b(comillas?|comisa|quotes?|aspas)\b/i.test(normTranscript)) {
      if (!code.includes('"') && !code.includes("'") && !code.includes("`")) {
        mismatches.push("missing_quotes");
      }
    }

    // 3. Llaves (llaves, llave, braces, brace, curly braces, chaves, chave)
    if (/\b(llaves?|braces?|curly\s+braces?|chaves?)\b/i.test(normTranscript)) {
      if (!code.includes("{") && !code.includes("}")) {
        mismatches.push("missing_braces");
      }
    }

    // 4. Corchetes (corchetes, corchete, brackets, bracket, colchetes, colchete)
    if (/\b(corchetes?|brackets?|colchetes?)\b/i.test(normTranscript)) {
      if (!code.includes("[") && !code.includes("]")) {
        mismatches.push("missing_brackets");
      }
    }

    // 5. Flecha (flecha, arrow)
    if (/\b(flecha|arrow)\b/i.test(normTranscript)) {
      if (!code.includes("=>")) {
        mismatches.push("missing_arrow");
      }
    }

    // 6. Dos puntos (dos puntos, two points, colons, colon, dois pontos)
    if (/\b(dos\s+puntos|two\s+points|colons?|dois\s+pontos)\b/i.test(normTranscript)) {
      if (!code.includes(":")) {
        mismatches.push("missing_colon");
      }
    }

    // 7. Punto y coma (punto y coma, semicolon, ponto e virgula)
    if (/\b(punto\s+y\s+coma|semicolon|ponto\s+e\s+virgula)\b/i.test(normTranscript)) {
      if (!code.includes(";")) {
        mismatches.push("missing_semicolon");
      }
    }

    // 8. Comparación / Igualdad (igual igual, triple igual, tres iguales, equals equals)
    if (/\b(igual\s+igual|tres\s+iguales|triple\s+igual|equals\s+equals)\b/i.test(normTranscript)) {
      if (!code.includes("==") && !code.includes("===")) {
        mismatches.push("missing_equality_comparison");
      }
    }

    // 9. Comprobaciones de Identificadores y Métodos Semánticos Clave:
    
    // innerHTML / html
    if (/\b(html|innerhtml)\b/i.test(normTranscript)) {
      if (!normCode.includes("html") && !normCode.includes("innerhtml")) {
        mismatches.push("missing_html_property");
      }
    }
    // .map / mapear
    if (/\b(maps?|mapear)\b/i.test(normTranscript)) {
      if (!normCode.includes(".map")) {
        mismatches.push("missing_map_method");
      }
    }
    // .filter / filtrar
    if (/\b(filter|filtrar|filtros?)\b/i.test(normTranscript)) {
      if (!normCode.includes(".filter") && !normCode.includes("filt")) {
        mismatches.push("missing_filter_method");
      }
    }
    // textContent / text content
    if (/\b(text\s*content|textcontent)\b/i.test(normTranscript)) {
      if (!normCode.includes("textcontent")) {
        mismatches.push("missing_textcontent_property");
      }
    }
    return mismatches;
  }

  static needsRefinementPass(parsed: ReturnType<typeof JsonTools.extractResponse>): boolean {
    if (!parsed) return false;
    if (parsed.is_directed === false) return false;

    const code = (parsed.code ?? "").trim();
    const transcript = (parsed.transcript ?? "").trim();
    const tags = (parsed.thought_tags ?? "").toLowerCase();
    const codeTags = parsed.code_tags ?? [];

    if (
      parsed.code_origin === "speech_normalizer" &&
      codeTags.some((tag) => ["spoken_print_call", "spoken_not_condition", "context_lexicon_reconstruction"].includes(tag))
    ) {
      return false;
    }

    // Structural issues that clearly need refinement
    if (CodeAnalysis.hasUnbalancedDelimiters(code)) return true;
    if (this.hasUnbalancedQuotes(code)) return true;

    // Doubt keywords in thought_tags — model expressed uncertainty
    const doubtKeywords = ["duda", "dudas", "corregir", "incompleto", "interrumpido", "error", "ambiguo", "confuso"];
    if (doubtKeywords.some(keyword => tags.includes(keyword))) return true;

    // Spoken punctuation remains raw in the code
    const rawPunctuationRegex = /\b(parentesis?|parenthesis|paren|comillas?|comisa|quotes?|llaves?|braces?|curly\s+braces?|corchetes?|brackets?|punto\s+y\s+coma|semicolon|signo\s+de\s+interrogacion|chaves?|colchetes?|ponto\s+e\s+virgula|igual(es)?|equals?|flecha|arrow)\b/i;
    if (rawPunctuationRegex.test(code)) return true;

    // Semantic transcript–code mismatch: only flag when code is empty/short
    // (structural mismatches are already caught above; semantic-only mismatches
    //  produce false positives when the model correctly omits constructs)
    if (code.length < 20 && this.detectTranscriptCodeMismatch(transcript, code).length > 0) return true;

    return false;
  }
}
