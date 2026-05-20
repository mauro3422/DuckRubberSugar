# Chrome Built-in AI — Gemini Nano (Prompt API)

> Referencia rápida para DuckSugar. Última actualización: 2026-05-18.

---

## 1. ¿Qué es?

**Gemini Nano** es un modelo de lenguaje pequeño (~1.7B params) que corre **localmente en el navegador Chrome** (sin internet). Se accede a través del **Prompt API** (`LanguageModel`) disponible desde Chrome 131+.

- **Modelo**: Gemini Nano (v3 en Chrome 148+)
- **Context window**: 9216 tokens (confirmado vía `session.contextWindow`)
- **Capacidades**: texto, audio (multimodal desde Chrome 138+), structured output (JSON Schema desde Chrome 137+)
- **Ejecución**: 100% on-device, sin latencia de red, sin costo de API

---

## 2. Documentación Oficial (Links)

| Recurso | URL |
|---------|-----|
| **Portal principal** | https://developer.chrome.com/docs/ai/built-in |
| **Get Started** | https://developer.chrome.com/docs/ai/get-started |
| **Prompt API (Extensions)** | https://developer.chrome.com/docs/extensions/ai/prompt-api |
| **Prompt API (Web)** | https://developer.chrome.com/docs/ai/prompt-api |
| **Session Management** | https://developer.chrome.com/docs/ai/session-management |
| **Structured Output** | https://developer.chrome.com/docs/ai/structured-output-for-prompt-api |
| **Streaming** | https://developer.chrome.com/docs/ai/streaming |
| **Render Streamed Responses** | https://developer.chrome.com/docs/ai/render-llm-responses |
| **Debug Gemini Nano** | https://developer.chrome.com/docs/ai/debug-gemini-nano |
| **Cache & Best Practices** | https://developer.chrome.com/docs/ai/cache-models |
| **Do and Don't** | https://developer.chrome.com/docs/ai/built-in-ai-dos-donts |
| **API Status Overview** | https://developer.chrome.com/docs/ai/built-in-apis |
| **Polyfill** | https://developer.chrome.com/docs/ai/prompt-api-polyfill |
| **Model Management** | https://developer.chrome.com/docs/ai/understand-built-in-model-management |
| **TypeScript types** | `npm i @types/dom-chromium-ai` |
| **Demos** | https://chrome.dev/web-ai-demos/ |
| **Chrome Issue Tracker** | https://issues.chromium.org/ (buscar "Built-in AI") |

---

## 3. Lifecycle del API

```
LanguageModel.availability(options)     // "available" | "downloadable" | "downloading" | "unavailable"
    ↓
LanguageModel.params()                  // { defaultTemperature, maxTemperature, defaultTopK, maxTopK }
    ↓
LanguageModel.create(options)           // → session (descarga modelo si es necesario)
    ↓
session.prompt(input, options)          // → string (respuesta completa)
session.promptStreaming(input, options)  // → ReadableStream<string> (chunks)
    ↓
session.clone()                         // → nueva sesión con misma config
session.destroy()                       // liberar recursos
```

---

## 4. Creación de Sesión — `LanguageModel.create(options)`

```javascript
const session = await LanguageModel.create({
  // --- Sampling ---
  temperature: 0.3,        // 0.0 = determinístico, 1.0+ = creativo
  topK: 3,                 // Top-K tokens a considerar (default 3, max 8)

  // --- System Prompt ---
  initialPrompts: [
    { role: "system", content: "Sos un asistente técnico..." }
  ],

  // --- Multimodal (Chrome 138+) ---
  expectedInputs: [
    { type: "text", languages: ["en", "es"] },
    { type: "audio" },          // habilita audio input
  ],
  expectedOutputs: [
    { type: "text", languages: ["es", "en"] },
  ],

  // --- Download Progress ---
  monitor(target) {
    target.addEventListener("downloadprogress", (e) => {
      console.log(`${Math.round(e.loaded * 100)}%`);
    });
  },
});
```

### ⚠️ Regla de inmutabilidad
Una vez creada la sesión, **no se puede cambiar** temperature, topK, ni el system prompt. Para cambiar parámetros → crear nueva sesión.

---

## 5. Parámetros de Sampling

### `temperature`

| Valor | Comportamiento | Uso recomendado |
|-------|---------------|-----------------|
| `0.0` | Totalmente determinístico | Tests, benchmarks reproducibles |
| `0.2–0.3` | Muy estable, baja variación | **JSON structured output**, código |
| `0.5` | Balance creatividad/estabilidad | Texto general |
| `0.8–1.0` | Creativo, más variación | Escritura creativa |
| `>1.0` | Caótico, errático | ⚠️ No recomendado para Nano |

### `topK`

| Valor | Comportamiento | Notas |
|-------|---------------|-------|
| `1` | Greedy decoding — siempre el token más probable | Ultra-determinístico |
| `3` | Default de Nano — top 3 tokens | **Recomendado para JSON** |
| `5–8` | Más diversidad | Más riesgo de loops |
| `>8` | ❌ Max es 8 en Nano | No permitido |

