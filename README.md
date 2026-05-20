# DuckSugar

DuckSugar is a local voice-driven rubber-duck and code-aid experiment. It uses a local Python server to transcribe audio with Google ASR, then sends the transcript plus compact technical context to Chrome's experimental `LanguageModel` API.

The project is not trying to make ASR understand code. The intended architecture is:

```text
audio -> Google ASR text -> local preanalysis -> Gemini Nano -> parsed XML -> benchmark report
```

The local preanalysis layer detects spoken code signals, normalizes universal syntax tokens, and uses IDE/RAG context as a dynamic lexicon for project-specific identifiers.

## Current Goal

Build a practical spoken programming assistant that can:

- understand rough Spanish/English developer speech;
- detect when the user is talking about code;
- recover probable identifiers from IDE context;
- answer concisely;
- benchmark transcript quality, code reconstruction, latency, repairs, and model stability.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the detailed flow.

High-level modules:

- `transcribe_server.py`: local HTTP server, static file serving, and `POST /transcribe`.
- `src/engine/pipeline-engine.ts`: audio/transcript/model orchestration.
- `src/utils/speech-normalizer.ts`: local code preanalysis, syntax normalization, and dynamic context lexicon matching.
- `src/services/language-model-service.ts`: Chrome `LanguageModel` execution and repair pass coordination.
- `src/utils/json-tools.ts`: XML response parsing, sanitization, and enrichment.
- `src/utils/dialogue-analyzer.ts`: interaction category, suggested questions, and phonetic/code mismatch hints.
- `src/services/benchmark-*`: benchmark aggregation, export, and statistics.

## Data Flow

1. User records or loads an audio file.
2. Browser sends the audio to the local Python server.
3. Python server returns a Google ASR transcript.
4. `SpeechNormalizer` runs local preanalysis:
   - code detection;
   - universal syntax recovery, such as `igual`, `flecha`, `parentesis`, `comilla`;
   - IDE context lexicon matching, such as `noteList`, `notasFiltradas`, `noteCount`.
5. The prompt receives:
   - ASR transcript;
   - acoustic state;
   - optional IDE context;
   - `[CODE DETECTED]`;
   - `[CODE SKETCH]`;
   - `[CODE NOTES]`.
6. Gemini Nano returns XML.
7. Parser sanitizes the XML, computes metadata, and stores a benchmark report.

## Setup

Install dependencies:

```bash
npm install
```

Compile TypeScript:

```bash
npm run build
```

Run the local server:

```bash
npm run start
```

Or compile and run in one command:

```bash
npm run dev
```

For active development, use two terminals:

```bash
npm run watch
npm run start
```

Open:

```text
http://127.0.0.1:5500/index.html
```

Do not open the app with VS Code Live Server on port `5500`. DuckSugar needs its Python server on that origin because the browser posts audio to `POST /transcribe`. If `/health` is missing or does not return `{"service":"ducksugar"}`, the app will block ASR and the benchmark run is invalid.

## Chrome Requirements

DuckSugar depends on Chrome's experimental local `LanguageModel` API. The exact flags can change across Chrome versions, but this project expects the on-device Gemini Nano model and Prompt API to be available in the browser.

Check:

- `chrome://flags/#optimization-guide-on-device-model`
- `chrome://flags/#prompt-api-for-gemini-nano`
- `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`
- `chrome://components` -> `Optimization Guide On Device Model`

## Benchmarks

The local dataset lives in `src/data/default-dataset.ts` and audio samples live in `pruebas/`.
Dataset entries do not provide transcript fallbacks. Audio runs must go through Google ASR; if `/transcribe` fails, the run is blocked instead of using a stored transcript.

Current benchmark cases:

- `tc-01-hello`: short `printf("hola mundo")` dictation.
- `tc-02-notecount`: spoken logic question around `if (!count)`.
- `tc-03-notelist`: longer JavaScript/DOM note list snippet with IDE context.

Reports track:

- total latency;
- first token latency;
- tokens/chars per second;
- transcript similarity;
- probable code similarity;
- repair attempts;
- truncation/repetition failures;
- parsed answer/code metadata.

## Design Notes

DuckSugar should not rely on a huge hardcoded dictionary of every possible spoken phrase. The intended split is:

- Universal grammar: stable spoken programming symbols and operators.
- Dynamic lexicon: identifiers provided by IDE context now, and RAG later.
- Model reasoning: validate intent, refine code, and answer.

This keeps the system extensible across projects and languages while still helping a small local model with the parts it consistently misses.
