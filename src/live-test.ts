/**
 * live-test.ts — Entry point for the live test harness.
 * Delegates functionality to modular sub-modules under src/live-test/.
 */
import { AppStore } from "./store/app-store.js";
import { PipelineEngine } from "./engine/pipeline-engine.js";
import type { AppState, EventLog } from "./types.js";
import { AppConfig } from "./config.js";
import { setupReplayTests, runReplayForCase } from "./live-test/replay-test.js";
import { setupVoiceChat, loadChatHistory } from "./live-test/voice-chat.js";
import { checkEnvironment, getModelAvailability } from "./live-test/environment.js";
import { countEvents, logToTerminal } from "./live-test/utils.js";

type LiveTestOptions = {
  lang?: string;
  maxMs?: number;
  stopAfterMs?: number;
};

type LiveTestResult = {
  ok: boolean;
  snapshot: AppState;
  eventCounts: Record<string, number>;
  errors: EventLog[];
  modelAvailability?: unknown;
};

declare global {
  interface Window {
    duckSugarLiveTest?: {
      run(options?: LiveTestOptions): Promise<LiveTestResult>;
      snapshot(): AppState;
    };
  }
}

const store = new AppStore();
const engine = new PipelineEngine(store);

// Enable audio session mode for the live audio replay test by default
(AppConfig as any).sessionMode = "audio";

// Setup modules
setupReplayTests(store, engine);
setupVoiceChat(store, engine);

// Expose legacy programmatic API for Puppeteer/CDP
window.duckSugarLiveTest = {
  snapshot: () => store.get(),
  run: async (options: LiveTestOptions = {}) => {
    const { DefaultDataset } = await import("./data/default-dataset.js");
    const { setStatus } = await import("./live-test/utils.js");
    setStatus("Running live programmatic replay...");
    const caseToRun = DefaultDataset.cases.find(c => c.fileName === "prueba 2.wav") || DefaultDataset.cases[0];
    const res = await runReplayForCase(caseToRun.id, engine);
    const snapshot = store.get();
    return {
      ok: res.ok,
      snapshot,
      eventCounts: countEvents(snapshot.events),
      errors: snapshot.events.filter((event) => event.type.includes("error")),
      modelAvailability: await getModelAvailability(),
    };
  },
};

// Initial environment diagnostics and proactive model pre-warming
(async () => {

  await checkEnvironment();
  const lm = (window as any).LanguageModel || (window as any).ai?.languageModel;
  if (lm) {
    try {
      logToTerminal("Inicializando y calentando modelo local de manera proactiva...", "info");
      await engine.initializeModel();
    } catch (err) {
      logToTerminal(`Error al pre-calentar el modelo: ${(err as Error).message}`, "error");
    }
  }
})();

// Load previous chat history on page load
void loadChatHistory();
