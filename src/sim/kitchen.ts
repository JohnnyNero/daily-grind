// The kitchen: hot food cooked to order. A cook preps it at a prep counter, cooks it in an
// oven and carries it out to the pickup. No oven or prep counter, no hot food on offer.

import type { Sim } from './sim';
import type { ObjectInst } from './state';

export const KITCHEN_KIT = { oven: 'oven', prep: 'prep' } as const;

function usable(sim: Sim, def: string): ObjectInst[] {
  return sim.state.objects.filter((o) => o.def === def && sim.world.spots(o).some(([x, y]) => sim.world.passable(x, y)));
}

/** There's an oven and a prep counter someone can stand at. */
export function canCook(sim: Sim): boolean {
  return usable(sim, KITCHEN_KIT.oven).length > 0 && usable(sim, KITCHEN_KIT.prep).length > 0;
}

/** Hot food waiting to be cooked. */
export function hotBacklog(sim: Sim): number {
  return sim.state.orders.reduce((n, o) => n + o.items.filter((i) => i.status === 'todo' && i.kind === 'hot').length, 0);
}

/** Hot dishes on the menu right now (on, and the kitchen can make them). */
export function hotOnMenu(sim: Sim): boolean {
  return canCook(sim) && sim.state.menu.some((m) => m.enabled && m.kind === 'hot');
}
