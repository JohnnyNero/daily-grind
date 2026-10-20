// The little card that comes up when you tap a piece of furniture: what it is, what it's
// for, who's using it, and buttons to move it, turn it round or sell it.

import { furnitureDef, isGraded } from '../sim/defs';
import { pounds } from '../sim/economy';
import { resaleOf, sellFurniture, turnFurniture } from '../sim/furnish';
import { GRADE_NAMES, gradeOf, gradedName, poshLockedWhy, poshUnlocked, upgradeCost, upgradeFurniture, upgradesFor } from '../sim/grades';
import type { Sim } from '../sim/sim';
import type { Furniture, Grade, NeedId } from '../sim/state';
import { el, h } from './dom';
import { condition, mend, repairCost } from '../sim/upkeep';

const FOR: Record<NeedId, string> = {
  sleep: 'sleeping',
  food: 'eating',
  hygiene: 'washing',
  bladder: 'the loo',
  fun: 'something to do',
  comfort: 'sitting comfortably',
  warmth: 'warmth',
  quiet: 'quiet',
};

/** What a piece is for, in a few words. */
function useOf(def: string): string {
  const d = furnitureDef(def);
  if (def === 'radiator') return 'Heats the flat (with the boiler on)';
  if (def === 'lamp') return 'Lights the flat in the evening';
  if (def === 'bins') return 'Where the rubbish goes';
  if (def === 'washer') return 'For doing the washing, in the flat or the laundry room';
  if (def === 'bikeRack') return 'Somewhere to keep a bike';
  if (def === 'bbq') return 'For barbecues';
  if (def === 'doormat') return 'Keeps the muck off the floors';
  if (def === 'dishwasher') return 'Nobody has to wash up. Hums after tea';
  if (def === 'console') return 'Needs a telly in the room. Loud, and worth nicking';
  if (def === 'bigTv') return 'A bigger telly for the sofa and armchair. Louder, and worth nicking';
  if (def === 'bookshelf') return 'Something to read. Quiet';
  if (def === 'diningSet') return 'Somewhere to eat, table and chairs in one';
  if (def === 'rug') return 'Soaks up noise going down to the flat below. Lies under other furniture';
  if (def === 'curtains') return 'A darker bedroom';
  if (def === 'smokeAlarm') return 'The council checks every let flat has one';
  if (def === 'cctv') return 'A camera on the lobby or stairs';
  if (def === 'intercom') return 'By the street door, so tenants can see who\'s buzzing';
  if (d.offers?.length) {
    const uses = d.offers.map((o) => (o.needsNearby ? `${FOR[o.need]} (with a ${furnitureDef(o.needsNearby).name.toLowerCase()})` : FOR[o.need]));
    return `For ${[...new Set(uses)].join(', ')}`;
  }
  if (d.decor) return 'Decoration: makes the flat look lived in';
  if (def === 'tv') return 'Something to watch from the sofa';
  if (def === 'table') return 'Somewhere to eat, with a chair';
  return 'Makes the flat look furnished';
}

export class FurnitureCard {
  private card = el('furn-card');
  private id: number | null = null;
  private selling = false;
  /** Says how something went (a repair you couldn't afford). */
  onNotify: (text: string, bad?: boolean) => void = () => {};
  /** Move was pressed. */
  onMove: (id: number) => void = () => {};
  /** It was turned or sold (or the card closed). */
  onChange: () => void = () => {};

  constructor(private readonly sim: Sim) {}

  get showing(): number | null {
    return this.id;
  }

  show(id: number): void {
    this.id = id;
    this.selling = false;
    this.render();
    this.card.hidden = false;
  }

  hide(): void {
    if (this.id === null) return;
    this.id = null;
    this.card.hidden = true;
    this.onChange();
  }

