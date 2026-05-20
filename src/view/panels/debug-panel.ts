import { UIComponent } from "../core/ui-component.js";

export class DebugPanel extends UIComponent {
  readonly debugOutput = this.must<HTMLPreElement>("#debugOutput");

  constructor() {
    super(document.body);
  }

  render(payload: unknown): void {
    this.debugOutput.textContent = JSON.stringify(payload, null, 2);
    this.debugOutput.classList.remove("empty-state");
  }
}
