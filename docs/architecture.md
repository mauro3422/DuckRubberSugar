# DuckSugar Architecture

DuckSugar is a browser-first local voice assistant for developer workflows. It is built around one constraint: Google ASR returns text, not code. Code understanding is therefore handled after transcription by local preanalysis plus the browser model.

## Pipeline

```text
Audio input
  -> AudioService
  -> ASR bridge discovery via /health
  -> transcribe_server.py /transcribe
  -> Google ASR transcript
  -> SpeechNormalizer preanalysis
  -> Prompt header + transcript + context
  -> Chrome LanguageModel session
  -> XML response
  -> JsonTools parser
  -> DialogueAnalyzer metadata
  -> Benchmark/report storage
```

## Core Components

### Browser App

- `src/app.ts`: app bootstrap.
- `src/store/app-store.ts`: reactive app state.
- `src/view/*`: UI panels.
- `src/engine/pipeline-engine.ts`: main orchestration.

### Audio and ASR

- `src/services/audio-service.ts`: recording, file loading, duration, and volume metrics.
- `src/utils/wav-encoder.ts`: browser-side WAV conversion.
- `transcribe_server.py`: static server plus Google ASR endpoint.

The app intentionally blocks new file runs when no ASR transcript is available. Dataset transcripts are not used as fallbacks. Chrome Nano is not used as a raw audio transcriber in the current flow.

The ASR bridge can run same-origin with the app or on a separate local port. `PipelineEngine` probes `/health` on the current origin and known local bridge ports before sending audio to `/transcribe`. This avoids the corrupted benchmark case where VS Code Live Server owns `5500` and returns `405 Method Not Allowed` for `POST /transcribe`.

`npm run dev` is the intended single-command development entrypoint. It runs TypeScript in watch mode and starts the Python static/ASR server. If `5500` is unavailable, the server chooses the next configured local port and the browser can still find it through `/health`.

Valid benchmark preconditions:

- `/health` identifies `service: "ducksugar"` and `asr: "google"`;
- the event log includes `asr-bridge-selected`;
- the file load emits `audio-file-transcribed`;
- no dataset transcript fallback is present.

Benchmark audio is loaded from `pruebas/` by the browser. The benchmark loop must use the same file-loading path as a user-selected audio file: fetch audio, decode/convert to WAV, call `/transcribe`, then prompt the model with the Google ASR transcript.

### Local Preanalysis

- `src/utils/universal-grammar.ts`: multilingual spoken programming grammar.
- `src/utils/speech-normalizer.ts`: code detection, symbol normalization, and context lexicon recovery.

Preanalysis produces:

- `codeDetected`: whether the transcript likely contains code.
- `codeSketch`: best-effort probable code when local evidence is strong.
- `codeNotes`: compact identifiers/operators/uncertainty notes for the model.

Example:

```text
[CODE DETECTED]
[CODE SKETCH]
noteList.innerHTML = notasFiltradas.map(...)
[CODE NOTES]
- identifiers: noteList, notasFiltradas, noteCount
- operators: = => === .
- uncertain: node/note list likely noteList
```

## Dynamic IDE/RAG Lexicon

Project-specific names must not live in a global hardcoded dictionary. They come from context.

Current source:

```xml
<ide_context>
identificadores_visibles: noteList, notasFiltradas, nota, noteActiveId, activeClass, noteCount
tokens_visibles: innerHTML, map, const, id, active, if, textContent, length, notas
</ide_context>
```

Future source:

```text
RAG / editor connector -> visible symbols -> nearby code -> file/project vocabulary
```

The normalizer can then resolve ASR variants such as:

- `node list.net html` -> `noteList.innerHTML`
- `nota filtradas punto maps` -> `notasFiltradas.map`
- `notes.com text content` -> `noteCount.textContent`

This is contextual recovery, not a universal Spanish dictionary.

## Model Contract

The model must return XML:

```xml
<response>
  <think></think>
  <tags></tags>
  <transcript></transcript>
  <code></code>
  <answer></answer>
  <directed></directed>
  <lang></lang>
  <needs_context></needs_context>
  <phonetic_corrections></phonetic_corrections>
</response>
```

Important constraints:

- `<think>` is short and in English.
- `<answer>` is concise, max 20 words.
- `<code>` is mandatory when `[CODE DETECTED]` is present.
- `<code>` must contain raw code only, not nested XML or correction tags.

## Repair Passes

`LanguageModelService` may trigger extra passes:

- `asr_text_retry`: first pass missed transcript/code despite ASR text.
- `json_repair`: XML shape is invalid.
- `self_refinement`: code contains raw spoken punctuation, unbalanced delimiters, or semantic mismatch.

Repair is useful but expensive. Benchmark reports track whether it improves the score.

## Current Design Tradeoff

The system deliberately avoids a single massive regex/dictionary layer. Instead:

1. Universal grammar handles stable syntax.
2. IDE/RAG context supplies real project names.
3. The model resolves intent and produces the final user-facing answer.

This is the path that scales beyond the three benchmark examples.
