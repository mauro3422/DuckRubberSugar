import { UIComponent } from "../core/ui-component.js";
import { AppConfig } from "../../config.js";
import { WidgetFactory } from "../components/widget-factory.js";
import { NumberTools } from "../../utils/number-tools.js";
import { BenchmarkService } from "../../services/benchmark-service.js";
import type { BenchmarkEntry, CodexSummarySnapshot } from "../../types.js";

export class BenchmarkPanel extends UIComponent {
  readonly benchmarkMetrics = this.must<HTMLDivElement>("#benchmarkMetrics");
  readonly benchmarkOutput = this.must<HTMLPreElement>("#benchmarkOutput");
  readonly historicalComparison = this.must<HTMLDivElement>("#historicalComparison");
  readonly historyTableBody = this.must<HTMLTableSectionElement>("#historyTableBody");

  constructor() {
    super(document.body);
  }

  render(entries: BenchmarkEntry[], history: CodexSummarySnapshot[] = []): void {
    const summary = BenchmarkService.summarize(entries);
    const fmtMinMax = (min: number | null, max: number | null): string => {
      if (min == null || max == null) return "n/a";
      return `${NumberTools.format(min * 100, 1)} / ${NumberTools.format(max * 100, 1)}%`;
    };
    const repairImprovedRateStr = summary.repairAttemptCount
      ? `${NumberTools.format(summary.repairImprovedRate * 100, 1)}%`
      : "0%";
    const cards: Array<[string, string]> = [
      ["Runs", String(entries.length)],
      ["Transcript avg", summary.transcriptAvg == null ? "n/a" : `${NumberTools.format(summary.transcriptAvg * 100, 1)}%`],
      ["Transcript min/max", fmtMinMax(summary.transcriptMin, summary.transcriptMax)],
      ["Code match avg", summary.codeAvg == null ? "n/a" : `${NumberTools.format(summary.codeAvg * 100, 1)}%`],
      ["Code min/max", fmtMinMax(summary.codeMin, summary.codeMax)],
      ["Code generated", `${summary.codeGeneratedCount}/${entries.length} (${NumberTools.format(summary.codeGenerationRate * 100, 1)}%)`],
      ["Useful code", `${summary.usefulCodeCount}/${entries.length} (${NumberTools.format(summary.usefulCodeRate * 100, 1)}%)`],
      ["Repaired runs", `${summary.repairRunCount}/${entries.length} (${NumberTools.format(summary.repairRunRate * 100, 1)}%)`],
      ["Repair attempts", `${summary.repairAttemptCount} (avg: ${summary.repairAttemptAvg == null ? "n/a" : NumberTools.format(summary.repairAttemptAvg, 1)})`],
      ["Repair improved", `${summary.repairImprovedCount}/${summary.repairAttemptCount} (${repairImprovedRateStr})`],
      ["Total avg", summary.totalAvg == null ? "n/a" : `${NumberTools.format(summary.totalAvg, 0)} ms`],
      ["TTFT avg", summary.firstChunkAvg == null ? "n/a" : `${NumberTools.format(summary.firstChunkAvg, 0)} ms`],
      ["Tok/s avg", summary.tokPerSecAvg == null ? "n/a" : `${NumberTools.format(summary.tokPerSecAvg, 1)} raw`],
      ["Content tok/s", summary.contentTokPerSecAvg == null ? "n/a" : `${NumberTools.format(summary.contentTokPerSecAvg, 1)}`],
      ["Truncated", String(summary.truncatedCount)],
      ["Prompt", AppConfig.promptVersion],
    ];
    if (summary.truncatedCount > 0) {
      cards.push(["Trunc reasons", Object.entries(summary.truncatedByReason).map(([key, value]) => `${key}:${value}`).join(", ")]);
    }
    const cardElements = cards.map(([label, value]) => WidgetFactory.createMetricCard(label, value));
    this.benchmarkMetrics.replaceChildren(...cardElements);
    this.benchmarkOutput.textContent = JSON.stringify(entries.slice(-10), null, 2);
    if (entries.length > 0) {
      this.benchmarkOutput.classList.remove("empty-state");
      this.benchmarkOutput.style.display = "block";
    } else {
      this.benchmarkOutput.classList.add("empty-state");
    }

    if (history.length > 0) {
      this.historicalComparison.style.display = "block";
      const rows = history.map((snapshot) => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid var(--panel-border)";
        tr.style.transition = "background 0.2s";

        const tdVersion = document.createElement("td");
        tdVersion.style.padding = "10px";
        tdVersion.style.fontWeight = "500";
        tdVersion.style.color = "var(--text-main)";
        tdVersion.textContent = snapshot.promptVersion;

        const tdRuns = document.createElement("td");
        tdRuns.style.padding = "10px";
        tdRuns.style.textAlign = "center";
        tdRuns.textContent = String(snapshot.runs);

        const tdTranscript = document.createElement("td");
        tdTranscript.style.padding = "10px";
        tdTranscript.style.textAlign = "center";
        tdTranscript.style.fontWeight = "600";
        tdTranscript.style.color = "var(--pre-color)";
        tdTranscript.textContent = snapshot.transcriptAvg == null ? "n/a" : `${NumberTools.format(snapshot.transcriptAvg * 100, 1)}%`;

        const tdCode = document.createElement("td");
        tdCode.style.padding = "10px";
        tdCode.style.textAlign = "center";
        tdCode.style.fontWeight = "600";
        tdCode.style.color = "var(--code-color)";
        tdCode.textContent = snapshot.codeAvg == null ? "n/a" : `${NumberTools.format(snapshot.codeAvg * 100, 1)}%`;

        const tdRepair = document.createElement("td");
        tdRepair.style.padding = "10px";
        tdRepair.style.textAlign = "center";
        tdRepair.textContent = `${NumberTools.format(snapshot.repairRunRate * 100, 1)}%`;

        const tdSpeed = document.createElement("td");
        tdSpeed.style.padding = "10px";
        tdSpeed.style.textAlign = "center";
        tdSpeed.textContent = snapshot.tokPerSecAvg == null ? "n/a" : `${NumberTools.format(snapshot.tokPerSecAvg, 1)}`;

        const tdDate = document.createElement("td");
        tdDate.style.padding = "10px";
        tdDate.style.textAlign = "right";
        tdDate.style.color = "var(--text-muted)";
        const date = new Date(snapshot.generatedAt);
        tdDate.textContent = isNaN(date.getTime())
          ? "n/a"
          : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + " " + date.toLocaleDateString([], { month: 'short', day: 'numeric' });

        tr.append(tdVersion, tdRuns, tdTranscript, tdCode, tdRepair, tdSpeed, tdDate);
        return tr;
      });
      this.historyTableBody.replaceChildren(...rows);
    } else {
      this.historicalComparison.style.display = "none";
    }
  }
}
