import { UIComponent } from "../core/ui-component.js";
import { WaveformRenderer } from "./waveform-renderer.js";

export class WaveformVisualizer extends UIComponent<HTMLCanvasElement> {
  private readonly audio: HTMLAudioElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly playBtnIcon: HTMLSpanElement;
  private readonly renderer: WaveformRenderer;
  
  private audioCtx: AudioContext | null = null;
  private canvasCtx: CanvasRenderingContext2D;
  private peaks: number[] = [];
  private isRecording = false;
  private wasJustRecorded = false;
  private animationFrameId: number | null = null;
  private lastRenderUrl: string | null = null;
  
  // Animation variables for the live procedural wave
  private recordingPhase = 0;

  // Real-time analysis and loading/scanning overlay variables
  private isTranscribing = false;
  private transcribePhase = 0;
  private analyser: AnalyserNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private dataArray: Uint8Array = new Uint8Array(0);
  private hoverX = -1;
  private isDragging = false;
  private readonly timeBadge: HTMLDivElement | null;

  // Volume sampling properties for real-time waveform construction
  private lastSampleTime = 0;
  private currentVolumeSum = 0;
  private currentVolumeCount = 0;
  private smoothedVolume = 0;

  constructor(
    canvasSelector: string = "#waveformCanvas",
    audioSelector: string = "#audioPlayback",
    playBtnSelector: string = "#playbackPlayBtn"
  ) {
    super(canvasSelector);
    
    // Get canvas context
    const ctx = this.root.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context from waveform canvas");
    this.canvasCtx = ctx;
    this.renderer = new WaveformRenderer(this.canvasCtx);

    // Fetch dependent elements
    const audioEl = document.querySelector<HTMLAudioElement>(audioSelector);
    if (!audioEl) throw new Error(`Missing audio element: ${audioSelector}`);
    this.audio = audioEl;

    const playBtnEl = document.querySelector<HTMLButtonElement>(playBtnSelector);
    if (!playBtnEl) throw new Error(`Missing play button: ${playBtnSelector}`);
    this.playBtn = playBtnEl;

    const iconSpan = this.playBtn.querySelector<HTMLSpanElement>(".btn-icon");
    this.playBtnIcon = iconSpan ?? this.playBtn;

    this.timeBadge = document.querySelector<HTMLDivElement>("#audioTimeBadge");

    this.bindEvents();
    this.drawEmptyState();
  }

  setRecordingActive(active: boolean, stream?: MediaStream): void {
    if (this.isRecording === active) return;
    this.isRecording = active;

    if (active) {
      this.playBtn.disabled = true;
      this.peaks = []; // Clear previous peaks to build a new live waveform!
      this.lastSampleTime = performance.now();
      this.currentVolumeSum = 0;
      this.currentVolumeCount = 0;
      this.smoothedVolume = 0;

      // Set up real-time audio analyser if a stream is provided
      if (stream) {
        try {
          if (!this.audioCtx) {
            const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
            this.audioCtx = new AudioContextCtor();
          }
          if (this.audioCtx.state === "suspended") {
            void this.audioCtx.resume();
          }
          
          this.micSource = this.audioCtx.createMediaStreamSource(stream);
          this.analyser = this.audioCtx.createAnalyser();
          this.analyser.fftSize = 128; // Small FFT for fluid, fast wiggling bars
          this.micSource.connect(this.analyser);
          
          const bufferLength = this.analyser.frequencyBinCount;
          this.dataArray = new Uint8Array(bufferLength);
        } catch (err) {
          console.warn("Failed to initialize Web Audio mic analyser:", err);
          this.analyser = null;
        }
      }

      this.startAnimationLoop();
    } else {
      // Disconnect and clean up live analyzer nodes
      if (this.micSource) {
        try {
          this.micSource.disconnect();
        } catch (e) {}
        this.micSource = null;
      }
      this.analyser = null;

      // Normalize the recorded peaks so they look perfectly scaled on canvas immediately
      if (this.peaks.length > 0) {
        const maxVal = Math.max(...this.peaks) || 1;
        this.peaks = this.peaks.map((p) => (p / maxVal) * 0.85);
      }

      this.wasJustRecorded = true;
      this.stopAnimationLoop();
      this.draw();
    }
  }

