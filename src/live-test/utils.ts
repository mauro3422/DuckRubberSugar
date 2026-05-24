import type { EventLog } from "../types.js";

export function setStatus(text: string): void {
  const el = document.querySelector<HTMLElement>("#status");
  if (el) el.textContent = text;
}

export function logToTerminal(message: string, type: "info" | "success" | "error" | "warning" | "model" = "info") {
  console.log(`[page-log] [${type}] ${message}`);
  const terminalEl = document.querySelector<HTMLElement>("#console-terminal");
  if (!terminalEl) return;
  const time = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.className = `console-line ${type}`;
  line.innerHTML = `<span class="timestamp">${time}</span>${escapeHtml(message)}`;
  terminalEl.appendChild(line);
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function cleanSpeechStutters(text: string): string {
  return text
    .replace(/\b(bueno|eh|este|o sea|poronga|como poronga|a ver|o sea que|digamos|no sé|ponele|entendes|ya no|pero bueno|bueno eso|eh o sea|o sea como)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tagSpeechStuttersForUi(text: string): string {
  return text.replace(
    /\b(bueno|eh|este|o sea|poronga|como poronga|a ver|o sea que|digamos|no sé|ponele|entendes|ya no|pero bueno|bueno eso|eh o sea|o sea como)\b/gi,
    "<muletilla>$1</muletilla>"
  );
}

export function updateProgress(percent: number, description: string): void {
  const bar = document.querySelector<HTMLElement>("#test-progress");
  const label = document.querySelector<HTMLElement>("#progress-percent");
  const action = document.querySelector<HTMLElement>("#current-action");
  if (bar) bar.style.width = `${percent}%`;
  if (label) label.textContent = `${percent}%`;
  if (action) action.textContent = description;
}

export function countEvents(events: EventLog[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;
  return counts;
}
