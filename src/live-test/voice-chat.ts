import { LiveChatHandler } from "../engine/live-chat-handler.js";
import { PromptBuilder } from "../engine/prompt-builder.js";
import { AudioTranscriptionPipeline } from "../engine/audio-transcription-pipeline.js";
import { JsonTools } from "../utils/json-tools.js";
import { AppStore } from "../store/app-store.js";
import type { PipelineEngine } from "../engine/pipeline-engine.js";
import {
  micBtn, micHint, clearChatBtn, dialogBox, chatStatusBadge,
  thinkingConsoleEl, syncStatusBadgeEl, liveThoughtsBoxEl,
  liveRawAsrEl, liveCleanedAsrEl, liveProbableCodeEl,
  reportViewEl, testBadgeEl, timeTakenEl, chunksSentEl,
  modelThoughtsEl, transcriptBodyEl, codeBodyEl,
} from "./dom.js";
import { logToTerminal, escapeHtml } from "./utils.js";

interface ChatHistoryEntry {
  timestamp: string;
  role: "user" | "ai" | "system";
  text?: string;
  think?: string;
  answer?: string;
  code?: string;
  parsed?: any;
}

let activeUserBubble: HTMLElement | null = null;
let activeAiBubble: HTMLElement | null = null;
let activeUserEntry: ChatHistoryEntry | null = null;
let activeAiEntry: ChatHistoryEntry | null = null;
let saveHistoryTimeout: number | null = null;
let isAiResponding = false;
const userBubbleMap = new Map<number, HTMLElement>();
const aiBubbleMap = new Map<number, HTMLElement>();
const userEntryMap = new Map<number, ChatHistoryEntry>();
const aiEntryMap = new Map<number, ChatHistoryEntry>();
const chatHistory: ChatHistoryEntry[] = [];
export { chatHistory };

