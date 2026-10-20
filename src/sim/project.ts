// Always a project (spec 4): something visible to save for, one at a time. Picked from the
// real building in order (the list's bare flat; the stripped flat from week two; locks; a
// laundry, bike store or garden; insulation where the noise is worst; posh furniture once it
// opens). The player can pin a different one (State.project.pinned).
//
// Costs are what the thing would cost to buy, close enough to save towards. Nothing here
// changes the game: the bar only points at what's worth doing next.

import { scoreFor } from './impressiveness';
import { CELL_PRICE, POUND, billsDue, flatInfo, furniturePrice } from './economy';
import { INSULATE_PRICE, LOCKS_PRICE, PROJECT } from './tuning';
import { noiseMade, noiseReaching } from './environment';
import { amenities } from './shared';
import type { Sim } from './sim';

export interface Project {
  /** Stable, for pinning: 'furnish:flat-3', 'locks', 'insulate:flat-2'. */
  id: string;
  /** "Furnish Flat 3". */
  label: string;
  /** What it costs, in pence. */
  cost: number;
  /** Where Build should open for it, if anywhere. */
  flat?: string;
  /** What it needs, in a line, for when you tap the bar. */
  needs: string;
}

/** The pieces a flat has to have before anyone will live in it. */
const BASICS: { def: string; label: string; has: 'bed' | 'toilet' | 'wash' | 'kitchen' }[] = [
  { def: 'bed', label: 'a bed', has: 'bed' },
  { def: 'toilet', label: 'a loo', has: 'toilet' },
  { def: 'shower', label: 'a shower', has: 'wash' },
  { def: 'cooker', label: 'a cooker', has: 'kitchen' },
];

