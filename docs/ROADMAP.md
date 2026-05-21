# DuckSugar + SpeechNormalizer Roadmap

## Phase 1: Current — Smart Regex Library Foundation

- [x] 32 test cases covering core patterns (printf, if/not, console.log, arrow functions, .map/.filter, array literals, context lexicon, mispronunciations, false positives)
- [x] Bug fixes: `looksMalformedCode` dot leading chars, `inferPrintfCall` dollar/template support
- [x] 100% test pass rate
- [x] HTML pipeline test runner with optional LLM integration
- [x] Paper research: Kencode taxonomy, Spoken Java/XGLR, ACM 2023 study
- [x] Design doc: smart regex library, mismatch tags, confidence scoring
- [ ] Refactor `hasCode` (binary) → confidence score (0-100%)
- [ ] Implement mismatch detector: compare spoken words vs generated code tokens
- [ ] Define output schema: `{ code, confidence, tags[], notes[] }` for LLM consumption

## Phase 2: Core — Mismatch Detection & Confidence

- [ ] Confidence scoring on every pattern match (weighted by token count, ambiguity)
- [ ] Mismatch tag emission for: unclosed parens/braces, missing template expressions, low-confidence prefixes, untranslated Spanish tokens
- [ ] Context lexicon integration: IDE-provided variable names boost confidence for [W] matches
- [ ] Test suite expansion: 32 → 50+ cases, including edge cases for each tag type

## Phase 3: Pipeline — LLM Integration

- [ ] Feed SpeechNormalizer output (sketch + tags) into LLM prompt header
- [ ] LLM prompt template: "The user said: X. SpeechNormalizer produced Y with Z tags. Confirm or correct."
- [ ] Streamlined response schema from LLM (optional — LLM only needed when confidence < threshold)
- [ ] Confidence threshold config: auto-approve code when confidence > 90%, always ask LLM when < 50%

## Phase 4: Stretch — Small Voice Model

- [ ] Collect Argentine/Tucumano Spanish code dictation dataset
- [ ] Fine-tune small Whisper or similar model on code-heavy transcriptions
- [ ] Replace or augment Google ASR with local model
- [ ] No existing library covers Argentine Spanish + code — unique differentiator

## Phase 5: IDE Integration

- [ ] Editor connector plugin (VS Code / JetBrains) to provide context lexicon
- [ ] Real-time variable name resolution as user speaks
- [ ] File-scope symbol table injection into normalizer

## Design Principles

1. **No more hardcoded patterns** — all future mappings go into the smart regex library with configurable rule sets
2. **Mismatch tags, not silent fixes** — always tell the LLM when we're unsure
3. **Test-first** — every rule needs 2+ test cases (one success, one edge/failure)
4. **Bilingual by default** — all rules handle ES and EN input equally
5. **Local-first** — everything must work offline with Chrome Nano