export function setupVoiceChat(store: AppStore, engine: PipelineEngine): void {
  const liveChatHandler = new LiveChatHandler(
    engine.audio,
    engine.model.getSessionManager(),
    new PromptBuilder(),
    new AudioTranscriptionPipeline(engine.model, (type, data) => {
      logToTerminal(`[ASR Pipeline] ${type}: ${JSON.stringify(data || {})}`, "info");
    }),
    {
      setStatus(text: string, kind: string): void {
        if (chatStatusBadge) {
          chatStatusBadge.textContent = text;
          chatStatusBadge.className = `sync-badge ${kind === "bad" ? "error" : kind === "ready" ? "success" : "running"}`;
        }
        logToTerminal(`[Voice Chat Status] ${text}`, "info");
      },
      setExpectedTranscript(text: string, turnId?: number): void {
        updateLiveUserBubble(text, turnId);
      },
      setRawOutput(text: string, turnId?: number): void {
        updateLiveAiBubble(text, turnId);
      },
      setPromptRunning(running: boolean): void {
        isAiResponding = running;
        const btn = document.querySelector<HTMLButtonElement>("#mic-btn");
        if (btn) btn.classList.toggle("processing", running);
      },
      setParsedResponse(parsed: unknown, turnId?: number): void {
        logToTerminal(`[Voice Chat Response] Parsed: ${JSON.stringify(parsed)}`, "model");
        const tid = turnId ?? 0;
        const entry = aiEntryMap.get(tid) || activeAiEntry;
        if (entry) {
          entry.parsed = parsed;
          if (parsed && typeof parsed === "object") {
            const p = parsed as any;
            if (p.think !== undefined) entry.think = p.think;
            if (p.answer !== undefined) entry.answer = p.answer;
            if (p.code !== undefined) entry.code = p.code;
          }
          if (saveHistoryTimeout !== null) {
            window.clearTimeout(saveHistoryTimeout);
            saveHistoryTimeout = null;
          }
          void saveChatHistoryToServer();
        }
      },
      getHistory(): any[] {
        return chatHistory;
      },
      onLog(type: string, data?: Record<string, unknown>): void {
        logToTerminal(`[Voice Chat Log] ${type}: ${JSON.stringify(data || {})}`, "info");

        const errorTypes = ["live-chat-processing-error", "live-chat-transcription-error", "live-chat-asr-error"];
        if (errorTypes.includes(type)) {
          isAiResponding = false;
          if (isRecording && !liveChatHandler.isProcessing) {
            logToTerminal("[Voice Chat Info] Error de procesamiento detectado. Restableciendo bucle de escucha...", "warning");
            void startNextListeningTurn(liveChatHandler);
          }
        }

        if (type === "live-chat-response-complete") {
          isAiResponding = false;
          if (isRecording && !liveChatHandler.isProcessing) {
            logToTerminal("[Voice Chat Info] IA terminó de responder. Iniciando siguiente turno de escucha...", "info");
            void startNextListeningTurn(liveChatHandler);
          }
        }

        if (type === "live-chat-stopped") {
          const isVad = data?.reason === "vad";
          if (!isVad) {
            isRecording = false;
            if (micBtn) micBtn.classList.remove("recording", "processing");
            if (micHint) micHint.textContent = "Haz clic para empezar a hablar";
          } else {
            if (isAiResponding) {
              logToTerminal("[Voice Chat Info] Turno completado por VAD. Esperando a que la IA termine de responder para escuchar de nuevo...", "info");
              return;
            }
            logToTerminal("[Voice Chat Info] Turno completado por VAD. Iniciando siguiente turno de escucha automática...", "info");
            void startNextListeningTurn(liveChatHandler);
          }
        }
      },
    }
  );

  let isRecording = false;

  async function startNextListeningTurn(handler: LiveChatHandler): Promise<void> {
    if (!isRecording) return;
    if (handler.isProcessing) return;

    try {
      activeUserBubble = null;
      activeAiBubble = null;
      activeUserEntry = null;
      activeAiEntry = null;

      if (micHint) micHint.textContent = "Te escucho... vuelve a hacer clic para parar";
      if (chatStatusBadge) {
        chatStatusBadge.textContent = "Escuchando...";
        chatStatusBadge.className = "sync-badge running";
      }

      const audioViewDelegate = {
        setRecordingState: (state: string) => logToTerminal(`Mic Recording State: ${state}`, "info"),
        setPlaybackUrl: () => {},
        clearFileSelection: () => {},
        clearRunOutput: () => {},
        onAudioDurationReady: () => {},
        onSpeechFragment: () => {},
      };

      await handler.start(audioViewDelegate, "es-AR");
    } catch (err) {
      logToTerminal(`Error al auto-iniciar siguiente turno: ${(err as Error).message}`, "error");
      isRecording = false;
      if (micBtn) micBtn.classList.remove("recording", "processing");
      if (micHint) micHint.textContent = "Haz clic para empezar a hablar";
    }
  }

  // Mic button
  const _micBtn = micBtn;
  if (_micBtn) {
    _micBtn.addEventListener("click", async () => {
      if (isRecording) {
        isRecording = false;
        _micBtn.classList.remove("recording");
        if (micHint) micHint.textContent = "Haz clic para empezar a hablar";
        liveChatHandler.stop();
      } else {
        try {
          await engine.initializeModel();
          isRecording = true;
          _micBtn.classList.add("recording");
          if (micHint) micHint.textContent = "Te escucho... vuelve a hacer clic para parar";

          const audioViewDelegate = {
            setRecordingState: (state: string) => logToTerminal(`Mic Recording State: ${state}`, "info"),
            setPlaybackUrl: () => {},
            clearFileSelection: () => {},
            clearRunOutput: () => {},
            onAudioDurationReady: () => {},
            onSpeechFragment: () => {},
          };

          activeUserBubble = null;
          activeAiBubble = null;
          activeUserEntry = null;
          activeAiEntry = null;

          await liveChatHandler.start(audioViewDelegate, "es-AR");
        } catch (err) {
          logToTerminal(`Error al iniciar el chat de voz: ${(err as Error).message}`, "error");
          isRecording = false;
          _micBtn.classList.remove("recording");
          if (micHint) micHint.textContent = "Haz clic para empezar a hablar";
        }
      }
    });
  }

  // Clear chat button
  if (clearChatBtn) {
    clearChatBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("¿Estás seguro de que deseas limpiar todo el historial del chat de voz?")) return;

      if (isRecording) {
        isRecording = false;
        if (micBtn) micBtn.classList.remove("recording", "processing");
        if (micHint) micHint.textContent = "Haz clic para empezar a hablar";
        liveChatHandler.stop();
      }

      try {
        await engine.resetModelSession();
      } catch (err) {
        console.error("[Clear Chat] Error resetting model session:", err);
      }

      chatHistory.length = 0;
      activeUserBubble = null;
      activeAiBubble = null;
      activeUserEntry = null;
      activeAiEntry = null;
      isAiResponding = false;
      userBubbleMap.clear();
      aiBubbleMap.clear();
      userEntryMap.clear();
      aiEntryMap.clear();

      if (dialogBox) {
        dialogBox.innerHTML = `<div class="chat-message system"><span class="chat-message-time">--:--:--</span><span class="chat-message-text">🎙️ ¡Hola! Soy tu patito de goma (Rubber Duck) inteligente. Activa el micrófono y cuéntame tus dudas o dicta código. Responderé hablándote o mostrándote bloques de código.</span></div>`;
      }

      if (liveThoughtsBoxEl) liveThoughtsBoxEl.textContent = "Esperando flujo de audio... Gemini Nano se activará al recibir palabras de voz.";
      if (liveRawAsrEl) liveRawAsrEl.textContent = "--";
      if (liveCleanedAsrEl) liveCleanedAsrEl.textContent = "--";
      if (liveProbableCodeEl) liveProbableCodeEl.textContent = "// Esperando deducción lógica...";
      if (syncStatusBadgeEl) {
        syncStatusBadgeEl.textContent = "Desconectado";
        syncStatusBadgeEl.className = "sync-badge idle";
      }

      const pillIds = ["#pill-segment", "#pill-energy", "#pill-asr", "#pill-llm", "#pill-total"];
      pillIds.forEach(id => {
        const pill = document.querySelector<HTMLElement>(id);
        if (pill) {
          pill.className = "telemetry-pill";
          const valEl = pill.querySelector(".val");
          if (valEl) valEl.textContent = "--";
        }
      });

      if (thinkingConsoleEl) thinkingConsoleEl.style.display = "none";
      if (reportViewEl) reportViewEl.style.display = "none";
      if (testBadgeEl) {
        testBadgeEl.className = "test-badge idle";
        testBadgeEl.textContent = "Esperando ejecución...";
      }
      if (timeTakenEl) timeTakenEl.textContent = "Duración: -- ms";
      if (chunksSentEl) chunksSentEl.textContent = "Chunks procesados: --";
      if (modelThoughtsEl) {
        modelThoughtsEl.style.display = "none";
        modelThoughtsEl.innerHTML = "";
      }
      if (transcriptBodyEl) transcriptBodyEl.textContent = "N/A";
      if (codeBodyEl) codeBodyEl.textContent = "N/A";

      if (saveHistoryTimeout !== null) {
        window.clearTimeout(saveHistoryTimeout);
        saveHistoryTimeout = null;
      }
      await saveChatHistoryToServer();
      logToTerminal("[Chat History] Historial del chat de voz limpiado y sincronizado con el servidor.", "success");
    });
  }
}

