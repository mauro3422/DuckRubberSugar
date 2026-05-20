import { AppConfig, ResponseContract } from "./config.js";
import { AppStore } from "./store/app-store.js";
import { PipelineEngine } from "./engine/pipeline-engine.js";
import { AppView } from "./view/app-view.js";
import { DefaultDataset } from "./data/default-dataset.js";

export class DuckSugarApp {
  private readonly store = new AppStore();
  private readonly engine = new PipelineEngine(this.store);
  private readonly view = new AppView();

  start(): void {
    this.store.update({
      expectedTranscript: DefaultDataset.cases[0].expectedTranscript,
      benchmarkEntries: this.engine.benchmark.read(),
      benchmarkHistory: this.engine.benchmark.readHistory()
    });

    this.bindEvents();
    this.bindStore();

    this.view.input.renderSystemPrompt(ResponseContract);
    void this.engine.initializeModel();
  }

  private get audioDelegate() {
    return {
      setRecordingState: (stateText: string) => this.store.update({ audioStateText: stateText }),
      setPlaybackUrl: (url: string | null) => {
        if (!url) {
          this.view.input.audioPlayback.removeAttribute("src");
          this.view.input.audioPlayback.load();
        } else {
          this.view.input.audioPlayback.src = url;
          this.view.input.audioPlayback.load();
        }
      },
      clearFileSelection: () => { this.view.input.audioFile.value = ""; },
      clearRunOutput: () => this.view.output.clearRunOutput(),
      onAudioDurationReady: (durationMs: number) => {},
      onSpeechFragment: (finalText: string, interimText: string) => {
        const transEl = this.view.output.transcription;
        if (finalText || interimText) {
          transEl.innerHTML = `<span class="final-text">${finalText}</span> <span class="interim-text">${interimText}</span>`;
        } else {
          transEl.innerHTML = `<span class="placeholder-text">La transcripción aparecerá aquí...</span>`;
        }
      },
    };
  }

