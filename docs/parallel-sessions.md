# Gemini Nano: Parallel Session Management

## State of the Art (Chrome 148, 2026)

Gemini Nano in Chrome soporta **múltiples sesiones concurrentes** via `session.clone()`. Cada sesión es un fork independiente con su propio contexto. Esto permite arquitecturas multi-agente *dentro del navegador*, 100% local, sin servidor.

---

## 1. Requisitos de Hardware

Chrome elige automáticamente entre **GPU** y **CPU** según un benchmark al descargar el modelo:

| Backend | Descarga | RAM proceso | VRAM | Threads |
|---------|----------|-------------|------|---------|
| GPU `HIGHEST_QUALITY` | ~4 GB | ~700 MB | ~3 GB | 1 (+GPU) |
| GPU `FASTEST_INFERENCE` | ~4 GB | ~700 MB | ~2 GB | 1 (+GPU) |
| CPU | ~2.7 GB | ~2.7 GB | — | 8 |

### Performance Classes

Chrome corre un benchmark de GPU (shader) y asigna una clase:

| Clase | Criterio | Modo preferido |
|-------|----------|----------------|
| `kVeryHigh` | input_speed ≥ 500 tok/s | HIGHEST_QUALITY (GPU) |
| `kHigh` | input_speed < 500 tok/s | HIGHEST_QUALITY (GPU) |
| `kMedium` | input_speed < 200 tok/s o VRAM < 5500 MiB | FASTEST_INFERENCE (GPU) |
| `kLow` | input_speed < 75 tok/s | FASTEST_INFERENCE (GPU) |
| `kVeryLow` | VRAM < 3000 MiB o output_speed < 5 tok/s | CPU |
| `kGpuBlocked` | GPU en blocklist de Chrome | CPU |
| `kError` | Benchmark falló | CPU |

### Requisitos mínimos

- **OS:** Windows 10+, macOS 13+, Linux, ChromeOS (Chromebook Plus)
- **Storage:** 22 GB libres (para descarga + headroom)
- **GPU:** >4 GB VRAM (con audio: GPU obligatorio)
- **CPU (fallback):** 16 GB+ RAM, 4+ cores, 64-bit
- **Mobile:** No soportado (Chrome Android/iOS no tiene Prompt API)

---

## 2. Rendimiento por Backend

| Métrica | GPU HIGHEST_QUALITY | GPU FASTEST_INFERENCE | CPU (8 threads) |
|---------|--------------------|----------------------|-----------------|
| Prefill (tok/s) | 1157 | 1668 | 183 |
| Decode (tok/s) | 34.7 | 48.0 | 15.4 |
| TTFT (ms) | 114 | 100 | 498 |
| RAM | ~700 MB | ~700 MB | ~2.7 GB |
| VRAM | ~3 GB | ~2 GB | — |

En una laptop mid-range, TTFT típico es 100-300ms desde sesión caliente.

---

## 3. Concurrencia y Sesiones Paralelas

### Regla fundamental

> **Una sesión = un prompt a la vez.** Llamar `prompt()` dos veces en paralelo sobre la misma sesión lanza `InvalidStateError`.

### Solución: `session.clone()`

```ts
const baseSession = await LanguageModel.create({
  initialPrompts: [{ role: "system", content: systemPrompt }],
});

// Clones independientes para tareas paralelas
const audioAgent = await baseSession.clone();
const ideAgent = await baseSession.clone();
const ragAgent = await baseSession.clone();

// Se ejecutan en paralelo
const [r1, r2, r3] = await Promise.all([
  audioAgent.prompt("..."),
  ideAgent.prompt("..."),
  ragAgent.prompt("..."),
]);

// Destruir clones cuando terminan
audioAgent.destroy();
ideAgent.destroy();
ragAgent.destroy();
```

### Límites prácticos de concurrencia

Dependen de VRAM/RAM disponible:

| GPU VRAM | Sesiones GPU simultáneas | Notas |
|----------|-------------------------|-------|
| 4 GB | **1** | JUSTO, con audio usa toda la VRAM |
| 6 GB | **1-2** | Factible si no todas están activas a la vez |
| 8 GB | **2-3** | Cómodo para multi-agente |
| 12 GB+ | **3-5** | Límite práctico por RAM del proceso (~700 MB c/u) |

