import type { AudioViewDelegate } from "../services/audio-service.js";
import { AudioService } from "../services/audio-service.js";
import { AudioTranscriptionPipeline } from "./audio-transcription-pipeline.js";
import { DefaultDataset } from "../data/default-dataset.js";

export interface AudioRecordingDelegate {
  setStatus(text: string, kind?: string): void;
  log(type: string, data?: Record<string, unknown>): void;
  storeUpdate(updates: Record<string, unknown>): void;
  storeGet(): { currentTestCase?: { id: string; fileName: string; expectedTranscript?: string; expectedCode?: string; contextHint?: string } | null };
}

export class AudioRecordingManager {
  typingIntervalId: number | null = null;
  audioTranscriptionPromise: Promise<void> | null = null;
  audioTranscriptionRequestId = 0;

  constructor(
    private readonly audio: AudioService,
    private readonly transcriptionPipeline: AudioTranscriptionPipeline,
    private readonly delegate: AudioRecordingDelegate,
  ) {}

  clearTyping(): void {
    if (this.typingIntervalId !== null) {
      clearInterval(this.typingIntervalId);
      this.typingIntervalId = null;
    }
  }

  loadAudioFile(file: File, delegate: AudioViewDelegate): void {
    this.clearTyping();

    const testCase = DefaultDataset.cases.find((tc) => tc.fileName === file.name);
    this.delegate.storeUpdate({
      currentTestCase: testCase ?? null,
      expectedTranscript: "",
      manualTranscript: "",
      isTranscribingAudio: true,
      audioStateText: "Transcribiendo archivo de audio..."
    });
    this.delegate.setStatus("Transcribiendo con Google ASR...");

    this.audio.loadFile(file, delegate, (type, data = {}) => this.delegate.log(type, data));
    const transcriptionRequestId = ++this.audioTranscriptionRequestId;

    this.audioTranscriptionPromise = this.transcriptionPipeline.transcribeFile(file)
      .then((result) => {
        if (transcriptionRequestId !== this.audioTranscriptionRequestId) return;
        this.delegate.storeUpdate({
          audioStateText: "Audio listo e indexado con ASR",
          manualTranscript: result.transcript,
          manualTranscriptEs: result.transcriptEs,
          manualTranscriptEn: result.transcriptEn,
        });
        this.delegate.log("audio-file-transcribed", { name: file.name, chars: result.transcript.length });
        this.startTypingAnimation(result.transcript);
      })
      .catch((error) => {
        if (transcriptionRequestId !== this.audioTranscriptionRequestId) return;
        this.delegate.log("audio-file-transcribe-error", { name: file.name, message: (error as Error).message });
        this.delegate.storeUpdate({
          expectedTranscript: "",
          manualTranscript: "",
          isTranscribingAudio: false,
          audioStateText: "Audio listo, pero Google ASR fallo"
        });
        this.delegate.setStatus("Google ASR requerido: inicia npm run asr o asr:5501", "bad");
      })
      .finally(() => {
        if (transcriptionRequestId === this.audioTranscriptionRequestId) {
          this.audioTranscriptionPromise = null;
        }
      });
  }

  transcribeRecordedAudio(): Promise<void> {
    const requestId = ++this.audioTranscriptionRequestId;
    this.audioTranscriptionPromise = this.audio.waitForRecordingReady()
      .then(async (asset) => {
        if (requestId !== this.audioTranscriptionRequestId) return;
        if (!asset?.blob) throw new Error("No hay audio grabado para transcribir");
        const file = new File([asset.blob], "grabacion.webm", { type: asset.blob.type || "audio/webm" });
        const result = await this.transcriptionPipeline.transcribeFile(file);
        if (requestId !== this.audioTranscriptionRequestId) return;
        this.delegate.storeUpdate({
          audioStateText: "Grabacion lista e indexada con ASR",
          manualTranscript: result.transcript,
          manualTranscriptEs: result.transcriptEs,
          manualTranscriptEn: result.transcriptEn,
        });
        this.delegate.log("recording-transcribed", { chars: result.transcript.length });
        this.startTypingAnimation(result.transcript);
      })
      .catch((error) => {
        if (requestId !== this.audioTranscriptionRequestId) return;
        this.delegate.log("recording-transcribe-error", { message: (error as Error).message });
        this.delegate.storeUpdate({
          expectedTranscript: "",
          manualTranscript: "",
          isTranscribingAudio: false,
          audioStateText: "Grabacion lista, pero Google ASR fallo",
        });
        this.delegate.setStatus("Google ASR requerido para grabacion", "bad");
      })
      .finally(() => {
        if (requestId === this.audioTranscriptionRequestId) {
          this.audioTranscriptionPromise = null;
        }
      });
    return this.audioTranscriptionPromise;
  }

  startTypingAnimation(transcript: string, successStatus = "Transcripción ASR lista"): void {
    this.clearTyping();

    const words = transcript.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      this.delegate.storeUpdate({ expectedTranscript: "", isTranscribingAudio: false });
      this.delegate.setStatus(successStatus, "ready");
      return;
    }

    const interval = Math.max(25, Math.min(100, 2000 / words.length));
    let currentIndex = 0;
    let currentText = "";

    this.delegate.storeUpdate({ isTranscribingAudio: true, expectedTranscript: "" });

    this.typingIntervalId = window.setInterval(() => {
      if (currentIndex >= words.length) {
        this.clearTyping();
        this.delegate.storeUpdate({ expectedTranscript: transcript, isTranscribingAudio: false });
        this.delegate.setStatus(successStatus, "ready");
      } else {
        currentText = currentText ? `${currentText} ${words[currentIndex]}` : words[currentIndex];
        this.delegate.storeUpdate({ expectedTranscript: currentText });
        currentIndex++;
      }
    }, interval);
  }
}
