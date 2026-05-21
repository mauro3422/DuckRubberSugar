import { UniversalGrammar } from "./universal-grammar.js";

export type SpeechInference = { code: string; tags: string[]; notes?: string[] };

export class SpeechNormalizer {
  static hasCodePatterns(text: string, contextHint = ""): boolean {
    const normalized = this.normalizeIdentifierSpeech(this.normalizeSpeech(text));
    const lexicon = this.extractContextLexicon(contextHint);

    const hasSpokenPunctuation = UniversalGrammar.tokenizeSpeech(normalized).length > 0;
    const hasCodeKeywords = /\b(?:console\.?log|print(?:f)?|if|else|for|while|function|const|let|var|return|map|filter|reduce|forEach)\b/i.test(normalized);
    const hasDomIdentifiers = /\b(?:innerHTML|textContent|innerText|classList|querySelector|addEventListener|length|count|value|style|display|className)\b/i.test(normalized);
    const hasCompoundIdentifiers = /\b\w+[A-Z]\w*\b|\b\w+\.\w+\b/.test(text);
    const hasCodeDelimiters = /[(){}[\]]/.test(text);
    const hasContextIdentifier = lexicon.some((identifier) => this.transcriptMentionsIdentifier(normalized, identifier));

    if (hasSpokenPunctuation && (hasCodeKeywords || hasDomIdentifiers || hasCompoundIdentifiers || hasCodeDelimiters || hasContextIdentifier)) return true;
    if (hasContextIdentifier && (hasCodeKeywords || hasDomIdentifiers)) return true;

    let signals = 0;
    if (hasSpokenPunctuation) signals++;
    if (hasCodeKeywords) signals++;
    if (hasDomIdentifiers) signals++;
    if (hasCompoundIdentifiers) signals++;
    if (hasCodeDelimiters) signals++;
    if (hasContextIdentifier) signals++;

    return signals >= 2;
  }

  static inferCodeFromSpeech(text: string, contextHint = ""): SpeechInference {
    const normalized = this.normalizeSpeech(text);
    const notes = this.buildCodeNotes(text, contextHint);

    const contextualCode = this.inferFromContextualLexicon(normalized, this.extractContextLexicon(contextHint));
    if (contextualCode) {
      return {
        code: contextualCode,
        tags: this.normalizationTags(normalized, contextualCode, ["context_lexicon_reconstruction"]),
        notes,
      };
    }

    const notCondition = this.inferNotCondition(normalized);
    if (notCondition) {
      return {
        code: notCondition,
        tags: this.normalizationTags(normalized, notCondition, ["spoken_not_condition"]),
        notes,
      };
    }

    const printfCall = this.inferPrintfCall(normalized);
    if (printfCall) {
      return {
        code: printfCall,
        tags: this.normalizationTags(normalized, printfCall, ["spoken_print_call"]),
        notes,
      };
    }

    const tokenCode = this.normalizeSpokenCodeTokens(normalized);
    if (tokenCode) {
      return {
        code: tokenCode,
        tags: this.normalizationTags(normalized, tokenCode, ["spoken_symbol_normalization"]),
        notes,
      };
    }

    // Fallback: if code notes have identifiers + actions, generate a rough skeleton
    const skeleton = this.inferCodeSkeleton(notes, text, contextHint);
    if (skeleton) {
      return {
        code: skeleton,
        tags: ["code_skeleton_fallback"],
        notes,
      };
    }

    return { code: "", tags: [], notes };
  }

