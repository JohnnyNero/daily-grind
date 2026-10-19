// The alert chips under the top bar, the inbox of letters, and the manager's calls.

import { computeAlerts, type Alert } from '../sim/alerts';
import { CALLS, callProblem, callReadyIn, makeCall } from '../sim/calls';
import { answerLetter } from '../sim/letters';
import type { Sim } from '../sim/sim';
import { TICKS_PER_DAY, TICKS_PER_MINUTE, type Letter } from '../sim/state';
import { el, h, hhmm } from './dom';
import type { ManageHooks } from './manageUi';

export interface InboxHooks extends ManageHooks {
  select(pawnId: number): void;
  openPanel(panel: 'staff' | 'cafe' | 'build'): void;
}

const ALERT_REFRESH_MS = 400;

export class AlertsUi {
  private box = el('alerts');
  private key = '';
  private next = 0;

  constructor(private readonly sim: Sim, private readonly hooks: InboxHooks) {}

  update(now: number): void {
    if (now < this.next) return;
    this.next = now + ALERT_REFRESH_MS;
    const alerts = computeAlerts(this.sim);
    const key = alerts.map((a) => `${a.id}|${a.text}`).join(';');
    if (key === this.key) return;
    this.key = key;
    const shown = alerts.slice(0, 4);
    this.box.replaceChildren(
      ...shown.map((a) => this.chip(a)),
      ...(alerts.length > shown.length ? [h('span', { className: 'alert more' }, `+${alerts.length - shown.length}`)] : []),
    );
    this.box.hidden = alerts.length === 0;
    document.body.classList.toggle('has-alerts', alerts.length > 0);
  }

  private chip(a: Alert): HTMLElement {
    return h('button', {
      type: 'button', className: `alert ${a.level}`,
      onclick: () => {
        if (a.pawn !== undefined) this.hooks.select(a.pawn);
        else if (a.panel) this.hooks.openPanel(a.panel);
      },
    }, a.text);
  }
}

function when(sim: Sim, tick: number): string {
  const day = Math.floor(tick / TICKS_PER_DAY) + 1;
  const minute = Math.floor((tick % TICKS_PER_DAY) / TICKS_PER_MINUTE);
  return day === sim.day ? hhmm(minute) : `Day ${day}`;
}

export class InboxUi {
  private panel = el('inbox-panel');
  private list = el('inbox-list');
  private count = el('inbox-count');
  private lastCount = -1;

  constructor(private readonly sim: Sim, private readonly hooks: InboxHooks) {
    el('inbox-open').addEventListener('click', () => {
      this.hooks.closePanels();
      this.render();
      this.panel.hidden = false;
    });
    el('inbox-close').addEventListener('click', () => this.close());
    el('inbox-clear').addEventListener('click', () => {
      for (const l of [...this.sim.state.letters]) if (!l.choices) answerLetter(this.sim, l.id);
      this.render();
    });
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  close(): void {
    this.panel.hidden = true;
  }

  /** Keeps the unread badge current, and the list if it's open. */
  update(): void {
    const n = this.sim.state.letters.length;
    if (n === this.lastCount) return;
    this.lastCount = n;
    const decisions = this.sim.state.letters.filter((l) => l.choices).length;
    this.count.textContent = n > 0 ? String(n) : '';
    this.count.className = decisions > 0 ? 'badge urgent' : 'badge';
    if (this.isOpen) this.render();
  }

  render(): void {
    const letters = [...this.sim.state.letters].sort((a, b) => Number(!!b.choices) - Number(!!a.choices) || b.tick - a.tick);
    this.list.replaceChildren(
      ...(letters.length === 0 ? [h('p', { className: 'hint' }, "Nothing waiting. Big news and decisions land here.")] : []),
      ...letters.map((l) => this.card(l)),
    );
    el('inbox-clear').hidden = !letters.some((l) => !l.choices);
  }

  private card(l: Letter): HTMLElement {
    const done = (choice: string | null) => () => {
      const err = answerLetter(this.sim, l.id, choice);
      if (err) this.hooks.notify(err, 'bad');
      this.lastCount = -1;
      this.update();
      this.render();
    };
    const pawn = l.pawn !== null ? this.sim.pawnById(l.pawn) : undefined;
    const lapses = l.expires !== undefined ? ` · decide by ${when(this.sim, l.expires)}` : '';
    return h('div', { className: `card letter ${l.tone}${l.choices ? ' decision' : ''}` },
      h('div', { className: 'top' }, h('strong', {}, l.title), h('span', {}, when(this.sim, l.tick) + lapses)),
      h('p', {}, l.text),
      h('div', { className: 'row' },
        ...(l.choices ? l.choices.map((c) => h('button', { type: 'button', onclick: done(c.id) }, c.label)) : [h('button', { type: 'button', onclick: done(null) }, 'Got it')]),
        ...(pawn?.onMap ? [h('button', { type: 'button', onclick: () => { this.close(); this.hooks.select(pawn.id); } }, `Find ${pawn.name}`)] : []),
      ),
    );
  }
}

export class CallsUi {
  private panel = el('calls-panel');
  private list = el('calls-list');
  private key = '';

  constructor(private readonly sim: Sim, private readonly hooks: InboxHooks) {
    el('calls-open').addEventListener('click', () => {
      this.hooks.closePanels();
      this.key = '';
      this.render();
      this.panel.hidden = false;
    });
    el('calls-close').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  close(): void {
    this.panel.hidden = true;
  }

  /** Cooldowns tick down while it's open. */
  update(): void {
    if (this.isOpen) this.render();
  }

  render(): void {
    const rows = CALLS.map((c) => ({ c, problem: callProblem(this.sim, c.id), wait: Math.ceil(callReadyIn(this.sim, c.id) / TICKS_PER_MINUTE) }));
    const key = rows.map((r) => `${r.problem}|${r.wait}`).join(';');
    if (key === this.key) return;
    this.key = key;
    this.list.replaceChildren(...rows.map(({ c, problem, wait }) => h('div', { className: 'card' },
      h('div', { className: 'top' }, h('strong', {}, c.label), h('span', {}, wait > 0 ? `ready in ${wait} min` : 'ready')),
      h('p', { className: 'hint' }, c.detail),
      h('div', { className: 'row' }, h('button', {
        type: 'button', disabled: problem !== null,
        onclick: () => {
          const err = makeCall(this.sim, c.id);
          if (err) this.hooks.notify(err, 'bad');
          this.key = '';
          this.render();
        },
      }, problem && wait === 0 ? problem : c.label)))));
  }
}
