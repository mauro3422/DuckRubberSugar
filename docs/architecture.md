# DuckSugar Architecture

DuckSugar is a browser-first local voice assistant for developer workflows. It uses a **layered pipeline** where the model hears the audio directly, ASR is just reference, and WCL + SpeechNormalizer act as post-hoc safety nets.

## Pipeline

```text
Audio input
  -> AudioService (startRecording — MediaRecorder.start(1000) for ~1s chunks)
     -> onAudioProgress callback each chunk
     -> [streaming] session.append(partialBlob) — audio accumulated during recording
  -> ASR bridge (transcribe_server.py /transcribe)
  -> Google ASR transcript (raw text)
  -> [1] Audio Pass — model listens to audio + ASR, outputs corrections (optional; timeout doesn't block)
  -> [2] Word Correction Layer (WCL) — applies corrections per-word to ASR (optional)
  -> [3] SpeechNormalizer preanalysis (code sketch + notes) (optional)
  -> [4] Main Pass — uses streaming session if available, else clones fresh + attaches audio blob
  -> JsonTools parser
  -> DialogueAnalyzer metadata
  -> Benchmark/report storage
```

ASR is the base text. Audio is the verification channel. The model reads the ASR like a draft, then listens to audio like a proofreader: "this word doesn't match what I hear → correct it".

Priority: **model's final output > WCL corrections > ASR raw > SpeechNormalizer

---

## [1] Audio Pass (WCL feeder)

**File:** `src/services/language-model-service.ts:44-136` (`runAudioTranscription`)

The model listens to the actual audio alongside the ASR transcript and outputs JSON with per-word corrections:

```typescript
{
  transcript: string;                        // full corrected transcript
  phonetic_corrections: PhoneticCorrection[]; // word-level corrections
  confidence: number;                        // 0-1 global confidence
  reasoning: string;                         // why corrections were made
}
```

Uses `TranscriptionSchema` as `responseConstraint`. Still runs but its timeout no longer blocks the pipeline — the Main Pass hears audio regardless.

---

## [2] Word Correction Layer (WCL)

**File:** `src/utils/transcript-merger.ts` (`TranscriptMerger`)

Applies corrections surgically — one word at a time, per-correction confidence. Operates on the raw ASR transcript, not the model output.

See `transcript-merger.ts` for full logic.

---

## [3] SpeechNormalizer (preanalysis)

**File:** `src/utils/speech-normalizer.ts`

Heuristic preanalysis on the corrected ASR. Extracts:
- `codeSketch` — partial inferred code (printf calls, if-conditions, etc.)
- `codeNotes` — identifiers and actions mentioned in speech

**Now optional** — the Main Pass hears audio directly. SpeechNormalizer is a fallback hint, not a requirement.

---

## [4] Main Pass (text + audio)

**File:** `src/engine/pipeline-engine.ts:700-726` (`sendAudio` → `runAudioPrompt`)

The Main Pass receives audio in one of two ways:

### Streaming path (live recording)
```
[streaming session]  ← audio chunks appended during recording via session.append()
[Acoustic State + instructions]
[Corrected ASR transcript]  ← from WCL
[codeSketch + codeNotes]    ← from SpeechNormalizer (optional)
[Context hint (IDE/RAG)]
```

### Non-streaming path (benchmark / file load)
```
[Audio blob]  ← attached to prompt inline
[Acoustic State + instructions]
[Corrected ASR transcript]  ← from WCL
[codeSketch + codeNotes]    ← from SpeechNormalizer (optional)
[Context hint (IDE/RAG)]
```

The model:
1. **Reads the ASR transcript** (base text, primary transcription)
2. **Hears the audio** (verification channel — either streamed or attached)
3. **Compares** both: "ASR says X, audio sounds like Y → correct"
4. **Produces** final code + transcript + answer

**Why this matters:**
- Before: Audio Pass cloned once to hear audio → Text Pass cloned again with only text → if Audio Pass timed out, Text Pass was blind
- After: Audio Pass still runs for WCL corrections, but Main Pass always gets audio regardless of Audio Pass timeout
- Streaming: audio is being processed by the model during recording, reducing post-recording latency

---

## Streaming Audio

**File:** `src/engine/pipeline-engine.ts:99-183` (`startRecording` / `stopRecording`)

During live recording, audio chunks are streamed to the model incrementally:

1. `startRecording()` clones a dedicated **streaming session** from the base session
2. `MediaRecorder.start(1000)` fires `dataavailable` every ~1s during recording
3. Each partial blob is emitted via `AudioViewDelegate.onAudioProgress`
4. `PipelineEngine` receives the callback and calls `session.append(partialBlob)` sequentially
5. A promise chain (`streamingAppendQueue`) ensures chunks are processed in order without races
6. When the user stops recording and sends, `sendAudio` awaits the queue to drain, then passes the accumulated session to `runAudioPrompt` as `existingSession`
7. `runAudioPrompt` uses this session instead of cloning a fresh one — the model already has the audio in context
8. The session is destroyed by `runAudioPrompt`'s cleanup after the prompt completes

### Why streaming matters
- Audio is being processed (or at least ingested) during recording, not after
- Reduces the gap between "user stops speaking" and "model responds"
- The full-blob attach fallback is used for benchmark/file-load paths

---

```text
User says:  "printf paréntesis comilla Hola mundo comilla punto y coma"

ASR hears:  "printf paréntesis con mi yaola mundo con Isa punto y coma"
                                         ↑ errors

[1] Audio Pass: escucha audio + ASR
  → phonetic_corrections: [{original: "yaola", corrected: "hola", confidence: 0.95}]
  → confidence: 0.92

[2] WCL: aplica correcciones al ASR:
  "printf paréntesis comilla hola mundo con Isa punto y coma"
  Note: "con Isa" no se corrije (confianza baja o no detectado)

[3] SpeechNormalizer: infiere printf call
  → code sketch: printf("Hola mundo")

[4] Main Pass: recibe audio + ASR corregido + code sketch
  Modelo escucha audio → oye "comilla" correctamente
  → corrige "comilla" y produce código final
  → output: printf("Hola mundo");

Result: printf("Hola mundo");
```

---

## Error Recovery

| Failure | Effect | Recovery |
|---|---|---|
| Audio Pass timeout | No WCL corrections | Main Pass hears audio directly — no data loss |
| SpeechNormalizer empty sketch | No code hint | Main Pass hears audio + reads ASR — no data loss |
| Main Pass hears audio only | No ASR text | Model transcribes from scratch (worst case) |

The pipeline is **resilient to any single layer failing** because the Main Pass always has the audio.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Audio in Main Pass, not just Audio Pass | Eliminates blind-Text-Pass problem; model hears once |
| Streaming via append() during recording | Audio processed incrementally; reduces post-recording latency |
| Streaming session reused for Main Pass | No second clone; accumulated audio context preserved |
| WCL still runs on ASR | Catches predictable ASR errors before Main Pass |
| SpeechNormalizer is optional | Heuristics can't beat the model hearing audio directly |
| ASR is reference, not source of truth | Audio is the source; ASR is a draft |

## Repair Passes

`LanguageModelService` may trigger extra passes:
- `asr_text_retry`: first pass missed transcript/code despite ASR text.
- `json_repair`: XML/JSON shape is invalid.
- `self_refinement`: code contains raw spoken punctuation, unbalanced delimiters, or semantic mismatch.
