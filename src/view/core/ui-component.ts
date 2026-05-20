export abstract class UIComponent<TElement extends HTMLElement = HTMLElement> {
  protected readonly root: TElement;

  constructor(selectorOrElement: string | TElement) {
    if (typeof selectorOrElement === "string") {
      const el = document.querySelector<TElement>(selectorOrElement);
      if (!el) throw new Error(`Missing component root: ${selectorOrElement}`);
      this.root = el;
    } else {
      this.root = selectorOrElement;
    }
  }

  /**
   * Selects a child element within the component's root.
   */
  protected must<T extends Element>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`Missing element ${selector} inside component`);
    return el;
  }
}
