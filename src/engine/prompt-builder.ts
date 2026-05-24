/**
 * PromptBuilder — Construye los prompts para el modelo de lenguaje.
 * Extraído de PipelineEngine para cumplir SRP y separar responsabilidades de construcción de prompts.
 */
import type { LanguageModelContent, LanguageModelPrompt } from "../types.js";
import { SpeechNormalizer } from "../utils/speech-normalizer.js";
import { LiveChatPromptBuilder } from "./live-chat-prompt-builder.js";

export interface PromptBuilderInput {
  instructionText: string;
  contextHint?: string;
  transcription: string;
  transcriptionSource: string;
  manualTranscriptEs?: string;
  manualTranscriptEn?: string;
  langSelectCode?: string;
  hasStreamingAudio: boolean;
  assetBlob: Blob;
  detectedMood: string;
  wpm: number;
  volumeStdDev: number;
  pauseRatio: number;
}

export interface CodeSketchResult {
  codeDetected: boolean;
  codeSketch: { code: string; tags: string[] };
  codeNotes: string[];
}

export class PromptBuilder {
  /**
   * Detecta el idioma de la transcripción para forzar el idioma de respuesta.
   */
  detectResponseLanguage(transcription: string, langSelectCode = "es-AR"): string {
    const currentLang = langSelectCode || "es-AR";
    const isSpanish =
      currentLang.toLowerCase().startsWith("es") ||
      /^(hola|cómo|como|estás|estas|necesito|bueno|tengo|pregunta|por|qué|que|cuando|donde|después|despues|mencionaste|correcciones|notas)/i.test(
        transcription
      );
    return isSpanish ? "Spanish" : "English";
  }

  static buildCodeSketchBlock(codeDetected: boolean, codeSketch: { code: string; tags: string[] }, codeNotes: string[]): string {
    const lines: string[] = [];

    if (codeDetected) {
      lines.push(
        '[CODE DETECTED] The ASR transcript contains code identifiers and/or spoken punctuation. You MUST generate the reconstructed code in the "code" field.'
      );
      if (codeSketch.code) {
        lines.push(
          `[CODE SKETCH] Possible code inferred from speech:\n${codeSketch.code}\n[END CODE SKETCH]\nUse this as a starting point, verify and improve the syntax.`
        );
      } else {
        lines.push(
          '[CODE SKETCH] No reliable sketch could be inferred, but code patterns were detected in the transcript. Analyze the transcript carefully and reconstruct the code.'
        );
      }
      if (codeNotes.length) {
        lines.push(`[CODE NOTES]\n${codeNotes.map((note) => `- ${note}`).join("\n")}\n[END CODE NOTES]`);
      }
      lines.push(
        'CRITICAL: Empty "code" field when code identifiers are detected in the transcript is a FAILURE. You MUST output reconstructed code in the "code" field.'
      );
    } else if (codeSketch.code) {
      lines.push(
        `[CODE SKETCH] Possible code inferred from speech:\n${codeSketch.code}\n[END CODE SKETCH]\nUse this as a starting point, verify and improve the syntax.`
      );
      if (codeNotes.length) {
        lines.push(`[CODE NOTES]\n${codeNotes.map((note) => `- ${note}`).join("\n")}\n[END CODE NOTES]`);
      }
    }

    return lines.filter(Boolean).join("\n\n");
  }

  /**
   * Ejecuta el análisis de SpeechNormalizer para detectar código.
   */
  analyzeCodePatterns(transcription: string, contextHint = ""): CodeSketchResult {
    const codeDetected = SpeechNormalizer.hasCodePatterns(transcription, contextHint);
    const codeSketch = SpeechNormalizer.inferCodeFromSpeech(transcription, contextHint);
    const codeNotes = SpeechNormalizer.buildCodeNotes(transcription, contextHint);
    return { codeDetected, codeSketch, codeNotes };
  }

