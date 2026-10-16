// Management panels: the team (rota, breaks, editing, hiring) and the café (menu, saving).
// Build mode lives in buildUi.ts. All changes go through sim/manage.ts, which validates them.

import { MAX_STAFF, TRAITS, WORK_TYPES, type TraitId } from '../sim/defs';
import {
  editStaff, fire, hire, orderBreak, priceRatio, sendHomeEarly, setEnabled, setPrice, setShift,
} from '../sim/manage';
import type { Sim } from '../sim/sim';
import { cleanliness, looks } from '../sim/ambience';
import type { Pawn, Recap } from '../sim/state';
import { changesOf, CharacterForm, draftOf, portrait } from './characterForm';
import { el, h, hhmm, setupTabs } from './dom';
import { exportSave, importSave, saveToDevice } from './save';

function traitLabels(traits: TraitId[]): string {
  return traits.map((t) => TRAITS.find((x) => x.id === t)!.label).join(', ');
}

export interface ManageHooks {
  notify(text: string, tone?: 'good' | 'bad' | 'neutral'): void;
  closePanels(): void;
  showRecap(recap: Recap): void;
}

// ------------------------------------------------------------------ team

export class TeamUi {
  private team = el('team');
  private applicants = el('applicants');
  private openShift: number | null = null;
  private editor: StaffEditor;

  constructor(private readonly sim: Sim, private readonly hooks: ManageHooks, private readonly onChange: () => void) {
    this.editor = new StaffEditor(sim, hooks, () => this.render());
  }

  render(): void {
    const s = this.sim.state;
    const staff = s.pawns.filter((p) => p.staff && !p.staff.quit);
    this.team.replaceChildren(...staff.map((p) => this.card(p)));
    const full = staff.length >= MAX_STAFF;
    this.applicants.replaceChildren(
      ...(s.applicants.length === 0 ? [h('p', { className: 'hint' }, 'Nobody has applied yet. Check back tomorrow.')] : []),
      ...s.applicants.map((a, i) => {
        const best = WORK_TYPES.slice().sort((x, y) => a.skills[y.id] - a.skills[x.id])[0];
        return h('div', { className: 'card person' },
          portrait(a.look, 44, a.name),
          h('div', { className: 'person-info' },
          h('div', { className: 'top' }, h('strong', {}, a.name), h('span', {}, traitLabels(a.traits))),
          h('p', {}, a.backstory),
          h('p', { className: 'hint' }, `Best at ${best.label.toLowerCase()} (skill ${Math.floor(a.skills[best.id])}) · 09:00–17:00`),
          h('div', { className: 'row' },
            h('button', {
              type: 'button',
              disabled: full,
              onclick: () => {
                const result = hire(this.sim, i);
                if (typeof result === 'string') this.hooks.notify(result, 'bad');
                this.render();
                this.onChange();
              },
            }, full ? 'Team is full' : `Hire ${a.name}`),
          )),
        );
      }),
    );
  }

  private card(p: Pawn): HTMLElement {
    const status = p.onMap ? this.sim.activity(p) : p.staff!.sickDay === this.sim.day ? 'Off sick' : 'Not in';
    const info = h('div', { className: 'person-info' },
      h('div', { className: 'top' }, h('strong', {}, p.name), h('span', {}, `${hhmm(p.shift.start)}–${hhmm(p.shift.end)}`)),
      h('p', { className: 'hint' }, `${traitLabels(p.staff!.traits)} · ${status}`),
    );
    const card = h('div', { className: 'card person' }, portrait(p.look, 44, p.name), info);
    if (this.openShift === p.id) info.append(this.shiftEditor(p));
    const act = (fn: () => string | null) => () => {
      const err = fn();
      if (err) this.hooks.notify(err, 'bad');
      this.render();
    };
    info.append(h('div', { className: 'row' },
      h('button', { type: 'button', 'aria-expanded': String(this.openShift === p.id), onclick: () => { this.openShift = this.openShift === p.id ? null : p.id; this.render(); } }, 'Shift'),
      h('button', { type: 'button', disabled: !p.onMap, onclick: act(() => orderBreak(this.sim, p)) }, 'Break now'),
      h('button', { type: 'button', disabled: !p.onMap, onclick: act(() => sendHomeEarly(this.sim, p)) }, 'Send home'),
      h('button', { type: 'button', onclick: () => this.editor.open(p) }, 'Edit'),
    ));
    return card;
  }

