import type { LanguageModelSession, RepairAttempt, RepairReason } from "../types.js";
import { JsonTools } from "../utils/json-tools.js";
import { LanguageModelGuard } from "./language-model-guard.js";
import { ModelRepairEngine } from "./model-repair-engine.js";

export interface RepairContext {
  bestResponse: string;
  bestParsed: ReturnType<typeof JsonTools.extractResponse>;
  repairAttempts: RepairAttempt[];
  repairPassMs: number | null;
}

interface StageResult {
  response: string;
  parsed: any;
  attempt: RepairAttempt;
  elapsedMs: number;
}

export class RepairPipeline {
  constructor(
    private readonly repairEngine: ModelRepairEngine,
    private readonly args: { sourceTranscript?: string; localCodeSketch?: string; localCodeTags?: string[] }
  ) {}

  async runStage(
    ctx: RepairContext,
    baseSession: LanguageModelSession,
    reason: RepairReason,
    shouldRun: boolean,
    firstPassTruncated: boolean,
    run: (session: LanguageModelSession) => Promise<StageResult>,
  ): Promise<RepairContext> {
    if (firstPassTruncated || !shouldRun) return ctx;
    try {
      const result = await run(baseSession);
      const parsed = this.hydrate(result.parsed);
      const response = parsed ? JsonTools.serializeToXml(parsed) : result.response;
      return {
        ...ctx,
        bestResponse: response,
        bestParsed: parsed,
        repairAttempts: [...ctx.repairAttempts, result.attempt],
        repairPassMs: (ctx.repairPassMs ?? 0) + result.elapsedMs,
      };
    } catch (error) {
      console.error(`Error during ${reason}:`, error);
      return {
        ...ctx,
        repairAttempts: [...ctx.repairAttempts, {
          reason,
          elapsedMs: 0,
          accepted: false,
          improved: false,
          scoreDelta: null,
          truncated: true,
          scoreBefore: LanguageModelGuard.parsedContentScore(ctx.bestParsed),
          scoreAfter: 0,
          outputChars: 0,
        }],
      };
    }
  }

  private hydrate(parsed: any): ReturnType<typeof JsonTools.extractResponse> {
    if (!parsed) return parsed;
    const sourceTranscript = this.args.sourceTranscript?.trim();
    const localCode = this.args.localCodeSketch?.trim() ?? "";
    const modelCode = (parsed.code ?? "").trim();
    const localCodeTags = this.args.localCodeTags ?? [];
    const trustedLocalCode = Boolean(
      localCode && localCodeTags.some((tag) =>
        [
          "spoken_print_call",
          "spoken_not_condition",
          "context_lexicon_reconstruction",
          "spoken_symbol_normalization",
        ].includes(tag)
      )
    );

    const patch: Record<string, unknown> = {};

    if (sourceTranscript) {
      patch.transcript = sourceTranscript;
    }

    if (trustedLocalCode && this.shouldPreferLocalCode(modelCode, localCode, localCodeTags)) {
      patch.code = localCode;
      patch.code_origin = "speech_normalizer";
      patch.code_tags = localCodeTags;
      patch.code_notes = modelCode
        ? "Codigo probable local usado porque la salida del modelo agrego estructura/prosa o contradijo el sketch ASR."
        : "Codigo probable reconstruido localmente desde ASR y contexto disponible.";
    } else if (localCode && !modelCode) {
      patch.code = localCode;
      patch.code_origin = "speech_normalizer";
      patch.code_tags = localCodeTags;
      patch.code_notes = "Codigo probable reconstruido localmente desde ASR y contexto disponible.";
    }

    return Object.keys(patch).length ? { ...parsed, ...patch } as typeof parsed : parsed;
  }

  private shouldPreferLocalCode(modelCode: string, localCode: string, localCodeTags: string[]): boolean {
    if (!localCode) return false;
    if (!modelCode) return true;

    const model = modelCode.trim();
    const local = localCode.trim();
    const lowerModel = model.toLowerCase();
    const lowerLocal = local.toLowerCase();

    if (model === local) return false;

    if (/^[>\s]+/.test(model)) return true;
    if (/[¿?]/.test(model)) return true;
    if (/\b(?:necesito|puedes|podrias|entendido|confirmar|contexto|algoritmo|quieres|qué quieres|what programming language)\b/i.test(model)) return true;
    if (/\btrue\s+es\s+(?:true|false)\b/i.test(model)) return true;
    if (/\/\/\s*(?:code to execute|add your logic|todo|your logic)/i.test(model)) return true;
    if (model.length > Math.max(local.length * 2.2, local.length + 35)) return true;

    if (/^(let|const|var)\s/i.test(local) && !/^(let|const|var)\s/i.test(model)) return true;
    if (/\$\w+/.test(local) && /%s/.test(model) && !/\$\w+/.test(model)) return true;

    if (localCodeTags.includes("spoken_not_condition")) {
      const localIdentifier = lowerLocal.match(/if\s*\(!\s*([a-z_$][\w$]*)\s*\)/i)?.[1];
      const modelIdentifier = lowerModel.match(/if\s*\(!\s*([a-z_$][\w$]*)\s*\)/i)?.[1];
      if (localIdentifier && modelIdentifier && localIdentifier !== modelIdentifier) return true;
    }

    if (localCodeTags.includes("spoken_print_call")) {
      if (/^#include\b|int\s+main\s*\(/i.test(model)) return true;
      if (lowerModel.includes("printf") && lowerLocal.includes("printf") && model !== local) return true;
    }

    return false;
  }
}
