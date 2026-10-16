// Small DOM helpers shared by the menus.

export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

type Child = Node | string;

/** Tiny element builder: h('button', { type: 'button', onclick }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, unknown>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener);
    else if (key === 'className') node.className = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children);
  return node;
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Wires a panel's `.tabs` buttons to its `.tab-page`s (matched by data-tab). The first tab starts open. */
export function setupTabs(root: HTMLElement, onChange: (tab: string) => void = () => {}): (tab: string) => void {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('.tabs [data-tab]')];
  const pages = [...root.querySelectorAll<HTMLElement>('.tab-page[data-tab]')];
  const select = (tab: string) => {
    for (const b of buttons) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of pages) p.hidden = p.dataset.tab !== tab;
    root.scrollTop = 0;
    onChange(tab);
  };
  for (const b of buttons) b.addEventListener('click', () => select(b.dataset.tab!));
  select(buttons[0].dataset.tab!);
  return select;
}
