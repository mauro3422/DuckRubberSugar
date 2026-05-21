import type { AppState, EventLog } from "../types.js";
import { DefaultDataset } from "../data/default-dataset.js";

type Listener = (state: AppState) => void;

export class AppStore {
  private state: AppState = {
    sessionMode: "none",
    isInitializing: false,
    isBenchmarkRunning: false,
    isPromptRunning: false,
    isLiveChat: false,
    latestMetrics: null,
    latestReport: null,
    events: [],
    currentTestCase: DefaultDataset.cases[0],
    audioStateText: "",
    audioPlaybackUrl: null,
    statusText: "",
    statusKind: "",
    rawOutputText: "",
    expectedTranscript: "",
    parsedResponse: null,
    benchmarkEntries: [],
    benchmarkHistory: [],
    isTranscribingAudio: false,
  };

  private listeners: Listener[] = [];

  get(): AppState {
    return this.state;
  }

  update(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  addEvent(event: EventLog): void {
    this.state = { ...this.state, events: [...this.state.events, event] };
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
