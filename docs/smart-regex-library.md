# SpeechNormalizer — Smart Regex Library for Dictated Code

## Core Insight

SpeechNormalizer **is** the smart regex library. It is not a separate component. The library sits between ASR transcription and the LLM, producing a code sketch with confidence metadata instead of a final answer.

## Architecture

```
ASR Transcription (ES/EN)
    ↓
Smart Regex Library (SpeechNormalizer)
    ├── Universal Grammar (stable syntax)
    ├── Context Lexicon (IDE/RAG variables)
    └── Mismatch Detector (confidence tags)
    ↓
Code Sketch + Confidence Tags
    ↓
LLM (Chrome Gemini Nano) → final output
```

## Key Design Decision: Mismatch Tags Over Silent Correction

The library never silently "fixes" ambiguous input. Instead it emits tags like:

- `"confidence:low"` — weak pattern match
- `"possible_unclosed_paren"` — `parentesis` without matching close
- `"possible_unclosed_brace"` — `llave` without matching close
- `"possible_dollar_variable"` — `signo pesos` detected, `{...}` inferred
- `"possible_template_literal"` — `signo pesos llave` pattern
- `"low_confidence_prefix"` — e.g. `console.log` normalized from `console punto log`

The LLM receives both the code sketch and the tags, and decides the final output.

## Confidence Scoring (Planned)

Replace binary `hasCode` with 0-100% confidence:

- **90-100%**: Strong multi-token match (e.g. `if not count` → `if (!count)`). Emit code directly, no tag.
- **70-89%**: Good match but minor ambiguity (e.g. missing close paren). Emit code + warning tag.
- **40-69%**: Probable but uncertain (e.g. partial context lexicon match). Emit sketch + explanation tag.
- **0-39%**: Weak or no match. Let LLM handle entirely.

## Taxonomy (Kencode-Inspired)

Adapted from Kencode [K][B][O][W]:

| Tag | Meaning | Examples |
|-----|---------|---------|
| **[K]** | Keywords | `if`, `else`, `for`, `while`, `return`, `const`, `let`, `function` |
| **[B]** | Base operations | `map`, `filter`, `innerHTML`, `textContent`, `length` |
| **[O]** | Operators | `=`, `===`, `=>`, `+`, `.` (dot), `!` (not) |
| **[W]** | Words (identifiers) | `noteList`, `notasFiltradas`, `noteCount` (via context lexicon) |

## Configurable Rule Set (Planned)

The library should support enabling/disabling rule categories:

```javascript
const normalizer = new SpeechNormalizer({
  rules: {
    inferPrintf: true,
    inferNotCondition: true,
    normalizeDotAccess: false,    // disable "punto" → "." normalization
    templateLiterals: true,
    arrowFunctions: true,
    contextLexicon: ["noteList", "notasFiltradas"],
    confidenceThreshold: 0.7,     // minimum score to auto-emit code
  }
});
```

## Relationship to Existing Code

- `src/utils/speech-normalizer.ts` — the library core (grow, don't rewrite)
- `src/utils/universal-grammar.ts` — token patterns and symbol compiler
- `test_autonomous.js` — 32-case test suite, will grow with each rule
- `test-pipeline.html` — visual pipeline test runner with optional LLM integration

## Future: Small Voice Model

All current systems (Code Dictator, Kencode, Serenade, VoxPilot) hardcode mappings. A small fine-tuned model with Argentine/Tucumano Spanish dialect data would be unique and more robust than any rule set.
