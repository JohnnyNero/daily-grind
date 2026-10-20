// Who lives where (docs/specs/layout.md section 4). Some tenants have a need that reads off
// the layout and the neighbours: the night worker who sleeps by day, the musician, the
// family with a baby, the old man who won't climb, the light sleeper, the dog. A need comes
// from their hours, their traits, or their circumstances (`circs`: a baby, bad knees, a dog).
//
// The same flat suits one and not another, and lives change: a baby arrives, a job goes to
// nights. What a flat is like for each need is a short list of facts, for the applicant's
// card and the map; how they take it is a labelled thought, like every other.
//
// What the layout is like (a telly through the wall, the stairs, how warm, how damp) is read
// through `READINGS`, flat by flat today. Noise and heat by room (L2, L3) swap it at merge.

import { flatInfo } from './economy';
import { SHARED, itemsIn, noiseThrough, tempOf } from './environment';
import { hasFlag } from './flags';
import { random, type RngHolder } from './rng';
import { flatKind } from './rooms';
import { amenities } from './shared';
import type { Sim } from './sim';
import { BASE, STOREY } from './start';
import { TICKS_PER_HOUR, type Applicant, type Circ, type HouseholdKind, type Life, type Person, type Schedule } from './state';
import type { Thought } from './thoughts';
import { DAMP, FIT, NEEDS as NEED_RATES, SCHEDULES } from './tuning';
import { roomTemp as roomTempL3 } from './heat';
import { roomDamp as roomDampL3 } from './damp';

export type FitNeed = 'nights' | 'musician' | 'baby' | 'wontClimb' | 'lightSleeper' | 'dog';

/** What each need is called, and the icon it wears on the map (art.ts). */
export const NEEDS: Record<FitNeed, { name: string; icon: string }> = {
  nights: { name: 'Works nights', icon: 'zz' },
  musician: { name: 'Musician', icon: 'music' },
  baby: { name: 'Has a baby', icon: 'pram' },
  wontClimb: { name: 'Bad knees', icon: 'stairs' },
  lightSleeper: { name: 'Light sleeper', icon: 'zz' },
  dog: { name: 'Has a dog', icon: 'paw' },
};

// ------------------------------------------------------------------ the seam

/**
 * What a flat is like where it matters: flat by flat for now. When noise and heat go room by
 * room (L2, L3), these read the bedrooms instead; nothing else here changes.
 */
export const READINGS = {
  /** The flat with a telly (or a console) through the wall, floor or ceiling, if any. */
  tellyThrough(sim: Sim, flatId: string): string | null {
    for (const f of sim.layout.flats) {
      if (f.id === flatId) continue;
      if (noiseThrough(sim, f.id, flatId) < FIT.through) continue;
      if (itemsIn(sim, f.id, 'tv') + itemsIn(sim, f.id, 'bigTv') + itemsIn(sim, f.id, 'console') > 0) return f.name;
    }
    return null;
  },
  /** The stairs heard through the wall. */
  stairsThrough(sim: Sim, flatId: string): boolean {
    return noiseThrough(sim, SHARED, flatId) >= FIT.through;
  },
  /** Let flats through the wall, floor or ceiling. */
  neighbours(sim: Sim, flatId: string): number {
    return sim.layout.flats.filter((f) => f.id !== flatId && flatInfo(sim, f.id).lease && noiseThrough(sim, flatId, f.id) >= FIT.through).length;
  },
  /** Layout L3: the bedrooms' warmth (the flat's, if it has none). */
  temp(sim: Sim, flatId: string): number {
    const beds = flatKind(sim, flatId).rooms.filter((r) => r.uses.includes('sleep'));
    return beds.length > 0 ? beds.reduce((n, r) => n + roomTempL3(sim, r.room), 0) / beds.length : tempOf(sim, flatId);
  },
  /** Layout L3: a bedroom damp enough to notice, or mould in the flat. */
  damp(sim: Sim, flatId: string): boolean {
    return hasFlag(sim, 'mould', flatId) || flatKind(sim, flatId).rooms.some((r) => r.uses.includes('sleep') && roomDampL3(sim, r.room) >= DAMP.damp);
  },
};

/** Flights of stairs up from the ground floor (0 on the ground floor). */
export function flightsUp(sim: Sim, flatId: string): number {
  const flat = sim.layout.flat(flatId);
  if (!flat) return 0;
  const rows = sim.layout.flatCells(flat).map((c) => sim.layout.xs(c)[1]);
  return rows.length === 0 ? 0 : Math.max(0, Math.floor((Math.min(...rows) - BASE) / STOREY));
}

// ------------------------------------------------------------------ needs

interface Who {
  schedule?: Schedule;
  traits: string[];
  circs?: Circ[];
  pet?: string;
}

