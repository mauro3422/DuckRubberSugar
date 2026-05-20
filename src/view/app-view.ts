import { ProgressBar } from "./components/progress-bar.js";
import { ToastNotification } from "./components/toast.js";
import { WaveformVisualizer } from "./components/waveform-visualizer.js";
import { ToolbarPanel } from "./panels/toolbar-panel.js";
import { InputPanel } from "./panels/input-panel.js";
import { OutputPanel } from "./panels/output-panel.js";
import { MetricsPanel } from "./panels/metrics-panel.js";
import { BenchmarkPanel } from "./panels/benchmark-panel.js";
import { DebugPanel } from "./panels/debug-panel.js";

export class AppView {
  // ── Panels ──────────────────────────────────────────────────────
  readonly toolbar = new ToolbarPanel();
  readonly input = new InputPanel();
  readonly output = new OutputPanel();
  readonly metrics = new MetricsPanel();
  readonly benchmark = new BenchmarkPanel();
  readonly debug = new DebugPanel();

  // ── Visual components ───────────────────────────────────────────
  readonly visualizer = new WaveformVisualizer();

  // ── Floating Components ─────────────────────────────────────────
  private readonly progressBar = new ProgressBar();
  private readonly toast = new ToastNotification();

  // ── Console State Control ───────────────────────────────────────
  private readonly consolePanel: HTMLElement | null;
  private readonly consoleBody: HTMLElement | null;
  private readonly collapseBtn: HTMLButtonElement | null;
  private isConsoleCollapsed = false;

  // ── Context State Control ───────────────────────────────────────
  private readonly contextPanel: HTMLElement | null;
  private readonly contextBody: HTMLElement | null;
  private readonly contextCollapseBtn: HTMLButtonElement | null;
  private isContextCollapsed = true; // Collapsed by default!

  constructor() {
    this.consolePanel = document.querySelector<HTMLElement>("#diagnosticsConsole");
    this.consoleBody = document.querySelector<HTMLElement>("#consoleBody");
    this.collapseBtn = document.querySelector<HTMLButtonElement>("#consoleCollapseBtn");

    this.contextPanel = document.querySelector<HTMLElement>("#cognitiveContext");
    this.contextBody = document.querySelector<HTMLElement>("#contextBody");
    this.contextCollapseBtn = document.querySelector<HTMLButtonElement>("#contextCollapseBtn");
    
    this.initializeConsoleController();
    this.initializeContextController();
    this.injectCopyButtons();
  }

  // ── Global Overlay API ──────────────────────────────────────────
  showToast(message: string, durationMs = 2500): void {
    this.toast.show(message, durationMs);
  }

  showProgress(current: number, total: number, label?: string): void {
    this.progressBar.show(current, total, label);
    // Expand the console automatically when benchmark progress starts!
    this.expandConsole();
    this.activateTab("bench-tab");
  }

  hideProgress(): void {
    this.progressBar.hide();
  }

  // ── Console Controller Methods ─────────────────────────────────
  expandConsole(): void {
    if (!this.isConsoleCollapsed || !this.consoleBody || !this.collapseBtn) return;
    this.isConsoleCollapsed = false;
    this.consoleBody.classList.remove("collapsed");
    this.collapseBtn.setAttribute("aria-expanded", "true");
    const icon = this.collapseBtn.querySelector(".collapse-icon");
    if (icon) icon.textContent = "▲";
    const textNode = Array.from(this.collapseBtn.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = " Collapse";
  }

  collapseConsole(): void {
    if (this.isConsoleCollapsed || !this.consoleBody || !this.collapseBtn) return;
    this.isConsoleCollapsed = true;
    this.consoleBody.classList.add("collapsed");
    this.collapseBtn.setAttribute("aria-expanded", "false");
    const icon = this.collapseBtn.querySelector(".collapse-icon");
    if (icon) icon.textContent = "▼";
    const textNode = Array.from(this.collapseBtn.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = " Expand";
  }

  expandContext(): void {
    if (!this.isContextCollapsed || !this.contextBody || !this.contextCollapseBtn) return;
    this.isContextCollapsed = false;
    this.contextBody.classList.remove("collapsed");
    this.contextCollapseBtn.setAttribute("aria-expanded", "true");
    const icon = this.contextCollapseBtn.querySelector(".collapse-icon");
    if (icon) icon.textContent = "▲";
    const textNode = Array.from(this.contextCollapseBtn.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = " Collapse";
  }

  collapseContext(): void {
    if (this.isContextCollapsed || !this.contextBody || !this.contextCollapseBtn) return;
    this.isContextCollapsed = true;
    this.contextBody.classList.add("collapsed");
    this.contextCollapseBtn.setAttribute("aria-expanded", "false");
    const icon = this.contextCollapseBtn.querySelector(".collapse-icon");
    if (icon) icon.textContent = "▼";
    const textNode = Array.from(this.contextCollapseBtn.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = " Expand";
  }

  activateTab(tabId: "raw-tab" | "bench-tab" | "debug-tab"): void {
    const tabs = document.querySelectorAll<HTMLButtonElement>(".console-tab");
    const contents = document.querySelectorAll<HTMLElement>(".console-tab-content");

    tabs.forEach(tab => {
      const target = tab.getAttribute("data-tab");
      if (target === tabId) {
        tab.classList.add("active");
        tab.setAttribute("aria-selected", "true");
      } else {
        tab.classList.remove("active");
        tab.setAttribute("aria-selected", "false");
      }
    });

    contents.forEach(content => {
      if (content.id === tabId) {
        content.classList.add("active");
      } else {
        content.classList.remove("active");
      }
    });
  }

  private initializeConsoleController(): void {
    // 1. Tab switching events
    const tabs = document.querySelectorAll<HTMLButtonElement>(".console-tab");
    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        const tabId = tab.getAttribute("data-tab");
        if (tabId) {
          this.activateTab(tabId as any);
          // If body is collapsed, expand it when user explicitly clicks a tab!
          this.expandConsole();
        }
      });
    });

    // 2. Collapse button events
    if (this.collapseBtn) {
      this.collapseBtn.addEventListener("click", () => {
        if (this.isConsoleCollapsed) {
          this.expandConsole();
        } else {
          this.collapseConsole();
        }
      });
    }
  }

  private initializeContextController(): void {
    if (this.contextCollapseBtn) {
      this.contextCollapseBtn.addEventListener("click", () => {
        if (this.isContextCollapsed) {
          this.expandContext();
        } else {
          this.collapseContext();
        }
      });
    }
  }

  private injectCopyButtons(): void {
    const preWrappers = document.querySelectorAll<HTMLElement>(".pre-wrapper");
    preWrappers.forEach(wrapper => {
      const pre = wrapper.querySelector<HTMLPreElement>("pre");
      if (!pre) return;

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "pre-copy-btn";
      copyBtn.innerHTML = `<span>📋</span> Copy`;

      copyBtn.addEventListener("click", async () => {
        const text = pre.textContent || pre.innerText || "";
        if (!text || pre.classList.contains("empty-state")) {
          this.showToast("❌ Nada que copiar");
          return;
        }

        try {
          await navigator.clipboard.writeText(text);
          copyBtn.classList.add("copied");
          copyBtn.innerHTML = `<span>✔</span> Copied!`;
          this.showToast("📋 Contenido copiado al portapapeles");
          
          setTimeout(() => {
            copyBtn.classList.remove("copied");
            copyBtn.innerHTML = `<span>📋</span> Copy`;
          }, 2000);
        } catch (err) {
          this.showToast("❌ Error al copiar");
        }
      });

      wrapper.appendChild(copyBtn);
    });
  }
}

