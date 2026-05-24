import { modelPresenceEl, modelTextEl, asrEl } from "./dom.js";
import { logToTerminal } from "./utils.js";

export async function checkEnvironment() {
  const lm = (window as any).ai?.languageModel || (window as any).LanguageModel;

  if (modelPresenceEl) {
    if (lm) {
      modelPresenceEl.className = "status-pill status-available";
      modelPresenceEl.querySelector(".value")!.textContent = "Disponible";
    } else {
      modelPresenceEl.className = "status-pill status-unavailable";
      modelPresenceEl.querySelector(".value")!.textContent = "Ausente";
    }
  }

  if (modelTextEl) {
    if (lm) {
      try {
        const capabilities = typeof lm.capabilities === "function"
          ? await lm.capabilities()
          : (typeof lm.availability === "function"
             ? await lm.availability({ expectedInputs: [{ type: "text", languages: ["en", "es"] }] })
             : "readily");

        const availability = typeof capabilities === "string" ? capabilities : (capabilities?.available || "readily");
        if (availability === "after-download") {
          modelTextEl.className = "status-pill status-downloading";
          modelTextEl.querySelector(".value")!.textContent = "Descargando";
        } else if (availability === "no") {
          modelTextEl.className = "status-pill status-unavailable";
          modelTextEl.querySelector(".value")!.textContent = "No Soportado";
        } else {
          modelTextEl.className = "status-pill status-available";
          modelTextEl.querySelector(".value")!.textContent = "Activo";
        }
      } catch {
        modelTextEl.className = "status-pill status-unavailable";
        modelTextEl.querySelector(".value")!.textContent = "Error";
      }
    } else {
      modelTextEl.className = "status-pill status-unavailable";
      modelTextEl.querySelector(".value")!.textContent = "Inactivo";
    }
  }

  if (asrEl) {
    try {
      const resp = await fetch("/health");
      if (resp.ok) {
        const data = await resp.json();
        asrEl.className = "status-pill status-available";
        asrEl.querySelector(".value")!.textContent = `Online (Port ${data.port})`;
      } else {
        asrEl.className = "status-pill status-unavailable";
        asrEl.querySelector(".value")!.textContent = "Falla Health";
      }
    } catch {
      asrEl.className = "status-pill status-unavailable";
      asrEl.querySelector(".value")!.textContent = "Offline (5500)";
    }
  }
}

export async function getModelAvailability(): Promise<unknown> {
  const lm = (window as any).LanguageModel || (window as any).ai?.languageModel;
  if (!lm) return { present: false };
  const result: Record<string, unknown> = { present: true };
  try {
    result.audio = await lm.availability?.({
      expectedInputs: [{ type: "text", languages: ["en", "es"] }, { type: "audio" }],
      expectedOutputs: [{ type: "text", languages: ["es", "en"] }],
    });
  } catch (error) {
    result.audioError = (error as Error).message;
  }
  try {
    result.text = await lm.availability?.({
      expectedInputs: [{ type: "text", languages: ["en", "es"] }],
      expectedOutputs: [{ type: "text", languages: ["es", "en"] }],
    });
  } catch (error) {
    result.textError = (error as Error).message;
  }
  return result;
}