  render(): void {
    const f = this.sim.state.furniture.find((o) => o.id === this.id);
    if (!f) {
      this.hide();
      return;
    }
    const d = furnitureDef(f.def);
    const flat = this.sim.layout.flatAt(f.x, f.s)?.name ?? 'Shared space';
    const user = this.sim.state.pawns.find((p) => p.life?.using?.furniture === f.id && p.life.using.until > 0);
    const grade = gradeOf(f);
    const resale = resaleOf(f.def, grade);
    this.card.replaceChildren(
      h(
        'div',
        { class: 'head' },
        h('div', {}, h('strong', {}, gradedName(f)), h('span', {}, `${flat} · ${user ? `${user.name.split(' ')[0]} is using it` : 'nobody using it'}`)),
        h('button', { type: 'button', class: 'close', 'aria-label': 'Close', onclick: () => this.hide() }, '✕'),
      ),
      h('p', {}, `${useOf(f.def)}.${isGraded(f.def) ? ` ${GRADE_WORDS[grade]}` : ''}`),
      d.offers ? h('p', { class: f.broken !== undefined ? 'cond bad' : 'cond' }, f.broken !== undefined ? `Broken since day ${f.broken}: nobody can use it.` : `Condition: ${condition(f)}.`) : '',
      this.upgrades(f),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'primary', onclick: () => this.onMove(f.id) }, 'Move'),
        h('button', { type: 'button', onclick: () => {
          turnFurniture(this.sim, f.id);
          this.onChange();
        } }, 'Turn'),
        (d.offers || f.broken !== undefined) && (f.broken !== undefined || (f.wear ?? 0) >= 0.5)
          ? h('button', { type: 'button', class: f.broken !== undefined ? 'primary' : '', onclick: () => {
              const problem = mend(this.sim, f.id);
              if (problem) this.onNotify(problem, true);
              this.render();
              this.onChange();
            } }, `${f.broken !== undefined ? 'Mend' : 'Service'} ${pounds(repairCost(f))}`)
          : '',
        h('button', { type: 'button', class: this.selling ? 'danger' : '', onclick: () => {
          if (!this.selling) {
            this.selling = true;
            this.render();
            return;
          }
          sellFurniture(this.sim, f.id);
          this.hide();
        } }, this.selling ? `Sure? ${pounds(resale)} back` : `Sell ${pounds(resale)}`),
      ),
    );
  }

  /** Upgrade buttons: pay the difference and it's swapped for a new one where it stands. Posh says what it takes while it's locked. */
  private upgrades(f: Furniture): HTMLElement | string {
    const ups = upgradesFor(f);
    if (ups.length === 0) return '';
    const open = poshUnlocked(this.sim);
    return h(
      'div',
      { class: 'actions upgrades' },
      ...ups.map((g) => {
        const locked = g === 'posh' && !open;
        const cost = upgradeCost(f, g);
        return h('button', {
          type: 'button',
          class: g === 'posh' ? 'posh' : '',
          disabled: locked || this.sim.state.money < cost,
          title: locked ? poshLockedWhy() : undefined,
          onclick: () => {
            const problem = upgradeFurniture(this.sim, f.id, g);
            if (problem) this.onNotify(problem, true);
            else this.onNotify(`Swapped for a ${GRADE_NAMES[g].toLowerCase()} ${furnitureDef(f.def).name.toLowerCase()}.`);
            this.render();
            this.onChange();
          },
        }, locked ? `Posh: locked` : `Upgrade to ${GRADE_NAMES[g].toLowerCase()} (${pounds(cost)})`);
      }),
      ...(ups.includes('posh') && !open ? [h('small', { class: 'why' }, `${poshLockedWhy()}.`)] : []),
    );
  }
}

/** What a grade means, for the card. */
const GRADE_WORDS: Record<Grade, string> = {
  cheap: 'Cheap: wears out quickly and looks it.',
  standard: 'Standard: does the job.',
  posh: 'Posh: lasts, and impresses. Burglars like it too.',
};
