// Management panels: the team (rota, breaks, editing, hiring) and the café (menu, saving).
// Build mode lives in buildUi.ts. All changes go through sim/manage.ts, which validates them.

import { canCook } from '../sim/kitchen';
import { MAX_STAFF, TRAITS, WORK_COLOURS, WORK_TYPES, objectDef, type TraitId, type WorkType } from '../sim/defs';
import {
  editStaff, fire, hire, orderBreak, priceRatio, sendHomeEarly, setDaysOff, setEnabled, setPrice, setRushStation, setShift, setStation,
} from '../sim/manage';
import type { Sim } from '../sim/sim';
import { cleanliness, looks } from '../sim/ambience';
import type { Pawn, Recap } from '../sim/state';
import { changesOf, CharacterForm, draftOf, portrait } from './characterForm';
import { el, h, hhmm, setupTabs } from './dom';
import { pounds } from './hud';
import { setLead } from '../sim/careers';
import { FLAT_COST, FLAT_RENT, beds, buildStaffFlat, hasFlat, liveIns, setLivesIn } from '../sim/flat';
import { STRESS_STRAINED, WEEKDAYS, weekday } from '../sim/stakes';
import { weekProfit } from '../sim/goals';
import {
  DEBT_LIMIT, INGREDIENT_SHARE, SERVICE_COST, dailyRent, guestCapacity, machineWear, priceTolerance, seatCount, serviceMachine, starProgress, starText, stars,
} from '../sim/business';
import { exportSave, importSave, saveToDevice } from './save';

function perHour(pence: number): string {
  return `£${(pence / 100).toFixed(2)}/h`;
}

function workLabel(sim: Sim, w: WorkType): string {
  return sim.venue.workLabels[w] ?? WORK_TYPES.find((x) => x.id === w)!.label;
}

function traitLabels(traits: TraitId[]): string {
  return traits.map((t) => TRAITS.find((x) => x.id === t)!.label).join(', ');
}

