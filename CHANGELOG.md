# Changelog

## Unreleased

### Added

- Initialized repository metadata with `.gitignore`.
- Added project architecture documentation in `docs/architecture.md`.
- Rewrote `README.md` around the current ASR -> preanalysis -> model -> benchmark flow.
- Added dynamic context lexicon support to `SpeechNormalizer`.
- Added `[CODE NOTES]` prompt injection from local preanalysis.

### Changed

- Removed dataset transcript fallback; every audio run now requires Google ASR output.
- Reports no longer refresh from the in-progress placeholder output while a prompt is running.
- Model results are locally hydrated with the ASR transcript when the XML omits `<transcript>`.
- Empty model `<code>` can be hydrated from the trusted local code sketch before triggering repair.
- `SpeechNormalizer.hasCodePatterns` now uses normalized identifiers and optional IDE context.
- `SpeechNormalizer.inferCodeFromSpeech` now accepts optional IDE/RAG context.
- `tc-01` style `printf` dictation is recovered before universal TypeScript token fallback.
- `tc-02` style `if not count` is recovered as `if (!count)`.
- `tc-03` style note-list reconstruction now comes from IDE context identifiers rather than a global dictionary.

### Fixed

- Added an ASR bridge `/health` preflight before `POST /transcribe`, so Live Server/incorrect-origin runs fail loudly instead of corrupting benchmarks.
- Prevented mixed `latestReport` states such as previous metrics plus `rawOutput: "Esperando respuesta..."`.
- Avoided self-refinement for trusted deterministic local sketches.
- Removed debug logging from `SpeechNormalizer`.
- Prevented malformed symbol-only snippets from contaminating benchmark runs.
- Improved preanalysis stability for the current benchmark set.

### Notes

- The current dynamic lexicon source is `contextHint` from the dataset/IDE context.
- Future work should replace or supplement `contextHint` with live IDE symbols and RAG.
