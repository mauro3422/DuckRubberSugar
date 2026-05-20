import { UIComponent } from "../core/ui-component.js";

export class InputPanel extends UIComponent {
  readonly audioFile = this.must<HTMLInputElement>("#audioFile");
  readonly instruction = this.must<HTMLTextAreaElement>("#instruction");
  readonly systemPrompt = this.must<HTMLTextAreaElement>("#systemPrompt");
  readonly audioPlayback = this.must<HTMLAudioElement>("#audioPlayback");
  readonly recordingState = this.must<HTMLSpanElement>("#recordingState");
  readonly modelStatus = this.must<HTMLDivElement>("#modelStatus");

  constructor() {
    super(document.body);
  }

  setStatus(text: string, kind = ""): void {
    this.modelStatus.textContent = text;
    this.modelStatus.className = `status ${kind}`.trim();
  }

  renderSystemPrompt(prompt: string): void {
    this.systemPrompt.value = prompt;
  }
}