export interface ManageHooks {
  notify(text: string, tone?: 'good' | 'bad' | 'neutral'): void;
  closePanels(): void;
  showRecap(recap: Recap): void;
  /** Re-frames the view (after building on the back plot, say). */
  refit?: () => void;
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
          h('p', { className: 'hint' }, `Best at ${best.label.toLowerCase()} (skill ${Math.floor(a.skills[best.id])}) · loves ${a.passions.map((w) => workLabel(this.sim, w).toLowerCase()).join(' and ')} · wants ${perHour(a.wage)}`),
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
      h('div', { className: 'top' }, h('strong', {}, p.name + (p.staff!.lead ? ' · lead' : '')), h('span', {}, `${hhmm(p.shift.start)}–${hhmm(p.shift.end)}`)),
      h('p', { className: 'hint' }, `${traitLabels(p.staff!.traits)} · ${status}`),
      h('p', { className: 'hint' }, `Loves ${p.staff!.passions.map((w) => workLabel(this.sim, w).toLowerCase()).join(' and ')} · ${perHour(p.staff!.wage)} · ${p.staff!.daysOff.length > 0 ? `off ${p.staff!.daysOff.map((d) => WEEKDAYS[d]).join(', ')}` : 'no days off'}${p.staff!.stress >= STRESS_STRAINED ? ` · stress ${Math.round(p.staff!.stress)}%` : ''}`),
    );
    const card = h('div', { className: 'card person' }, portrait(p.look, 44, p.name), info);
    info.append(this.stationPicker(p));
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
      ...(hasFlat(this.sim) || p.staff!.livesIn ? [h('button', {
        type: 'button', 'aria-pressed': String(p.staff!.livesIn),
        onclick: () => {
          const err = setLivesIn(this.sim, p, !p.staff!.livesIn);
          if (err) this.hooks.notify(err, 'bad');
          this.render();
        },
      }, p.staff!.livesIn ? 'Lives in ✓' : 'Live in')] : []),
      h('button', {
        type: 'button', 'aria-pressed': String(p.staff!.lead),
        title: 'A shift lead steadies the team around them, for +£1.50 an hour',
        onclick: () => { setLead(this.sim, p.staff!.lead ? null : p); this.render(); },
      }, p.staff!.lead ? 'Lead ✓' : 'Lead'),
    ));
    return card;
  }

  private stationPicker(p: Pawn): HTMLElement {
    const label = (w: WorkType) => this.sim.venue.workLabels[w] ?? WORK_TYPES.find((x) => x.id === w)!.label;
    const select = h('select', {
      'aria-label': `${p.name}'s station`,
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        setStation(this.sim, p, v ? (v as WorkType) : null);
        this.onChange();
      },
    },
    h('option', { value: '' }, 'Anywhere'),
    ...WORK_TYPES.map((w) => h('option', { value: w.id }, label(w.id))));
    select.value = p.staff!.station ?? '';
    if (p.staff!.station) select.style.boxShadow = `inset 5px 0 0 ${WORK_COLOURS[p.staff!.station]}`;
    const rush = h('select', {
      'aria-label': `${p.name}'s station in a rush`,
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        setRushStation(p, v ? (v as WorkType) : null);
        this.onChange();
      },
    },
    h('option', { value: '' }, 'Same'),
    ...WORK_TYPES.map((w) => h('option', { value: w.id }, label(w.id))));
    rush.value = p.staff!.rushStation ?? '';
    if (p.staff!.rushStation) rush.style.boxShadow = `inset 5px 0 0 ${WORK_COLOURS[p.staff!.rushStation]}`;
    return h('div', { className: 'stations' },
      h('label', { className: 'station' }, 'Station', select),
      h('label', { className: 'station' }, 'In a rush', rush));
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
    const days = h('div', { className: 'choices days' }, ...WEEKDAYS.map((label, d) => h('button', {
      type: 'button', 'aria-pressed': String(p.staff!.daysOff.includes(d)), 'aria-label': `Off on ${label}`,
      onclick: () => {
        const off = p.staff!.daysOff.includes(d) ? p.staff!.daysOff.filter((x) => x !== d) : [...p.staff!.daysOff, d];
        const err = setDaysOff(p, off);
        if (err) this.hooks.notify(err, 'bad');
        this.render();
      },
    }, label)));
    return h('div', {},
      row('Starts', p.shift.start, nudge(-30, 0), nudge(30, 0)),
      row('Ends', p.shift.end, nudge(0, -30), nudge(0, 30)),
      h('p', { className: 'hint' }, 'Days off (a day off a week keeps stress down):'),
      days,
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

  constructor(private readonly sim: Sim, private readonly hooks: ManageHooks, startBuild: () => void, private readonly onLayoutChange: () => void = () => {}) {
    setupTabs(this.panel);
    el('cafe-open').addEventListener('click', () => {
      this.hooks.closePanels();
      this.render();
      this.panel.hidden = false;
    });
    el('cafe-close').addEventListener('click', () => {
      this.panel.hidden = true;
    });
    el('flat-build').addEventListener('click', () => {
      const err = buildStaffFlat(this.sim);
      this.hooks.notify(err ?? 'The staff flat is built. Set people to live in from their Team cards.', err ? 'bad' : 'good');
      this.hooks.refit?.();
      this.onLayoutChange();
      this.render();
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
    const n = stars(this.sim);
    el('standing-line').textContent = `${starText(n)} ${n < 5 ? `· ${Math.round(starProgress(this.sim) * 100)}% of the way to the next star` : '· top of the tree'}. Room for ${guestCapacity(this.sim)} customers (${seatCount(this.sim)} seats). Happy customers spread the word; walkouts and queues out the door undo it.`;
    el('machines').replaceChildren(...this.sim.state.objects.filter((o) => o.def === this.sim.venue.drinkStation).map((o) => {
      const wear = Math.round(machineWear(this.sim, o.id));
      return h('div', { className: 'card' },
        h('div', { className: 'top' }, h('strong', {}, objectDef(o.def).label), h('span', {}, `${wear}% worn`)),
        h('p', { className: 'hint' }, wear >= 70 ? 'Making worse drinks, and likely to break down.' : wear >= 40 ? 'Getting tired. Drinks are slipping a little.' : 'Running nicely.'),
        h('div', { className: 'row' }, h('button', {
          type: 'button', disabled: wear < 5,
          onclick: () => {
            const err = serviceMachine(this.sim, o.id);
            this.hooks.notify(err ?? 'Serviced. Good as new.', err ? 'bad' : 'good');
            this.render();
          },
        }, `Service ${pounds(SERVICE_COST)}`)));
    }));
    const flat = hasFlat(this.sim);
    el('flat-line').textContent = flat
      ? `${liveIns(this.sim).length} of ${beds(this.sim)} beds taken. Live-ins pay ${pounds(FLAT_RENT)} a night, never miss a shift to the commute, and spend their evenings with each other. Add beds and rooms in build mode (Staff flat floor).`
      : `The plot out back can be a flat for staff to live in: they pay a little rent, never miss a shift to the commute, and their life off the clock happens right here. Build it by hand in build mode (Staff flat floor, beds), or in one go for ${pounds(FLAT_COST)}.`;
    el('flat-row').hidden = flat;
    const wages = this.sim.state.pawns.filter((p) => p.staff && !p.staff.quit).reduce((sum, p) => sum + p.staff!.wage * ((p.shift.end - p.shift.start) / 60), 0);
    const debt = this.sim.state.money < 0
      ? ` You're in the red: 1% a day in overdraft fees, wages go out late below ${pounds(DEBT_LIMIT / 2)}, and below ${pounds(DEBT_LIMIT)} the bank won't lend for furniture or building work.`
      : '';
    el('costs-line').textContent = `Rent and rates ${pounds(dailyRent(this.sim))} a day (rates rise with the value of your fit-out). Wages about ${pounds(wages)} a day. Ingredients ${Math.round(INGREDIENT_SHARE * 100)}% of the usual price of everything made.${debt}`;
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

    el('goals').replaceChildren(...s.goals.filter((g) => !g.done && !g.failed).map((g) => h('div', { className: 'card' },
      h('div', { className: 'top' }, h('strong', {}, g.title), h('span', {}, pounds(g.reward))),
      h('p', { className: 'hint' }, `${g.detail}${g.byDay !== null ? ` By day ${g.byDay}.` : ''}`))));
    const upcoming = s.diary.slice().sort((a, b) => a.day - b.day);
    el('diary').replaceChildren(
      ...(upcoming.length === 0 ? [h('li', {}, 'Nothing booked yet. Big days are announced a few days ahead.')] : []),
      ...upcoming.map((d) => h('li', {}, h('span', {}, d.day === this.sim.day ? 'Today' : `${WEEKDAYS[weekday(d.day)]}, day ${d.day}`), d.title)),
    );
    const weeks = s.weeklyReports.slice().reverse();
    el('weeks').replaceChildren(
      ...(weeks.length === 0 ? [h('p', { className: 'hint' }, 'The first report comes at the end of the week.')] : []),
      ...weeks.map((w) => {
        const profit = weekProfit(w);
        return h('div', { className: 'card' },
          h('div', { className: 'top' }, h('strong', {}, `Week ${w.week}`), h('span', { className: profit >= 0 ? 'pos' : 'neg' }, `${profit >= 0 ? '+' : '−'}${pounds(Math.abs(profit))}`)),
          h('p', { className: 'hint' }, `Takings ${pounds(w.takings)} · wages ${pounds(w.wages)} · ingredients ${pounds(w.ingredients)} · rent ${pounds(w.rent)}${w.repairs ? ` · repairs ${pounds(w.repairs)}` : ''}${w.other ? ` · other ${pounds(w.other)}` : ''}`),
          h('p', { className: 'hint' }, `${w.served} served, ${w.walkouts} walked out · ${w.starsStart}★ → ${w.starsEnd}★`));
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
    const tolerance = priceTolerance(this.sim);
    const fine = tolerance > 1.001 ? `At ${starText(stars(this.sim))} people will pay up to ${Math.round((tolerance - 1) * 100)}% over the usual without minding.` : 'More stars and people will pay more.';
    el('price-hint').textContent = (ratio > tolerance + 0.04
      ? `Prices are ${Math.round((ratio - 1) * 100)}% above usual: more than people will happily pay, so fewer come and they grumble about value. `
      : ratio < 0.95
        ? `Prices are ${Math.round((1 - ratio) * 100)}% below usual: a little busier, but thinner margins. `
        : `Prices are ${ratio > 1.005 ? `${Math.round((ratio - 1) * 100)}% above usual` : 'at the usual level'}. `) + fine;
    const cooking = canCook(this.sim);
    this.list.replaceChildren(...this.sim.state.menu.map((m) => {
      const change = (fn: () => string | null) => () => {
        const err = fn();
        if (err) this.hooks.notify(err, 'bad');
        this.render();
      };
      const cls = m.price > m.basePrice ? 'price up' : m.price < m.basePrice ? 'price down' : 'price';
      return h('li', { className: m.enabled ? '' : 'off' },
        h('span', { className: 'name' }, m.name,
          // Hot food comes from the kitchen, and only while there's an oven and prep counter.
          m.kind === 'hot' ? h('small', { className: 'kitchen-tag' }, cooking ? 'Cooked in the kitchen' : 'Needs an oven and prep counter') : ''),
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
