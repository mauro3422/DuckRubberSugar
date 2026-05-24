import type { LiveFileReplayChunkTrace } from "../engine/live-file-replay-runner.js";
import { DefaultDataset } from "../data/default-dataset.js";
import { AppStore } from "../store/app-store.js";
import type { PipelineEngine } from "../engine/pipeline-engine.js";
import {
  caseSelect, runBtn, runAllBtn, copyConsoleBtn,
  terminalEl, testBadgeEl, waveVisualEl, reportViewEl,
  timeTakenEl, chunksSentEl, currentActionEl, transcriptBodyEl,
  codeBodyEl, modelThoughtsEl, thinkingConsoleEl, syncStatusBadgeEl,
  liveThoughtsBoxEl, liveRawAsrEl, liveCleanedAsrEl, liveProbableCodeEl,
  pillSegmentEl, pillSegmentValEl, pillEnergyEl, pillEnergyValEl,
  pillAsrEl, pillAsrValEl, pillLlmEl, pillLlmValEl,
  pillTotalEl, pillTotalValEl,
} from "./dom.js";
import {
  setStatus, logToTerminal, escapeHtml, updateProgress,
  cleanSpeechStutters, tagSpeechStuttersForUi,
} from "./utils.js";

export function setupReplayTests(store: AppStore, engine: PipelineEngine): void {
  // Populate case select
  if (caseSelect) {
    caseSelect.innerHTML = DefaultDataset.cases
      .map(c => `<option value="${c.id}" ${c.fileName === "prueba 2.wav" ? "selected" : ""}>${c.fileName} ${c.fileName === "prueba 2.wav" ? "(Recomendado)" : ""}</option>`)
      .join("");
  }

  // Store subscriber for replay events
  let lastProcessedEventIndex = 0;
  let totalChunks = 6;

  store.subscribe((state) => {
    if (currentActionEl) {
      currentActionEl.textContent = state.statusText || "Listo";
      if (state.statusKind === "bad") {
        currentActionEl.style.color = "var(--danger)";
      } else if (state.statusKind === "ready" || state.statusKind === "good") {
        currentActionEl.style.color = "var(--success)";
      } else {
        currentActionEl.style.color = "var(--primary)";
      }
    }

    if (state.statusText) {
      setStatus(state.statusText);
    }

    if (transcriptBodyEl && state.expectedTranscript) {
      transcriptBodyEl.innerHTML = state.expectedTranscript;
    }

    if (state.parsedResponse) {
      if (codeBodyEl) {
        codeBodyEl.textContent = state.parsedResponse.code || "// Escuchando en vivo... Gemini Nano razonando lógica de programación...";
      }
      if (modelThoughtsEl) {
        if (state.parsedResponse.think) {
          modelThoughtsEl.style.display = "block";
          modelThoughtsEl.innerHTML = `<p><strong>Pensamientos de Gemini Nano:</strong></p><p style="font-style: italic; color: var(--text-muted); margin-top: 0.5rem; line-height: 1.5;">${escapeHtml(state.parsedResponse.think)}</p>`;
        } else {
          modelThoughtsEl.style.display = "none";
        }
      }
    }

    const events = state.events;
    for (let i = lastProcessedEventIndex; i < events.length; i++) {
      const event = events[i];
      const data = event.data || {};

      switch (event.type) {
        case "live-replay-started":
          totalChunks = (data.chunkCount as number) || 6;
          logToTerminal(`[Replay Started] ID: ${data.id}, File: ${data.fileName}, Chunks: ${totalChunks}`, "info");
          updateProgress(5, `Decodificando audio y preparando chunks...`);
          if (thinkingConsoleEl) thinkingConsoleEl.style.display = "flex";
          if (syncStatusBadgeEl) {
            syncStatusBadgeEl.className = "sync-badge syncing";
            syncStatusBadgeEl.textContent = "Sincronizando";
          }
          if (liveThoughtsBoxEl) liveThoughtsBoxEl.textContent = "Esperando flujo de audio... Gemini Nano se activará al recibir palabras de voz.";
          if (liveRawAsrEl) liveRawAsrEl.textContent = "--";
          if (liveCleanedAsrEl) liveCleanedAsrEl.textContent = "--";
          if (liveProbableCodeEl) liveProbableCodeEl.textContent = "// Esperando deducción lógica...";
          break;

        case "live-replay-started-vad":
          totalChunks = (data.segments as number) || totalChunks;
          logToTerminal(`[Status] [live replay] Detectados ${totalChunks} segmentos reales con VAD`, "info");
          updateProgress(8, `Preparando ${totalChunks} segmentos de audio con VAD...`);
          break;

        case "live-replay-chunk-appended":
          const chunkIdx = (data.chunkIndex as number) || 1;
          const elapsed = (data.elapsedMs as number) || 0;
          logToTerminal(`[Chunk ${chunkIdx}/${totalChunks}] Enviado al modelo (${(elapsed / 1000).toFixed(1)}s)`, "info");
          updateProgress(Math.min(85, Math.round(5 + (chunkIdx / totalChunks) * 80)), `Procesando chunk de audio ${chunkIdx}/${totalChunks}...`);
          break;

        case "live-replay-asr-error":
          logToTerminal(`[ASR Error] Chunk ${data.chunkIndex}: ${data.message}`, "error");
          break;

        case "live-replay-final-asr-error":
          logToTerminal(`[ASR Final Error] ${data.message}`, "error");
          break;

        case "live-replay-response-complete":
          logToTerminal(`[Model Response] Modo: ${data.mode}, Longitud: ${data.responseLength} caracteres${data.modelDurationMs ? ` (${data.modelDurationMs}ms)` : ""}`, "model");
          if (state.parsedResponse?.code) {
            logToTerminal(`[Model Code] Reconstrucción parcial: "${state.parsedResponse.code}"`, "success");
          }
          break;

        case "live-replay-chunk-silence-skipped":
          logToTerminal(`   └─ 🔇 [Silencio] Omitiendo llamada al modelo en chunk ${data.chunkIndex} (Energía: ${(data.energy as number || 0).toFixed(6)} < ${(data.silenceThreshold as number || 0).toFixed(6)})`, "info");
          break;

        case "live-replay-response-skipped-duplicate":
          logToTerminal(`   └─ 🔄 [Duplicado] Omitiendo llamada al modelo en chunk ${data.chunkIndex} (Sin cambios significativos)`, "info");
          break;

        case "live-replay-chunk-sync": {
          const trace = data as unknown as LiveFileReplayChunkTrace;
          if (!trace) break;
          if (thinkingConsoleEl) thinkingConsoleEl.style.display = "flex";
          if (syncStatusBadgeEl) {
            syncStatusBadgeEl.className = "sync-badge syncing";
            syncStatusBadgeEl.textContent = "Sincronizando";
          }
          if (pillSegmentValEl) pillSegmentValEl.textContent = `${trace.index} / ${totalChunks}`;
          if (pillSegmentEl) pillSegmentEl.className = "telemetry-pill active-pill";
          if (pillEnergyValEl) pillEnergyValEl.textContent = trace.energy ? trace.energy.toFixed(4) : "0.0000";
          if (pillEnergyEl) pillEnergyEl.className = `telemetry-pill ${trace.isSilent ? "silent-pill" : "success-pill"}`;
          if (pillAsrValEl) pillAsrValEl.textContent = trace.asrSkipped ? "Omitido" : `${trace.asrDurationMs}ms`;
          if (pillAsrEl) pillAsrEl.className = `telemetry-pill ${trace.asrSkipped ? "warning-pill" : "success-pill"}`;

          if (pillLlmValEl) {
            if (trace.modelSkipped) {
              pillLlmValEl.textContent = trace.modelSkippedReason === "silence" ? "Silencio" : trace.modelSkippedReason === "duplicate" ? "Duplicado" : "Omitido";
            } else {
              pillLlmValEl.textContent = `${trace.modelDurationMs}ms`;
            }
          }
          if (pillLlmEl) {
            pillLlmEl.className = `telemetry-pill ${trace.modelSkipped ? (trace.modelSkippedReason === "silence" ? "silent-pill" : "warning-pill") : "success-pill"}`;
          }
          if (pillTotalValEl) pillTotalValEl.textContent = `${trace.totalChunkDurationMs}ms`;
          if (pillTotalEl) pillTotalEl.className = "telemetry-pill active-pill";

          if (liveThoughtsBoxEl) {
            if (trace.think) {
              liveThoughtsBoxEl.textContent = trace.think;
            } else if (trace.modelSkipped) {
              if (trace.modelSkippedReason === "silence") {
                liveThoughtsBoxEl.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">[Segmento Silencioso] Gemini Nano en reposo para ahorrar GPU.</span>`;
              } else if (trace.modelSkippedReason === "duplicate") {
                liveThoughtsBoxEl.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">[Segmento Duplicado] Transcripción idéntica detectada. Reutilizando razonamiento anterior.</span>`;
              } else {
                liveThoughtsBoxEl.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">[Omitido] Gemini Nano en reposo.</span>`;
              }
            } else {
              liveThoughtsBoxEl.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">Esperando respuesta de Gemini Nano...</span>`;
            }
          }

          if (liveRawAsrEl) liveRawAsrEl.innerHTML = tagSpeechStuttersForUi(trace.transcript || "");
          if (liveCleanedAsrEl) liveCleanedAsrEl.textContent = cleanSpeechStutters(trace.transcript || "");
          if (liveProbableCodeEl) liveProbableCodeEl.textContent = trace.code || "// Analizando voz y buscando patrones lógicos...";
          break;
        }

        case "live-replay-complete":
          logToTerminal(`[Replay Complete] Test finalizado exitosamente.`, "success");
          updateProgress(100, `¡Prueba completada!`);
          if (syncStatusBadgeEl) {
            syncStatusBadgeEl.className = "sync-badge idle";
            syncStatusBadgeEl.textContent = "Completado";
          }
          break;

        case "model-init-error":
          logToTerminal(`[Model Init Error] ${data.message}`, "error");
          break;

        case "status":
          logToTerminal(`[Status] ${data.text}`, "info");
          break;
      }
    }
    lastProcessedEventIndex = events.length;
  });

  // Run button
  const _runBtn = runBtn;
  if (_runBtn) {
    _runBtn.addEventListener("click", async () => {
      _runBtn.disabled = true;
      if (runAllBtn) runAllBtn.disabled = true;
      if (caseSelect) caseSelect.disabled = true;
      if (terminalEl) terminalEl.innerHTML = "";

      try {
        const selectedId = caseSelect ? caseSelect.value : "tc-02-notecount";
        await runReplayForCase(selectedId, engine);
      } catch (err) {
        logToTerminal(`Falla crítica durante el test: ${(err as Error).message}`, "error");
        if (testBadgeEl) {
          testBadgeEl.className = "test-badge fail";
          testBadgeEl.textContent = "ERROR";
        }
      } finally {
        if (waveVisualEl) waveVisualEl.classList.remove("active");
        _runBtn.disabled = false;
        if (runAllBtn) runAllBtn.disabled = false;
        if (caseSelect) caseSelect.disabled = false;
      }
    });
  }

  // Run All button
  const _runAllBtn = runAllBtn;
  if (_runAllBtn) {
    _runAllBtn.addEventListener("click", async () => {
      if (_runBtn) _runBtn.disabled = true;
      _runAllBtn.disabled = true;
      if (caseSelect) caseSelect.disabled = true;
      if (terminalEl) terminalEl.innerHTML = "";

      logToTerminal("🚀 Iniciando ejecución de Suite Completa...", "info");
      const suiteResults: any[] = [];
      let passedCount = 0;

      try {
        const cases = DefaultDataset.cases;
        for (let i = 0; i < cases.length; i++) {
          const testCase = cases[i];
          logToTerminal(`\n==================================================`, "info");
          logToTerminal(`🏃 [Caso ${i + 1}/${cases.length}] Iniciando: ${testCase.id} (${testCase.fileName})`, "info");
          logToTerminal(`==================================================\n`, "info");

          try {
            const res = await runReplayForCase(testCase.id, engine);
            suiteResults.push({
              id: testCase.id, fileName: testCase.fileName, ok: res.ok,
              finalTranscript: res.finalTranscript, expectedTranscript: res.expectedTranscript,
              finalCode: res.finalCode, expectedCode: res.expectedCode,
              think: res.think, elapsedMs: res.elapsedMs, errors: res.errors,
              error: null, chunks: res.chunks,
            });
            if (res.ok) passedCount++;
          } catch (caseErr) {
            logToTerminal(`❌ Error en caso ${testCase.id}: ${(caseErr as Error).message}`, "error");
            suiteResults.push({
              id: testCase.id, fileName: testCase.fileName, ok: false,
              finalTranscript: "", expectedTranscript: testCase.expectedTranscript || "",
              finalCode: "", expectedCode: testCase.expectedCode || "",
              think: "", elapsedMs: 0, errors: [(caseErr as Error).message],
              error: (caseErr as Error).message,
            });
          }
        }

        logToTerminal(`\n==================================================`, "success");
        logToTerminal(`🎉 Suite Finalizada: ${passedCount}/${cases.length} PASARON`, passedCount === cases.length ? "success" : "warning");
        logToTerminal(`==================================================\n`, "success");

        logToTerminal("Guardando reporte consolidado en fake-mic-live-result.json...", "info");
        const suiteReport = {
          suiteRun: true, timestamp: new Date().toISOString(),
          summary: { total: cases.length, passed: passedCount, failed: cases.length - passedCount },
          results: suiteResults,
        };

        try {
          const postResp = await fetch("/save-test-result", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(suiteReport),
          });
          if (postResp.ok) {
            logToTerminal(`Resultados consolidados guardados exitosamente en fake-mic-live-result.json.`, "success");
          } else {
            logToTerminal(`Error al guardar resultados consolidados: HTTP ${postResp.status}`, "error");
          }
        } catch (postErr) {
          logToTerminal(`Error de red al guardar resultados consolidados: ${(postErr as Error).message}`, "error");
        }

        if (testBadgeEl) {
          testBadgeEl.className = passedCount === cases.length ? "test-badge pass" : "test-badge fail";
          testBadgeEl.textContent = `${passedCount}/${cases.length} PASSED`;
        }
      } catch (err) {
        logToTerminal(`Falla crítica durante la ejecución de la suite: ${(err as Error).message}`, "error");
      } finally {
        if (waveVisualEl) waveVisualEl.classList.remove("active");
        if (_runBtn) _runBtn.disabled = false;
        _runAllBtn.disabled = false;
        if (caseSelect) caseSelect.disabled = false;
      }
    });
  }

  // Copy console button
  const _copyConsoleBtn = copyConsoleBtn;
  if (_copyConsoleBtn) {
    _copyConsoleBtn.addEventListener("click", async () => {
      if (!terminalEl) return;
      const lines = Array.from(terminalEl.querySelectorAll(".console-line")).map(line => {
        const timestampEl = line.querySelector(".timestamp");
        const timestamp = timestampEl ? `[${timestampEl.textContent}] ` : "";
        const clone = line.cloneNode(true) as HTMLElement;
        const ts = clone.querySelector(".timestamp");
        if (ts) ts.remove();
        return `${timestamp}${clone.textContent?.trim()}`;
      }).join("\n");

      try {
        await navigator.clipboard.writeText(lines);
        const originalText = _copyConsoleBtn.innerHTML;
        _copyConsoleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg> ¡Copiado!`;
        setTimeout(() => { _copyConsoleBtn.innerHTML = originalText; }, 2000);
      } catch (err) {
        console.error("Falla al copiar la consola:", err);
      }
    });
  }
}

export async function runReplayForCase(caseId: string, engine: PipelineEngine): Promise<{
  ok: boolean; finalCode: string; elapsedMs: number; finalTranscript: string;
  think: string; expectedCode: string; expectedTranscript: string;
  errors: string[]; chunks?: LiveFileReplayChunkTrace[];
}> {
  const testCase = DefaultDataset.cases.find(c => c.id === caseId);
  if (!testCase) throw new Error(`Caso no encontrado: ${caseId}`);

  logToTerminal(`Descargando archivo de prueba: ${testCase.fileName}...`, "info");
  updateProgress(2, `Descargando ${testCase.fileName}...`);

  const url = `/pruebas/${encodeURIComponent(testCase.fileName)}`;
  const fileResp = await fetch(url);
  if (!fileResp.ok) throw new Error(`HTTP ${fileResp.status} al descargar ${testCase.fileName}`);
  const fileBlob = await fileResp.blob();
  logToTerminal(`Archivo ${testCase.fileName} descargado (${(fileBlob.size / 1024 / 1024).toFixed(2)} MB).`, "success");

  const file = new File([fileBlob], testCase.fileName, { type: fileBlob.type });
  if (waveVisualEl) waveVisualEl.classList.add("active");

  logToTerminal("Iniciando pipeline de audio a código offline...", "info");

  const result = await engine.replayLiveAudioFile({
    id: testCase.id, file,
    expectedTranscript: testCase.expectedTranscript,
    expectedCode: testCase.expectedCode,
    contextHint: testCase.contextHint,
  }, { chunkCount: 6, asrEveryChunks: 1 });

  logToTerminal(`Pipeline finalizado. Reconstruido en ${result.elapsedMs} ms.`, "success");

  if (reportViewEl) reportViewEl.style.display = "block";
  if (timeTakenEl) timeTakenEl.textContent = `Duración: ${result.elapsedMs} ms`;
  if (chunksSentEl) chunksSentEl.textContent = `Chunks procesados: ${result.chunkCount}`;

  const normalizeForAssert = (code: string): string =>
    code.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "").replace(/[;:,()"'\s`\-+={}[\]]/g, "").toLowerCase();

  const genClean = normalizeForAssert(result.finalCode || "");
  const expClean = normalizeForAssert(testCase.expectedCode || "");

  let isMatch = false;
  if (!testCase.expectedCode || testCase.expectedCode.trim() === "") {
    isMatch = true;
  } else {
    isMatch = genClean.length > 0 && (genClean.includes(expClean) || expClean.includes(genClean));
  }

  if (testBadgeEl) {
    if (isMatch) {
      testBadgeEl.className = "test-badge pass";
      testBadgeEl.textContent = "PASSED";
      logToTerminal(`[Assert] ¡El código generado coincide con el esperado ("${testCase.expectedCode}")!`, "success");
    } else {
      testBadgeEl.className = "test-badge fail";
      testBadgeEl.textContent = "FAIL";
      logToTerminal(`[Assert] El código generado no coincide exactamente con el esperado ("${testCase.expectedCode}"). Generado: "${result.finalCode}"`, "warning");
    }
  }

  const responsePayload = {
    ...result,
    expectedTranscript: testCase.expectedTranscript,
    expectedCode: testCase.expectedCode,
    ok: isMatch,
  };

  logToTerminal(`Guardando reporte en fake-mic-live-result.json...`, "info");
  try {
    const postResp = await fetch("/save-test-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(responsePayload),
    });
    if (postResp.ok) {
      logToTerminal(`Resultados guardados exitosamente en fake-mic-live-result.json en el servidor local.`, "success");
    } else {
      logToTerminal(`Error al guardar resultados en el servidor: HTTP ${postResp.status}`, "error");
    }
  } catch (postErr) {
    logToTerminal(`Error de red al guardar resultados: ${(postErr as Error).message}`, "error");
  }

  return {
    ok: isMatch, finalCode: result.finalCode, elapsedMs: result.elapsedMs,
    finalTranscript: result.finalTranscript, think: result.finalResponse?.think || "",
    expectedCode: testCase.expectedCode || "", expectedTranscript: testCase.expectedTranscript || "",
    errors: result.errors || [], chunks: result.chunks,
  };
}