### Consultar defaults en runtime

```javascript
const params = await LanguageModel.params();
console.log(params.defaultTemperature);  // ej: 0.8
console.log(params.maxTemperature);      // ej: 2.0
console.log(params.defaultTopK);         // ej: 3
console.log(params.maxTopK);             // ej: 8
```

---

## 6. Prompting

### `prompt(input, options)` — Respuesta completa

```javascript
const response = await session.prompt("¿Cómo estás?");
```

### `promptStreaming(input, options)` — Streaming

```javascript
const stream = session.promptStreaming("Explicame algo");

// Cada chunk es el texto COMPLETO acumulado (no incremental)
for await (const chunk of stream) {
  console.log(chunk);  // "Hola", "Hola, te", "Hola, te explico..."
}
```

> **Nota importante**: En la implementación actual de Chrome, cada chunk es el texto completo acumulado, NO el delta. Para obtener solo el texto nuevo:
> ```javascript
> let previousText = "";
> for await (const chunk of stream) {
>   const newContent = chunk.startsWith(previousText)
>     ? chunk.slice(previousText.length)
>     : chunk;
>   previousText = chunk;
> }
> ```

### Input multimodal (audio)

```javascript
const response = await session.prompt({
  role: "user",
  content: [
    { type: "text", value: "Transcribí este audio" },
    { type: "audio", value: audioBlob },  // Blob de audio
  ],
});
```

---

## 7. Structured Output — `responseConstraint`

Desde Chrome 137, se puede forzar la estructura de la respuesta con JSON Schema:

```javascript
const schema = {
  type: "object",
  properties: {
    nombre: { type: "string" },
    edad: { type: "number" },
  },
  required: ["nombre", "edad"],
};

const response = await session.prompt("¿Quién sos?", {
  responseConstraint: schema,
});

const parsed = JSON.parse(response);
```

### Propiedades del schema soportadas
- `type`: "string", "number", "integer", "boolean", "array", "object"
- `enum`: lista de valores permitidos
- `properties`, `required`, `additionalProperties`
- `items` (para arrays)

### ⚠️ Limitaciones conocidas
- Schemas muy complejos con strings anidados (ej: JSON con código dentro de strings) pueden causar loops de generación en Nano
- `additionalProperties: false` ayuda a mantener la estructura limpia
- No hay `maxLength` para strings en el schema
- El `responseConstraint` puede consumir contexto si Chrome lo inserta como parte del prompt interno. Para reducir tokens de entrada, DuckSugar usa `omitResponseConstraintInput: true` y mantiene una instrucción textual corta con la forma esperada.

### JSON vs XML/HTML/Markdown

- Para salida consumida por código, la ruta oficial es JSON Schema con `responseConstraint`.
- XML/HTML puede ser útil como delimitador de entrada (`<ide_context>...</ide_context>`), pero no hay evidencia oficial de Chrome de que sea más rápido o más confiable como formato de salida.
- HTML/Markdown generado por el modelo debe tratarse como texto no confiable si se va a renderizar. Para DuckSugar conviene parsear JSON y renderizar UI propia.
- Si se necesita bajar latencia sin perder señales, la opción más segura no es reemplazar JSON por XML, sino usar claves compactas en JSON y mapearlas localmente:

```json
{"tags":"","transcript":"","code":"","answer":"","directed":true,"lang":"es","needs_context":false}
```

Mapeo interno:
- `tags` -> `thought_tags`
- `directed` -> `is_directed`

Esto conserva los campos semánticos, pero evita repetir nombres largos en cada salida.

---

## 8. Gestión de Sesión

### Context window
```javascript
session.contextWindow;  // 9216 (tokens totales disponibles)
session.contextUsage;   // tokens usados hasta ahora
```

### Medir uso antes de enviar
```javascript
const usage = await session.measureContextUsage(prompt, options);
// Permite saber si el prompt cabe antes de enviarlo
```

### Clonar sesión
```javascript
const clone = await session.clone();
// Misma config, misma historia → útil para paralelizar o aislar contexto
```

### Destruir sesión
```javascript
session.destroy();
// Libera recursos. La sesión no se puede usar después.
```

---

## 9. Problemas Conocidos y Mitigaciones

### 🔴 Loop de whitespace/newlines (Repetition Loop)

**Síntoma**: El modelo genera tokens vacíos o `\n` indefinidamente después de un JSON parcial.

**Causa raíz**: El modelo se confunde con el escape de comillas anidadas, especialmente cuando intenta escribir código (`printf("...")`) dentro de un string JSON (`"answer": "...printf(\"...\")..."`).

**Mitigaciones**:
1. **Bajar temperature** a 0.2–0.3 (menos opciones = menos loops)
2. **topK = 3** (mínimo práctico)
3. **Prompt anti-repetición**: `"Do not repeat yourself. Do not produce excessive whitespace."`
4. **Limitar la complejidad del answer**: `"Keep answer concise, 2-3 sentences. No code blocks with backticks."`
5. **Stale detection en código**: Si no hay contenido nuevo por N segundos, cortar el stream
6. **Sesión nueva**: Si la sesión entra en loop, destruir y crear una nueva