  private shiftEditor(p: Pawn): HTMLElement {
    const nudge = (ds: number, de: number) => () => {
      setShift(this.sim, p, p.shift.start + ds, p.shift.end + de);
      this.render();
    };
    const row = (label: string, value: number, minus: () => void, plus: () => void) =>
      h('div', { className: 'shift-edit' },
        h('button', { type: 'button', 'aria-label': `${label} 30 minutes earlier`, onclick: minus }, '−'),
        h('span', {}, `${label} ${hhmm(value)}`),
        h('button', { type: 'button', 'aria-label': `${label} 30 minutes later`, onclick: plus }, '+'));
    return h('div', {},
      row('Starts', p.shift.start, nudge(-30, 0), nudge(30, 0)),
      row('Ends', p.shift.end, nudge(0, -30), nudge(0, 30)),
    );
  }
}

class StaffEditor {
  private box = el('editor');
  private error = el('editor-error');
  private form = new CharacterForm();
  private pawn: Pawn | null = null;

  constructor(private readonly sim: Sim, private readonly hooks: ManageHooks, private readonly onDone: () => void) {
    el('editor-form').replaceWith(this.form.root);
    el('editor-cancel').addEventListener('click', () => this.close());
    el('editor-save').addEventListener('click', () => this.save());
    el('editor-fire').addEventListener('click', () => {
      const p = this.pawn;
      if (!p || !confirm(`Let ${p.name} go? They won't be back.`)) return;
      const err = fire(this.sim, p);
      if (err) this.hooks.notify(err, 'bad');
      this.close();
    });
  }

  open(p: Pawn): void {
    this.pawn = p;
    el('editor-title').textContent = p.name;
    this.error.textContent = '';
    this.form.set(draftOf(p));
    this.box.hidden = false;
    this.form.focusName();
  }

  private save(): void {
    const err = editStaff(this.pawn!, changesOf(this.form.value));
    if (err) {
      this.error.textContent = err;
      return;
    }
    this.close();
  }

  private close(): void {
    this.box.hidden = true;
    this.pawn = null;
    this.onDone();
  }

  get isOpen(): boolean {
    return !this.box.hidden;
  }
}

// ------------------------------------------------------------------ café panel

export class CafeUi {
  private panel = el('cafe-panel');
  private list = el('menu-list');
  private resetting = false;

