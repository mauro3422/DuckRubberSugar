import type { AudioAsset } from "../types.js";

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognition;
    SpeechRecognition?: new () => SpeechRecognition;
  }
}

export interface AudioViewDelegate {
  setRecordingState(state: string): void;
  setPlaybackUrl(url: string | null): void;
  clearFileSelection(): void;
  clearRunOutput(): void;
  onAudioDurationReady(durationMs: number): void;
  onSpeechFragment?(finalText: string, interimText: string): void;
  onAudioProgress?(partialBlob: Blob, elapsedMs: number): void;
  onAudioChunk?(chunkBlob: Blob, elapsedMs: number, chunkIndex: number): void;
}

export class AudioService {
  public micTranscription: string | null = null;
  public recordedVolumeHistory: number[] = [];
  public silencePauseCount = 0;
  public chunkedMode = false;
  
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private audioChunks: Blob[] = [];
  private startedAt = 0;
  private stoppedAt = 0;
  private fileDurationMs: number | null = null;
  private current: AudioAsset | null = null;
  private durationReady: Promise<void> | null = null;
  private resolveDurationReady: (() => void) | null = null;
  private recordingReady: Promise<AudioAsset | null> | null = null;
  private resolveRecordingReady: ((asset: AudioAsset | null) => void) | null = null;
  private recognition: SpeechRecognition | null = null;
  public recognitionFinished: Promise<string | null> | null = null;

  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analysisInterval: number | null = null;

  // Chunked processing state
  private chunkDelegate: AudioViewDelegate | null = null;
  private chunkOnLog: ((type: string, data?: Record<string, unknown>) => void) | null = null;
  private chunkLang = "es-AR";
  private chunkIndex = 0;
  private chunkInterval: number | null = null;
  private chunkDurationMs = 3000; // 3 seconds per chunk

  get isRecording(): boolean {
    return Boolean(this.mediaRecorder);
  }

  get stream(): MediaStream | null {
    return this.mediaStream;
  }

  get asset(): AudioAsset | null {
    return this.current;
  }

  get recordedDurationMs(): number | null {
    return this.startedAt && this.stoppedAt ? Math.round(this.stoppedAt - this.startedAt) : this.fileDurationMs;
  }

  async start(
    delegate: AudioViewDelegate,
    onLog: (type: string, data?: Record<string, unknown>) => void,
    lang = "es-AR"
  ): Promise<void> {
    this.audioChunks = [];
    this.current = null;
    this.startedAt = 0;
    this.stoppedAt = 0;
    this.fileDurationMs = null;
    this.durationReady = null;
    this.resolveDurationReady = null;
    this.recordingReady = new Promise((resolve) => {
      this.resolveRecordingReady = resolve;
    });
    this.micTranscription = null;
    this.recognition = null;
    let resolveRecFinished: (val: string | null) => void = () => {};
    this.recognitionFinished = new Promise<string | null>((resolve) => {
      resolveRecFinished = resolve;
    });

    this.recordedVolumeHistory = [];
    this.silencePauseCount = 0;
    delegate.clearFileSelection();
    delegate.clearRunOutput();
    delegate.setPlaybackUrl(null);
    delegate.setRecordingState("Pidiendo microfono...");

    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(this.mediaStream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined,
    });