| RAM total | Sesiones CPU simultáneas | Notas |
|-----------|-------------------------|-------|
| 16 GB | **1-2** | 2.7 GB c/u + sistema |
| 32 GB | **3-4** | 8 threads c/u, CPU-bound |

**En la práctica:** 2-3 sesiones concurrentes en GPU es el sweet spot. Más que eso satura VRAM o compite por GPU compute.

---

## 4. Ventana de Contexto

| Propiedad | Chrome 137-146 | Chrome 148+ |
|-----------|---------------|-------------|
| `session.contextWindow` | 6144 tokens | **9216 tokens** |
| `session.contextUsage` | tokens usados | tokens usados |
| `session.tokensLeft` | `contextWindow - contextUsage` | `contextWindow - contextUsage` |

### Manejo de overflow

```ts
session.addEventListener("contextoverflow", () => {
  // Se descartó el par prompt/respuesta más antiguo
  // (NUNCA se descarta el system prompt)
});

// Si el input excede el window, lanza QuotaExceededError
try {
  await session.prompt(muyLargo);
} catch (e) {
  if (e.name === "QuotaExceededError") {
    console.log(`Input: ${e.requested}, Window: ${e.contextWindow}`);
  }
}
```

### Estrategia de rotación

Para sesiones de larga duración, clonar y rotar:

```ts
if (session.tokensLeft < 500) {
  const freshSession = await session.clone();
  session.destroy();
  return freshSession;
}
```

---

## 5. Modelo de Memoria

### GPU
- **1 base session**: ~700 MB RAM proceso + ~2-3 GB VRAM
- **1 clone**: solo incrementa ~100-200 MB RAM (comparte pesos del modelo en VRAM)
- Los clones NO duplican los pesos del modelo — solo duplican el estado del contexto

### CPU
- **1 base session**: ~2.7 GB RAM
- **1 clone**: incrementa ~200-400 MB RAM
- Cada sesión CPU necesita sus propios threads (8 por sesión)

---

## 6. API de Detección de Capacidad

```ts
// Detectar backend disponible
const hasGPU = !!navigator.gpu;
const availability = await LanguageModel.availability();
// "unavailable" | "downloadable" | "downloading" | "available"

// Medir tokens de un prompt antes de enviarlo
const tokenCount = await session.measureContextUsage(promptText);

// Obtener info de la sesión
const shape = {
  contextUsage: session.contextUsage,
  contextWindow: session.contextWindow,
  tokensLeft: session.tokensLeft,
  topK: session.topK,
  temperature: session.temperature,
};

// chrome://on-device-internals — debug, versión del modelo, event logs
```

---

## 7. Arquitectura Multi-Agente Propuesta para DuckSugar

Basado en 2-3 sesiones paralelas en GPU:

```
┌─────────────────────────────────────────────────────┐
│                  Base Session                        │
│   (System Prompt + ResponseContract compartido)      │
└──────────┬──────────────┬────────────────┬───────────┘
           │ clone()      │ clone()        │ clone()
           ▼              ▼                ▼
    ┌──────────┐   ┌──────────┐   ┌──────────────┐
    │ AUDIO    │   │ IDE      │   │ RAG /        │
    │ AGENT    │   │ AGENT    │   │ MEMORY AGENT │
    │          │   │          │   │              │
    │ Voz en   │   │ Analiza  │   │ Consulta     │
    │ tiempo   │   │ contexto  │   │ historial,   │
    │ real     │   │ del IDE  │   │ patrones de  │
    │          │   │ (lexicon)│   │ habla,       │
    │ Produce  │   │          │   │ fine-tuning  │
    │ código   │   │ Sugiere  │   │ personalizado│
    │ corregido│   │ imports, │   │              │
    │          │   │ vars     │   │ Kokoro       │
    │          │   │          │   │ (énfasis,    │
    │          │   │          │   │ puntuación)  │
    └──────────┘   └──────────┘   └──────────────┘
```

### Scheduling sugerido

- **Audio Agent**: Prioridad máxima, siempre activo (el usuario habla)
- **IDE Agent**: Prioridad media, corre en background cada ~2s analizando contexto
- **RAG/Memory Agent**: Prioridad baja, corre cuando hay silencio o el usuario no habla
- Chrome prioriza naturalmente las tabs visibles sobre las ocultas