  private bindEvents(): void {
    this.view.toolbar.recordButton.addEventListener("click", () => {
      this.view.toolbar.setRecordingVisual(true);
      void this.engine.startRecording(this.audioDelegate, this.view.toolbar.langSelect.value);
    });
    this.view.toolbar.stopButton.addEventListener("click", () => {
      this.view.toolbar.setRecordingVisual(false);
      this.engine.stopRecording();
    });
    this.view.toolbar.sendButton.addEventListener("click", () => void this.engine.sendAudio(
      this.view.input.instruction.value,
      this.view.toolbar.streamingToggle.checked,
      (text) => {},
      this.view.toolbar.langSelect.value
    ));
    this.view.toolbar.runBenchButton.addEventListener("click", () => void this.runBenchmarkBatch(AppConfig.benchmarkRuns));
    this.view.toolbar.runDatasetButton.addEventListener("click", () => void this.runFullDataset());

    // Clipboard buttons with toast feedback
    this.view.toolbar.copyLogButton.addEventListener("click", () => void this.copyWithToast("Log", () => this.copyLog()));
    this.view.toolbar.copyBenchButton.addEventListener("click", () => void this.copyWithToast("Benchmark", () => this.copyBenchmark()));
    this.view.toolbar.copyCodexButton.addEventListener("click", () => void this.copyWithToast("Codex summary", () => this.copyCodexSummary()));

    this.view.toolbar.clearBenchButton.addEventListener("click", () => {
      this.engine.benchmark.clear();
      this.store.update({ 
        benchmarkEntries: this.engine.benchmark.read(),
        benchmarkHistory: this.engine.benchmark.readHistory()
      });
      this.view.showToast("🗑 Benchmark limpiado");
    });
    this.view.input.audioFile.addEventListener("change", () => {
      const file = this.view.input.audioFile.files?.[0];
      if (file) this.engine.loadAudioFile(file, this.audioDelegate);
    });

    // Premium Drag & Drop support on #speechHub panel
    const speechHub = document.querySelector<HTMLElement>("#speechHub");
    if (speechHub) {
      speechHub.addEventListener("dragenter", (e) => {
        e.preventDefault();
        e.stopPropagation();
        speechHub.classList.add("drag-over");
      });
      speechHub.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        speechHub.classList.add("drag-over");
      });
      speechHub.addEventListener("dragleave", (e) => {
        e.preventDefault();
        e.stopPropagation();
        speechHub.classList.remove("drag-over");
      });
      speechHub.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        speechHub.classList.remove("drag-over");
        const file = e.dataTransfer?.files?.[0];
        if (file) {
          if (file.type.startsWith("audio/") || file.name.endsWith(".webm") || file.name.endsWith(".weba") || file.name.endsWith(".mp3") || file.name.endsWith(".wav") || file.name.endsWith(".m4a")) {
            this.engine.loadAudioFile(file, this.audioDelegate);
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            this.view.input.audioFile.files = dataTransfer.files;
            this.view.showToast(`📥 Cargado: ${file.name}`);
          } else {
            this.view.showToast("❌ Por favor carga un archivo de audio válido");
          }
        }
      });
    }

    this.view.output.transcription.addEventListener("input", () => {
      const transEl = this.view.output.transcription;
      const text = transEl.innerText || transEl.textContent || "";
      const cleanText = transEl.querySelector(".placeholder-text") ? "" : text.trim();
      this.store.update({ expectedTranscript: cleanText });
      const report = this.engine.reports.build();
      this.store.update({ latestReport: report });
    });
  }

  private async copyWithToast(label: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
      this.view.showToast(`📋 ${label} copiado al clipboard`);
    } catch {
      this.view.showToast(`❌ Error copiando ${label}`);
    }
  }

  private bindStore(): void {
    this.store.subscribe((state) => {
      const hasApi = "LanguageModel" in window || ("ai" in window && "languageModel" in (window as any).ai);
      const hasSession = this.engine.model.hasSession;
      const hasAudio = Boolean(this.engine.audio.asset);
      const isRecording = this.engine.audio.isRecording;

      const busy = state.isInitializing || state.isPromptRunning || state.isBenchmarkRunning;
      
      this.view.toolbar.setButtons({
        hasApi,
        hasSession,
        hasAudio,
        sessionMode: state.sessionMode,
        isRecording,
        isInitializing: state.isInitializing,
        isPromptRunning: state.isPromptRunning,
        isBenchmarkRunning: state.isBenchmarkRunning
      });

      // Update recording visual based on actual state
      this.view.toolbar.setRecordingVisual(isRecording);
      this.view.visualizer.setRecordingActive(isRecording, this.engine.audio.stream || undefined);
      this.view.visualizer.setTranscribingActive(state.isTranscribingAudio || false);

      // Active panel neon breathing/pulse effect
      const speechHub = document.querySelector<HTMLElement>("#speechHub");
      const parsedOutputs = document.querySelector<HTMLElement>("#parsedOutputs");
      if (speechHub) {
        if (state.isTranscribingAudio) {
          speechHub.classList.add("pulse-neon-cyan");
        } else {
          speechHub.classList.remove("pulse-neon-cyan");
        }
      }
      if (parsedOutputs) {
        if (state.isPromptRunning) {
          parsedOutputs.classList.add("pulse-neon-indigo");
        } else {
          parsedOutputs.classList.remove("pulse-neon-indigo");
        }
      }

      // Update Empathy Aura glow based on detected mood
      const auraEl = document.querySelector<HTMLElement>("#empathyAura");
      if (auraEl) {
        auraEl.className = "empathy-aura";
        if (state.detectedEmpathyMood) {
          auraEl.classList.add(`aura-${state.detectedEmpathyMood}`);
        } else {
          auraEl.classList.add("aura-calm");
        }
      }

      this.view.input.setStatus(state.statusText, state.statusKind);
      
      if (state.audioStateText) this.view.input.recordingState.textContent = state.audioStateText;
      const transEl = this.view.output.transcription;
      const cleanExpected = (state.expectedTranscript ?? "").trim();
      const cleanCurrent = transEl.querySelector(".placeholder-text") ? "" : transEl.innerText.trim();
      
      if (state.isTranscribingAudio) {
        transEl.setAttribute("contenteditable", "false");
        if (!cleanExpected) {
          transEl.innerHTML = `<span class="interim-text animate-pulse" style="display: inline-flex; align-items: center; gap: 8px; font-weight: 500; color: var(--accent-hover);">⚡ Transcribiendo audio con Google ASR...</span>`;
        } else {
          transEl.innerHTML = `<span class="final-text">${state.expectedTranscript}</span><span class="interim-text animate-pulse" style="color: var(--success-color); font-weight: bold; margin-left: 2px;">▋</span>`;
        }
      } else {
        transEl.setAttribute("contenteditable", "true");
        if (cleanExpected && cleanCurrent !== cleanExpected && !isRecording && document.activeElement !== transEl) {
          transEl.innerHTML = `<span class="final-text">${state.expectedTranscript}</span>`;
        } else if (!cleanExpected && !hasAudio && !isRecording && !transEl.querySelector(".placeholder-text")) {
          transEl.innerHTML = `<span class="placeholder-text">La transcripción en tiempo real aparecerá aquí al grabar...</span>`;
        }
      }
      
      this.view.output.renderResponse(state.rawOutputText, state.parsedResponse);
      
      if (state.latestMetrics && state.latestReport) {
        this.view.metrics.render(state.latestMetrics, state.latestReport.transcriptDiff, state.latestReport.codeDiff);
      }
      
      this.view.benchmark.render(state.benchmarkEntries, state.benchmarkHistory);

      this.view.debug.render({
        location: window.location.href,
        userAgent: navigator.userAgent,
        hasLanguageModel: hasApi,
        sessionMode: state.sessionMode,
        latestMetrics: state.latestMetrics,
        latestReport: state.latestReport,
        events: state.events,
      });
    });
  }

  private async runBenchmarkBatch(count: number): Promise<void> {
    if (!this.engine.audio.asset || this.store.get().isBenchmarkRunning) return;
    this.store.update({ isBenchmarkRunning: true });

    try {
      for (let index = 1; index <= count; index += 1) {
        this.view.showProgress(index, count, `Benchmark ${index}/${count}`);
        this.store.update({ statusText: `Benchmark ${index}/${count}`, statusKind: "" });
        await this.engine.sendAudio(this.view.input.instruction.value, this.view.toolbar.streamingToggle.checked, () => {}, this.view.toolbar.langSelect.value);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      this.store.update({ statusText: `Benchmark x${count} listo`, statusKind: "ready" });
    } finally {
      this.view.hideProgress();
      this.store.update({ isBenchmarkRunning: false });
    }
  }

  private async runFullDataset(): Promise<void> {
    if (this.store.get().isBenchmarkRunning) return;
    this.store.update({ isBenchmarkRunning: true });

    const totalRuns = DefaultDataset.cases.length * AppConfig.benchmarkRuns;
    let globalIndex = 0;

    try {
      for (const testCase of DefaultDataset.cases) {
        this.store.update({ statusText: `Cargando ${testCase.fileName}...`, statusKind: "" });
        const res = await fetch(`/pruebas/${testCase.fileName}`);
        if (!res.ok) throw new Error(`Could not fetch ${testCase.fileName}`);
        const blob = await res.blob();
        const file = new File([blob], testCase.fileName, { type: blob.type || "audio/webm" });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        this.view.input.audioFile.files = dataTransfer.files;
        
        this.engine.loadAudioFile(file, this.audioDelegate);
        await new Promise((resolve) => setTimeout(resolve, 500));

        const count = AppConfig.benchmarkRuns;
        for (let index = 1; index <= count; index += 1) {
          globalIndex += 1;
          this.view.showProgress(globalIndex, totalRuns, `[${testCase.id}] ${index}/${count}`);
          this.store.update({ statusText: `[${testCase.id}] Benchmark ${index}/${count}`, statusKind: "" });
          await this.engine.sendAudio(this.view.input.instruction.value, this.view.toolbar.streamingToggle.checked, () => {}, this.view.toolbar.langSelect.value);
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      this.store.update({ statusText: `Dataset listo`, statusKind: "ready" });
    } finally {
      this.view.hideProgress();
      this.store.update({ isBenchmarkRunning: false });
    }
  }

  private async copyLog(): Promise<void> {
    const report = this.engine.reports.build();
    const text = `${this.engine.reports.summary(report)}\n\n--- full-json ---\n${JSON.stringify(report, null, 2)}`;
    await navigator.clipboard.writeText(text);
  }

  private async copyBenchmark(): Promise<void> {
    const text = JSON.stringify(this.engine.benchmark.exportPayload(), null, 2);
    await navigator.clipboard.writeText(text);
  }

  private async copyCodexSummary(): Promise<void> {
    const report = this.engine.reports.build();
    const text = JSON.stringify(this.engine.benchmark.exportCodexSummary(report), null, 2);
    await navigator.clipboard.writeText(text);
  }
}
