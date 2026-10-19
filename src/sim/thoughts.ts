// What tenants think, and how much they like living here.
//
// Liking is a baseline plus every thought a tenant has. Some thoughts are live, worked out
// from how things are right now (hungry, a grim flat, no toilet); others are memories that
// last a while (slept on the sofa, cooked a proper meal). Copies of the same memory count
// for less each time, so a run of good dinners doesn't buy endless goodwill. The liking
// shown eases towards the total, so one bad night is a dip, not a crash.

import { flatInfo, goingRate } from './economy';
import { SHARED, binsOverflowing, dirtOf, tempOf } from './environment';
import { flatScore, type FlatScore } from './impressiveness';
import { opinion } from './social';
import type { Sim } from './sim';
import { TICKS_PER_HOUR, type Life, type NeedId, type Pawn } from './state';
import { has } from './traits';
import { brokenIn } from './upkeep';
import { furnitureDef } from './defs';

export const BASELINE = 50;

export interface MemoryDef {
  label: string;
  value: number;
  hours: number;
  /** Most copies that count at once. */
  stack: number;
  /** Worth passing on: neighbours hear about it (at less than half the strength). */
  gossip?: boolean;
}

/** Hearing about something counts this much of living it. */
const HEARD = 0.4;

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
  rentRiseSmall: { label: 'Rent went up', value: -5, hours: 10 * 24, stack: 2, gossip: true },
  rentRiseBig: { label: 'Rent went up a lot', value: -12, hours: 14 * 24, stack: 2, gossip: true },
  rentCut: { label: 'Rent came down', value: 6, hours: 10 * 24, stack: 1, gossip: true },
  refusedHaggle: { label: 'Landlord wouldn\'t budge on rent', value: -6, hours: 7 * 24, stack: 1, gossip: true },
  agreedHaggle: { label: 'Got money off the rent', value: 6, hours: 7 * 24, stack: 1, gossip: true },
  letOffSteam: { label: 'Let off steam', value: 8, hours: 2 * 24, stack: 1 },
  landlordListened: { label: 'Landlord listened', value: 4, hours: 5 * 24, stack: 2, gossip: true },
  landlordShrugged: { label: 'Landlord couldn\'t care less', value: -4, hours: 5 * 24, stack: 2, gossip: true },
  ignored: { label: 'Landlord ignored the chat', value: -5, hours: 5 * 24, stack: 2, gossip: true },
  wearAJumper: { label: 'Told to wear a jumper', value: -6, hours: 5 * 24, stack: 1, gossip: true },
  toldOff: { label: 'Landlord had a word about the noise', value: -5, hours: 5 * 24, stack: 1 },
  gotPet: { label: 'Got a pet', value: 8, hours: 10 * 24, stack: 1 },
  noPet: { label: 'Not allowed a pet', value: -6, hours: 7 * 24, stack: 1, gossip: true },
  sawRow: { label: 'Saw a row on the stairs', value: -3, hours: 24, stack: 2, gossip: true },
  keptAwake: { label: 'Kept awake by the neighbours', value: -6, hours: 14, stack: 3 },
  friendLeft: { label: 'A friend moved out', value: -6, hours: 7 * 24, stack: 2 },
  brokeUp: { label: 'Broke up', value: -12, hours: 7 * 24, stack: 1 },
  paysMore: { label: 'Pays more than next door', value: -6, hours: 7 * 24, stack: 1 },
  buildersIn: { label: 'Builders in the flat', value: -3, hours: 12, stack: 2 },
  doneUp: { label: 'Flat got done up', value: 6, hours: 5 * 24, stack: 1, gossip: true },
  threwParty: { label: 'Threw a party', value: 6, hours: 2 * 24, stack: 1 },
  goodParty: { label: 'Went to a good party', value: 5, hours: 24, stack: 1 },
  partyShutDown: { label: 'Party got shut down', value: -6, hours: 3 * 24, stack: 1 },
  sawFight: { label: 'Saw a fight on the stairs', value: -8, hours: 3 * 24, stack: 2, gossip: true },
  brokeItUp: { label: 'Got between a fight', value: -5, hours: 24, stack: 1 },
  cantStand: { label: 'Can\'t stand being in the same building as them', value: -4, hours: 48, stack: 1 },
  attemptedBreakIn: { label: 'Someone tried to break in', value: -3, hours: 3 * 24, stack: 1, gossip: true },
  burgled: { label: 'Got burgled', value: -15, hours: 10 * 24, stack: 1, gossip: true },
  cheatedOn: { label: 'Got cheated on', value: -15, hours: 10 * 24, stack: 1 },
  caughtOut: { label: 'Got found out', value: -6, hours: 4 * 24, stack: 1 },
  notAsAdvertised: { label: 'Not what the listing said', value: -8, hours: 7 * 24, stack: 1 },
  betterThanExpected: { label: 'Better than the listing said', value: 5, hours: 7 * 24, stack: 1 },
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
  warmth: [
    { under: 0.25, label: 'Freezing in the flat', value: -10 },
    { under: 0.5, label: 'Cold flat', value: -5 },
  ],
  quiet: [
    { under: 0.3, label: 'Can\'t hear yourself think', value: -6 },
    { under: 0.55, label: 'Noisy neighbours', value: -3 },
  ],
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
    out.push(...placeThoughts(sim, life, flat.id));
  }
  out.push(...peopleThoughts(sim, p));
  out.push(...memoryThoughts(sim, life));
  return out;
}