  static inferCodeSkeleton(notes: string[], text: string, contextHint: string): string {
    const idNote = notes.find(n => n.startsWith("identifiers:"));
    if (!idNote) return "";
    const identifiers = idNote.replace("identifiers:", "").trim().split(/,\s*/);
    const actionNote = notes.find(n => n.startsWith("actions:"));
    if (!actionNote) return "";
    const actions = actionNote.replace("actions:", "").trim().split(/,\s*/);

    // Generate skeleton from common action patterns
    if (actions.includes("map") && actions.includes("render_html")) {
      const listVar = identifiers.find(id => /[Ll]ist/.test(id)) || identifiers[0];
      const filteredVar = identifiers.find(id => /[Ff]iltradas?/.test(id)) || identifiers[1] || "filtered";
      const itemVar = identifiers.find(id => /^nota$/i.test(id)) || "item";
      return `${listVar}.innerHTML = ${filteredVar}.map((${itemVar}) => { /* ... */ });`;
    }
    if (actions.includes("condition") && identifiers.length > 0) {
      const condVar = identifiers.find(id => /[Cc]ount|[Gg]oing/.test(id)) || identifiers[0];
      return `if (!${condVar}) { /* ... */ }`;
    }
    if (actions.includes("print") || actions.includes("update_text")) {
      const target = identifiers.find(id => /[Cc]ount|[Tt]ext[Cc]ontent/.test(id)) || identifiers[0] || "value";
      return `${target}.textContent = /* ... */;`;
    }

    return "";
  }

  static buildCodeNotes(text: string, contextHint = ""): string[] {
    const normalized = this.normalizeIdentifierSpeech(this.normalizeSpeech(text));
    const lexicon = this.extractContextLexicon(contextHint);
    const mentioned = lexicon.filter((identifier) => this.transcriptMentionsIdentifier(normalized, identifier));
    const verbs = this.extractActionHints(normalized);
    const notes: string[] = [];

    if (mentioned.length) notes.push(`identifiers: ${mentioned.join(", ")}`);
    if (verbs.length) notes.push(`actions: ${verbs.join(", ")}`);
    if (/\b(?:node|note)\s+list\b/i.test(normalized) && lexicon.includes("noteList")) notes.push("uncertain: node/note list likely noteList");
    if (/\bnota?s?\s+filtradas?\b/i.test(normalized) && lexicon.includes("notasFiltradas")) notes.push("uncertain: nota filtradas likely notasFiltradas");
    if (/\b(?:notes?|node)\s*(?:\.?\s*com|\.|punto|dot)?\s*text\s+content\b/i.test(normalized) && lexicon.includes("noteCount")) {
      notes.push("uncertain: notes.com text content likely noteCount.textContent");
    }

    return notes;
  }

  private static extractActionHints(normalizedTranscript: string): string[] {
    const actions: string[] = [];
    const add = (value: string) => {
      if (!actions.includes(value)) actions.push(value);
    };

    if (/\b(?:printf|print|imprimir|console\.log)\b/i.test(normalizedTranscript)) add("print");
    if (/\b(?:if|condicion|condition)\b/i.test(normalizedTranscript)) add("condition");
    if (/\b(?:map|maps|mapear)\b/i.test(normalizedTranscript)) add("map");
    if (/\b(?:filter|filtrar|filtros?)\b/i.test(normalizedTranscript)) add("filter");
    if (/\b(?:html|innerHTML)\b/i.test(normalizedTranscript)) add("render_html");
    if (/\b(?:textContent|text\s+content|innerText)\b/i.test(normalizedTranscript)) add("update_text");
    if (/\b(?:igual)\b/i.test(normalizedTranscript)) add("assign_or_compare");
    if (/\b(?:arrow|flecha)\b/i.test(normalizedTranscript)) add("arrow_function");

    return actions.slice(0, 6);
  }

