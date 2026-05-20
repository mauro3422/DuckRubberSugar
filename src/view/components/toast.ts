import { UIComponent } from "../core/ui-component.js";

export class ToastNotification extends UIComponent<HTMLDivElement> {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(selector: string = "#toast") {
    super(selector);
  }

  show(message: string, durationMs = 2500): void {
    this.root.textContent = message;
    this.root.classList.add("visible");
    
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    
    this.timeoutId = setTimeout(() => {
      this.root.classList.remove("visible");
      this.timeoutId = null;
    }, durationMs);
  }
}
