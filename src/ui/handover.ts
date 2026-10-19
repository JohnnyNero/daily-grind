// The handover on screen: what Denise is saying on her walk round (any tap moves her on),
// and her to-do list down the left, which ticks itself off. Tapping a line takes you to
// the place you'd do it.

import { guide, saying, showTodo, skipHandover, skipAhead, stopFlat, todo, touring } from '../sim/handover';
import type { Sim } from '../sim/sim';
import { el, h } from './dom';
import { face } from './panels';

export class HandoverUi {
  private say = el('say');
  private list = el('todo');
  private lastSay = '';
  private lastList = '';
  private lastStop = -2;
  private folded = false;
  /** The walk has moved to another flat (null: the whole building). */
  onFocus: (flatId: string | null) => void = () => {};
  /** A line on the list was tapped. */
  onOpen: (id: string) => void = () => {};

  constructor(private readonly sim: Sim) {
    el('menu-skip').addEventListener('click', () => {
      skipHandover(this.sim);
      el('menu').hidden = true;
      this.update();
    });
  }

  /** A tap on the building while she's talking: on to the next stop. True if it was used. */
  tap(): boolean {
    if (!touring(this.sim)) return false;
    skipAhead(this.sim);
    this.update();
    return true;
  }

  /** Every frame; cheap when nothing's changed. */
  update(): void {
    const sim = this.sim;
    const hv = sim.state.handover;
    if (hv.stop !== this.lastStop) {
      this.lastStop = hv.stop;
      this.onFocus(hv.stop >= 0 ? stopFlat(sim) : null);
    }
    const text = saying(sim);
    const sayKey = `${touring(sim)}|${text}`;
    if (sayKey !== this.lastSay) {
      this.lastSay = sayKey;
      this.renderSay(text);
    }
    el('menu-skip').hidden = hv.skipped === true || (!touring(sim) && !showTodo(sim));
    const items = showTodo(sim) ? todo(sim) : [];
    const listKey = JSON.stringify([items, this.folded]);
    if (listKey !== this.lastList) {
      this.lastList = listKey;
      this.renderList(items);
    }
  }

  private renderSay(text: string | null): void {
    const d = guide(this.sim);
    this.say.hidden = !touring(this.sim);
    if (this.say.hidden) return;
    this.say.replaceChildren(
      d ? face(d) : h('span', {}),
      h(
        'div',
        { className: 'words' },
        h('b', {}, 'Denise'),
        h('p', {}, text ?? 'On her way…'),
        h('small', {}, 'Tap anywhere to carry on'),
      ),
      h('button', { type: 'button', className: 'skip', onclick: () => { skipHandover(this.sim); this.update(); } }, 'Skip'),
    );
  }

  private renderList(items: ReturnType<typeof todo>): void {
    this.list.hidden = items.length === 0;
    if (this.list.hidden) return;
    const left = items.filter((t) => !t.done).length;
    const head = h('button', { type: 'button', className: 'todo-head', 'aria-expanded': String(!this.folded), onclick: () => { this.folded = !this.folded; this.update(); } }, h('b', {}, "Denise's list"), h('span', {}, left === 0 ? 'All done' : `${items.length - left} of ${items.length}`));
    this.list.replaceChildren(
      head,
      ...(this.folded
        ? []
        : items.map((t) => h('button', { type: 'button', className: `todo-item ${t.done ? 'done' : ''}`, onclick: () => this.onOpen(t.id) }, h('span', { className: 'tick' }, t.done ? '✓' : ''), t.label))),
    );
  }
}