  private static inferFromContextualLexicon(text: string, lexicon: string[]): string {
    if (!lexicon.length) return "";

    let normalized = this.normalizeIdentifierSpeech(text);

    // Dynamic phonetic identifier replacement
    for (const identifier of lexicon) {
      // Split camelCase/PascalCase to individual words
      const words = identifier.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/);
      if (words.length > 1) {
        // Build a dynamic regex allowing common spoken/phonetic confusions for each word
        const regexParts = words.map((w, index) => {
          if (w === "note" || w === "node" || w === "nota" || w === "notas") return "(?:note|node|nota|notas?)";
          if (w === "list" || w === "lista") return "(?:list|lista)";
          if (w === "active" || w === "activo" || w === "activa") return "(?:active|activo|activa|activas?)";
          if (w === "class" || w === "clase") return "(?:class|clase|classes?)";
          if (w === "id") return index === words.length - 1 && words.length > 2 ? "(?:id|ids|identificador|aqui)?" : "(?:id|ids|identificador|aqui)";
          if (w === "filtradas" || w === "filtrada" || w === "filtro") return "(?:filtradas?|filtro|filter)";
          if (w === "count" || w === "counter") return index === words.length - 1 && words.length > 2 ? "(?:count|counter|cuenta|com)?" : "(?:count|counter|cuenta|com)";
          return w;
        });
        
        const pattern = new RegExp("\\b" + regexParts.filter(Boolean).join("\\s*") + "\\b", "gi");
        normalized = normalized.replace(pattern, identifier);
      } else {
        // Single word identifier, replace exact case-insensitive matches
        const pattern = new RegExp("\\b" + identifier + "\\b", "gi");
        normalized = normalized.replace(pattern, identifier);
      }
    }