function saveChatHistoryToServerDebounced(): void {
  if (saveHistoryTimeout !== null) window.clearTimeout(saveHistoryTimeout);
  saveHistoryTimeout = window.setTimeout(() => {
    saveHistoryTimeout = null;
    void saveChatHistoryToServer();
  }, 1000);
}

async function saveChatHistoryToServer(): Promise<void> {
  try {
    const response = await fetch("/save-chat-history", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatHistory),
    });
    if (response.ok) {
      logToTerminal(`[Chat History] Historial guardado exitosamente (${chatHistory.length} turnos)`, "success");
    } else {
      console.error(`[Chat History] Failed to save history: HTTP ${response.status}`);
      logToTerminal(`[Chat History] Error al guardar historial: HTTP ${response.status}`, "error");
    }
  } catch (error) {
    console.error("[Chat History] Network error saving history:", error);
    logToTerminal(`[Chat History] Error de red al guardar historial: ${(error as Error).message}`, "error");
  }
}

function getLiveResponseFields(text: string): { answer: string; code: string; think: string } {
  let parsed = JsonTools.extractResponse(text);
  if (!parsed) parsed = JsonTools.salvagePartialJson(text);
  if (parsed) {
    return { answer: parsed.answer || "", code: parsed.code || "", think: parsed.think || "" };
  }
  return { answer: text, code: "", think: "" };
}

function appendChatMessage(sender: "user" | "ai" | "system", text: string): HTMLElement {
  if (!dialogBox) return document.createElement("div");

  const msg = document.createElement("div");
  msg.className = `chat-message ${sender}`;
  const time = new Date().toLocaleTimeString();
  msg.innerHTML = `<span class="chat-message-time">${time}</span><span class="chat-message-text">${escapeHtml(text)}</span>`;
  dialogBox.appendChild(msg);
  dialogBox.scrollTop = dialogBox.scrollHeight;

  const entry: ChatHistoryEntry = {
    timestamp: new Date().toISOString(),
    role: sender,
  };
  if (sender === "user" || sender === "system") {
    entry.text = text;
  } else {
    entry.think = "";
    entry.answer = text;
    entry.code = "";
  }
  chatHistory.push(entry);
  saveChatHistoryToServerDebounced();

  return msg;
}

function updateLiveUserBubble(text: string, turnId?: number) {
  const tid = turnId ?? 0;
  let bubble = userBubbleMap.get(tid);
  let entry = userEntryMap.get(tid);

  if (!bubble) {
    bubble = appendChatMessage("user", "");
    userBubbleMap.set(tid, bubble);
    entry = chatHistory[chatHistory.length - 1];
    userEntryMap.set(tid, entry);
  }

  activeUserBubble = bubble;
  activeUserEntry = entry ?? null;

  const textEl = bubble.querySelector(".chat-message-text");
  if (textEl) textEl.textContent = text;
  if (dialogBox) dialogBox.scrollTop = dialogBox.scrollHeight;

  if (entry) {
    entry.text = text;
    saveChatHistoryToServerDebounced();
  }
}