  setTranscribingActive(active: boolean): void {
    if (this.isTranscribing === active) return;
    this.isTranscribing = active;

    if (active) {
      this.startAnimationLoop();
    } else {
      if (!this.isRecording && this.audio.paused) {
        this.stopAnimationLoop();
      }
      this.draw();
    }
  }


  private bindEvents(): void {
    // Play button click handler
    this.playBtn.addEventListener("click", () => {
      if (this.isRecording) return;
      if (this.audio.paused) {
        void this.audio.play();
      } else {
        this.audio.pause();
      }
    });

    // Native audio element event hooks
    this.audio.addEventListener("play", () => {
      this.updatePlayButtonVisual(true);
      this.startAnimationLoop();
    });

    this.audio.addEventListener("pause", () => {
      this.updatePlayButtonVisual(false);
      this.stopAnimationLoop();
    });

    this.audio.addEventListener("ended", () => {
      this.updatePlayButtonVisual(false);
      this.stopAnimationLoop();
      this.audio.currentTime = 0;
      this.draw();
    });

    // Check for src updates on loadedmetadata or loadstart
    this.audio.addEventListener("loadedmetadata", () => {
      void this.loadAndDecodeAudio();
    });

    // High reliability backup: MutationObserver watches for src changes directly
    const observer = new MutationObserver(() => {
      void this.loadAndDecodeAudio();
    });
    observer.observe(this.audio, { attributes: true, attributeFilter: ["src"] });

    // Handle clicks/drags inside canvas to seek audio playback
    this.root.addEventListener("mousedown", (event) => {
      if (this.isRecording || !this.audio.getAttribute("src") || !this.audio.duration) return;
      this.isDragging = true;
      const rect = this.root.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, clickX / rect.width));
      this.audio.currentTime = percentage * this.audio.duration;
      this.draw();
    });

    window.addEventListener("mousemove", (event) => {
      if (!this.isDragging || !this.audio.duration) return;
      const rect = this.root.getBoundingClientRect();
      const clientX = event.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, clientX / rect.width));
      this.audio.currentTime = percentage * this.audio.duration;
      
      this.hoverX = Math.max(0, Math.min(rect.width, clientX));
      this.draw();
    });

    window.addEventListener("mouseup", () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.draw();
      }
    });

    // Interactive mouse hover tracking for playhead preview and tooltip
    this.root.addEventListener("mousemove", (event) => {
      if (this.isRecording || !this.audio.getAttribute("src") || !this.audio.duration || this.isDragging) {
        if (!this.isDragging) this.hoverX = -1;
        return;
      }
      const rect = this.root.getBoundingClientRect();
      this.hoverX = event.clientX - rect.left;
      this.draw();
    });

    this.root.addEventListener("mouseleave", () => {
      if (!this.isDragging) {
        this.hoverX = -1;
        this.draw();
      }
    });

    // Periodic timeupdate fallback to redraw playhead when playing
    this.audio.addEventListener("timeupdate", () => {
      this.updateTimeBadge();
      if (!this.audio.paused && !this.isRecording) {
        this.draw();
      }
    });

    // Resize canvas resolution to match pixel ratio
    this.resizeCanvas();
    window.addEventListener("resize", () => {
      this.resizeCanvas();
      this.draw();
    });
  }

  private resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.root.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    
    // Set actual screen rendering size
    this.root.width = rect.width * dpr;
    this.root.height = rect.height * dpr;
    
    // Scale drawings accordingly
    this.canvasCtx.scale(dpr, dpr);
  }

  private updatePlayButtonVisual(isPlaying: boolean): void {
    if (isPlaying) {
      this.playBtnIcon.textContent = "⏸";
      this.playBtn.innerHTML = '<span class="btn-icon">⏸</span> Pausar';
      this.playBtn.style.borderColor = "var(--success-color)";
      this.playBtn.style.color = "var(--success-color)";
    } else {
      this.playBtnIcon.textContent = "▶";
      this.playBtn.innerHTML = '<span class="btn-icon">▶</span> Reproducir';
      this.playBtn.style.borderColor = "var(--panel-border)";
      this.playBtn.style.color = "var(--text-main)";
    }
  }

  private startAnimationLoop(): void {
    if (this.animationFrameId) return;
    const loop = () => {
      if (this.isRecording) {
        this.drawLiveMicrophoneWave();
      } else {
        this.draw();
      }
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  private stopAnimationLoop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private drawEmptyState(): void {
    if (this.timeBadge) this.timeBadge.style.display = "none";
    const width = this.root.width / (window.devicePixelRatio || 1);
    const height = this.root.height / (window.devicePixelRatio || 1);
    if (width === 0 || height === 0) return;
    this.renderer.drawEmptyState(width, height);
  }

  private async loadAndDecodeAudio(): Promise<void> {
    const url = this.audio.getAttribute("src");
    if (!url) {
      this.lastRenderUrl = null;
      this.peaks = [];
      this.playBtn.disabled = true;
      this.updatePlayButtonVisual(false);
      this.drawEmptyState();
      return;
    }
    if (url === this.lastRenderUrl) return;
    this.lastRenderUrl = url;

    // If this audio was just recorded, we already have the real-time peaks
    // perfectly captured and scaled. Skip decoding to prevent visual pops.
    if (this.wasJustRecorded) {
      this.wasJustRecorded = false;
      this.playBtn.disabled = false;
      this.draw();
      this.updateTimeBadge();
      return;
    }

    this.playBtn.disabled = true;
    this.peaks = [];
    
    // Draw loading status
    const width = this.root.width / (window.devicePixelRatio || 1);
    const height = this.root.height / (window.devicePixelRatio || 1);
    if (width > 0 && height > 0) {
      this.renderer.drawLoadingState(width, height);
    }

    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      // Resume context if suspended
      if (this.audioCtx.state === "suspended") {
        await this.audioCtx.resume();
      }

      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();

      // Decode with a 3.0s timeout to prevent hanging on unsupported/corrupt files
      const decodePromise = this.audioCtx.decodeAudioData(arrayBuffer);
      const timeoutPromise = new Promise<AudioBuffer>((_, reject) => 
        setTimeout(() => reject(new Error("Audio decoding timeout")), 3000)
      );

      const audioBuffer = await Promise.race([decodePromise, timeoutPromise]);
      
      const channelData = audioBuffer.getChannelData(0);
      const totalBars = 90; // Number of vertical bars we want to draw
      const blockSize = Math.floor(channelData.length / totalBars);
      
      for (let i = 0; i < totalBars; i++) {
        let sum = 0;
        const start = i * blockSize;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(channelData[start + j]);
        }
        const avg = sum / blockSize;
        this.peaks.push(avg);
      }

      // Normalize peaks to fit the visual area cleanly (max height of 85%)
      const maxVal = Math.max(...this.peaks) || 1;
      this.peaks = this.peaks.map((p) => (p / maxVal) * 0.85);

      this.playBtn.disabled = false;
      this.draw();
      this.updateTimeBadge();
    } catch (err) {
      console.warn("Waveform rendering failed or timed out. Falling back to default visualization:", err);
      
      // Fallback: Generate a nice natural simulated sound wave so the user can STILL play the file!
      this.peaks = Array.from({ length: 90 }, (_, i) => {
        const x = (i / 90) * Math.PI;
        // Smooth sine-like distribution + natural noise
        return (0.2 + Math.sin(x) * 0.5 + Math.random() * 0.15) * 0.8;
      });
      
      this.playBtn.disabled = false;
      this.draw();
      this.updateTimeBadge();
    }
  }

  private draw(): void {
    if (this.peaks.length === 0) {
      this.drawEmptyState();
      return;
    }

    const width = this.root.width / (window.devicePixelRatio || 1);
    const height = this.root.height / (window.devicePixelRatio || 1);
    if (width === 0 || height === 0) return;

    // Playback percentage calculations
    const currentTime = this.audio.currentTime || 0;
    const duration = this.audio.duration || 1;

    // If transcribing, advance scanning animation position
    if (this.isTranscribing) {
      this.transcribePhase += 0.08;
    }

    this.renderer.drawPlaybackState(
      width,
      height,
      this.peaks,
      currentTime,
      duration,
      this.isTranscribing,
      this.transcribePhase,
      this.hoverX
    );
  }

  private getMicVolume(): number {
    if (!this.analyser) return 0;
    const bufferLength = this.analyser.frequencyBinCount;
    if (this.dataArray.length !== bufferLength) {
      this.dataArray = new Uint8Array(bufferLength);
    }
    this.analyser.getByteTimeDomainData(this.dataArray as any);
    
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const amplitude = Math.abs(this.dataArray[i] - 128); // 128 is silence in 8-bit time domain data
      sum += amplitude;
    }
    const average = sum / bufferLength;
    // Normalize: standard speaking average amplitude is around 35-45. Scale to 0..1 range.
    return Math.min(1.0, average / 45);
  }

  private drawLiveMicrophoneWave(): void {
    const width = this.root.width / (window.devicePixelRatio || 1);
    const height = this.root.height / (window.devicePixelRatio || 1);
    if (width === 0 || height === 0) return;

    // Get current microphone amplitude and apply low-pass filtering for smooth fluid visual response
    const rawVol = this.analyser ? this.getMicVolume() : 0.05 + Math.random() * 0.1;
    // 0.7 old + 0.3 new: beautifully smooth and responsive, eliminating epileptic/blurry flickering
    this.smoothedVolume = this.smoothedVolume * 0.7 + rawVol * 0.3;
    const currentVol = this.smoothedVolume;

    // Sample volume periodically to grow the wave (every 150ms)
    const now = performance.now();
    const sampleInterval = 150;

    if (this.isRecording) {
      this.currentVolumeSum += currentVol;
      this.currentVolumeCount++;

      if (now - this.lastSampleTime >= sampleInterval) {
        const avgVol = this.currentVolumeCount > 0 ? this.currentVolumeSum / this.currentVolumeCount : 0;
        
        // Push the average volume as a historical peak! Apply standard threshold.
        this.peaks.push(Math.max(0.04, avgVol * 0.85));

        // Reset counters
        this.lastSampleTime = now;
        this.currentVolumeSum = 0;
        this.currentVolumeCount = 0;
      }
    }

    // Build the array of peaks to render: past peaks + the live leading edge wiggler!
    const renderPeaks = [...this.peaks];
    if (this.isRecording) {
      renderPeaks.push(Math.max(0.05, currentVol * 0.85));
    }

    this.recordingPhase += 0.1;

    this.renderer.drawLiveMicrophoneWave(
      width,
      height,
      renderPeaks,
      this.isRecording,
      this.recordingPhase,
      currentVol
    );
  }

  private updateTimeBadge(): void {
    if (!this.timeBadge) return;
    if (!this.audio.getAttribute("src") || !this.audio.duration) {
      this.timeBadge.style.display = "none";
      return;
    }
    this.timeBadge.style.display = "inline-flex";
    const currentTime = this.audio.currentTime || 0;
    const duration = this.audio.duration || 0;

    const formatTime = (time: number): string => {
      const mins = Math.floor(time / 60);
      const secs = Math.floor(time % 60);
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    this.timeBadge.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  }
}
