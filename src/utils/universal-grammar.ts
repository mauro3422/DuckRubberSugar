/**
 * RubberDuck Universal Syntax Engine.
 * An agnostic, multilingual translator that maps spoken dictation and phonetic symbols
 * in Spanish, English, and Portuguese to universal programming concepts (UniversalTokens),
 * and compiles them to target languages (TypeScript, Python, C#, Rust, Go).
 */

export enum UniversalToken {
  // Operators
  ASSIGN = "ASSIGN",
  EQUALITY = "EQUALITY",
  LAMBDA = "LAMBDA",
  PROPERTY_ACCESS = "PROPERTY_ACCESS",
  STATEMENT_TERMINATOR = "STATEMENT_TERMINATOR",
  LIST_SEPARATOR = "LIST_SEPARATOR",
  KEY_VALUE_SEPARATOR = "KEY_VALUE_SEPARATOR",

  // Delimiters
  PAREN_OPEN = "PAREN_OPEN",
  PAREN_CLOSE = "PAREN_CLOSE",
  BLOCK_START = "BLOCK_START",
  BLOCK_END = "BLOCK_END",
  BRACKET_OPEN = "BRACKET_OPEN",
  BRACKET_CLOSE = "BRACKET_CLOSE",
  STRING_LITERAL = "STRING_LITERAL",

  // High-Level Operations (Functional & DOM)
  ARRAY_MAP = "ARRAY_MAP",
  ARRAY_FILTER = "ARRAY_FILTER",
  DOM_HTML = "DOM_HTML",
  DOM_TEXT = "DOM_TEXT",
  PRINT = "PRINT"
}

export type LanguageTarget = "typescript" | "python" | "csharp" | "rust" | "go";

export interface SpokenPattern {
  token: UniversalToken;
  regex: RegExp;
}

export class UniversalGrammar {
  // Multilingual dictation patterns (Spanish, English, Portuguese) with Google ASR phonetic support
  public static readonly spokenPatterns: SpokenPattern[] = [
    // Open/Close Parentheses
    { token: UniversalToken.PAREN_OPEN, regex: /\b(abrir\s+parentesis|open\s+parenthesis|open\s+paren|abrir\s+parênteses)\b/i },
    { token: UniversalToken.PAREN_CLOSE, regex: /\b(cerrar\s+parentesis|close\s+parenthesis|close\s+paren|fechar\s+parênteses)\b/i },
    { token: UniversalToken.PAREN_OPEN, regex: /\b(parentesis?|parenthesis|paren|parênteses)\b/i },

    // Blocks (Curly Braces)
    { token: UniversalToken.BLOCK_START, regex: /\b(abrir\s+llave|llave\s+abre|open\s+brace|curly\s+brace|abrir\s+chave|chave\s+abre)\b/i },
    { token: UniversalToken.BLOCK_END, regex: /\b(cerrar\s+llave|llave\s+cierra|close\s+brace|fechar\s+chave|chave\s+fecha)\b/i },
    { token: UniversalToken.BLOCK_START, regex: /\b(llaves?|braces?|chaves?)\b/i },

    // Brackets (Square brackets)
    { token: UniversalToken.BRACKET_OPEN, regex: /\b(abrir\s+corchete|open\s+bracket|abrir\s+colchete)\b/i },
    { token: UniversalToken.BRACKET_CLOSE, regex: /\b(cerrar\s+corchete|close\s+bracket|cerrar\s+colchete)\b/i },
    { token: UniversalToken.BRACKET_OPEN, regex: /\b(corchetes?|brackets?|colchetes?)\b/i },

    // Arrow / Lambda functions
    { token: UniversalToken.LAMBDA, regex: /\b(flecha|arrow\s+function|arrow|lambda)\b/i },

    // Quotes
    { token: UniversalToken.STRING_LITERAL, regex: /\b(comillas?|comisa|quotes?|aspas)\b/i },

    // Equality / Assignment
    { token: UniversalToken.EQUALITY, regex: /\b(igual\s+igual\s+igual|triple\s+equals?|tres\s+iguales|triple\s+igual)\b/i },
    { token: UniversalToken.EQUALITY, regex: /\b(igual\s+igual|double\s+equals?|dos\s+iguales|equals\s+equals)\b/i },
    { token: UniversalToken.ASSIGN, regex: /\b(igual|equals?|atribuir)\b/i },

    // Punctuation
    { token: UniversalToken.STATEMENT_TERMINATOR, regex: /\b(punto\s+y\s+coma|semicolon|ponto\s+e\s+virgula)\b/i },
    { token: UniversalToken.KEY_VALUE_SEPARATOR, regex: /\b(dos\s+puntos|two\s+points|colon|dois\s+pontos)\b/i },
    { token: UniversalToken.PROPERTY_ACCESS, regex: /\b(punto|dot|ponto)\b/i },
    { token: UniversalToken.LIST_SEPARATOR, regex: /\b(coma|comma|vírgula)\b/i },

    // Semantic Operations
    { token: UniversalToken.ARRAY_MAP, regex: /\b(maps?|mapear)\b/i },
    { token: UniversalToken.ARRAY_FILTER, regex: /\b(filter|filtrar|filtros?)\b/i },
    { token: UniversalToken.DOM_HTML, regex: /\b(html|innerhtml)\b/i },
    { token: UniversalToken.DOM_TEXT, regex: /\b(text\s*content|textcontent|innertext)\b/i },
    { token: UniversalToken.PRINT, regex: /\b(print|printf|imprimir|escrever|console\s*log)\b/i }
  ];

