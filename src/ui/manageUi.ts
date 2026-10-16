// Management panels: the team (rota, breaks, editing, hiring), the café (menu, saving)
// and build mode. All changes go through sim/manage.ts, which validates them.

import { HAIR_COLOURS, HAIR_STYLES, MAX_STAFF, OBJECT_DEFS, SKIN_TONES, TRAITS, WORK_TYPES, objectDef, type HairStyle, type TraitId } from '../sim/defs';
import {
  buyObject, editStaff, fire, hire, moveObject, orderBreak, priceRatio, sellObject, sellValue, sendHomeEarly,
  setEnabled, setPrice, setShift,
} from '../sim/manage';
import type { Sim } from '../sim/sim';
import { VENUES } from '../sim/venues';
import { cleanliness, looks } from '../sim/ambience';
import type { Pawn, Recap } from '../sim/state';
import type { Renderer } from '../render/renderer';
import { pounds } from './hud';
import { clearDeviceSave, exportSave, importSave, saveToDevice } from './save';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

type Child = Node | string;

/** Tiny element builder: h('button', { type: 'button', onclick }, 'Label'). */
function h<K extends keyof HTMLElementTagNameMap>(
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

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

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
        return h('div', { className: 'card' },
          h('div', { className: 'top' }, h('strong', {}, a.name), h('span', {}, traitLabels(a.traits))),
          h('p', {}, a.backstory),
          h('p', { className: 'hint' }, `Best at ${best.label.toLowerCase()} (skill ${Math.floor(a.skills[best.id])}). Starts on 09:00–17:00.`),
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
          ),
        );
      }),
    );
  }

  private card(p: Pawn): HTMLElement {
    const status = p.onMap ? this.sim.activity(p) : p.staff!.sickDay === this.sim.day ? 'Off sick' : 'Not in';
    const card = h('div', { className: 'card' },
      h('div', { className: 'top' }, h('strong', {}, p.name), h('span', {}, `${hhmm(p.shift.start)}–${hhmm(p.shift.end)}`)),
      h('p', { className: 'hint' }, `${traitLabels(p.staff!.traits)} · ${status}`),
    );
    if (this.openShift === p.id) card.append(this.shiftEditor(p));
    const act = (fn: () => string | null) => () => {
      const err = fn();
      if (err) this.hooks.notify(err, 'bad');
      this.render();
    };
    card.append(h('div', { className: 'row' },
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
  private name = el<HTMLInputElement>('editor-name');
  private error = el('editor-error');
  private pawn: Pawn | null = null;
  private draft: { skin: string; hair: string; hairStyle: HairStyle; traits: TraitId[] } | null = null;

  constructor(private readonly sim: Sim, private readonly hooks: ManageHooks, private readonly onDone: () => void) {
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
    this.draft = { skin: p.look.skin, hair: p.look.hair, hairStyle: p.look.hairStyle, traits: [...p.staff!.traits] };
    el('editor-title').textContent = p.name;
    this.name.value = p.name;
    this.error.textContent = '';
    this.paint();
    this.box.hidden = false;
    this.name.focus();
  }

  private paint(): void {
    const d = this.draft!;
    const swatches = (id: string, colours: readonly string[], current: string, set: (c: string) => void) =>
      el(id).replaceChildren(...colours.map((c) => h('button', {
        type: 'button', style: `background:${c}`, 'aria-label': c, 'aria-pressed': String(c === current),
        onclick: () => { set(c); this.paint(); },
      })));
    swatches('editor-skin', SKIN_TONES, d.skin, (c) => { d.skin = c; });
    swatches('editor-hair', HAIR_COLOURS, d.hair, (c) => { d.hair = c; });
    el('editor-style').replaceChildren(...HAIR_STYLES.map((st) => h('button', {
      type: 'button', 'aria-pressed': String(st === d.hairStyle), onclick: () => { d.hairStyle = st; this.paint(); },
    }, st.charAt(0).toUpperCase() + st.slice(1))));
    el('editor-traits').replaceChildren(...TRAITS.map((t) => h('button', {
      type: 'button', title: t.description, 'aria-pressed': String(d.traits.includes(t.id)),
      onclick: () => {
        d.traits = d.traits.includes(t.id) ? d.traits.filter((x) => x !== t.id) : [...d.traits, t.id];
        this.paint();
      },
    }, t.label)));
  }

  private save(): void {
    const p = this.pawn!;
    const d = this.draft!;
    const err = editStaff(p, { name: this.name.value, skin: d.skin, hair: d.hair, hairStyle: d.hairStyle, traits: d.traits });
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
      this.panel.hidden = true;
      el('venue-options').replaceChildren(...Object.values(VENUES).map((v) => h('div', { className: 'card' },
        h('div', { className: 'top' }, h('strong', {}, v.name.charAt(0).toUpperCase() + v.name.slice(1))),
        h('p', {}, v.tagline),
        h('div', { className: 'row' }, h('button', {
          type: 'button',
          onclick: () => {
            this.resetting = true;
            clearDeviceSave();
            location.href = `${location.pathname}?venue=${v.id}`;
          },
        }, `Open ${v.name.replace(/^The /i, 'a ')}`)),
      )));
      el('venue-picker').hidden = false;
    });
    el('venue-cancel').addEventListener('click', () => {
      el('venue-picker').hidden = true;
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
        h('label', {}, h('input', {
          type: 'checkbox', checked: m.enabled,
          onchange: change(() => setEnabled(this.sim, m.name, !m.enabled)),
        }), 'On'),
      );
    }));
  }
}

