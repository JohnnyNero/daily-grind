// What tenants think, and how much they like living here.
//
// Liking is a baseline plus every thought a tenant has. Some thoughts are live, worked out
// from how things are right now (hungry, a grim flat, no toilet); others are memories that
// last a while (slept on the sofa, cooked a proper meal). Copies of the same memory count
// for less each time, so a run of good dinners doesn't buy endless goodwill. The liking
// shown eases towards the total, so one bad night is a dip, not a crash.

import { flatInfo, goingRate } from './economy';
import { flatScore, type FlatScore } from './impressiveness';
import type { Sim } from './sim';
import { TICKS_PER_HOUR, type Life, type NeedId, type Pawn } from './state';
import { has } from './traits';

export const BASELINE = 50;

export interface MemoryDef {
  label: string;
  value: number;
  hours: number;
  /** Most copies that count at once. */
  stack: number;
}

/** Each extra copy of a memory counts this much of the one before. */
const STACK_FACTOR = 0.75;

export const MEMORIES: Record<string, MemoryDef> = {
  sleptWell: { label: 'Slept well', value: 3, hours: 10, stack: 1 },
  sleptSofa: { label: 'Slept on the sofa', value: -4, hours: 12, stack: 2 },
  sleptFloor: { label: 'Slept on the floor', value: -8, hours: 14, stack: 2 },
  cookedMeal: { label: 'Cooked a proper meal', value: 3, hours: 8, stack: 2 },
  ateAtTable: { label: 'Ate at the table', value: 1, hours: 6, stack: 2 },
  ateStanding: { label: 'Ate standing up', value: -2, hours: 6, stack: 2 },
  fridgeDinner: { label: 'Had tea out of the fridge', value: -2, hours: 8, stack: 2 },
  longBath: { label: 'Had a long bath', value: 4, hours: 8, stack: 1 },
  commute: { label: 'Grim commute', value: -2, hours: 3, stack: 1 },
  newPlace: { label: 'New place', value: 5, hours: 5 * 24, stack: 1 },
  rentRiseSmall: { label: 'Rent went up', value: -5, hours: 10 * 24, stack: 2 },
  rentRiseBig: { label: 'Rent went up a lot', value: -12, hours: 14 * 24, stack: 2 },
  rentCut: { label: 'Rent came down', value: 6, hours: 10 * 24, stack: 1 },
  refusedHaggle: { label: 'Landlord wouldn\'t budge on rent', value: -6, hours: 7 * 24, stack: 1 },
  agreedHaggle: { label: 'Got money off the rent', value: 6, hours: 7 * 24, stack: 1 },
  letOffSteam: { label: 'Let off steam', value: 8, hours: 2 * 24, stack: 1 },
};

export interface Thought {
  label: string;
  value: number;
  /** A memory (with how many copies count) rather than how things are right now. */
  memory?: number;
}

/** Need bands: below `under`, this thought. Lowest band first. */
const NEED_THOUGHTS: Record<NeedId, { under: number; label: string; value: number }[]> = {
  sleep: [
    { under: 0.12, label: 'Exhausted', value: -10 },
    { under: 0.3, label: 'Tired', value: -4 },
  ],
  food: [
    { under: 0.1, label: 'Starving', value: -12 },
    { under: 0.3, label: 'Hungry', value: -5 },
  ],
  hygiene: [{ under: 0.15, label: 'Feels grubby', value: -6 }],
  bladder: [{ under: 0.1, label: 'Bursting for the loo', value: -8 }],
  fun: [
    { under: 0.12, label: 'Bored stiff', value: -6 },
    { under: 0.3, label: 'Bored', value: -2 },
  ],
  comfort: [{ under: 0.2, label: 'Uncomfortable', value: -4 }],
};

/** What a flat's impressiveness tier does to how its tenants feel. Ordinary flats do nothing. */
const TIER_THOUGHTS: Record<string, number> = { Grim: -10, Shabby: -5, Plain: 0, Decent: 3, Nice: 6, Smart: 9, Impressive: 12 };

