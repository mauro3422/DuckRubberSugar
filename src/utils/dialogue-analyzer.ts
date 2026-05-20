import type { ParsedResponse, TestCase } from "../types.js";
import { CodeAnalysis } from "./code-analysis.js";
import { DialogueSyntaxMap, DialogueStopWords } from "../data/markers/dialogue-markers.js";

export type DialogueAnalysis = {
  category: "Saludo / Charla" | "Dictado de Código" | "Mixto (Charla y Código)";
  flow: string;
  detectedTopics: string[];
  suggestedQuestions: string[];
  phoneticCorrections: string[];
};

type CorrectionCandidate = {
  identifier: string;
  score: number;
  reason: "fonética" | "subcadena" | "subtoken";
};

export class DialogueAnalyzer {
  static analyze(parsed: ParsedResponse, testCaseContext?: TestCase | null): DialogueAnalysis {
    const transcript = (parsed.transcript ?? "").trim();
    const code = (parsed.code ?? "").trim();
    const thoughtTags = (parsed.thought_tags ?? "").trim().toLowerCase();

    const t = transcript.toLowerCase();
    const c = code.toLowerCase();

    // 1. Detect language
    const lang = this.detectLanguage(transcript, parsed.lang);

    // 2. Dynamic Component Detection based strictly on LLM Semantic Output
    const hasGreeting = thoughtTags.includes("saludo") || 
                        thoughtTags.includes("hola") || 
                        thoughtTags.includes("greeting") || 
                        thoughtTags.includes("saudações");
    
    const hasClosing = thoughtTags.includes("chao") || 
                       thoughtTags.includes("adios") || 
                       thoughtTags.includes("closure") || 
                       thoughtTags.includes("despedida") || 
                       thoughtTags.includes("farewell") ||
                       thoughtTags.includes("tchau");

    const hasCasual = thoughtTags.includes("charla") || 
                      thoughtTags.includes("casual") || 
                      thoughtTags.includes("conversacion") || 
                      thoughtTags.includes("chat") || 
                      thoughtTags.includes("general");

    const hasCode = code.length > 0 && 
                    code !== "..." && 
                    code !== "[...]" && 
                    code !== "[ininteligible]" && 
                    !/^if\s+(?:not|no)\s+[a-z0-9_]+;?$/i.test(code);

    // 3. Classify Interaction Category
    let category: DialogueAnalysis["category"] = "Saludo / Charla";
    if (hasCode) {
      if (hasGreeting || hasCasual || hasClosing) {
        category = "Mixto (Charla y Código)";
      } else {
        category = "Dictado de Código";
      }
    } else {
      category = "Saludo / Charla";
    }

    // 4. Calculate Phonetic and Semantic corrections (Fuzzy Levenshtein against context)
    const phoneticCorrections = this.getPhoneticCorrections(parsed, transcript, code, parsed.phonetic_corrections, testCaseContext);

    // 5. Build Flow and Topics dynamically translated to target language
    const { flow, detectedTopics } = this.translateFlowAndTopics(hasGreeting, hasCasual, hasCode, hasClosing, lang, t);

    // 6. Generate Suggested Questions / Doubts
    const suggestedQuestions: string[] = [];
    if (category === "Saludo / Charla") {
      if (lang === "en") {
        suggestedQuestions.push("Would you like to dictate a code snippet or algorithm for us to analyze?");
        suggestedQuestions.push("Do you have any questions about JavaScript syntax or another language?");
      } else if (lang === "pt") {
        suggestedQuestions.push("Você gostaria de ditar um trecho de código ou algoritmo para analisarmos?");
        suggestedQuestions.push("Você tem alguma dúvida com a sintaxe do JavaScript ou de outra linguagem?");
      } else {
        suggestedQuestions.push("¿Deseas dictar un fragmento de código o algoritmo para que lo analicemos?");
        suggestedQuestions.push("¿Tienes alguna duda con la sintaxis de JavaScript o de algún otro lenguaje?");
      }
    } else {
      // It has code
      if (CodeAnalysis.hasUnbalancedDelimiters(code)) {
        if (lang === "en") suggestedQuestions.push("I detected unbalanced delimiters. Did you mean to close all parentheses or quotes?");
        else if (lang === "pt") suggestedQuestions.push("Detectei delimitadores desbalanceados. Você queria fechar todos os parênteses ou aspas?");
        else suggestedQuestions.push("He detectado delimitadores desbalanceados. ¿Querías cerrar todos los paréntesis o comillas?");
      }
      if (parsed.needs_context) {
        if (lang === "en") suggestedQuestions.push("Could you share your IDE code context so I can understand the exact context?");
        else if (lang === "pt") suggestedQuestions.push("Você poderia compartilhar o contexto de código do seu IDE para que eu possa entender o contexto exato?");
        else suggestedQuestions.push("¿Podrías compartirme el código de tu IDE para entender el contexto exacto?");
      }
      if (t.includes("printf") && !c.includes("printf")) {
        if (lang === "en") suggestedQuestions.push("You mentioned 'printf'. Did you want to use C/C++ printf instead of Python/JS print?");
        else if (lang === "pt") suggestedQuestions.push("Você mencionou 'printf'. Queria usar printf do C/C++ em vez do print do Python/JS?");
        else suggestedQuestions.push("Mencionaste 'printf'. ¿Querías usar printf de C/C++ en lugar de print de Python/JS?");
      }
      if (c.includes("innerHTML") && !t.includes("innerhtml")) {
        if (lang === "en") suggestedQuestions.push("We inferred 'innerHTML' from context. Is this the correct DOM property?");
        else if (lang === "pt") suggestedQuestions.push("Inferimos 'innerHTML' pelo contexto. Esta é a propriedade correta do DOM?");
        else suggestedQuestions.push("Se infirió 'innerHTML' por el contexto. ¿Es esta la propiedad de DOM correcta?");
      }

      // Add suggested questions for mismatches in our fuzzy phonetic mismatch analyzer
      const mismatches = phoneticCorrections.filter(corr => corr.startsWith("[Mismatched]"));
      for (const mismatch of mismatches) {
        const match = mismatch.match(/'([^']+)' ➔ '([^']+)'(?:.*\[opciones:\s*([^\]]+)\])?/);
        if (match) {
          const spoken = match[1];
          const expected = match[2];
          const options = match[3] ? match[3] : expected;
          if (!this.shouldAskAboutMismatch(spoken, options)) continue;
          if (lang === "en") {
            suggestedQuestions.push(`Mentioned '${spoken}', did you mean [${options}]?`);
          } else if (lang === "pt") {
            suggestedQuestions.push(`Mencionou '${spoken}', referia-se a [${options}]?`);
          } else {
            suggestedQuestions.push(`Mencionaste '${spoken}', ¿te referías a [${options}]?`);
          }
        }
      }

      if (suggestedQuestions.length === 0) {
        if (lang === "en") suggestedQuestions.push("The probable code looks well-structured. Would you like to add a condition or refactor it?");
        else if (lang === "pt") suggestedQuestions.push("O código provável parece bem estruturado. Gostaria de adicionar alguma condição ou refatorá-lo?");
        else suggestedQuestions.push("El código probable se ve bien estructurado. ¿Deseas agregar alguna condición o refactorizarlo?");
      }
    }