// ------------------------------------------------------------------ build mode

export class BuildUi {
  private bar = el('buildbar');
  private hint = el('build-hint');
  private palette = el('build-palette');
  private sellButton = el<HTMLButtonElement>('build-sell');
  private cancelButton = el<HTMLButtonElement>('build-cancel');
  private selected: number | null = null;
  private buying: string | null = null;

  constructor(private readonly sim: Sim, private readonly renderer: Renderer, private readonly hooks: ManageHooks) {
    el('build-done').addEventListener('click', () => this.stop());
    el('build-buy').addEventListener('click', () => {
      this.palette.hidden = !this.palette.hidden;
      if (!this.palette.hidden) this.renderPalette();
    });
    this.sellButton.addEventListener('click', () => {
      if (this.selected === null) return;
      const o = this.sim.world.objectById(this.selected);
      const err = sellObject(this.sim, this.selected);
      if (err) this.hooks.notify(err, 'bad');
      else if (o) this.hooks.notify(`Sold the ${objectDef(o.def).label.toLowerCase()}.`, 'neutral');
      this.clear();
      this.renderer.rebuildStatic();
    });
    this.cancelButton.addEventListener('click', () => this.clear());
  }

  get active(): boolean {
    return !this.bar.hidden;
  }

  start(): void {
    this.bar.hidden = false;
    document.body.classList.add('building');
    this.clear();
  }

  stop(): void {
    this.bar.hidden = true;
    document.body.classList.remove('building');
    this.clear();
  }

  private clear(): void {
    this.selected = null;
    this.buying = null;
    this.palette.hidden = true;
    this.update();
  }

  private renderPalette(): void {
    const buyable = Object.values(OBJECT_DEFS).filter((d) => d.price !== undefined && !d.fixed);
    this.palette.replaceChildren(...buyable.map((d) => h('button', {
      type: 'button',
      onclick: () => {
        this.buying = d.id;
        this.selected = null;
        this.palette.hidden = true;
        this.update();
      },
    }, d.label, h('small', {}, pounds(d.price!)))));
  }

  private update(): void {
    this.renderer.buildSelection = { objectId: this.selected, active: this.active };
    const o = this.selected !== null ? this.sim.world.objectById(this.selected) : undefined;
    this.sellButton.hidden = !o || objectDef(o.def).fixed === true;
    this.cancelButton.hidden = !o && !this.buying;
    if (this.buying) {
      const d = objectDef(this.buying);
      this.hint.textContent = `Tap where the ${d.label.toLowerCase()} should go (${pounds(d.price!)}).`;
    } else if (o) {
      const d = objectDef(o.def);
      this.hint.textContent = d.fixed
        ? `The ${d.label.toLowerCase()} is fixed in place.`
        : `Tap a new spot for the ${d.label.toLowerCase()}, or sell it for ${pounds(sellValue(o.def))}.`;
      this.sellButton.textContent = `Sell ${pounds(sellValue(o.def))}`;
    } else {
      this.hint.textContent = 'Tap furniture to move or sell it, or Buy something new.';
    }
  }

  /** Handles a tap on the café while building. */
  tap(sx: number, sy: number): void {
    const [tx, ty] = this.renderer.screenToTile(sx, sy);
    if (this.buying) {
      const err = buyObject(this.sim, this.buying, tx, ty);
      if (err) {
        this.hooks.notify(err, 'bad');
        return;
      }
      this.hooks.notify(`Bought a ${objectDef(this.buying).label.toLowerCase()}.`, 'neutral');
      this.buying = null;
      this.renderer.rebuildStatic();
      this.update();
      return;
    }
    const hit = this.renderer.objectAtTile(tx, ty);
    if (this.selected !== null && (!hit || hit.id === this.selected)) {
      if (hit?.id === this.selected) {
        this.clear();
        return;
      }
      const o = this.sim.world.objectById(this.selected)!;
      const d = objectDef(o.def);
      // Tapped tile becomes the object's top-left, nudged so the footprint centres on the finger.
      const err = moveObject(this.sim, o.id, tx - Math.floor((d.w - 1) / 2), ty - Math.floor((d.h - 1) / 2));
      if (err) this.hooks.notify(err, 'bad');
      else this.clear();
      this.renderer.rebuildStatic();
      return;
    }
    this.selected = hit?.id ?? null;
    this.update();
  }
}