/**
 * Someone's needs. With `known` (the traits you know about), only what you could tell: their
 * hours and circumstances are plain from the start; a light sleeper or a musician shows when
 * the trait does.
 */
export function needsOf(who: Who, known?: readonly string[]): FitNeed[] {
  const out: FitNeed[] = [];
  const trait = (t: string) => who.traits.includes(t) && (!known || known.includes(t));
  if (who.schedule === 'nights') out.push('nights');
  if (who.circs?.includes('baby')) out.push('baby');
  if (who.circs?.includes('wontClimb')) out.push('wontClimb');
  if (who.circs?.includes('dog') || /dog/.test(who.pet ?? '')) out.push('dog');
  if (trait('lightSleeper')) out.push('lightSleeper');
  if (trait('musician')) out.push('musician');
  return out;
}

/** Everyone's needs in an applicant household, as far as you can tell: the lead's shown trait, everyone's hours and circumstances. */
export function applicantNeeds(a: Applicant): FitNeed[] {
  const out = new Set<FitNeed>();
  a.people.forEach((p, i) => {
    for (const n of needsOf({ schedule: p.schedule, traits: p.traits, circs: a.circs }, i === 0 ? [a.shown] : [])) out.add(n);
  });
  return [...out];
}

// ------------------------------------------------------------------ facts

export interface FitFact {
  need: FitNeed;
  /** Short, for a chip: "Telly through the wall". */
  text: string;
  good: boolean;
  /** How they take it, if they do. */
  thought?: Thought;
}

const FLIGHTS = ['Ground floor', 'One flight up', 'Two flights up', 'Three flights up', 'Four flights up'];

/** What a flat is like for each need: facts, not a score. */
export function fitFacts(sim: Sim, flatId: string, needs: readonly FitNeed[]): FitFact[] {
  const out: FitFact[] = [];
  const R = READINGS;
  const fact = (need: FitNeed, text: string, good: boolean, label?: string, value?: number) => out.push({ need, text, good, ...(label && value ? { thought: { label, value } } : {}) });
  for (const need of needs) {
    if (need === 'nights') {
      const telly = R.tellyThrough(sim, flatId);
      const stairs = R.stairsThrough(sim, flatId);
      if (telly) fact(need, 'Telly through the wall', false, `${telly}'s telly through the wall by day`, FIT.nightsTelly);
      if (stairs) fact(need, 'Stairs through the wall', false, 'The stairs, all day', FIT.nightsStairs);
      if (!telly && !stairs) fact(need, 'Quiet by day', true, 'Quiet to sleep in by day', FIT.nightsQuiet);
    } else if (need === 'lightSleeper') {
      const stairs = R.stairsThrough(sim, flatId);
      const street = flightsUp(sim, flatId) === 0;
      if (stairs) fact(need, 'Stairs through the wall', false, 'Hears every step on the stairs', FIT.lightStairs);
      if (street) fact(need, 'On the street', false, 'The street right outside', FIT.lightStreet);
      if (!stairs && !street) fact(need, 'Away from the stairs', true);
    } else if (need === 'wontClimb') {
      const up = flightsUp(sim, flatId);
      const text = FLIGHTS[Math.min(up, FLIGHTS.length - 1)];
      if (up <= 1) fact(need, text, true, 'Hardly any stairs', FIT.climbLow);
      else fact(need, text, false, `${text}, on these knees`, (up - 1) * FIT.climbPerFlight);
    } else if (need === 'dog') {
      const down = flightsUp(sim, flatId) === 0;
      const garden = amenities(sim).garden;
      if (down || garden) fact(need, down ? 'Ground floor' : 'A garden', true, 'Somewhere for the dog', FIT.dogDown);
      else fact(need, 'Upstairs, no garden', false, 'The dog never gets out', FIT.dogUp);
    } else if (need === 'baby') {
      const kind = flatKind(sim, flatId);
      if (kind.bedrooms < 2) fact(need, 'No room for a cot', false, 'No room for the baby', FIT.babyNoRoom);
      if (R.temp(sim, flatId) < FIT.coldForBaby) fact(need, 'Cold', false, 'Too cold for the baby', FIT.babyCold);
      if (R.damp(sim, flatId)) fact(need, 'Damp', false, 'Damp, with a baby', FIT.babyDamp);
      if (kind.bedrooms >= 2 && !out.some((f) => f.need === 'baby')) fact(need, 'A room for the baby', true);
    } else if (need === 'musician') {
      const n = R.neighbours(sim, flatId);
      if (n === 0) fact(need, 'Nobody through the wall', true, 'Can practise in peace', FIT.musicianPeace);
      else fact(need, n === 1 ? 'Neighbours through the wall' : `${n} flats through the wall`, false);
    }
  }
  return out;
}

