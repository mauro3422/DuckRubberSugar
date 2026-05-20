import { UIComponent } from "../core/ui-component.js";
import { WidgetFactory } from "../components/widget-factory.js";
import { NumberTools } from "../../utils/number-tools.js";
import type { Metrics, TranscriptDiff, CodeDiff } from "../../types.js";

export class MetricsPanel extends UIComponent {
  readonly metricsOutput = this.must<HTMLDivElement>("#metricsOutput");

  constructor() {
    super(document.body);
  }

  clear(): void {
    this.metricsOutput.innerHTML = "";
  }

  render(metrics: Metrics, transcriptDiff: TranscriptDiff | null, codeDiff: CodeDiff | null): void {
    const rows: Array<[string, string]> = [
      ["Total", `${NumberTools.format(metrics.totalMs, 0)} ms`],
      ["Primer chunk", metrics.firstChunkMs == null ? "n/a" : `${NumberTools.format(metrics.firstChunkMs, 0)} ms`],
      ["Salida", `${metrics.outputTokensApprox} tok aprox`],
      ["Velocidad", `${NumberTools.format(metrics.tokensPerSecond, 2)} tok/s aprox`],
      ["Vel. contenido", `${NumberTools.format(metrics.contentTokensPerSecond, 2)} tok/s`],
      ["Caracteres/s", `${NumberTools.format(metrics.charsPerSecond, 1)}`],
      ["Audio", `${NumberTools.format((metrics.audioDurationMs ?? 0) / 1000, 1)} s`],
      ["Chunks", String(metrics.chunkCount)],
      ["Repair", metrics.repairAttemptCount ? `${metrics.repairAttemptCount} (${metrics.repairAttempts.filter(a => a.improved).length} imp) / ${metrics.repairPassMs ?? 0} ms` : "no"],
      ["Truncado", metrics.truncated ? metrics.truncatedReason ?? "si" : "no"],
      ["Match", transcriptDiff ? `${NumberTools.format(transcriptDiff.similarity * 100, 1)}%` : "n/a"],
      ["Code", codeDiff ? `${NumberTools.format(codeDiff.similarity * 100, 1)}%` : "n/a"],
    ];
    const cards = rows.map(([label, value]) => WidgetFactory.createMetricCard(label, value));
    this.metricsOutput.replaceChildren(...cards);
  }
}
