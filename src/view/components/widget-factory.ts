import { HtmlBuilder } from "../core/html-builder.js";

export class WidgetFactory {
  /**
   * Generates a reusable Metric Card showing a label and a value.
   */
  static createMetricCard(label: string, value: string): HTMLElement {
    return HtmlBuilder.create("div")
      .class("metric")
      .append(
        HtmlBuilder.create("span").text(label),
        HtmlBuilder.create("strong").text(value)
      )
      .build();
  }

  /**
   * Generates a reusable Modal Dialog.
   */
  static createModal(title: string, content: HTMLElement | string, onClose: () => void): HTMLElement {
    const backdrop = HtmlBuilder.create("div").class("modal-backdrop");
    
    // Clicking the backdrop closes the modal
    backdrop.on("click", (e) => {
      if (e.target === backdrop.build()) onClose();
    });

    const modal = HtmlBuilder.create("div").class("modal");
    
    const header = HtmlBuilder.create("div").class("modal-header").append(
      HtmlBuilder.create("h3").text(title),
      HtmlBuilder.create("button").class("icon-btn").text("×").on("click", onClose)
    );
    
    const body = HtmlBuilder.create("div").class("modal-body").append(content);

    return backdrop.append(modal.append(header, body)).build();
  }
}