  /**
   * Construye el contenido de texto que va junto a la instrucción.
   */
  buildTextContent(instructionText: string, contextHint?: string, codeSketchBlock?: string): string {
    const parts: string[] = [
      `Additional user instruction:\n${instructionText.trim()}`,
    ];

    if (contextHint) {
      parts.push(["IDE context available for this test:", contextHint].join("\n"));
    }

    if (codeSketchBlock) {
      parts.push(codeSketchBlock);
    }

    return parts.filter(Boolean).join("\n\n");
  }

  /**
   * Construye el bloque ASR (puede tener múltiples idiomas).
   */
  buildAsrBlock(
    transcription: string,
    manualTranscriptEs?: string,
    manualTranscriptEn?: string
  ): string {
    if (manualTranscriptEs || manualTranscriptEn) {
      return [
        "[AUDIO TRANSCRIBED BY ASR]:",
        manualTranscriptEs ? `- Spanish ASR (es-AR): ${manualTranscriptEs.trim()}` : "",
        manualTranscriptEn ? `- English ASR (en-US): ${manualTranscriptEn.trim()}` : "",
        `- Primary / Combined: ${transcription}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    return `[AUDIO TRANSCRIBED BY ASR]: ${transcription}`;
  }

  /**
   * Construye la instrucción de audio (streaming vs adjunto).
   */
  buildAudioInstruction(hasStreamingAudio: boolean): string {
    return hasStreamingAudio
      ? "[STREAMING AUDIO] Audio was streamed during recording and is already in the session context. The ASR transcript below is your base text — verify it against what you heard."
      : '[AUDIO + ASR] The audio is attached above. Read the ASR transcript below as your base text — it\'s the primary transcription. Listen to the audio to verify: if the ASR misheard something (e.g., \'comisa\' instead of \'comilla\', \'Sprint F\' instead of \'printf\'), correct it. Think of it as reading a draft while someone dictates: you read, you hear, you catch mismatches.';
  }

  /**
   * Construye el prompt completo listo para enviar al modelo.
   */
  buildPrompt(input: PromptBuilderInput): {
    prompt: LanguageModelPrompt;
    codeDetected: boolean;
    codeSketch: { code: string; tags: string[] };
    codeNotes: string[];
  } {
    const responseLanguage = this.detectResponseLanguage(input.transcription, input.langSelectCode);
    const { codeDetected, codeSketch, codeNotes } = this.analyzeCodePatterns(
      input.transcription,
      input.contextHint
    );

    const codeSketchBlock = PromptBuilder.buildCodeSketchBlock(codeDetected, codeSketch, codeNotes);
    const textContent = this.buildTextContent(input.instructionText, input.contextHint, codeSketchBlock);
    const audioInstruction = this.buildAudioInstruction(input.hasStreamingAudio);
    const acousticBlock = `[Acoustic State: ${input.detectedMood}] [Audio Attached — listen to audio alongside ASR] [Response Language: ${responseLanguage}] (Speech Pace: ${input.wpm} WPM, Volume Dynamics: ${input.volumeStdDev.toFixed(3)}, Pause Ratio: ${(input.pauseRatio * 100).toFixed(1)}%)\n\n${audioInstruction}\n\n${textContent}`;

    const asrBlock = this.buildAsrBlock(
      input.transcription,
      input.manualTranscriptEs,
      input.manualTranscriptEn
    );

    const audioContent: LanguageModelContent[] = input.hasStreamingAudio
      ? []
      : [{ type: "audio" as const, value: input.assetBlob }];

    const prompt: LanguageModelPrompt = [
      {
        role: "user",
        content: [
          ...audioContent,
          { type: "text", value: acousticBlock },
          { type: "text", value: asrBlock },
        ],
      },
    ];

    return { prompt, codeDetected, codeSketch, codeNotes };
  }

  private readonly liveChatBuilder = new LiveChatPromptBuilder();

  buildLiveChatPrompt(
    transcript: string,
    contextHint?: string,
    isInteractiveChat = false,
    history?: any[]
  ): { textContent: string; codeDetected: boolean; codeSketch: { code: string; tags: string[] }; codeNotes: string[] } {
    return this.liveChatBuilder.build(transcript, contextHint, isInteractiveChat, history);
  }
}