    // Pass through normalizer to compile spoken symbols
    return this.normalizeSpokenCodeTokens(normalized);
  }



  private static inferNotCondition(text: string): string {
    const normalized = this.normalizeIdentifierSpeech(text);
    const match = normalized.match(/\bif\s+(?:not|no)\s+([a-z_$][\w$]*)\b/i);
    if (!match) return "";

    let identifier = match[1];
    if (identifier.toLowerCase() === "going" && /\bcount\b/i.test(normalized)) {
      identifier = "count";
    }

    return `if (!${identifier})`;
  }

  private static inferPrintfCall(text: string): string {
    const normalized = this.normalizeIdentifierSpeech(text);
    if (!/\bprintf\b/i.test(normalized)) return "";

    const quoted = normalized.match(/\b(?:comilla|comillas|quote|quotes?)\s+(.+)\s+(?:comilla|comillas|quote|quotes?)\b/i);
    let rawArgument = quoted?.[1]?.trim() ?? "";
    
    // Clean up intermediate stray quotes if the user had dictation stutter/misplacement
    rawArgument = rawArgument.replace(/\b(?:comilla|comillas|quote|quotes?)\b/gi, "");
    
    // Process dollar/peso sign followed by variable name inside string literal first
    let argument = rawArgument
      .replace(/\b(?:signo\s+pesos?|signo\s+dolar|signo\s+dólar|dolar|dólar|dollar|pesos)\s*llave\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+llave\b/gi, (_, g1) => `\${${g1}}`)
      .replace(/\b(?:signo\s+pesos?|signo\s+dolar|signo\s+dólar|dolar|dólar|dollar|pesos)\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/gi, (_, g1) => `$${g1}`)
      .replace(/\b(?:signo\s+pesos?|signo\s+dolar|signo\s+dólar|dolar|dólar|dollar|pesos)\b/gi, "$");
      
    // Replace common dictation symbols inside string literal
    argument = argument
      .replace(/\bcoma\b/gi, ",")
      .replace(/\bpunto\b/gi, ".")
      .replace(/\bdos\s+puntos\b/gi, ":")
      .replace(/\bpunto\s+y\s+coma\b/gi, ";")
      .replace(/\b(?:par.?ntesis?|parentesis?|parenthesis|paren|colon|igual|flecha|arrow)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Check for trailing "punto y coma" after closing quote to determine statement terminator
    const afterQuotes = quoted ? normalized.slice((quoted.index ?? 0) + quoted[0].length).trim() : "";
    const hasTerminator = /\b(punto\s+y\s+coma|semicolon)\b/i.test(afterQuotes);

    if (!argument) return hasTerminator ? "printf();" : "printf()";
    return `printf("${this.normalizeStringLiteral(argument)}")${hasTerminator ? ";" : ""}`;
  }


  private static normalizeSpokenCodeTokens(text: string): string {
    const span = this.extractCodeLikeSpan(text);
    if (!span) return "";

    const tokens = span.split(/\s+/).filter(Boolean);
    if (!tokens.some((token) => this.spokenSymbolToken(token))) return "";

    let normalized = this.normalizeIdentifierSpeech(span);

    let parenCount = 0;
    normalized = normalized.replace(/\b(?:(abrir|cerrar|open|close|fechar)\s+)?(parentesis?|parenthesis|paren|parentheses)\b/gi, (match, prefix) => {
      if (prefix) return match;
      parenCount++;
      return parenCount % 2 === 1 ? "abrir parentesis" : "cerrar parentesis";
    });

    let braceCount = 0;
    normalized = normalized.replace(/\b(?:(abrir|cerrar|open|close|fechar)\s+)?(llaves?|braces?|chaves?)\b/gi, (match, prefix) => {
      if (prefix) return match;
      braceCount++;
      return braceCount % 2 === 1 ? "abrir llave" : "cerrar llave";
    });

    let bracketCount = 0;
    normalized = normalized.replace(/\b(?:(abrir|cerrar|open|close|fechar)\s+)?(corchetes?|brackets?|colchetes?)\b/gi, (match, prefix) => {
      if (prefix) return match;
      bracketCount++;
      return bracketCount % 2 === 1 ? "abrir corchete" : "cerrar corchete";
    });

    for (const pattern of UniversalGrammar.spokenPatterns) {
      const replacement = UniversalGrammar.compileToken(pattern.token, "typescript");
      const globalRegex = new RegExp(pattern.regex.source, "gi");
      normalized = normalized.replace(globalRegex, replacement);
    }

    normalized = normalized
      .replace(/\s*([().,;:={}[\]"'])\s*/g, "$1")
      .replace(/\.{2,}/g, (match) => match.length === 3 ? "..." : ".")
      .replace(/;\)/g, ");")
      .replace(/;\}/g, "};")
      .replace(/\s*=>\s*/g, " => ")
      .replace(/\s+/g, " ")
      .trim();


    return this.looksLikeCode(normalized) && !this.looksLikeProseCode(normalized) && !this.looksMalformedCode(normalized)
      ? normalized
      : "";
  }

  private static extractCodeLikeSpan(text: string): string {
    const normalized = this.normalizeIdentifierSpeech(text);
    const markerPattern = /\b(?:console\.log|printf?|if|const|let|var|function|map|innerHTML|textContent|length|count|notasfiltradas|notas|note(?:list|count|activeid)?|nodelist|nodecount)\b|=>|===|==|=|\(|\)|\b(?:parentesis|comillas?|punto|igual|flecha|arrow|colon|semicolon|llave|corchete)\b/i;
    const marker = normalized.search(markerPattern);
    if (marker < 0) return "";

    // Include context before the marker (up to 3 words or previous sentence boundary)
    const before = normalized.slice(0, marker).trim();
    const beforeWords = before.split(/\s+/).filter(Boolean);
    const stopWords = /^(?:el|la|los|las|un|una|unos|unas|este|esta|estos|estas|y|o|que|de|del|en|al|por|para|con|sin|su|tu|mi|se|le|lo|la|no|si|me|te|es|fue|era|son|ser|hay|muy|mas|pero|como|cuando|donde|tiene|tengo|estoy|estas|esta|estamos|estan|estaba|estado|hacer|hace|hago|haciendo|voy|va|vas|vamos|van|iba|he|has|ha|han|habia|haber|puedo|puede|pueden|puedes|pueda|pudiera|sido|siendo|dice|dijo|dicen|dar|dio|dan|dando|dado|saber|sabe|sabes|saben|sabia|sabido|poner|pone|pones|ponen|puso|puesto|poniendo|tener|tenia|tenido|tiene|tienes|tienen|venir|viene|vienes|vienen|vino|venido|venir|sacar|saca|sacas|sacan|saco|sacado|sacar|dejar|deja|dejas|dejan|dejo|dejado|dejando|buscar|busca|buscas|buscan|busco|buscado|buscando)$/i;
    const contextWords = beforeWords.slice(-3).filter(w => !stopWords.test(w));
    let span = (contextWords.length ? contextWords.join(" ") + " " : "") + normalized.slice(marker).trim();

    const boundary = span.search(/\b(?:bueno|okay|despues|luego|me toca|estoy metiendo|si no me equivoco|eso es todo|chao|gracias)\b/i);
    if (boundary > 0) span = span.slice(0, boundary).trim();

    const weakLead = span.match(/^(?:codigo|notas?|note)\b/i);
    if (weakLead) {
      const stronger = span.search(/\b(?:console\.log|printf?|if|const|let|var|function|map|innerHTML|textContent|length|count|notasfiltradas|note(?:list|count|activeid)|nodelist|nodecount)\b|=>|===|==|=|\(|\)|\b(?:parentesis|comillas?|punto|igual|flecha|arrow)\b/i);
      if (stronger > weakLead[0].length) span = span.slice(stronger).trim();
    }

    return span;
  }

  private static normalizationTags(source: string, code: string, baseTags: string[]): string[] {
    const tags = new Set(baseTags);
    if (UniversalGrammar.tokenizeSpeech(source).length > 0) tags.add("probable_punctuation");
    if (/[()"'.,;:={}[\]<>]|=>/.test(code)) tags.add("normalized_signs");
    if (/\(\s*["']/.test(code)) tags.add("probable_string_argument");
    return Array.from(tags);
  }

  private static spokenSymbolToken(token: string): boolean {
    return UniversalGrammar.tokenizeSpeech(token).length > 0;
  }

  private static looksLikeCode(value: string): boolean {
    const hasClearSign = /[()\[\]{}]|=>|==|=|[;:]/.test(value);
    const hasKeywords = /\b(console\.log|printf?|if|else|const|let|var|function|map|innerHTML|textContent|length|count)\b/i.test(value);
    const text = value.toLowerCase();
    if (/\b(hola|como estas|bueno|chao|gracias|saludos)\b/.test(text) && !hasKeywords) return false;
    return hasClearSign || hasKeywords;
  }

  private static looksLikeProseCode(value: string): boolean {
    const text = value.toLowerCase();
    if (/^(hola|estoy|necesito|bueno|okay)\b/.test(text)) return true;
    if (/[?¿]/.test(value)) return true;

    const words = text.match(/\b[a-záéíóúñ]{3,}\b/gi) ?? [];
    if (words.length >= 18) {
      const proseHits = words.filter((word) =>
        this.conversationalWords.includes(word.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
      ).length;
      const syntaxHits = (value.match(/[()[\]{}=;:]|=>|\./g) ?? []).length;
      if (proseHits >= 4 && syntaxHits < proseHits + 4) return true;
    }

    return false;
  }

  private static looksMalformedCode(value: string): boolean {
    const text = value.toLowerCase();
    if (/^[=)\]}]/.test(value.trim())) return true;
    if (/====/.test(value)) return true;
    if (/\b(con|esta|ahi|aqui|bueno|okay|comisa|comida|icon|lane|ignor|ignot)\b/i.test(text) && !/[(){};]/.test(value)) {
      return true;
    }

    const words = text.match(/\b[a-z][a-z0-9_$]*\b/gi) ?? [];
    const syntaxHits = (value.match(/[()[\]{}=;:]|=>|\./g) ?? []).length;
    return words.length > 8 && syntaxHits < 3;
  }

  private static normalizeIdentifierSpeech(text: string): string {
    return text
      .replace(/\b(?:consola|consol)\s*(?:\.|punto|dot)?\s*log\b/gi, "console.log")
      .replace(/\b(?:e)?sprint\s+f\b/gi, "printf")
      .replace(/\b(?:e)?sprint\s*efe\b/gi, "printf")
      .replace(/\b(?:e)?sprint\b/gi, "print")
      .replace(/\bprint\s+f\b/gi, "printf")
      .replace(/\binnerhtml\b/gi, "innerHTML")
      .replace(/\btextcontent\b/gi, "textContent")
      .replace(/\binner\s+html\b/gi, "innerHTML")
      .replace(/\btext\s+content\b/gi, "textContent")
      .replace(/\barrow\s+function\b/gi, "arrow")
      .replace(/\bflecha\s+function\b/gi, "flecha");
  }

  private static extractContextLexicon(contextHint: string): string[] {
    if (!contextHint) return [];

    const visibleIdentifiers = contextHint.match(/identificadores_visibles:\s*([^\n<]+)/i)?.[1];
    if (visibleIdentifiers) {
      return visibleIdentifiers
        .split(/[,\s]+/)
        .map((value) => value.trim())
        .filter((value) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value));
    }

    const stop = new Set([
      "ide_context", "tipo", "contexto_visible_de_ide", "lenguaje_probable", "JavaScript", "tema",
      "identificadores_visibles", "tokens_visibles", "instruccion", "usar", "solo", "para", "elegir",
      "identificadores", "cuando", "audio", "sea", "ambiguo", "completar", "lineas", "mencione",
      "lista", "de", "notas", "filtradas",
    ]);
    const values = new Set<string>();
    const matches = contextHint.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];

    for (const match of matches) {
      if (match.length <= 1 || stop.has(match)) continue;
      if (/[A-Z]/.test(match.slice(1)) || /^(id|if|map|const|active|length|innerHTML|textContent|nota)$/.test(match)) {
        values.add(match);
      }
    }

    return Array.from(values);
  }

  private static transcriptMentionsIdentifier(normalizedTranscript: string, identifier: string): boolean {
    const normalizedIdentifier = identifier
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[^A-Za-z0-9_$]+/g, " ")
      .toLowerCase();
    const compactIdentifier = normalizedIdentifier.replace(/\s+/g, "");
    const compactTranscript = normalizedTranscript.replace(/[^a-z0-9_$]+/g, "");
    if (compactTranscript.includes(compactIdentifier)) return true;

    if (identifier === "noteList") return /\b(?:node|note)\s+list\b/i.test(normalizedTranscript);
    if (identifier === "notasFiltradas") return /\bnota?s?\s+filtradas?\b/i.test(normalizedTranscript);
    if (identifier === "noteCount") return /\b(?:note|notes|node)\s*(?:count|com)?\b/i.test(normalizedTranscript);
    if (identifier === "noteActiveId") return /\b(?:note\s+active\s+id|no\s+(?:esta|te)\s+(?:ahi|active|activas?)\s*(?:aqui|id)?)\b/i.test(normalizedTranscript);
    if (identifier === "activeClass") return /\bactive\s+class\b/i.test(normalizedTranscript);
    return false;
  }

  private static normalizeStringLiteral(value: string): string {
    return value
      .replace(/\s+/g, " ")
      .replace(/\s+([).,;:!?])/g, "$1")
      .trim();
  }

  static normalizeSpeech(text: string): string {
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/[`"']/g, " ")
      .replace(/[,:;¡!¿]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  private static readonly conversationalWords = [
    "hola", "estas", "estoy", "haciendo", "metiendo", "mediante",
    "todavia", "modelo", "baile", "codigo", "ahora", "parte",
    "donde", "despues", "toca", "contador", "equivoco", "escritura",
    "correcta", "claramente", "necesito", "bueno", "okay", "chao",
  ];
}
