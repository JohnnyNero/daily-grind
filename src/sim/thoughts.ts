// What tenants think, and how much they like living here.
//
// Liking is a baseline plus every thought a tenant has. Some thoughts are live, worked out
// from how things are right now (hungry, a grim flat, no toilet); others are memories that
// last a while (slept on the sofa, cooked a proper meal). Copies of the same memory count
// for less each time, so a run of good dinners doesn't buy endless goodwill. The liking
// shown eases towards the total, so one bad night is a dip, not a crash.

import { flatInfo, goingRate } from './economy';
import { expectGrade, expectThought } from './expectations';
import { SHARED, binsOverflowing, dirtOf, itemsIn, tempOf } from './environment';
import { flatScore, type FlatScore } from './impressiveness';
import { opinion } from './social';
import type { Sim } from './sim';
import { TICKS_PER_HOUR, type Life, type NeedId, type Pawn } from './state';
import { has } from './traits';
import { brokenIn } from './upkeep';
import { furnitureDef } from './defs';
import { BASELINE, EASY_GOING_BAD, HEARD, HOUSE_PROUD_TIER, ITEMS, KEEN_COOK_MEAL, LIVE_THOUGHTS as LIVE, MEMORIES, MISSING, NEED_THOUGHTS, RENT_THOUGHTS, STACK_FACTOR, TIER_THOUGHTS } from './tuning';

// The memories, need bands and what each thought is worth are in tuning.ts.
export { BASELINE, MEMORIES, type MemoryDef } from './tuning';

export interface Thought {
  label: string;
  value: number;
  /** A memory (with how many copies count) rather than how things are right now. */
  memory?: number;
}

/** Every thought a tenant has right now, live ones first, then memories (stacked). */
export function thoughtsOf(sim: Sim, p: Pawn): Thought[] {
  const life = p.life;
  if (!life) return [];
  const out: Thought[] = [];
  for (const [need, bands] of Object.entries(NEED_THOUGHTS) as [NeedId, (typeof NEED_THOUGHTS)[string]][]) {
    const band = bands.find((b) => life.needs[need] < b.under);
    if (band) out.push({ label: band.label, value: band.value });
  }
  const flat = sim.layout.flat(life.flat);
  if (!flat) out.push({ label: 'Their flat has no front door any more', value: LIVE.noFrontDoor });
  else {
    const score = flatScore(sim, flat.id);
    const tier = tierThought(score.tier, has(life, 'houseProud'));
    if (tier) out.push(tier);
    const grade = expectGrade(sim);
    const hoped = expectThought(score.tier, grade);
    if (hoped) out.push(hoped);
    out.push(...missingThoughts(score));
    if (!flat.enclosed) out.push({ label: 'Flat is open to the weather', value: LIVE.openToWeather });
    const lease = flatInfo(sim, flat.id).lease;
    const rent = lease ? rentThought(lease.rent, goingRate(sim, flat.id), grade) : null;
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
  if (tempOf(sim, flatId) > LIVE.tooHot.above) out.push({ label: 'Too hot in the flat', value: LIVE.tooHot.value });
  const dirt = dirtOf(sim, flatId);
  const proud = has(life, 'houseProud');
  if (!has(life, 'messy')) {
    if (dirt > LIVE.tip.above) out.push({ label: 'Flat\'s a tip', value: LIVE.tip.value });
    else if (proud && dirt > LIVE.couldBeCleaner.above) out.push({ label: 'Flat could be cleaner', value: LIVE.couldBeCleaner.value });
  }
  if (dirtOf(sim, SHARED) > LIVE.grubbyStairs.above) out.push({ label: 'Grubby stairwell', value: proud ? LIVE.grubbyStairs.houseProud : LIVE.grubbyStairs.value });
  if (binsOverflowing(sim)) out.push({ label: 'Bins overflowing', value: LIVE.binsOverflowing });
  if (itemsIn(sim, SHARED, 'intercom') > 0) out.push({ label: 'Intercom on the street door', value: ITEMS.intercomLikes });
  if (itemsIn(sim, SHARED, 'cctv') > 0) {
    if (has(life, 'knowsRights')) out.push({ label: 'Camera pointed at the lobby', value: ITEMS.cctvKnowsRights });
    else if (has(life, 'busybody')) out.push({ label: 'Can see who comes and goes', value: ITEMS.cctvBusybody });
  }
  if (life.pet && life.pet !== 'asked') out.push({ label: `Has ${life.pet}`, value: LIVE.hasPet });
  for (const f of brokenIn(sim, flatId).slice(0, LIVE.broken.most)) out.push({ label: `Broken ${furnitureDef(f.def).name.toLowerCase()}`, value: LIVE.broken.value });
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
    if (o.id === p.life!.partner && op > 0) out.push({ label: `In love with ${o.name.split(' ')[0]}`, value: LIVE.inLove });
    else if (op >= LIVE.friends.opinion) friends++;
    else if (op <= LIVE.rival.opinion) rivals.push({ label: `Can't stand ${o.name.split(' ')[0]}`, value: LIVE.rival.value });
  }
  if (friends > 0) out.push({ label: friends > 1 ? `Friends in the building ×${friends}` : 'A friend in the building', value: Math.min(LIVE.friends.most, friends * LIVE.friends.each) });
  out.push(...rivals.slice(0, LIVE.rival.most));
  return out;
}

/** What they think of the flat's tier. House-proud tenants feel it half as much again, both ways. */
export function tierThought(tier: string, houseProud: boolean): Thought | null {
  const v = TIER_THOUGHTS[tier];
  if (!v) return null;
  return { label: `Lives in a ${tier.toLowerCase()} flat${houseProud ? ' (house-proud)' : ''}`, value: houseProud ? Math.round(v * HOUSE_PROUD_TIER) : v };
}

/** What they think of the rent against the going rate for the flat. Tenants who expect more are quicker to call it steep and slower to call it fair. */
export function rentThought(rent: number, going: number, grade = 0): Thought | null {
  const r = rent / Math.max(1, going);
  const T = RENT_THOUGHTS;
  if (r < T.bargain.under - T.bargain.perGrade * grade) return { label: 'Rent is a bargain', value: T.bargain.value };
  if (r < T.fair.under - T.fair.perGrade * grade) return { label: 'Fair rent', value: T.fair.value };
  if (r <= T.ok.upTo - T.ok.perGrade * grade) return null;
  if (r <= T.steep.upTo) return { label: 'Rent is steep', value: T.steep.value };
  return { label: 'Daylight robbery', value: T.robbery };
}

/** What's missing from the flat. Also how an applicant sizes it up, so it's shared. */
export function missingThoughts(score: FlatScore): Thought[] {
  const out: Thought[] = [];
  if (!score.has.bed) out.push({ label: 'No bed', value: MISSING.bed });
  if (!score.has.toilet) out.push({ label: 'No toilet', value: MISSING.toilet });
  if (!score.has.wash) out.push({ label: 'Nowhere to wash', value: MISSING.wash });
  if (!score.has.kitchen) out.push({ label: 'No kitchen', value: MISSING.kitchen });
  if (score.perPerson < MISSING.crampedUnder) out.push({ label: 'Cramped', value: MISSING.cramped });
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
    if (each < 0 && has(life, 'easyGoing')) each *= EASY_GOING_BAD;
    if (id === 'cookedMeal' && has(life, 'keenCook')) each *= KEEN_COOK_MEAL;
    if (id === 'goodRead' && ITEMS.keenReaders.some((t) => has(life, t))) each *= ITEMS.keenReadingFeel;
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