  /**
   * Translates an ASR transcript into a sequence of detected Universal Tokens.
   */
  static tokenizeSpeech(transcript: string): UniversalToken[] {
    const tokens: UniversalToken[] = [];
    const norm = transcript.toLowerCase();

    for (const pattern of this.spokenPatterns) {
      if (pattern.regex.test(norm)) {
        tokens.push(pattern.token);
      }
    }
    return tokens;
  }

  /**
   * Compiles a UniversalToken into the concrete syntax of the target programming language.
   */
  static compileToken(token: UniversalToken, target: LanguageTarget): string {
    switch (target) {
      case "typescript":
        return this.compileToTypeScript(token);
      case "python":
        return this.compileToPython(token);
      case "csharp":
        return this.compileToCSharp(token);
      case "rust":
        return this.compileToRust(token);
      case "go":
        return this.compileToGo(token);
      default:
        return "";
    }
  }

  private static compileToTypeScript(token: UniversalToken): string {
    switch (token) {
      case UniversalToken.ASSIGN: return "=";
      case UniversalToken.EQUALITY: return "===";
      case UniversalToken.LAMBDA: return "=>";
      case UniversalToken.PROPERTY_ACCESS: return ".";
      case UniversalToken.STATEMENT_TERMINATOR: return ";";
      case UniversalToken.LIST_SEPARATOR: return ",";
      case UniversalToken.KEY_VALUE_SEPARATOR: return ":";
      case UniversalToken.PAREN_OPEN: return "(";
      case UniversalToken.PAREN_CLOSE: return ")";
      case UniversalToken.BLOCK_START: return "{";
      case UniversalToken.BLOCK_END: return "}";
      case UniversalToken.BRACKET_OPEN: return "[";
      case UniversalToken.BRACKET_CLOSE: return "]";
      case UniversalToken.STRING_LITERAL: return "'";
      case UniversalToken.ARRAY_MAP: return ".map(";
      case UniversalToken.ARRAY_FILTER: return ".filter(";
      case UniversalToken.DOM_HTML: return ".innerHTML";
      case UniversalToken.DOM_TEXT: return ".textContent";
      case UniversalToken.PRINT: return "console.log(";
      default: return "";
    }
  }

