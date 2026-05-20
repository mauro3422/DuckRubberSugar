export class HtmlBuilder<T extends HTMLElement = HTMLElement> {
  private readonly element: T;

  private constructor(tag: string) {
    this.element = document.createElement(tag) as T;
  }

  static create<K extends keyof HTMLElementTagNameMap>(tag: K): HtmlBuilder<HTMLElementTagNameMap[K]> {
    return new HtmlBuilder(tag as string);
  }

  id(id: string): this {
    this.element.id = id;
    return this;
  }

  class(...classes: string[]): this {
    this.element.classList.add(...classes.filter(Boolean));
    return this;
  }

  text(content: string): this {
    this.element.textContent = content;
    return this;
  }

  html(content: string): this {
    this.element.innerHTML = content;
    return this;
  }

  attr(name: string, value: string): this {
    this.element.setAttribute(name, value);
    return this;
  }

  style(property: string, value: string): this {
    this.element.style.setProperty(property, value);
    return this;
  }

  on<K extends keyof HTMLElementEventMap>(event: K, listener: (this: T, ev: HTMLElementEventMap[K]) => any): this {
    this.element.addEventListener(event, listener as EventListener);
    return this;
  }

  append(...children: (HTMLElement | HtmlBuilder<any> | string)[]): this {
    for (const child of children) {
      if (child instanceof HtmlBuilder) {
        this.element.appendChild(child.build());
      } else if (typeof child === 'string') {
        this.element.appendChild(document.createTextNode(child));
      } else {
        this.element.appendChild(child);
      }
    }
    return this;
  }

  build(): T {
    return this.element;
  }
}