/** The building around them: heat, dirt, the bins, the stairwell. */
function placeThoughts(sim: Sim, life: Life, flatId: string): Thought[] {
  const out: Thought[] = [];
  if (tempOf(sim, flatId) > 26) out.push({ label: 'Too hot in the flat', value: -3 });
  const dirt = dirtOf(sim, flatId);
  const proud = has(life, 'houseProud');
  if (!has(life, 'messy')) {
    if (dirt > 0.6) out.push({ label: 'Flat\'s a tip', value: -4 });
    else if (proud && dirt > 0.3) out.push({ label: 'Flat could be cleaner', value: -4 });
  }
  if (dirtOf(sim, SHARED) > 0.5) out.push({ label: 'Grubby stairwell', value: proud ? -5 : -3 });
  if (binsOverflowing(sim)) out.push({ label: 'Bins overflowing', value: -3 });
  if (life.pet && life.pet !== 'asked') out.push({ label: `Has ${life.pet}`, value: 3 });
  for (const f of brokenIn(sim, flatId).slice(0, 3)) out.push({ label: `Broken ${furnitureDef(f.def).name.toLowerCase()}`, value: -3 });
  return out;
}

/** Friends, enemies and a partner in the building. */
function peopleThoughts(sim: Sim, p: Pawn): Thought[] {
  const out: Thought[] = [];
  let friends = 0;
  const rivals: Thought[] = [];
  for (const o of sim.state.pawns) {
    if (o === p || !o.life || o.life.leaving) continue;
    const op = opinion(sim, p, o);
    if (o.id === p.life!.partner && op > 0) out.push({ label: `In love with ${o.name.split(' ')[0]}`, value: 6 });
    else if (op >= 30) friends++;
    else if (op <= -30) rivals.push({ label: `Can't stand ${o.name.split(' ')[0]}`, value: -3 });
  }
  if (friends > 0) out.push({ label: friends > 1 ? `Friends in the building ×${friends}` : 'A friend in the building', value: Math.min(5, friends * 1.5) });
  out.push(...rivals.slice(0, 3));
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
  // Grouped by what it was, its words, and whether they lived it or heard about it.
  const groups = new Map<string, { id: string; label: string; heard: boolean; n: number }>();
  for (const m of life.memories) {
    const def = MEMORIES[m.id];
    if (!def || now - m.at >= def.hours * TICKS_PER_HOUR) continue;
    const heard = m.from !== undefined;
    const label = m.note ?? def.label;
    const k = `${m.id}|${label}|${heard}`;
    const g = groups.get(k) ?? { id: m.id, label: heard ? `Heard: ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label, heard, n: 0 };
    g.n++;
    groups.set(k, g);
  }
  const out: Thought[] = [];
  for (const { id, label, heard, n } of groups.values()) {
    const def = MEMORIES[id];
    const count = Math.min(n, def.stack);
    // Easy-going people let bad things go; keen cooks love a proper meal.
    let each = def.value;
    if (each < 0 && has(life, 'easyGoing')) each *= 0.75;
    if (id === 'cookedMeal' && has(life, 'keenCook')) each *= 2;
    if (heard) each *= HEARD;
    let value = 0;
    for (let i = 0; i < count; i++) value += each * STACK_FACTOR ** i;
    out.push({ label: count > 1 ? `${label} ×${count}` : label, value: Math.round(value * 10) / 10, memory: count });
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
