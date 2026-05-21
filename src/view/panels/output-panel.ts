import { UIComponent } from "../core/ui-component.js";
import type { ParsedResponse } from "../../types.js";

export class OutputPanel extends UIComponent {
  readonly rawOutput = this.must<HTMLPreElement>("#rawOutput");
  readonly transcription = this.must<HTMLDivElement>("#transcription");
  readonly probableCode = this.must<HTMLTextAreaElement>("#probableCode");
  readonly answer = this.must<HTMLTextAreaElement>("#answer");
  readonly reasoning = this.must<HTMLTextAreaElement>("#reasoning");

  constructor() {
    super(document.body);
  }

  clearRunOutput(): void {
    this.rawOutput.textContent = "";
    this.rawOutput.classList.add("empty-state");
    this.transcription.innerHTML = `<span class="placeholder-text">La transcripción aparecerá aquí...</span>`;
    this.probableCode.value = "";
    this.answer.value = "";
    this.reasoning.value = "";
  }

  renderResponse(text: string, parsed: ParsedResponse | null): void {
    this.rawOutput.textContent = text;
    if (text) this.rawOutput.classList.remove("empty-state");
    if (!parsed) return;
    
    if (this.isEmptyParsedResponse(parsed)) {
      if (!this.hasVisibleParsedOutput()) {
        this.answer.value = "Sin salida parseada util. El modelo devolvio JSON vacio.";
        this.reasoning.value = "Fallo de transcripcion: respuesta parseada vacia.";
      }
      return;
    }

    if ((parsed.transcript ?? "").trim()) {
      this.transcription.innerHTML = `<span class="final-text">${parsed.transcript ?? ""}</span>`;
    }
    if ((parsed.code ?? "").trim()) this.probableCode.value = parsed.code ?? "";
    if ((parsed.answer ?? "").trim()) this.answer.value = parsed.answer ?? "";
    this.reasoning.value = [
      parsed.think ? `🧠 ACOUSTIC CHAIN-OF-THOUGHT (AcoCoT):\n${parsed.think}` : "",
      parsed.lang ? `Idioma detectado: ${parsed.lang}` : "",
      parsed.interaction_category ? `Categoría de interacción: ${parsed.interaction_category}` : "",
      parsed.dialogue_flow ? `Flujo de diálogo: ${parsed.dialogue_flow}` : "",
      parsed.detected_topics?.length ? `Temas detectados: ${parsed.detected_topics.join(", ")}` : "",
      parsed.is_directed === false ? `[SILENCE MODE] Audio ignorado: no iba dirigido al asistente.` : "",
      parsed.needs_context ? "Necesita contexto: si" : "",
      parsed.code_origin ? `Origen de código: ${parsed.code_origin}` : "",
      parsed.code_tags?.length ? `Tags de código: ${parsed.code_tags.join(", ")}` : "",
      parsed.code_notes ? `Nota de código: ${parsed.code_notes}` : "",
      parsed.suggested_questions?.length ? `Preguntas de aclaración sugeridas:\n${parsed.suggested_questions.map((q) => `• ${q}`).join("\n")}` : "",
      parsed.phonetic_corrections?.length ? `Correcciones fonéticas / semánticas (Ansiedad de Etiquetas):\n${parsed.phonetic_corrections.map((c) => `• ${c}`).join("\n")}` : "",
      parsed.thought_tags ? `Pistas del audio (Thought Tags): ${parsed.thought_tags}` : "",
      parsed.pipeline_trace ? `━━━━━━━━━━━━━━━━━━━━\n${parsed.pipeline_trace}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private isEmptyParsedResponse(parsed: ParsedResponse): boolean {
    return ![parsed.transcript, parsed.code, parsed.answer].some((value) => (value ?? "").trim());
  }

  private hasVisibleParsedOutput(): boolean {
    const transcriptText = this.transcription.querySelector(".final-text")?.textContent || "";
    return [transcriptText, this.probableCode.value, this.answer.value].some((value) => value.trim());
  }
}
