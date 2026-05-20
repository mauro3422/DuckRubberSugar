import { UIComponent } from "../core/ui-component.js";

export class ToolbarPanel extends UIComponent {
  readonly recordButton = this.must<HTMLButtonElement>("#recordButton");
  readonly stopButton = this.must<HTMLButtonElement>("#stopButton");
  readonly sendButton = this.must<HTMLButtonElement>("#sendButton");
  readonly runBenchButton = this.must<HTMLButtonElement>("#runBenchButton");
  readonly runDatasetButton = this.must<HTMLButtonElement>("#runDatasetButton");
  readonly copyLogButton = this.must<HTMLButtonElement>("#copyLogButton");
  readonly copyBenchButton = this.must<HTMLButtonElement>("#copyBenchButton");
  readonly copyCodexButton = this.must<HTMLButtonElement>("#copyCodexButton");
  readonly clearBenchButton = this.must<HTMLButtonElement>("#clearBenchButton");
  readonly streamingToggle = this.must<HTMLInputElement>("#streamingToggle");
  readonly langSelect = this.must<HTMLSelectElement>("#langSelect");
  
  constructor() {
    super(document.body);
  }

  setButtons(options: {
    hasApi: boolean;
    hasSession: boolean;
    hasAudio: boolean;
    sessionMode: string;
    isRecording: boolean;
    isInitializing: boolean;
    isPromptRunning: boolean;
    isBenchmarkRunning: boolean;
  }): void {
    const busy = options.isInitializing || options.isPromptRunning || options.isBenchmarkRunning;
    this.recordButton.disabled =
      !options.hasApi || !options.hasSession || options.isRecording || busy;
    this.stopButton.disabled = !options.isRecording || options.isBenchmarkRunning;
    this.sendButton.disabled = !options.hasApi || !options.hasAudio || options.isRecording || busy;
    this.runBenchButton.disabled = !options.hasApi || !options.hasAudio || options.isRecording || busy;
    this.runDatasetButton.disabled = !options.hasApi || options.isRecording || busy;
    this.copyLogButton.disabled = options.isBenchmarkRunning;
    this.copyBenchButton.disabled = options.isBenchmarkRunning;
    this.copyCodexButton.disabled = options.isBenchmarkRunning;
    this.clearBenchButton.disabled = options.isBenchmarkRunning;
  }

  setRecordingVisual(isRecording: boolean): void {
    this.recordButton.classList.toggle("recording", isRecording);
  }
}
