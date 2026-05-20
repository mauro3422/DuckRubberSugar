import { UIComponent } from "../core/ui-component.js";

export class ProgressBar extends UIComponent<HTMLDivElement> {
  private readonly fill: HTMLDivElement;
  private readonly label: HTMLSpanElement;

  constructor(selector: string = "#progressBar") {
    super(selector);
    this.fill = this.must<HTMLDivElement>("#progressFill");
    this.label = this.must<HTMLSpanElement>("#progressLabel");
  }

  show(current: number, total: number, labelText?: string): void {
    this.root.hidden = false;
    const pct = Math.round((current / total) * 100);
    this.fill.style.width = `${pct}%`;
    this.label.textContent = labelText ?? `${current} / ${total}`;
  }

  hide(): void {
    this.root.hidden = true;
    this.fill.style.width = "0%";
    this.label.textContent = "";
  }
}