/** How a tenant takes their flat, need by need (thoughts.ts adds them to the rest). */
export function needThoughts(sim: Sim, life: Life, flatId: string): Thought[] {
  const needs = needsOf(life);
  if (needs.length === 0) return [];
  return fitFacts(sim, flatId, needs).flatMap((f) => (f.thought ? [f.thought] : []));
}

/** The household's most telling need you know about, for the map: its icon, and whether the flat suits it. */
export function mapFit(sim: Sim, flatId: string): { icon: string; mood: 'good' | 'bad' | 'mixed' } | null {
  const people = sim.state.pawns.filter((p) => p.life?.flat === flatId && !p.life.leaving);
  const needs = new Set<FitNeed>();
  for (const p of people) for (const n of needsOf(p.life!, p.life!.revealed)) needs.add(n);
  if (needs.size === 0) return null;
  const facts = fitFacts(sim, flatId, [...needs]);
  const bad = facts.filter((f) => !f.good);
  const first = bad[0]?.need ?? [...needs][0];
  const mood = bad.length === 0 ? 'good' : bad.length === facts.length ? 'bad' : 'mixed';
  return { icon: NEEDS[first].icon, mood };
}

// ------------------------------------------------------------------ applicants

/** The fit's own dice, so who brings a baby never moves the game's (like the drip's and the moments'). */
const FIT_DICE = 0x51f15e;

function dice(sim: Sim, a: number, b: number): RngHolder {
  const h = { rng: (sim.state.seed ^ FIT_DICE ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) | 0 };
  random(h);
  return h;
}

/** What an applicant household brings: a baby, bad knees, a dog. */
export function rollCircs(sim: Sim, id: number, household: HouseholdKind, people: readonly Person[], petsListing: boolean): Circ[] {
  const d = dice(sim, id, 0);
  const out: Circ[] = [];
  const babyChance = people.some((p) => p.schedule === 'retired') ? 0 : household === 'family' ? FIT.babyFamily : household === 'couple' ? FIT.babyCouple : 0;
  if (random(d) < babyChance) out.push('baby');
  if (people[0]?.schedule === 'retired' && random(d) < FIT.wontClimbRetired) out.push('wontClimb');
  if (petsListing && people[0]?.traits.includes('petOwner') && random(d) < FIT.dogPetsListing) out.push('dog');
  return out;
}

/** The most a household will pay a week, in pence. */
export function budgetOf(household: HouseholdKind, size: number): number {
  const B = FIT.budget;
  const pounds = household === 'single' ? B.single : household === 'couple' ? B.couple : household === 'family' ? B.family : B.sharersEach * size;
  return pounds * 100;
}

// ------------------------------------------------------------------ lives change

/** First thing each morning: now and then a couple has a baby, or someone's job goes to nights. */
export function livesChange(sim: Sim): void {
  const st = sim.state;
  const seen = new Set<string>();
  for (const p of st.pawns) {
    const life = p.life;
    if (!life || life.leaving) continue;
    const d = dice(sim, sim.day, p.id);
    const baby = random(d) < FIT.babyPerDay;
    const nights = random(d) < FIT.nightsPerDay;
    if (baby && life.household === 'couple' && !seen.has(life.flat) && !life.circs?.includes('baby')) {
      seen.add(life.flat);
      const both = st.pawns.filter((q) => q.life?.flat === life.flat && !q.life.leaving);
      for (const q of both) q.life!.circs = [...(q.life!.circs ?? []), 'baby'];
      sim.notify(`${both.map((q) => q.name.split(' ')[0]).join(' and ')} in ${sim.layout.flat(life.flat)?.name ?? 'the flat'} have had a baby.`);
    }
    if (nights && life.job && (life.schedule === 'office' || life.schedule === 'early' || life.schedule === 'late')) {
      const hours = SCHEDULES.away.nights;
      life.schedule = 'nights';
      life.job = { ...life.job, leave: hours.leave, back: hours.back };
      sim.notify(`${p.name.split(' ')[0]} is on nights now.`);
    }
  }
}

/** Asleep in the day (after a night shift) and next door's loud enough to wake them: they remember it, now and then. */
export function wokenByDay(sim: Sim, life: Life, loudest: string): void {
  const st = sim.state;
  if (life.memories.some((m) => m.id === 'wokenByDay' && st.tick - m.at < NEED_RATES.keptAwakeHours * TICKS_PER_HOUR)) return;
  const from = loudest === SHARED ? 'the stairs' : (sim.layout.flat(loudest)?.name ?? 'next door');
  life.memories.push({ id: 'wokenByDay', at: st.tick, note: `Woken in the day by ${from}` });
}