    this.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
        const partialBlob = new Blob([event.data], { type: this.mediaRecorder?.mimeType || "audio/webm" });
        const elapsed = Math.round(performance.now() - this.startedAt);
        delegate.onAudioProgress?.(partialBlob, elapsed);
      }
    });
    this.mediaRecorder.addEventListener("stop", () => {
      const recorder = this.mediaRecorder;
      const blob = new Blob(this.audioChunks, { type: recorder?.mimeType || "audio/webm" });
      this.current = { blob, durationMs: this.recordedDurationMs };
      delegate.setPlaybackUrl(URL.createObjectURL(blob));
      delegate.setRecordingState(`Audio listo: ${Math.round(blob.size / 1024)} KiB`);
      this.stopTracks();
      this.mediaRecorder = null;
      onLog("recording-ready", { type: blob.type, size: blob.size });
      this.resolveRecordingReady?.(this.current);
      this.resolveRecordingReady = null;
    });

    this.mediaRecorder.start(1000);
    this.startedAt = performance.now();
    delegate.setRecordingState("Grabando...");
    onLog("recording-started", { mimeType: this.mediaRecorder.mimeType });

    // Initialize Web Audio API analysis for Empathy Engine
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextCtor) {
      try {
        this.audioContext = new AudioContextCtor();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.sourceNode.connect(this.analyser);

        const bufferLength = this.analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);

        this.analysisInterval = window.setInterval(() => {
          if (!this.analyser) return;
          this.analyser.getFloatTimeDomainData(dataArray);

          // Calculate RMS volume: Math.sqrt(sum(v^2)/n)
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
          }
          const rms = Math.sqrt(sum / bufferLength);
          this.recordedVolumeHistory.push(rms);

          // Silence threshold: RMS < 0.015
          if (rms < 0.015) {
            this.silencePauseCount++;
          }
        }, 150);
      } catch (err) {
        onLog("audio-analysis-init-error", { message: (err as Error).message });
      }
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognitionCtor) {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang;

      let finalTranscript = "";
      recognition.onresult = (event) => {
        let interimTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }
        this.micTranscription = finalTranscript.trim();
        delegate.onSpeechFragment?.(finalTranscript.trim(), interimTranscript.trim());
      };

      recognition.onerror = (err) => {
        onLog("speech-recognition-error", { error: err.error, message: err.message });
        resolveRecFinished(this.micTranscription);
      };

      recognition.onend = () => {
        onLog("speech-recognition-end", { final: this.micTranscription });
        resolveRecFinished(this.micTranscription);
      };

      try {
        recognition.start();
        this.recognition = recognition;
        onLog("speech-recognition-started", { lang });
      } catch (err) {
        onLog("speech-recognition-start-error", { message: (err as Error).message });
        resolveRecFinished(null);
      }
    } else {
      onLog("speech-recognition-not-supported");
      resolveRecFinished(null);
    }
  }

  async startChunked(
    delegate: AudioViewDelegate,
    onLog: (type: string, data?: Record<string, unknown>) => void,
    lang = "es-AR",
    chunkDurationMs = 3000
  ): Promise<void> {
    this.chunkedMode = true;
    this.chunkDelegate = delegate;
    this.chunkOnLog = onLog;
    this.chunkLang = lang;
    this.chunkDurationMs = chunkDurationMs;
    this.chunkIndex = 0;
    this.audioChunks = [];
    this.current = null;
    this.startedAt = 0;
    this.stoppedAt = 0;

    delegate.clearFileSelection();
    delegate.clearRunOutput();
    delegate.setPlaybackUrl(null);
    delegate.setRecordingState("Pidiendo microfono...");

    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(this.mediaStream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined,
    });

    // Collect chunks for final asset
    this.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    });

    this.mediaRecorder.start(1000);
    this.startedAt = performance.now();
    delegate.setRecordingState("Grabando en modo live...");
    onLog("chunked-recording-started", { chunkDurationMs, mimeType: this.mediaRecorder.mimeType });

    // Emit chunks every chunkDurationMs
    this.chunkInterval = window.setInterval(() => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") return;
      
      // Request a new chunk from MediaRecorder
      this.mediaRecorder.requestData();
      
      // The dataavailable event will fire, but we need to capture the chunk
      // We'll use the last chunk from audioChunks
      if (this.audioChunks.length > this.chunkIndex) {
        const chunkBlob = this.audioChunks[this.chunkIndex];
        const elapsed = Math.round(performance.now() - this.startedAt);
        this.chunkIndex++;
        delegate.onAudioChunk?.(chunkBlob, elapsed, this.chunkIndex);
        onLog("audio-chunk-emitted", { chunkIndex: this.chunkIndex, size: chunkBlob.size, elapsedMs: elapsed });
      }
    }, chunkDurationMs);

    // Initialize Web Audio API analysis
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextCtor) {
      try {
        this.audioContext = new AudioContextCtor();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.sourceNode.connect(this.analyser);

        const bufferLength = this.analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);

        this.analysisInterval = window.setInterval(() => {
          if (!this.analyser) return;
          this.analyser.getFloatTimeDomainData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
          }
          const rms = Math.sqrt(sum / bufferLength);
          this.recordedVolumeHistory.push(rms);
          if (rms < 0.015) {
            this.silencePauseCount++;
          }
        }, 150);
      } catch (err) {
        onLog("audio-analysis-init-error", { message: (err as Error).message });
      }
    }

    // Speech recognition for interim transcript
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognitionCtor) {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang;

      let finalTranscript = "";
      recognition.onresult = (event) => {
        let interimTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }
        this.micTranscription = finalTranscript.trim();
        delegate.onSpeechFragment?.(finalTranscript.trim(), interimTranscript.trim());
      };

      recognition.onerror = (err) => {
        onLog("speech-recognition-error", { error: err.error, message: err.message });
      };

      try {
        recognition.start();
        this.recognition = recognition;
        onLog("speech-recognition-started", { lang });
      } catch (err) {
        onLog("speech-recognition-start-error", { message: (err as Error).message });
      }
    }
  }

  stopChunked(onLog: (type: string, data?: Record<string, unknown>) => void): void {
    if (this.chunkInterval) {
      clearInterval(this.chunkInterval);
      this.chunkInterval = null;
    }
    this.chunkedMode = false;
    this.stop(onLog);
  }

  stop(onLog: (type: string, data?: Record<string, unknown>) => void): void {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
    this.analyser = null;
    this.sourceNode = null;

    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.stoppedAt = performance.now();
      this.mediaRecorder.stop();
      onLog("recording-stopped");
    } else {
      this.resolveRecordingReady?.(this.current);
      this.resolveRecordingReady = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (err) {
        // already stopped or failed
      }
      this.recognition = null;
    }
  }

  async waitForRecordingReady(timeoutMs = 2500): Promise<AudioAsset | null> {
    if (!this.recordingReady) return this.current;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const asset = await Promise.race([this.recordingReady, timeout]);
    return asset ?? this.current;
  }

  async waitForRecognitionFinished(timeoutMs = 1500): Promise<string | null> {
    if (!this.recognitionFinished) return this.micTranscription;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const result = await Promise.race([this.recognitionFinished, timeout]);
    return result ?? this.micTranscription;
  }

  loadFile(file: File, delegate: AudioViewDelegate, onLog: (type: string, data?: Record<string, unknown>) => void): void {
    const inferredType = file.name.endsWith(".weba") || file.name.endsWith(".webm") ? "audio/webm" : "audio/*";
    const blob = new Blob([file], { type: file.type || inferredType });
    this.current = { blob, durationMs: null };
    this.startedAt = 0;
    this.stoppedAt = 0;
    this.fileDurationMs = null;
    this.recordedVolumeHistory = [];
    this.silencePauseCount = 0;
    this.durationReady = new Promise((resolve) => {
      this.resolveDurationReady = resolve;
    });
    
    delegate.clearRunOutput();
    const url = URL.createObjectURL(blob);
    delegate.setPlaybackUrl(url);
    delegate.setRecordingState(`Archivo listo: ${file.name}, ${Math.round(file.size / 1024)} KiB`);
    
    // Create a temporary audio element just to get the duration metadata
    const tempAudio = new Audio(url);
    tempAudio.preload = "metadata";
    tempAudio.addEventListener(
      "loadedmetadata",
      () => {
        if (Number.isFinite(tempAudio.duration)) {
          this.setFileDuration(Math.round(tempAudio.duration * 1000), blob, delegate, onLog);
        }
      },
      { once: true },
    );
    tempAudio.load();
    this.decodeDuration(blob, delegate, onLog).catch((error) => {
      onLog("audio-duration-decode-error", { message: (error as Error).message });
      this.resolveDurationReady?.();
      this.resolveDurationReady = null;
    });

    onLog("audio-file-loaded", { name: file.name, type: blob.type, size: blob.size });
  }

  async waitForDurationReady(timeoutMs = 1200): Promise<void> {
    if (!this.durationReady || this.current?.durationMs !== null) return;
    await Promise.race([
      this.durationReady,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private setFileDuration(durationMs: number, blob: Blob, delegate: AudioViewDelegate, onLog: (type: string, data?: Record<string, unknown>) => void): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0 || this.fileDurationMs !== null) return;
    this.fileDurationMs = durationMs;
    this.current = { blob, durationMs: this.fileDurationMs };
    delegate.onAudioDurationReady(this.fileDurationMs);
    onLog("audio-file-duration", { durationMs: this.fileDurationMs });
    this.resolveDurationReady?.();
    this.resolveDurationReady = null;
  }

  private async decodeDuration(blob: Blob, delegate: AudioViewDelegate, onLog: (type: string, data?: Record<string, unknown>) => void): Promise<void> {
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    try {
      const buffer = await blob.arrayBuffer();
      const decoded = await context.decodeAudioData(buffer.slice(0));
      this.setFileDuration(Math.round(decoded.duration * 1000), blob, delegate, onLog);

      // Extract RMS Volume History for file benchmarks
      const channelData = decoded.getChannelData(0);
      const sampleRate = decoded.sampleRate;
      const chunkSize = Math.round(0.150 * sampleRate);
      const volumeHistory: number[] = [];
      let silencePauseCount = 0;

      for (let offset = 0; offset < channelData.length; offset += chunkSize) {
        let sum = 0;
        const limit = Math.min(offset + chunkSize, channelData.length);
        const count = limit - offset;
        if (count <= 0) break;
        for (let i = offset; i < limit; i++) {
          sum += channelData[i] * channelData[i];
        }
        const rms = Math.sqrt(sum / count);
        volumeHistory.push(rms);
        if (rms < 0.015) {
          silencePauseCount++;
        }
      }
      this.recordedVolumeHistory = volumeHistory;
      this.silencePauseCount = silencePauseCount;
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  private stopTracks(): void {
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }
}
