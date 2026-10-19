// The little card that comes up when you tap a piece of furniture: what it is, what it's
// for, who's using it, and buttons to move it, turn it round or sell it.

import { furnitureDef } from '../sim/defs';
import { pounds } from '../sim/economy';
import { resaleOf, sellFurniture, turnFurniture } from '../sim/furnish';
import type { Sim } from '../sim/sim';
import type { NeedId } from '../sim/state';
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
  if (def === 'bikeRack') return 'Somewhere to keep the bike; working tenants sometimes cycle';
  if (def === 'bbq') return 'For barbecues: whoever fires it up, the neighbours come';
  if (def === 'doormat') return 'Keeps the muck off the floors';
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
    const resale = resaleOf(f.def);
    this.card.replaceChildren(
      h(
        'div',
        { class: 'head' },
        h('div', {}, h('strong', {}, d.name), h('span', {}, `${flat} · ${user ? `${user.name.split(' ')[0]} is using it` : 'nobody using it'}`)),
        h('button', { type: 'button', class: 'close', 'aria-label': 'Close', onclick: () => this.hide() }, '✕'),
      ),
      h('p', {}, `${useOf(f.def)}. Adds ${d.value} to how furnished the flat is.`),
      d.offers ? h('p', { class: f.broken !== undefined ? 'cond bad' : 'cond' }, f.broken !== undefined ? `Broken since day ${f.broken}: nobody can use it.` : `Condition: ${condition(f)}.`) : '',
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'primary', onclick: () => this.onMove(f.id) }, 'Move'),
        h('button', { type: 'button', onclick: () => {
          turnFurniture(this.sim, f.id);
          this.onChange();
        } }, 'Turn'),
        d.offers && (f.broken !== undefined || (f.wear ?? 0) >= 0.5)
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
}