### 🟡 JSON incompleto (Truncation)

**Síntoma**: El JSON se corta a mitad de un campo.

**Mitigaciones**:
1. **`responseConstraint`** (JSON Schema) — ayuda pero no elimina el problema
2. **Salvamento parcial**: Extraer campos completos del JSON roto con regex
3. **Repair pass**: Re-enviar el texto como contexto pidiendo solo el JSON

### 🟡 Transcripción de audio inconsistente

**Síntoma**: El mismo audio produce transcripciones diferentes en cada run.

**Causa**: Es inherente al modelo probabilístico. Nano es un modelo pequeño — las partes "sociales" del habla (saludos, muletillas) varían más que el contenido técnico.

**Mitigación**: Bajar temperature reduce la variación pero no la elimina. Benchmark con N runs y promediar.

---

## 10. Configuración Recomendada por Caso de Uso

| Caso | temperature | topK | Notas |
|------|------------|------|-------|
| **JSON structured output** | 0.2–0.3 | 3 | Mínima creatividad, máxima estabilidad |
| **Transcripción de audio** | 0.3–0.5 | 3 | Balance entre fidelidad y flexibilidad |
| **Asistente conversacional** | 0.5–0.7 | 5 | Más natural, algo de variación |
| **Benchmark reproducible** | 0.0 | 1 | Greedy decoding, 100% determinístico |
| **Escritura creativa** | 0.8–1.0 | 8 | Máxima diversidad (cuidado con loops) |

---

## 11. Configuración Actual de DuckSugar

```typescript
// language-model-service.ts — LanguageModel.create()
{
  temperature: 0.5,           // Balance entre estabilidad y flexibilidad para código
  topK: 3,                    // Mínimo práctico
  expectedInputs: [
    { type: "text", languages: ["en", "es"] },
    { type: "audio" },
  ],
  expectedOutputs: [
    { type: "text", languages: ["es", "en"] },
  ],
  initialPrompts: [
    { role: "system", content: ResponseContract }
  ],
}

// config.ts — PromptOptionsConfig (por cada prompt/promptStreaming)
{
  responseConstraint: ResponseSchema,    // JSON Schema hibrido: tags,transcript,code,answer,directed,lang,needs_context
  omitResponseConstraintInput: true,     // No insertar el schema completo como texto de prompt
}

// config.ts — Streaming guards
{
  maxStreamMs: 45_000,   // Hard limit absoluto
  staleMs: 5_000,        // Sin contenido nuevo → cortar
}
```

---

## 12. Propiedades de la Sesión (SessionShape)

```javascript
// Métodos disponibles en la sesión
session.prompt(input, options)            // Respuesta completa
session.promptStreaming(input, options)    // Streaming
session.clone()                           // Clonar
session.destroy()                         // Destruir
session.measureContextUsage(input, opts)  // Medir tokens
session.append(input)                     // Agregar al historial

// Propiedades
session.contextUsage    // number — tokens usados
session.contextWindow   // number — tokens disponibles (9216)
```

---

## 13. Requisitos del Sistema

| Requisito | Detalle |
|-----------|---------|
| **Chrome** | v131+ (texto), v137+ (structured output), v138+ (audio) |
| **OS** | Windows, macOS, Linux, ChromeOS |
| **RAM** | Mínimo recomendado 4GB disponible |
| **Disco** | ~1-2GB para el modelo descargado |
| **GPU** | Beneficiosa pero no obligatoria |
| **Flag** | `chrome://flags/#optimization-guide-on-device-model` → Enabled |
| **Flag audio** | `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → Enabled |

### Verificar disponibilidad
```
chrome://components → "Optimization Guide On Device Model"
```
Si la versión es `0.0.0.0`, el modelo no está descargado. Click "Check for update".

---

## 14. TypeScript Types

```bash
npm install @types/dom-chromium-ai
```

Tipos principales:
```typescript
interface LanguageModel {
  static availability(options?): Promise<string>;
  static params(): Promise<{ defaultTemperature, maxTemperature, defaultTopK, maxTopK }>;
  static create(options?): Promise<LanguageModelSession>;
}

interface LanguageModelSession {
  prompt(input, options?): Promise<string>;
  promptStreaming(input, options?): ReadableStream<string>;
  clone(): Promise<LanguageModelSession>;
  destroy(): void;
  measureContextUsage(input, options?): Promise<number>;
  contextUsage: number;
  contextWindow: number;
}
```

---

## 15. Historial de Cambios Relevantes

| Chrome | Feature |
|--------|---------|
| **131** | Prompt API disponible (texto) |
| **137** | `responseConstraint` (JSON Schema) |
| **138** | Audio input (multimodal) |
| **148** | Gemini Nano v3 (modelo actual) |
