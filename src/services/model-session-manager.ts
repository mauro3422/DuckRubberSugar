import { AppConfig, ResponseContract } from "../config.js";
import type { LanguageModelSession, SessionShape } from "../types.js";

// Declare global variable for LanguageModel to make TypeScript compiler happy
declare const LanguageModel: any;

export class ModelSessionManager {
  private baseSession: LanguageModelSession | null = null;
  private mode = "none";

  get sessionMode(): string {
    return this.mode;
  }

  get hasAudioSession(): boolean {
    return Boolean(this.baseSession) && this.mode === "audio";
  }

  get hasSession(): boolean {
    return Boolean(this.baseSession);
  }

  getBaseSession(): LanguageModelSession | null {
    return this.baseSession;
  }

  async cloneSession(): Promise<LanguageModelSession | null> {
    if (!this.baseSession) return null;
    return typeof this.baseSession.clone === "function" 
      ? await this.baseSession.clone() 
      : this.baseSession;
  }

  async initialize(
    onStatus: (text: string, kind?: string) => void,
    onLog: (type: string, data?: Record<string, unknown>) => void
  ): Promise<void> {
    if (this.baseSession) return;

    let lmAPI = (window as any).LanguageModel;
    if (!lmAPI && (window as any).ai && (window as any).ai.languageModel) {
      lmAPI = (window as any).ai.languageModel;
    }

    if (!lmAPI) {
      onStatus("Sin LanguageModel", "bad");
      onLog("api-missing");
      return;
    }

    onStatus("Preparando modelo...");
    let audioAvailability = "no";
    let textAvailability = "no";

    try {
      if (typeof lmAPI.availability === "function") {
        [audioAvailability, textAvailability] = await Promise.all([
          lmAPI.availability(AppConfig.sessionOptions.audio).catch(() => "no"),
          lmAPI.availability(AppConfig.sessionOptions.text).catch(() => "no"),
        ]);
      } else if (typeof lmAPI.capabilities === "function") {
        const caps = await lmAPI.capabilities().catch(() => null);
        if (caps) {
          textAvailability = caps.available || "no";
          audioAvailability = caps.available || "no";
        }
      } else {
        textAvailability = "available";
        audioAvailability = "available";
      }
    } catch (err) {
      onLog("availability-error", { error: String(err) });
    }
    
    onLog("availability", { audioAvailability, textAvailability });

    try {
      onStatus(textAvailability === "available" ? "Creando sesion..." : "Activando modelo...");
      
      // Use text-only session when configured (faster, no raw audio to model)
      const sessionOptions = AppConfig.sessionMode === "text"
        ? AppConfig.sessionOptions.text
        : AppConfig.sessionOptions.audio;

      this.baseSession = await lmAPI.create({
        ...sessionOptions,
        temperature: 0.45,
        topK: 10,
        initialPrompts: [{ role: "system", content: ResponseContract }],
        monitor(monitorTarget: EventTarget) {
          monitorTarget.addEventListener("downloadprogress", (event) => {
            const progressEvent = event as Event & { loaded?: number };
            onLog("downloadprogress", { loaded: progressEvent.loaded ?? 0 });
            onStatus(`Cargando ${Math.round((progressEvent.loaded ?? 0) * 100)}%`);
          });
        },
      });
      this.mode = AppConfig.sessionMode === "text" ? "text" : "audio";
      onStatus("Modelo listo", "ready");
      onLog("session-created", { mode: this.mode, sessionShape: this.shape(this.baseSession) });
    } catch (error) {
      onLog("session-create-error", { message: (error as Error).message, stack: (error as Error).stack });
      // Fallback: try the other mode
      try {
        const fallbackOptions = AppConfig.sessionMode === "text"
          ? AppConfig.sessionOptions.audio
          : AppConfig.sessionOptions.text;
        this.baseSession = await lmAPI.create(fallbackOptions);
        this.mode = AppConfig.sessionMode === "text" ? "audio" : "text";
        onStatus("Solo texto", "bad");
        onLog("session-created", { mode: this.mode, sessionShape: this.shape(this.baseSession) });
      } catch (fallbackError) {
        onLog("session-create-error", { message: (error as Error).message });
        throw error;
      }
    }
  }

  shape(targetSession: LanguageModelSession | null = this.baseSession): SessionShape | null {
    if (!targetSession) return null;
    const proto = Object.getPrototypeOf(targetSession);
    const methods = proto
      ? Object.getOwnPropertyNames(proto).filter((name) => typeof targetSession[name] === "function")
      : [];
    const props = ["contextUsage", "contextWindow", "inputUsage", "inputQuota", "tokensLeft", "topK", "temperature"].reduce<
      Record<string, unknown>
    >((acc, key) => {
      try {
        acc[key] = targetSession[key];
      } catch (error) {
        acc[key] = `ERR: ${(error as Error).message}`;
      }
      return acc;
    }, {});
    return { methods, props };
  }
}