const sentence = (parts: string[]) => (parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** Furnishing a flat so it lets: what's missing and what that costs. Null if it has the lot. */
function furnish(sim: Sim, flatId: string): Project | null {
  const flat = sim.layout.flat(flatId);
  if (!flat || flatInfo(sim, flatId).lease) return null;
  const has = scoreFor(sim, flatId, 1).has;
  const missing = BASICS.filter((b) => !has[b.has]);
  if (missing.length === 0) return null;
  const cost = missing.reduce((n, b) => n + furniturePrice(b.def), 0);
  return { id: `furnish:${flatId}`, label: `furnish ${flat.name}`, cost, flat: flatId, needs: `${flat.name} needs ${sentence(missing.map((b) => b.label))}.` };
}

/** The stripped flat, split in two (the handover's idea for week two): a wall, two doors and the basics twice. */
function split(sim: Sim): Project | null {
  const h = sim.state.handover;
  if (sim.day < 8 || !h.gutted) return null;
  const flat = sim.layout.flat(h.gutted);
  if (!flat || flatInfo(sim, flat.id).lease) return null;
  // Once it has the basics (or has been split, so its id has moved on) there's nothing left to save for.
  const has = scoreFor(sim, flat.id, 1).has;
  if (has.bed && has.toilet && has.wash && has.kitchen) return null;
  const basics = BASICS.reduce((n, b) => n + furniturePrice(b.def), 0);
  const cost = 2 * basics + 2 * CELL_PRICE.flatDoor + 4 * CELL_PRICE.wall;
  return { id: `split:${flat.id}`, label: `split ${flat.name} in two`, cost, flat: flat.id, needs: `A wall down the middle, a front door each, and a bed, loo, shower and cooker in both halves.` };
}

function locks(sim: Sim): Project | null {
  if (sim.state.security.locks) return null;
  return { id: 'locks', label: 'fit better locks', cost: LOCKS_PRICE, needs: 'Locks on the street door: Build, then Security.' };
}

/** A laundry, then a bike store, then a garden: whichever you haven't got. */
function shared(sim: Sim): Project | null {
  const have = amenities(sim);
  if (!have.laundry) return { id: 'laundry', label: 'build a laundry', cost: furniturePrice('washer'), needs: 'A washing machine in a shared room.' };
  if (!have.bikes) return { id: 'bikes', label: 'build a bike store', cost: furniturePrice('bikeRack'), needs: 'A bike rack in a shared room.' };
  if (!have.garden) return { id: 'garden', label: 'make a garden', cost: furniturePrice('bench'), needs: 'A bench or two, out in the open.' };
  return null;
}

/** Insulation for the let flat with the most noise coming in. Null if nobody's bothered. */
function insulate(sim: Sim): Project | null {
  const made = noiseMade(sim);
  let worst: { id: string; amount: number } | null = null;
  for (const f of sim.layout.flats) {
    if (!flatInfo(sim, f.id).lease) continue;
    const amount = noiseReaching(sim, made, f.id).amount;
    if (amount > 0 && (!worst || amount > worst.amount)) worst = { id: f.id, amount };
  }
  if (!worst) return null;
  const flat = sim.layout.flat(worst.id)!;
  return { id: `insulate:${worst.id}`, label: `insulate ${flat.name}`, cost: 3 * INSULATE_PRICE, flat: worst.id, needs: `${flat.name} hears its neighbours. Insulate the walls it shares.` };
}

/** Posh furniture, once it's open, for the best let flat. */
function posh(sim: Sim): Project | null {
  if (sim.state.poshFrom === undefined) return null;
  const best = sim.layout.flats.filter((f) => flatInfo(sim, f.id).lease).sort((a, b) => scoreFor(sim, b.id, 1).score - scoreFor(sim, a.id, 1).score)[0];
  if (!best) return null;
  return { id: `posh:${best.id}`, label: `posh furniture for ${best.name}`, cost: furniturePrice('sofa', 'posh') + furniturePrice('bed', 'posh'), flat: best.id, needs: `A posh bed and sofa in ${best.name}.` };
}

/** Everything worth saving for now, in the order it's offered. */
export function projects(sim: Sim): Project[] {
  const h = sim.state.handover;
  const out: (Project | null)[] = [h.fit ? furnish(sim, h.fit) : null, split(sim)];
  // Any other bare flat that's still waiting for its basics.
  for (const f of sim.layout.flats) if (f.id !== h.fit) out.push(furnish(sim, f.id));
  out.push(locks(sim), shared(sim), insulate(sim), posh(sim));
  const seen = new Set<string>();
  return out.filter((p): p is Project => {
    if (!p || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

/** The project now: the pinned one if it still makes sense, else the first in order. Null if there's nothing to save for. */
export function nextProject(sim: Sim): Project | null {
  const all = projects(sim);
  const pinned = sim.state.project.pinned;
  return (pinned ? all.find((p) => p.id === pinned) : undefined) ?? all[0] ?? null;
}

/** Days until you can afford it, guessing from this week's rent less the bills; null if never at this rate. */
export function projectEta(sim: Sim, p: Project): number | null {
  const st = sim.state;
  if (st.money >= p.cost) return 0;
  const rent = sim.layout.flats.reduce((n, f) => n + (flatInfo(sim, f.id).lease?.rent ?? 0), 0);
  const net = rent - billsDue(sim) - st.mortgage.payment;
  if (net <= 0) return null;
  const days = Math.ceil(((p.cost - st.money) / net) * 7);
  return days > PROJECT.horizonWeeks * 7 ? null : days;
}

/** Pins a project by id, or unpins (undefined). */
export function pinProject(sim: Sim, id: string | undefined): void {
  if (id === undefined) delete sim.state.project.pinned;
  else sim.state.project.pinned = id;
}

/** "Next: furnish Flat 3. £340 of £610. About 9 days." */
export function projectLine(sim: Sim, p: Project): string {
  const have = Math.max(0, Math.min(sim.state.money, p.cost));
  const eta = projectEta(sim, p);
  const when = eta === null ? '' : eta === 0 ? ' You can afford it.' : eta === 1 ? ' About a day.' : ` About ${eta} days.`;
  return `Next: ${p.label}. £${Math.floor(have / POUND)} of £${Math.round(p.cost / POUND)}.${when}`;
}
