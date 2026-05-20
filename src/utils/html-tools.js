export class HtmlTools {
    static metricCards(rows) {
        return rows
            .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
            .join("");
    }
}