  private static compileToPython(token: UniversalToken): string {
    switch (token) {
      case UniversalToken.ASSIGN: return "=";
      case UniversalToken.EQUALITY: return "==";
      case UniversalToken.LAMBDA: return "lambda ";
      case UniversalToken.PROPERTY_ACCESS: return ".";
      case UniversalToken.STATEMENT_TERMINATOR: return "";
      case UniversalToken.LIST_SEPARATOR: return ",";
      case UniversalToken.KEY_VALUE_SEPARATOR: return ":";
      case UniversalToken.PAREN_OPEN: return "(";
      case UniversalToken.PAREN_CLOSE: return ")";
      case UniversalToken.BLOCK_START: return ":"; // Python uses colon for indentation block
      case UniversalToken.BLOCK_END: return "";
      case UniversalToken.BRACKET_OPEN: return "[";
      case UniversalToken.BRACKET_CLOSE: return "]";
      case UniversalToken.STRING_LITERAL: return "'";
      case UniversalToken.ARRAY_MAP: return "map(";
      case UniversalToken.ARRAY_FILTER: return "filter(";
      case UniversalToken.PRINT: return "print(";
      default: return "";
    }
  }

  private static compileToCSharp(token: UniversalToken): string {
    switch (token) {
      case UniversalToken.ASSIGN: return "=";
      case UniversalToken.EQUALITY: return "==";
      case UniversalToken.LAMBDA: return "=>";
      case UniversalToken.PROPERTY_ACCESS: return ".";
      case UniversalToken.STATEMENT_TERMINATOR: return ";";
      case UniversalToken.LIST_SEPARATOR: return ",";
      case UniversalToken.KEY_VALUE_SEPARATOR: return ":";
      case UniversalToken.PAREN_OPEN: return "(";
      case UniversalToken.PAREN_CLOSE: return ")";
      case UniversalToken.BLOCK_START: return "{";
      case UniversalToken.BLOCK_END: return "}";
      case UniversalToken.BRACKET_OPEN: return "[";
      case UniversalToken.BRACKET_CLOSE: return "]";
      case UniversalToken.STRING_LITERAL: return '"';
      case UniversalToken.ARRAY_MAP: return ".Select(";
      case UniversalToken.ARRAY_FILTER: return ".Where(";
      case UniversalToken.PRINT: return "Console.WriteLine(";
      default: return "";
    }
  }

  private static compileToRust(token: UniversalToken): string {
    switch (token) {
      case UniversalToken.ASSIGN: return "=";
      case UniversalToken.EQUALITY: return "==";
      case UniversalToken.LAMBDA: return "|"; // Rust closures use vertical pipes |x|
      case UniversalToken.PROPERTY_ACCESS: return ".";
      case UniversalToken.STATEMENT_TERMINATOR: return ";";
      case UniversalToken.LIST_SEPARATOR: return ",";
      case UniversalToken.KEY_VALUE_SEPARATOR: return ":";
      case UniversalToken.PAREN_OPEN: return "(";
      case UniversalToken.PAREN_CLOSE: return ")";
      case UniversalToken.BLOCK_START: return "{";
      case UniversalToken.BLOCK_END: return "}";
      case UniversalToken.BRACKET_OPEN: return "[";
      case UniversalToken.BRACKET_CLOSE: return "]";
      case UniversalToken.STRING_LITERAL: return '"';
      case UniversalToken.ARRAY_MAP: return ".map(";
      case UniversalToken.ARRAY_FILTER: return ".filter(";
      case UniversalToken.PRINT: return "println!(";
      default: return "";
    }
  }

  private static compileToGo(token: UniversalToken): string {
    switch (token) {
      case UniversalToken.ASSIGN: return ":=";
      case UniversalToken.EQUALITY: return "==";
      case UniversalToken.PROPERTY_ACCESS: return ".";
      case UniversalToken.STATEMENT_TERMINATOR: return "";
      case UniversalToken.LIST_SEPARATOR: return ",";
      case UniversalToken.KEY_VALUE_SEPARATOR: return ":";
      case UniversalToken.PAREN_OPEN: return "(";
      case UniversalToken.PAREN_CLOSE: return ")";
      case UniversalToken.BLOCK_START: return "{";
      case UniversalToken.BLOCK_END: return "}";
      case UniversalToken.BRACKET_OPEN: return "[";
      case UniversalToken.BRACKET_CLOSE: return "]";
      case UniversalToken.STRING_LITERAL: return '"';
      case UniversalToken.PRINT: return "fmt.Println(";
      default: return "";
    }
  }
}
