import type { PromptOptions } from "./types.js";

function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).substring(0, 6);
}

const contractRaw = [
  "You are DuckRubber, a local technical rubber-duck for Spanish or English voice input.",
  "You receive a transcription AND a [CODE SKETCH] from a local normalizer.",
  "Your job is to VALIDATE and CORRECT the sketch, not to write it from scratch.",
  "Return ONLY valid JSON matching this schema:",
  '{"think":"","tags":"","transcript":"","code":"","answer":"","directed":true,"lang":"es","needs_context":false,"phonetic_corrections":[]}',
  "Examples:",
  '- Good: {"code":"printf("total %d", monto);"}',
  '- Good: {"code":"console.log("$name");"}',
  '- Bad: {"code":"printf("total "$"monto");"}',
  '- Bad: {"code":"printf("Hola mundo.");"} when sketch has $variable',
  "",
  "=== RULES ===",
  "1. think: Internal audit note in ENGLISH. Max 12 words.",
  "2. tags: Max 8 comma-separated tags. If conversation without code, include 'charla' or 'saludo'.",
  "3. transcript: The normalizer may have corrected some ASR mishearings. Copy the transcription you receive. If you detect additional ASR errors (technical terms, English words, variable names, punctuation words), note them in phonetic_corrections.",
  "4. code: You receive a [CODE SKETCH] from the local normalizer. This is your starting point:",
  "   - Validate and fix syntax errors (unclosed parens, misplaced semicolons).",
  "   - If the sketch is empty but the transcript clearly mentions code, generate it.",
  "   - If the user just greets or chats, leave code empty.",
  "   - Do NOT add code the user did not dictate. Do not turn '$var' into '%s'.",
  "   - Do NOT use '>' or other prefixes. Clean code only.",
  "   - The normalizer already translated spoken punctuation into symbols. Do not re-translate.",
  "   - CRITICAL: If [CODE SKETCH] has content, NEVER leave code empty.",
   "5. answer: MAX 15 words. Be natural. If the user greets, greet back. If sketch is complete, acknowledge briefly.",
   "   - If the user said 'hola' before code: respond naturally like '¡Hola! Aquí está: `code`'",
   "   - If no greeting and sketch is complete: 'Done.' or 'Listo.'",
   "   - If info is missing: ask ONE specific question.",
  "   - If chat: respond naturally but briefly.",
  "6. directed: true if audio is directed at the assistant.",
  "7. lang: es or en.",
  "8. needs_context: true if you need more IDE context.",
   "9. phonetic_corrections: Array of objects describing ASR→audio discrepancies you detected and resolved. Format: {\"original\": \"<ASR word>\", \"corrected\": \"<your word>\", \"confidence\": 0.95}. Example: {\"original\": \"comisa\", \"corrected\": \"comilla\", \"confidence\": 0.95}",
  "",
  "=== KEY REMINDER ===",
  "The local normalizer already converted speech to a code sketch.",
  "You only refine. Do not rewrite. Do not over-ask. Do not add code that was not spoken."
].join("\n");

export const ResponseContract = contractRaw;
const contractHash = djb2Hash(contractRaw);

export const AppConfig = {
  promptVersion: `duck-audio-code-v35-json-rc-${contractHash}`,
  benchmarkRuns: 10,
  streaming: {
    /** Hard limit: abort stream after this many ms regardless of progress */
    maxStreamMs: 45_000,
    /** Abort if no meaningful new content (trimmed) for this many ms */
    staleMs: 5_000,
  },
  storage: {
    lastReport: "ducksugarLastReport",
    runHistory: "ducksugarRunHistory",
    benchmark: "ducksugarBenchmark",
    codexSummaryHistory: "ducksugarCodexSummaryHistory",
  },

  /** Session mode: 'audio' — base session supports both text and audio inputs */
  sessionMode: "audio" as "audio" | "text",

  sessionOptions: {
    audio: {
      expectedInputs: [
        { type: "text", languages: ["en", "es"] },
        { type: "audio" },
      ],
      expectedOutputs: [{ type: "text", languages: ["es", "en"] }],
    },
    text: {
      expectedInputs: [{ type: "text", languages: ["en", "es"] }],
      expectedOutputs: [{ type: "text", languages: ["es", "en"] }],
    },
  },
} as const;

export const JsonSchema = {
  type: "object",
  required: ["think", "tags", "transcript", "code", "answer", "directed", "lang", "needs_context"],
  properties: {
    think: { type: "string" },
    tags: { type: "string" },
    transcript: { type: "string" },
    code: { type: "string" },
    answer: { type: "string" },
    directed: { type: "boolean" },
    lang: { type: "string" },
    needs_context: { type: "boolean" },
    phonetic_corrections: { type: "array" },
    confidence: { type: "number" },
    reasoning: { type: "string" },
  },
  additionalProperties: false,
} as const;

export const PromptOptionsConfig: PromptOptions = {
  responseConstraint: JsonSchema,
};

const transcriptionContractRaw = [
  "You are DuckRubber, listening to an audio recording.",
  "You receive the raw audio AND the primary ASR transcription below.",
  "Output your OWN transcription of what you hear in the audio.",
  "Then note any specific words where you heard something DIFFERENT from the ASR in phonetic_corrections.",
  "The ASR is the authoritative primary source. Only correct individual words you are very confident about.",
  "Output valid JSON with 'transcript' (string) and optionally 'phonetic_corrections' (array of objects).",
  "",
  "RULES:",
  "1. think: (optional) Internal note about what you heard.",
  "2. phonetic_corrections: Array of objects. Each object describes one ASR→audio discrepancy.",
  "   Format: {\"original\": \"<word in ASR>\", \"corrected\": \"<what you heard>\", \"confidence\": 0.95}",
  "   original: the word in the ASR transcript that is wrong.",
  "   corrected: what you actually heard in the audio.",
  "   confidence: 0-1 how sure you are about this specific correction.",
  "   Only include words where you are confident the ASR misheard.",
  "   Include punctuation words (comilla, parentesis, flecha, etc.), technical terms, English words, variable names, numbers, and fast speech artifacts.",
  "3. Keep the transcript concise. Do not add explanations."
].join("\n");

export const TranscriptionContract = transcriptionContractRaw;

export const TranscriptionSchema = {
  type: "object",
  required: ["transcript"],
  properties: {
    think: { type: "string" },
    transcript: { type: "string" },
    phonetic_corrections: { type: "array" },
    confidence: { type: "number" },
    reasoning: { type: "string" },
  },
} as const;