### Consumo estimado

| Agente | VRAM | RAM | Prompt típico | Tokens/request |
|--------|------|-----|---------------|----------------|
| Audio | ~700 MB | ~200 MB | Sketch + transcripción | ~200-500 |
| IDE | ~500 MB | ~150 MB | Contexto del IDE | ~500-1500 |
| Memory | ~300 MB | ~100 MB | Embeddings + consulta corta | ~100-300 |
| **Total** | **~1.5 GB** | **~450 MB** | — | — |

En una GPU de 8 GB VRAM, sobran ~6.5 GB para otros usos.

---

## 8. Consideraciones de Producción

### Cold start
- Primera descarga: 2-4 minutos (depende del internet)
- Primera `create()`: 2-8 segundos (compila WGSL shaders)
- Sesiones pre-warm: crear una base session en hover/focus del usuario
- El modelo se descarga automáticamente si el disco baja de 10 GB libres

### Session lifecycle
- `destroy()` siempre al terminar (sinó se acumula memoria)
- En `beforeunload` del window: destruir clones
- Mantener 1 base session viva (el modelo se descarga si no hay sessions vivas)

### Circuit breaker
- Chrome desactiva la API con exponential backoff si crashea 3 veces
- El servicio del modelo es *compartido entre tabs*: prioriza tabs visibles
- No hay rate limiting de la API, pero hay límite de VRAM/RAM

### Limitaciones conocidas
- **Mobile no soportado** (Chrome Android/iOS sin Prompt API)
- **GPU obligatorio para audio input**
- **Sin shader cache persistente** entre page loads (cada cold start recompila)
- **No se puede queryear versión del modelo desde JS** (solo `chrome://on-device-internals`)
- **Modelo puede desaparecer** si el disco se llena (sin importar sessions activas)

---

## 9. Código de Referencia

```ts
class ParallelAgentManager {
  private baseSession: LanguageModelSession | null = null;
  private clones: Map<string, LanguageModelSession> = new Map();

  async initialize(systemPrompt: string) {
    this.baseSession = await LanguageModel.create({
      initialPrompts: [{ role: "system", content: systemPrompt }],
    });
  }

  async getAgent(name: string): Promise<LanguageModelSession> {
    const existing = this.clones.get(name);
    if (existing && existing.tokensLeft > 200) return existing;
    
    // Rotar: clon nuevo, destruir viejo
    const fresh = await this.baseSession!.clone();
    if (existing) existing.destroy();
    this.clones.set(name, fresh);
    return fresh;
  }

  async runAgent(name: string, prompt: string): Promise<string> {
    const agent = await this.getAgent(name);
    const response = await agent.prompt(prompt);
    
    this.logUsage(name, agent.contextUsage, agent.tokensLeft);
    return response;
  }

  destroyAll() {
    for (const [_, session] of this.clones) session.destroy();
    this.baseSession?.destroy();
    this.clones.clear();
    this.baseSession = null;
  }

  get totalContextUsage(): number {
    let total = 0;
    for (const [_, session] of this.clones) {
      total += session.contextUsage;
    }
    return total;
  }
}
```

---

## 10. Referencias

- [Prompt API Docs (Chrome Developers)](https://developer.chrome.com/docs/ai/prompt-api)
- [Session Management Best Practices](https://developer.chrome.com/docs/ai/session-management)
- [Built-in AI Do's and Don'ts](https://developer.chrome.com/docs/ai/built-in-ai-dos-donts)
- [Understand Built-in Model Management](https://developer.chrome.com/docs/ai/understand-built-in-model-management)
- [Debug Gemini Nano](https://developer.chrome.com/docs/ai/debug-gemini-nano)
- [CPU Support Expansion (Chrome 140)](https://developer.chrome.com/blog/gemini-nano-cpu-support)
- [Prompt API now on by default (Chrome 148)](https://adsm.dev/posts/prompt-api/)
- [Calling Gemini Nano from Browser (April 2026 Guide)](https://gemilab.net/en/articles/gemini-dev/chrome-prompt-api-gemini-nano-browser-implementation-guide)