/** Every thought a tenant has right now, live ones first, then memories (stacked). */
export function thoughtsOf(sim: Sim, p: Pawn): Thought[] {
  const life = p.life;
  if (!life) return [];
  const out: Thought[] = [];
  for (const [need, bands] of Object.entries(NEED_THOUGHTS) as [NeedId, (typeof NEED_THOUGHTS)[NeedId]][]) {
    const band = bands.find((b) => life.needs[need] < b.under);
    if (band) out.push({ label: band.label, value: band.value });
  }
  const flat = sim.layout.flat(life.flat);
  if (!flat) out.push({ label: 'Their flat has no front door any more', value: -20 });
  else {
    const score = flatScore(sim, flat.id);
    const tier = tierThought(score.tier, has(life, 'houseProud'));
    if (tier) out.push(tier);
    out.push(...missingThoughts(score));
    if (!flat.enclosed) out.push({ label: 'Flat is open to the weather', value: -20 });
    const lease = flatInfo(sim, flat.id).lease;
    const rent = lease ? rentThought(lease.rent, goingRate(sim, flat.id)) : null;
    if (rent) out.push(rent);
  }
  out.push(...memoryThoughts(sim, life));
  return out;
}

/** What they think of the flat's tier. House-proud tenants feel it half as much again, both ways. */
export function tierThought(tier: string, houseProud: boolean): Thought | null {
  const v = TIER_THOUGHTS[tier];
  if (!v) return null;
  return { label: `Lives in a ${tier.toLowerCase()} flat${houseProud ? ' (house-proud)' : ''}`, value: houseProud ? Math.round(v * 1.5) : v };
}

/** What they think of the rent against the going rate for the flat. */
export function rentThought(rent: number, going: number): Thought | null {
  const r = rent / Math.max(1, going);
  if (r < 0.8) return { label: 'Rent is a bargain', value: 6 };
  if (r < 0.95) return { label: 'Fair rent', value: 2 };
  if (r <= 1.1) return null;
  if (r <= 1.3) return { label: 'Rent is steep', value: -6 };
  return { label: 'Daylight robbery', value: -14 };
}

function missingThoughts(score: FlatScore): Thought[] {
  const out: Thought[] = [];
  if (!score.has.bed) out.push({ label: 'No bed', value: -12 });
  if (!score.has.toilet) out.push({ label: 'No toilet', value: -15 });
  if (!score.has.wash) out.push({ label: 'Nowhere to wash', value: -8 });
  if (!score.has.kitchen) out.push({ label: 'No kitchen', value: -6 });
  if (score.perPerson < 5) out.push({ label: 'Cramped', value: -5 });
  return out;
}

function memoryThoughts(sim: Sim, life: Life): Thought[] {
  const now = sim.state.tick;
  const groups = new Map<string, number>();
  for (const m of life.memories) {
    const def = MEMORIES[m.id];
    if (!def || now - m.at >= def.hours * TICKS_PER_HOUR) continue;
    groups.set(m.id, (groups.get(m.id) ?? 0) + 1);
  }
  const out: Thought[] = [];
  for (const [id, n] of groups) {
    const def = MEMORIES[id];
    const count = Math.min(n, def.stack);
    // Easy-going people let bad things go; keen cooks love a proper meal.
    let each = def.value;
    if (each < 0 && has(life, 'easyGoing')) each *= 0.75;
    if (id === 'cookedMeal' && has(life, 'keenCook')) each *= 2;
    let value = 0;
    for (let i = 0; i < count; i++) value += each * STACK_FACTOR ** i;
    out.push({ label: count > 1 ? `${def.label} ×${count}` : def.label, value: Math.round(value * 10) / 10, memory: count });
  }
  return out;
}

/** The liking a tenant's thoughts add up to (0 to 100). */
export function likingTarget(thoughts: readonly Thought[]): number {
  return Math.max(0, Math.min(100, BASELINE + thoughts.reduce((n, t) => n + t.value, 0)));
}

export function remember(sim: Sim, life: Life, id: string): void {
  life.memories.push({ id, at: sim.state.tick });
}

/** Drops memories that have run out. */
export function forget(sim: Sim, life: Life): void {
  const now = sim.state.tick;
  life.memories = life.memories.filter((m) => {
    const def = MEMORIES[m.id];
    return def !== undefined && now - m.at < def.hours * TICKS_PER_HOUR;
  });
}