  constructor(private readonly sim: Sim, private readonly hooks: ManageHooks, startBuild: () => void) {
    setupTabs(this.panel);
    el('cafe-open').addEventListener('click', () => {
      this.hooks.closePanels();
      this.render();
      this.panel.hidden = false;
    });
    el('cafe-close').addEventListener('click', () => {
      this.panel.hidden = true;
    });
    el('build-start').addEventListener('click', () => {
      this.panel.hidden = true;
      startBuild();
    });
    el('save-now').addEventListener('click', () => {
      this.hooks.notify(saveToDevice(this.sim) ? 'Saved.' : "Couldn't save on this device. Try Export save instead.", 'neutral');
    });
    el('save-export').addEventListener('click', () => exportSave(this.sim));
    el<HTMLInputElement>('save-import').addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        await importSave(file);
        this.resetting = true;
        location.reload();
      } catch (err) {
        this.hooks.notify((err as Error).message, 'bad');
      }
    });
    el('save-new').addEventListener('click', () => {
      // The start screen takes it from here; this place stays saved until the new one opens.
      saveToDevice(this.sim);
      this.resetting = true;
      location.href = `${location.pathname}?new`;
    });
  }

  private renderExtras(): void {
    const s = this.sim.state;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    el('ambience-line').textContent = `Cleanliness ${pct(cleanliness(this.sim))} · Looks ${pct(looks(this.sim))}. Plants and armchairs out front help; dirty cups and spills don't.`;

    const regulars = s.regulars.slice().sort((a, b) => b.visits - a.visits).slice(0, 8);
    el('regulars').replaceChildren(
      ...(regulars.length === 0 ? [h('p', { className: 'hint' }, 'No regulars yet. Happy customers sometimes decide to come back.')] : []),
      ...regulars.map((r) => {
        const fav = s.pawns.filter((p) => p.staff && !p.staff.quit && (r.likes[p.id] ?? 0) >= 15)
          .sort((a, b) => (r.likes[b.id] ?? 0) - (r.likes[a.id] ?? 0))[0];
        const notes = [`usual: ${r.usual}`];
        if (fav) notes.push(`soft spot for ${fav.name}`);
        if (r.grudge) notes.push(`still sore about ${r.grudge.what} by ${r.grudge.staffName}`);
        return h('div', { className: 'card' },
          h('div', { className: 'top' }, h('strong', {}, r.name), h('span', {}, `${r.visits} visit${r.visits === 1 ? '' : 's'}`)),
          h('p', { className: 'hint' }, notes.join(' · ')));
      }),
    );

    const recaps = s.recaps.slice().reverse();
    el('scrapbook').replaceChildren(
      ...(recaps.length === 0 ? [h('li', {}, 'Nothing yet. The first page gets written at closing time.')] : []),
      ...recaps.map((r) => h('li', {},
        h('span', {}, `Day ${r.day}`),
        h('button', { type: 'button', className: 'link', onclick: () => { this.panel.hidden = true; this.hooks.showRecap(r); } }, r.headline))),
    );
    const fame = s.hallOfFame.slice().reverse();
    el('hall-of-fame').replaceChildren(
      ...(fame.length === 0 ? [h('li', {}, 'Legends take time.')] : []),
      ...fame.map((f) => h('li', {}, h('span', {}, `Day ${f.day}`), f.text)),
    );
  }

  /** True while the page is reloading into a different café, so nothing saves over it. */
  get isResetting(): boolean {
    return this.resetting;
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  close(): void {
    this.panel.hidden = true;
  }

  render(): void {
    el('cafe-title').textContent = this.sim.venue.name.charAt(0).toUpperCase() + this.sim.venue.name.slice(1);
    this.renderExtras();
    const ratio = priceRatio(this.sim);
    el('price-hint').textContent = ratio > 1.05
      ? `Prices are ${Math.round((ratio - 1) * 100)}% above usual: fewer customers, and they'll grumble about value.`
      : ratio < 0.95
        ? `Prices are ${Math.round((1 - ratio) * 100)}% below usual: busier, but thinner margins.`
        : 'Prices are at the usual level.';
    this.list.replaceChildren(...this.sim.state.menu.map((m) => {
      const change = (fn: () => string | null) => () => {
        const err = fn();
        if (err) this.hooks.notify(err, 'bad');
        this.render();
      };
      const cls = m.price > m.basePrice ? 'price up' : m.price < m.basePrice ? 'price down' : 'price';
      return h('li', { className: m.enabled ? '' : 'off' },
        h('span', { className: 'name' }, m.name),
        h('button', { type: 'button', 'aria-label': `${m.name} 10p cheaper`, onclick: change(() => setPrice(this.sim, m.name, m.price - 10)) }, '−'),
        h('span', { className: cls }, `£${(m.price / 100).toFixed(2)}`),
        h('button', { type: 'button', 'aria-label': `${m.name} 10p dearer`, onclick: change(() => setPrice(this.sim, m.name, m.price + 10)) }, '+'),
        h('input', {
          type: 'checkbox', role: 'switch', className: 'switch', checked: m.enabled, 'aria-label': `Sell ${m.name}`,
          onchange: change(() => setEnabled(this.sim, m.name, !m.enabled)),
        }),
      );
    }));
  }
}