function updateLiveAiBubble(rawOutputText: string, turnId?: number) {
  const tid = turnId ?? 0;
  let bubble = aiBubbleMap.get(tid);
  let entry = aiEntryMap.get(tid);

  if (!bubble) {
    bubble = appendChatMessage("ai", "");
    aiBubbleMap.set(tid, bubble);
    entry = chatHistory[chatHistory.length - 1];
    aiEntryMap.set(tid, entry);
  }

  activeAiBubble = bubble;
  activeAiEntry = entry ?? null;

  const { answer, code, think } = getLiveResponseFields(rawOutputText);

  const textEl = bubble.querySelector(".chat-message-text");
  if (textEl) textEl.textContent = answer;

  let thinkEl = bubble.querySelector(".chat-think-block") as HTMLElement | null;
  if (think) {
    if (!thinkEl) {
      thinkEl = document.createElement("div");
      thinkEl.className = "chat-think-block";
      bubble.insertBefore(thinkEl, textEl);
    }
    thinkEl.textContent = `🤔 [Pensamiento: ${think}]`;
  } else if (thinkEl) {
    thinkEl.remove();
  }

  let codeEl = bubble.querySelector(".chat-code-block") as HTMLElement | null;
  if (code) {
    if (!codeEl) {
      codeEl = document.createElement("div");
      codeEl.className = "chat-code-block";
      bubble.appendChild(codeEl);
    }
    codeEl.innerHTML = `<div class="chat-code-header"><span>Código Generado</span><button class="copy-code-btn">Copiar</button></div><pre><code>${escapeHtml(code)}</code></pre>`;
    const copyBtn = codeEl.querySelector(".copy-code-btn");
    copyBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(code);
      if (copyBtn) {
        copyBtn.textContent = "¡Copiado!";
        setTimeout(() => { copyBtn.textContent = "Copiar"; }, 2000);
      }
    });
  } else if (codeEl) {
    codeEl.remove();
  }

  if (dialogBox) dialogBox.scrollTop = dialogBox.scrollHeight;

  if (entry) {
    entry.think = think;
    entry.answer = answer;
    entry.code = code;
    saveChatHistoryToServerDebounced();
  }
}

export async function loadChatHistory(): Promise<void> {
  try {
    const response = await fetch(`/voice-chat-history.json?t=${Date.now()}`);
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        chatHistory.length = 0;
        if (dialogBox) dialogBox.innerHTML = "";
        for (const entry of data) {
          chatHistory.push(entry);
          renderPastChatMessage(entry);
        }
        logToTerminal(`[Chat History] Historial cargado exitosamente (${chatHistory.length} turnos)`, "success");
      }
    } else if (response.status === 404) {
      logToTerminal("[Chat History] No se encontró historial previo. Iniciando vacío.", "info");
    } else {
      logToTerminal(`[Chat History] No se pudo cargar historial previo: HTTP ${response.status}`, "warning");
    }
  } catch (error) {
    console.error("[Chat History] Error loading chat history:", error);
    logToTerminal(`[Chat History] Error de red al cargar historial: ${(error as Error).message}`, "warning");
  }
}

function renderPastChatMessage(entry: ChatHistoryEntry) {
  if (!dialogBox) return;

  const msg = document.createElement("div");
  msg.className = `chat-message ${entry.role}`;
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

  if (entry.role === "user" || entry.role === "system") {
    msg.innerHTML = `<span class="chat-message-time">${time}</span><span class="chat-message-text">${escapeHtml(entry.text || "")}</span>`;
  } else {
    msg.innerHTML = `<span class="chat-message-time">${time}</span><span class="chat-message-text">${escapeHtml(entry.answer || "")}</span>`;

    if (entry.think) {
      const thinkEl = document.createElement("div");
      thinkEl.className = "chat-think-block";
      thinkEl.textContent = `🤔 [Pensamiento: ${entry.think}]`;
      msg.insertBefore(thinkEl, msg.querySelector(".chat-message-text"));
    }

    if (entry.code) {
      const codeEl = document.createElement("div");
      codeEl.className = "chat-code-block";
      codeEl.innerHTML = `<div class="chat-code-header"><span>Código Generado</span><button class="copy-code-btn">Copiar</button></div><pre><code>${escapeHtml(entry.code)}</code></pre>`;
      msg.appendChild(codeEl);
      const copyBtn = codeEl.querySelector(".copy-code-btn");
      copyBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(entry.code || "");
        if (copyBtn) {
          copyBtn.textContent = "¡Copiado!";
          setTimeout(() => { copyBtn.textContent = "Copiar"; }, 2000);
        }
      });
    }
  }

  dialogBox.appendChild(msg);
  dialogBox.scrollTop = dialogBox.scrollHeight;
}
