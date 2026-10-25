type Child = Node | string | number | null | undefined | false;

interface Props {
  class?: string;
  text?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  checked?: boolean;
  disabled?: boolean;
  maxLength?: number;
  rows?: number;
  for?: string;
  id?: string;
  min?: string;
  max?: string;
  step?: string;
  onclick?: (ev: MouseEvent) => void;
  oninput?: (ev: Event) => void;
  onchange?: (ev: Event) => void;
  dataset?: Record<string, string>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    switch (key) {
      case 'class':
        el.className = value as string;
        break;
      case 'text':
        el.textContent = value as string;
        break;
      case 'for':
        el.setAttribute('for', value as string);
        break;
      case 'dataset':
        Object.assign(el.dataset, value);
        break;
      case 'onclick':
      case 'oninput':
      case 'onchange':
        el.addEventListener(key.slice(2), value as EventListener);
        break;
      default:
        (el as unknown as Record<string, unknown>)[key] = value;
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'number' ? String(child) : child);
  }
  return el;
}

export function button(label: string, onclick: () => void, options: { class?: string; disabled?: boolean } = {}): HTMLButtonElement {
  return h('button', { type: 'button', class: options.class ?? '', disabled: options.disabled ?? false, onclick: () => onclick() }, label);
}

export function paragraphs(lines: readonly string[], className = ''): HTMLElement[] {
  return lines.map((line) => h('p', { class: className }, line));
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
