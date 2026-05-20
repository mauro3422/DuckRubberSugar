export const DialogueSyntaxMap: Record<string, { symbol: string; category: string }[]> = {
  "parentesis": [{ symbol: "()", category: "delimitadores" }],
  "parentese": [{ symbol: "()", category: "delimitadores" }],
  "parenthesis": [{ symbol: "()", category: "delimitadores" }],
  "parentheses": [{ symbol: "()", category: "delimitadores" }],
  "paren": [{ symbol: "()", category: "delimitadores" }],
  "corchetes": [{ symbol: "[]", category: "delimitadores" }],
  "colchetes": [{ symbol: "[]", category: "delimitadores" }],
  "brackets": [{ symbol: "[]", category: "delimitadores" }],
  "llaves": [{ symbol: "{}", category: "delimitadores" }],
  "chaves": [{ symbol: "{}", category: "delimitadores" }],
  "braces": [{ symbol: "{}", category: "delimitadores" }],
  "curly": [{ symbol: "{}", category: "delimitadores" }],
  "igual": [{ symbol: "=", category: "operadores" }],
  "equals": [{ symbol: "=", category: "operadores" }],
  "flecha": [{ symbol: "=>", category: "operadores" }],
  "seta": [{ symbol: "=>", category: "operadores" }],
  "arrow": [{ symbol: "=>", category: "operadores" }],
  "dos puntos": [{ symbol: ":", category: "puntuación" }],
  "dois pontos": [{ symbol: ":", category: "puntuación" }],
  "colon": [{ symbol: ":", category: "puntuación" }],
  "punto y coma": [{ symbol: ";", category: "puntuación" }],
  "ponto e virgula": [{ symbol: ";", category: "puntuación" }],
  "semicolon": [{ symbol: ";", category: "puntuación" }],
  "punto": [{ symbol: ".", category: "puntuación" }],
  "ponto": [{ symbol: ".", category: "puntuación" }],
  "dot": [{ symbol: ".", category: "puntuación" }],
  "comillas": [{ symbol: '""', category: "delimitadores" }],
  "aspas": [{ symbol: '""', category: "delimitadores" }],
  "quotes": [{ symbol: '""', category: "delimitadores" }],
  "quote": [{ symbol: '""', category: "delimitadores" }]
};

export const DialogueStopWords = new Set([
  // Spanish
  "hola", "como", "estas", "que", "con", "para", "por", "una", "este", "ahora", "del", "las", "los", "una", "uno", "unos", "unas", "bueno", "pero", "aqui", "acá", "donde", "despues", "tengo", "esta", "otra", "todo", "solo", "ver", "mas", "más", "mira",
  // English
  "hello", "how", "are", "you", "that", "with", "for", "now", "here", "where", "after", "then", "just", "about", "some", "good", "well", "only", "this", "there", "look", "have",
  // Portuguese
  "bom", "dia", "tarde", "tudo", "bem", "como", "vai", "ola", "olá", "com", "para", "por", "uma", "este", "agora", "aqui", "onde", "depois"
]);
