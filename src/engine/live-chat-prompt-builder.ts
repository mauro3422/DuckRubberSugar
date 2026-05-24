import { PromptBuilder } from "./prompt-builder.js";

export class LiveChatPromptBuilder {
  build(
    transcript: string,
    contextHint?: string,
    isInteractiveChat = false,
    history?: any[]
  ): { textContent: string; codeDetected: boolean; codeSketch: { code: string; tags: string[] }; codeNotes: string[] } {
    const builder = new PromptBuilder();
    const { codeDetected, codeSketch, codeNotes } = builder.analyzeCodePatterns(transcript, contextHint);

    let userIntentBlock = "";
    let codeSketchBlock = "";
    let forceProgressNoQuestion = false;

    if (isInteractiveChat) {
      const normalized = transcript.toLowerCase().trim();
      const hasHistory = history && history.filter(h => h.role === "user" || h.role === "ai").length > 0;
      const isGreetingOrHesitation = /^(hola|buen|buenos|buenas|hola patito|patito|che|eh|este|a ver|o sea|testing|test)\b/i.test(normalized) || (!hasHistory && normalized.length < 15);
      const isConceptualQuestion = /\b(?:explicame|explícame|explicar|que es|qué es|como funciona|cómo funciona|por que|por qué|para que|para qué|que opinas|qué opinas|que opina|qué opina|ventajas|desventajas|patron|patrón)\b/i.test(normalized);
      const hasExplicitCodeDirective = /\b(?:genera|genere|generar|escribi|escribir|crea|crear|haz|hace|dame|escribime|escribeme|escribas|escriba|escribirle|escribamos|escribirnos|mostrar|mostra|mostrame|mostrame el|codigo|código|code|codeblock|funcion|función|function|snippet|ejemplo|ejemplo de)\b/i.test(normalized);
      forceProgressNoQuestion = /\b(?:ya\s+te\s+dije|ahi\s+te\s+conte|ahí\s+te\s+conté|te\s+lo\s+acabo\s+de\s+decir|no\s+me\s+hagas\s+tantas\s+preguntas|avancemos|sigamos|estamos\s+teniendo\s+una\s+charla)\b/i.test(normalized);

      const isCodeGenerationIntent = hasExplicitCodeDirective && !isConceptualQuestion && !isGreetingOrHesitation;

      if (isGreetingOrHesitation) {
        userIntentBlock = `[RUBBER DUCK INTERACTIVE MODE: GREETING/INITIAL TALK]
The user is just starting to speak, greeting you, or hesitating.
CRITICAL INSTRUCTION:
- Act as a supportive, friendly developer companion (Rubber Duck).
- Respond in a warm, welcoming, and very concise way in Spanish in the "answer" field (e.g. "¡Hola! ¿En qué puedo ayudarte hoy?", "Hola colega, contame qué estás programando.").
- Keep the "code" field strictly EMPTY (""). Do NOT generate any code under any circumstances.`;

        codeSketchBlock = `[NO CODE INTENT DETECTED]
Do NOT write code. Keep the "code" field empty.`;
      } else if (isConceptualQuestion) {
        userIntentBlock = `[RUBBER DUCK INTERACTIVE MODE: CONCEPTUAL/BRAINSTORMING]
The user is asking a conceptual developer question or brainstorming an idea.
CRITICAL INSTRUCTION:
- Answer in a friendly, encouraging, and clear developer companion style in the "answer" field. Keep it under 25 words.
- If the conversation already contains a project/topic/technology/goal, continue from those known facts instead of asking broad setup questions again.
- Prefer one useful next step, suggestion, or short summary over another generic question.
- If the user is frustrated about repeated questions, briefly summarize the known context and advance without asking another question.
- Keep the "code" field strictly EMPTY (""). Do NOT generate any code under any circumstances unless explicitly asked to write code.`;

        codeSketchBlock = `[NO CODE INTENT DETECTED]
Do NOT write code. Keep the "code" field empty.`;
      } else if (isCodeGenerationIntent) {
        userIntentBlock = `[RUBBER DUCK INTERACTIVE MODE: CODE GENERATION REQUEST]
The user is explicitly requesting code or dictating a snippet.
CRITICAL INSTRUCTION:
- Generate the requested code inside the "code" field. Make sure the syntax is correct and fits the context.
- Never return an empty "code" field for this turn.
- If the user asks for Python, output runnable Python. Lists, arrays, dicts, and function calls must use correct commas/separators.
- If the user says "extendelo", "agregale", or refers to previous code, return a complete updated snippet that can run by itself.
- Complete updated snippets must include imports they use, including "import random" when using random.choice.
- Keep the "answer" field extremely brief (e.g. "Listo.", "¡Aquí tenés el código!", "Hecho.").`;

        codeSketchBlock = PromptBuilder.buildCodeSketchBlock(codeDetected, codeSketch, codeNotes);
      } else {
        userIntentBlock = `[RUBBER DUCK INTERACTIVE MODE]
The user is brainstorming or talking with you.
CRITICAL INSTRUCTION:
- Respond naturally and concisely in the "answer" field.
- Use the conversation memory before asking for information. If the user already gave the topic, language, goal, or constraints, continue from those facts.
- If the user says "ya te dije", "ahi te conte", "lo que te dije", "mi idea", or similar, summarize the relevant known fact and move forward.
- Avoid repeated broad questions. Once you know at least a topic and goal, offer a concrete next step or recommendation.
- If the user complains that you are only asking questions, answer with a short summary plus an actionable next step. Do not end with a question.
- ONLY generate code in the "code" field if you are absolutely sure the user wants code written now. Otherwise, keep "code" field strictly EMPTY ("").`;

        if (codeDetected && codeSketch.code) {
          codeSketchBlock = `[POSSIBLE CODE REFERENCE]
The user spoke about some code elements. If they didn't explicitly request to write code, keep "code" field empty ("").
Possible reference sketch:
${codeSketch.code}`;
        } else {
          codeSketchBlock = `[NO CODE INTENT DETECTED]
Do NOT write code. Keep the "code" field empty.`;
        }
      }
    } else {
      userIntentBlock = `[RUBBER DUCK INTERACTIVE MODE]
The user is talking to their technical Rubber Duck to brainstorm, think aloud, ask conceptual questions, or prepare to speak.
CRITICAL RULES FOR CODE GENERATION & DIALOGUE:
1. ONLY generate code in the "code" field if the user EXPLICITLY says so (e.g., "genera el código...", "escribí un...", "crea una función...", or explicitly dictates code).
2. The model must know if the user is just starting to speak, greeting ("hola", "eh..."), or asking conceptual questions ("cómo funciona...", "qué opinas de..."). In these cases, do NOT generate any code. Keep the "code" field strictly EMPTY ("").
3. Act as a supportive, encouraging developer companion. Answer in a friendly, conversational, and concise way inside the "answer" field.`;

      codeSketchBlock = PromptBuilder.buildCodeSketchBlock(codeDetected, codeSketch, codeNotes);
    }

    let memoryBlock = "";
    let dialoguePolicyBlock = "";
    let historyBlock = "";
    if (history && history.length > 0) {
      const formattedTurns: string[] = [];
      const validHistory = history.filter(h => h.role === "user" || h.role === "ai").slice(-12);
      for (const entry of validHistory) {
        if (entry.role === "user") {
          formattedTurns.push(`User: "${entry.text || ""}"`);
        } else if (entry.role === "ai") {
          const parts: string[] = [];
          if (entry.answer) parts.push(`Answer: "${entry.answer}"`);
          if (entry.code) parts.push(`Generated Code: \`\`\`\n${entry.code}\n\`\`\``);
          formattedTurns.push(`Duck: ${parts.join(" | ")}`);
        }
      }
      if (formattedTurns.length > 0) {
        historyBlock = `[CONVERSATION HISTORY]\nThis is the history of previous turns in this conversation. Use this context to understand references like "lo que te dije" (what I told you), "mi idea", etc.\n${formattedTurns.join("\n")}\n[END CONVERSATION HISTORY]`;
      }

      const userFacts = this.buildConversationMemoryFacts(history, transcript);
      if (userFacts.length > 0) {
        memoryBlock = `[CONVERSATION MEMORY]\nKnown facts and requests stated by the user. Treat these as active context and do not ask for them again:\n${userFacts.map((fact) => `- ${fact}`).join("\n")}\nIf the current utterance is short or refers back to "eso", "mi idea", "lo que te dije", or "ahi te conte", resolve it using these facts.\n[END CONVERSATION MEMORY]`;
      }

      const recentQuestionCount = this.countRecentAiQuestions(history);
      if (forceProgressNoQuestion || recentQuestionCount >= 2 || userFacts.length >= 3) {
        dialoguePolicyBlock = `[DIALOGUE POLICY]\nYou have already asked enough setup questions in this conversation.\nFor this turn, do NOT ask another broad clarifying question.\nUse the known facts and give a concrete next step, tiny plan, design choice, or code if explicitly requested.\nThe answer should be declarative and useful. Do not end the answer with a question mark unless there is truly no safe next step.`;
      }
    }

    const parts: string[] = [];
    if (memoryBlock) parts.push(memoryBlock);
    if (dialoguePolicyBlock) parts.push(dialoguePolicyBlock);
    if (historyBlock) parts.push(historyBlock);
    parts.push(userIntentBlock);
    parts.push(`[AUDIO TRANSCRIBED BY ASR]: ${transcript}`);
    if (contextHint) {
      parts.push(`IDE context available for this test:\n${contextHint}`);
    }
    if (codeSketchBlock) parts.push(codeSketchBlock);

    const textContent = parts.filter(Boolean).join("\n\n");
    return { textContent, codeDetected, codeSketch, codeNotes };
  }

  private buildConversationMemoryFacts(history: any[], currentTranscript: string): string[] {
    const entries = history
      .filter((entry) => entry?.role === "user")
      .map((entry) => String(entry.text || "").trim())
      .filter(Boolean);

    const candidates = [...entries, currentTranscript.trim()]
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter((text) => this.isSubstantiveConversationFact(text));

    const seen = new Set<string>();
    const facts: string[] = [];
    for (const candidate of candidates.slice(-10)) {
      const key = candidate.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push(candidate);
    }

    return facts.slice(-8);
  }

  private countRecentAiQuestions(history: any[]): number {
    return history
      .filter((entry) => entry?.role === "ai")
      .slice(-4)
      .filter((entry) => /\?/.test(String(entry.answer || ""))).length;
  }

  private isSubstantiveConversationFact(text: string): boolean {
    const normalized = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) return false;
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length < 4) return false;
    if (/^(hey\s+)?hola\b|^buen(?:o|os|as)\b|^che\b/.test(normalized) && words.length <= 6) return false;
    if (/^(eh|este|a ver|o sea|testing|test)\b/.test(normalized) && words.length <= 6) return false;
    return true;
  }
}