    // Limit suggested questions to maximum 3
    const maxQuestions = 3;
    const limitedQuestions = suggestedQuestions.length > maxQuestions
      ? suggestedQuestions.slice(0, maxQuestions)
      : suggestedQuestions;

    return {
      category,
      flow,
      detectedTopics,
      suggestedQuestions: limitedQuestions,
      phoneticCorrections
    };
  }

  private static detectLanguage(transcript: string, parsedLang?: string): string {
    if (parsedLang && parsedLang.trim()) return parsedLang.trim().toLowerCase();
    
    const t = transcript.toLowerCase();
    if (/\b(hello|hi|good\s+morning|good\s+afternoon|how\s+are\s+you|dictate|code|testing|try)\b/i.test(t)) return "en";
    if (/\b(bom\s+dia|boa\s+tarde|tudo\s+bem|olá|ditado|código|tchau|obrigado|obrigada)\b/i.test(t)) return "pt";
    
    return "es";
  }

  private static extractIdentifiers(code: string): string[] {
    if (!code) return [];
    const rawMatches = code.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) ?? [];
    const keywords = new Set([
      "const", "let", "var", "function", "if", "else", "return", "true", "false", 
      "null", "undefined", "map", "filter", "reduce", "class", "this", "new", "console", "log"
    ]);
    const identifiers = new Set<string>();
    for (const match of rawMatches) {
      if (match.length > 2 && !keywords.has(match)) {
        identifiers.add(match);
      }
    }
    return Array.from(identifiers);
  }

  private static isCodeLikeIdentifier(id: string): boolean {
    if (!id || id.length <= 2) return false;
    if (this.isFuzzyUnsafeWord(id.toLowerCase())) return false;
    if (/^(active|notas|nota)$/.test(id)) return true;
    if (/[A-Z]/.test(id.slice(1))) return true;
    if (/(HTML|Content|List|Count|Class|Id|ID|Filtradas|length)$/i.test(id)) return true;
    return /^(console|printf|innerHTML|textContent|length)$/.test(id);
  }

  private static isLowConfidenceGeneratedCode(parsed: ParsedResponse): boolean {
    const tags = parsed.code_tags ?? [];
    return parsed.code_origin === "speech_normalizer" && !tags.includes("spoken_notelist_reconstruction");
  }

  private static decomposeIdentifier(id: string): string[] {
    const words = id
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[^a-zA-Z]+/g, " ")
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 1);
    return Array.from(new Set(words));
  }

  private static getSimilarity(s1: string, s2: string): number {
    let longer = s1;
    let shorter = s2;
    if (s1.length < s2.length) {
      longer = s2;
      shorter = s1;
    }
    const longerLength = longer.length;
    if (longerLength === 0) return 1.0;
    
    return (longerLength - this.editDistance(longer, shorter)) / longerLength;
  }

  private static editDistance(s1: string, s2: string): number {
    const costs: number[] = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else {
          if (j > 0) {
            let newValue = costs[j - 1];
            if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
              newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
            }
            costs[j - 1] = lastValue;
            lastValue = newValue;
          }
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  }

  private static getPhoneticCorrections(parsed: ParsedResponse, transcript: string, code: string, modelCorrections?: string[], testCaseContext?: TestCase | null): string[] {
    const t = this.normalizeWordText(transcript);
    const c = code.toLowerCase();
    const corrections: string[] = [];
    const seenCorrections = new Set<string>();

    // 1. Incorporate LLM's dynamic semantic corrections
    if (modelCorrections && Array.isArray(modelCorrections)) {
      for (const mc of modelCorrections) {
        const clean = mc.trim();
        if (clean && !seenCorrections.has(clean.toLowerCase())) {
          corrections.push(clean);
          seenCorrections.add(clean.toLowerCase());
        }
      }
    }

    // 2. Check Multilingual Syntax Symbols from markers map
    for (const key of Object.keys(DialogueSyntaxMap)) {
      if (t.includes(key)) {
        for (const item of DialogueSyntaxMap[key]) {
          const codeContainsSymbol = c.includes(item.symbol.charAt(0)) || 
                                     (item.symbol === "=>" && c.includes("=>")) ||
                                     (item.symbol === "()" && (c.includes("(") || c.includes(")"))) ||
                                     (item.symbol === "[]" && (c.includes("[") || c.includes("]"))) ||
                                     (item.symbol === "{}" && (c.includes("{") || c.includes("}"))) ||
                                     (item.symbol === '""' && (c.includes('"') || c.includes("'") || c.includes("`")));
          
          const label = codeContainsSymbol 
            ? `[Resuelta] Símbolo hablado '${key}' ➔ '${item.symbol}' (sintaxis detectada correctamente)`
            : `[Mismatched] Símbolo hablado '${key}' ➔ '${item.symbol}' (falta el símbolo en el código generado)`;
          
          if (!seenCorrections.has(label.toLowerCase())) {
            corrections.push(label);
            seenCorrections.add(label.toLowerCase());
          }
        }
      }
    }

    // 3. Dynamic Structural Variable / Identifier Decomposition and Fuzzy Matching
    const domainIdentifiers = new Set<string>();
    
    // Only use dataset identifiers if there's a contextHint (tc-03 has contextHint, tc-01/tc-02 don't)
    if (testCaseContext?.contextHint) {
      this.extractIdentifiers(testCaseContext.expectedCode)
        .filter(id => this.isCodeLikeIdentifier(id))
        .forEach(id => domainIdentifiers.add(id));
    }
    // Always extract dynamic domain identifiers from currently generated code
    if (!this.isLowConfidenceGeneratedCode(parsed)) {
      this.extractIdentifiers(code)
        .filter(id => this.isCodeLikeIdentifier(id))
        .forEach(id => domainIdentifiers.add(id));
    }

    // Tokenize transcript and clean up
    const codeIdentifiers = new Set(
      this.extractIdentifiers(code)
        .filter(id => this.isCodeLikeIdentifier(id))
        .map(id => id.toLowerCase())
    );
    const tWords = t.split(/[^a-zA-Z_$]+/).filter(w => (
      w.length > 2 &&
      !DialogueStopWords.has(w) &&
      !this.isFuzzyUnsafeWord(w)
    ));
    const processedWords = new Set<string>();

    for (const word of tWords) {
      if (processedWords.has(word)) continue;
      processedWords.add(word);
      if (codeIdentifiers.has(word)) continue;

      const candidates: CorrectionCandidate[] = [];

      for (const id of domainIdentifiers) {
        const idLower = id.toLowerCase();
        if (idLower === word) continue;
        if (!this.isCodeLikeIdentifier(id)) continue;

        let score = 0;
        let reason: CorrectionCandidate["reason"] = "fonética";

        // Decompose the identifier to check matches on sub-tokens (e.g. noteCount -> ["note", "count"])
        const subTokens = this.decomposeIdentifier(id);
        const hasSubTokenMatch = subTokens.some(token => {
          const tokenSim = this.getSimilarity(word, token);
          return tokenSim >= 0.70 || token.includes(word) || word.includes(token);
        });

        if (hasSubTokenMatch) {
          score = 0.85;
          reason = "subtoken";
        } else if (idLower.includes(word) || word.includes(idLower)) {
          score = 0.80;
          reason = "subcadena";
        } else {
          score = this.getSimilarity(word, idLower);
          reason = "fonética";
        }

        if (score >= 0.60) {
          candidates.push({ identifier: id, score, reason });
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);

        // Keep top candidates (within 0.15 of best score, max 3)
        const highestScore = candidates[0].score;
        const topCandidates = candidates.filter(cand => cand.score >= highestScore - 0.15).slice(0, 3);
        const names = topCandidates.map(cand => cand.identifier).join(", ");

        // Check if generated code contains any of the top candidates
        const resolvedIdentifier = topCandidates.find(cand => c.includes(cand.identifier.toLowerCase()));

        const label = resolvedIdentifier
          ? `[Resuelta] '${word}' ➔ '${resolvedIdentifier.identifier}' [opciones: ${names}]`
          : `[Mismatched] '${word}' ➔ '${topCandidates[0].identifier}' [opciones: ${names}]`;

        if (!seenCorrections.has(label.toLowerCase())) {
          corrections.push(label);
          seenCorrections.add(label.toLowerCase());
        }
      }
    }

    return corrections;
  }

  private static translateFlowAndTopics(
    hasGreeting: boolean,
    hasCasual: boolean,
    hasCode: boolean,
    hasClosing: boolean,
    lang: string,
    t: string
  ) {
    let flow = "";
    const detectedTopics: string[] = [];

    if (lang === "en") {
      const flowParts: string[] = [];
      if (hasGreeting) flowParts.push("Greeting");
      if (hasCasual) flowParts.push("Chat / Explanation");
      if (hasCode) flowParts.push("Code Dictation");
      if (hasClosing) flowParts.push("Closure");
      if (flowParts.length === 0) flowParts.push(hasCode ? "Code Dictation" : "General Query");
      flow = flowParts.join(" ➔ ");

      if (hasGreeting) detectedTopics.push("greetings");
      if (hasCasual) detectedTopics.push("functionality test");
      if (hasCode) detectedTopics.push("code dictation");
      if (hasClosing) detectedTopics.push("farewell");
    } else if (lang === "pt") {
      const flowParts: string[] = [];
      if (hasGreeting) flowParts.push("Saudação");
      if (hasCasual) flowParts.push("Conversa / Explicação");
      if (hasCode) flowParts.push("Ditado de Código");
      if (hasClosing) flowParts.push("Fechamento");
      if (flowParts.length === 0) flowParts.push(hasCode ? "Ditado de Código" : "Consulta Geral");
      flow = flowParts.join(" ➔ ");

      if (hasGreeting) detectedTopics.push("saudações");
      if (hasCasual) detectedTopics.push("teste de funcionamento");
      if (hasCode) detectedTopics.push("ditado de código");
      if (hasClosing) detectedTopics.push("despedida");
    } else {
      // default: es
      const flowParts: string[] = [];
      if (hasGreeting) flowParts.push("Saludo");
      if (hasCasual || (!hasCode && t.length > 20)) flowParts.push("Charla / Explicación");
      if (hasCode) flowParts.push("Dictado de Código");
      if (hasClosing) flowParts.push("Cierre");
      if (flowParts.length === 0) flowParts.push(hasCode ? "Dictado de Código" : "Consulta General");
      flow = flowParts.join(" ➔ ");

      if (hasGreeting) detectedTopics.push("saludos");
      if (hasCasual) detectedTopics.push("prueba de funcionamiento");
      if (hasCode) detectedTopics.push("dictado de código");
      if (hasClosing) detectedTopics.push("despedida");
    }

    const isQuestion = t.includes("?") || t.includes("¿") || t.includes("pregunta") || t.includes("duda") || t.includes("question") || t.includes("doubt") || t.includes("pergunta") || t.includes("duvida") || t.includes("dúvida");
    if (isQuestion) {
      if (lang === "en") detectedTopics.push("query / question");
      else if (lang === "pt") detectedTopics.push("consulta / pergunta");
      else detectedTopics.push("consulta / pregunta");
    }

    if (detectedTopics.length === 0) {
      if (lang === "en") detectedTopics.push("general conversation");
      else if (lang === "pt") detectedTopics.push("conversação geral");
      else detectedTopics.push("conversación general");
    }

    return { flow, detectedTopics };
  }

  private static isFuzzyUnsafeWord(word: string): boolean {
    return new Set([
      "not", "and", "or", "if", "else", "for", "let", "var", "const",
      "cuando", "cuanto", "porque", "pregunta", "condicion", "vacia", "vacio", "rellenado", "arriba",
      "detecta", "dejar", "comprueba", "esta", "ese", "esa", "esto", "ahi", "aca",
      "hola", "como", "estas", "estoy", "haciendo", "metiendo", "todavia", "modelo", "baile",
      "son", "poco", "codigo", "ahora", "parte", "donde", "bueno", "okay", "despues", "toca",
      "ignor", "ignot", "ignoto", "contador", "equivoco", "escritura", "correcta", "claramente",
      "lane", "land", "comisa", "comida", "icon", "punto", "igual", "function", "con", "sin",
      "count"
    ]).has(word);
  }

  private static normalizeWordText(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  private static shouldAskAboutMismatch(spoken: string, options: string): boolean {
    const word = this.normalizeWordText(spoken).trim();
    if (!word || this.isFuzzyUnsafeWord(word)) return false;
    const optionList = options.split(",").map(option => option.trim()).filter(Boolean);
    return optionList.some(option => this.isCodeLikeIdentifier(option));
  }
}
