// Tenants' lives. Each person has needs that run down (sleep, food, a wash, the loo, fun
// and comfort) and meets them with the furniture you've put in their flat. Most go out to
// work on weekdays. What's missing has a cost: no bed means the sofa or the floor, no loo
// means popping to the pub, no kitchen means chips. All of it turns into thoughts, and the
// thoughts add up to how much they like living here.

import { useUp } from './upkeep';
import { furnitureDef, spotColumns, type Offer } from './defs';
import { outdoorsOk } from './shared';
import { flatScore } from './impressiveness';
import { gradeOf } from './grades';
import type { Flat } from './layout';
import { findPath } from './layout';
import { keysOf, setGoal } from './pawns';
import { pick, randInt, random } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, type Furniture, type Life, type NeedId, type Pawn, type Person } from './state';
import { forget, likingTarget, remember, thoughtsOf } from './thoughts';
import { has } from './traits';
import { SHARED, dirtOf, isNight, itemsIn, outdoorTemp, noiseReaching, tempOf, tidy, warmthOf } from './environment';
import { noticeTrait } from './outcomes';
import { breakThink } from './breaks';
import { onKnock } from './events';
import { asleepHours, awayToday, dueOut, freeFor, habitStep, keepTime, habitThink, rollHabits, scheduleFromJob, wakeAt } from './schedules';
import { momentStep, momentThink } from './moments';
import { post, recently } from './chat';
import { rememberAbout } from './social';
import { hhmm } from './time';
import { stat } from './stat';
import { DECAY, ITEMS, NEEDS, OUTINGS, SEEK, SHARED_USE, START_NEEDS } from './tuning';

export const NEED_NAMES: Record<NeedId, string> = {
  sleep: 'Sleep',
  food: 'Food',
  hygiene: 'Hygiene',
  bladder: 'Bladder',
  fun: 'Fun',
  comfort: 'Comfort',
  warmth: 'Warmth',
  quiet: 'Quiet',
};

/** Eating a meal they've cooked: sitting down if there's a seat. */
const EAT: Offer = { need: 'food', rate: 3, minutes: [15, 25], pose: 'sit', doing: 'Eating' };
/** Sleeping on the floor, when there's no bed or sofa. */
const FLOOR_SLEEP: Offer = { need: 'sleep', rate: 1 / 10, minutes: [480, 540], pose: 'sleep', doing: 'Asleep on the floor' };
/** Sleeping on the sofa, when there's no bed. */
const SOFA_SLEEP: Offer = { need: 'sleep', rate: 1 / 8.5, minutes: [420, 540], pose: 'sleep', doing: 'Asleep on the sofa' };

const ON_THE_FLOOR = -1;

export type { Person };

// ------------------------------------------------------------------ moving in

/** A household moves into a flat. `revealed` are the traits you already know about (the first person's). */
export function moveIn(sim: Sim, flatId: string, people: Person[], revealed: string[] = []): Pawn[] {
  const st = sim.state;
  const lay = sim.layout;
  const flat = lay.flat(flatId);
  if (!flat) throw new Error(`No flat ${flatId}`);
  const nodes = flat.rooms.flatMap((r) => lay.rooms[r].nodes).filter((n) => !lay.isDoorNode(n));
  const out: Pawn[] = [];
  people.forEach((person, i) => {
    const [x, s] = lay.xs(pick(st, nodes));
    const life: Life = {
      flat: flatId,
      needs: { ...START_NEEDS },
      social: [],
      memories: [],
      liking: 50,
      job: person.job ? { ...person.job } : null,
      away: null,
      using: null,
      traits: [...person.traits],
      revealed: i === 0 ? revealed.filter((r) => person.traits.includes(r)) : [],
      under: { minor: 0, major: 0, extreme: 0 },
      calmUntil: 0,
      since: sim.day,
      schedule: person.schedule ?? scheduleFromJob(person.job),
      habits: [],
    };
    life.habits = rollHabits(st, life);
    const p: Pawn = {
      id: st.nextId++,
      name: person.name,
      kind: 'tenant',
      x,
      s,
      path: [],
      goal: null,
      task: 'go',
      exit: random(st) < 0.5 ? 0 : 1,
      doing: 'Settling in',
      waitUntil: 0,
      flat: flatId,
      look: { ...person.look },
      facing: 1,
      life,
      note: person.note,
    };
    st.pawns.push(p);
    out.push(p);
  });
  for (const p of out) p.life!.liking = likingTarget(thoughtsOf(sim, p));
  return out;
}

// ------------------------------------------------------------------ every minute

/** Needs run down (or up, with whatever they're using), memories fade, liking moves. */
export function minuteOfLife(sim: Sim, p: Pawn): void {
  const life = p.life!;
  const per = 1 / 60;
  const using = life.using && life.using.until > 0 ? offerOf(sim, life.using) : null;
  for (const need of Object.keys(DECAY) as (keyof typeof DECAY)[]) {
    let rate: number;
    // Using something that meets this need (or another one along with it) sets the rate outright.
    if (using?.need === need) rate = using.rate * (need === 'fun' && using.doing === 'Watching telly' && itemsIn(sim, life.flat, 'bigTv') > 0 ? ITEMS.bigTellyFun : 1);
    else if (using?.also?.[need] !== undefined) rate = using.also[need]!;
    // Otherwise it runs down: party animals get bored faster; at work or asleep, most things run down slower.
    else
      rate = stat(-DECAY[need], [], [
        need === 'fun' && has(life, 'partyAnimal') ? NEEDS.partyAnimalFun : 1,
        life.away ? (NEEDS.atWork[need] ?? 1) : 1,
        using?.pose === 'sleep' ? (NEEDS.asleep[need] ?? NEEDS.asleepOther) : 1,
      ]);
    if (using?.pose === 'sleep' && need === 'fun') rate = 0;
    life.needs[need] = Math.max(0, Math.min(1, life.needs[need] + rate * per));
  }
  buildingNeeds(sim, p);
  // Liking eases towards what their thoughts add up to.
  const target = likingTarget(thoughtsOf(sim, p));
  life.liking += (target - life.liking) * NEEDS.likingEase;
  if (sim.state.tick % TICKS_PER_HOUR === 0) forget(sim, life);
}

/**
 * Warmth and quiet come from the building: they drift towards how warm the flat is and how
 * much noise is getting in. Asleep at night with the neighbours loud, they're kept awake.
 */
function buildingNeeds(sim: Sim, p: Pawn): void {
  const life = p.life!;
  if (life.away) return;
  const warm = warmthOf(tempOf(sim, life.flat));
  life.needs.warmth += (warm - life.needs.warmth) * NEEDS.warmthEase;
  const { amount, loudest } = noiseReaching(sim, sim.noise(), life.flat);
  const night = isNight(sim);
  // Noise felt: what gets through, more for light sleepers, more at night.
  const felt = stat(amount, [], [has(life, 'lightSleeper') ? NEEDS.lightSleeper : 1, night ? NEEDS.night : 1]);
  const quiet = 1 - Math.min(1, felt / NEEDS.quietGone);
  life.needs.quiet += (quiet - life.needs.quiet) * (quiet < life.needs.quiet ? NEEDS.quietFalls : NEEDS.quietRises);
  if (p.pose === 'sleep' && night && felt >= NEEDS.keptAwake && loudest) {
    const recent = life.memories.some((m) => m.id === 'keptAwake' && sim.state.tick - m.at < NEEDS.keptAwakeHours * TICKS_PER_HOUR);
    if (recent) return;
    const from = loudest === SHARED ? 'the stairwell' : (sim.layout.flat(loudest)?.name ?? 'next door');
    life.memories.push({ id: 'keptAwake', at: sim.state.tick, note: `Kept awake by ${from}` });
    if (has(life, 'lightSleeper')) noticeTrait(sim, p, 'lightSleeper');
    if (loudest !== SHARED) {
      for (const n of sim.state.pawns.filter((o) => o.life?.flat === loudest)) rememberAbout(sim, p, 'noise', n);
      if (!recently(sim, 'Some of us are trying to sleep')) {
        post(sim, p, `Some of us are trying to sleep. ${from}, it's ${hhmm(sim.minuteOfDay)}`, [
          { label: `Have a word with ${from}`, note: `${from} won't thank you; ${p.name.split(' ')[0]} will`, act: `word:${loudest}` },
          { label: 'Not my business', note: `${p.name.split(' ')[0]} will remember`, act: 'notMine' },
        ]);
      }
    }
  }
}

// ------------------------------------------------------------------ deciding

function home(sim: Sim, p: Pawn): Flat | undefined {
  return sim.layout.flat(p.life!.flat);
}

function flatNodes(sim: Sim, flat: Flat): number[] {
  return flat.rooms.flatMap((r) => sim.layout.rooms[r].nodes);
}

// When they wake, sleep and go out to their hours comes from their schedule (schedules.ts).

export function tenantThink(sim: Sim, p: Pawn): void {
  decide(sim, p);
  keepTime(sim, p);
}

function decide(sim: Sim, p: Pawn): void {
  const life = p.life!;
  const st = sim.state;
  if (life.using) {
    // Time to go to work: whatever they're doing (even sleeping) stops; the alarm's gone.
    if (life.using.until > 0 && dueOut(sim, p)) stopUsing(sim, p, true);
    else {
      continueUsing(sim, p);
      return;
    }
  }
  delete p.pose;
  const flat = home(sim, p);
  const edge = p.exit === 0 ? 0 : st.w - 1;
  // Kicking off (or a good turn) comes before everything but moving out.
  const base = home(sim, p);
  if (base && !life.leaving && breakThink(sim, p, base)) return;
  // At a noisy neighbour's door to knock (events.ts): they wait to be answered.
  if (!life.leaving && onKnock(sim, p)) {
    p.waitUntil = st.tick + TICKS_PER_MINUTE;
    return;
  }
  // In the middle of an ambient moment (moments.ts): it carries on.
  if (base && !life.leaving && momentStep(sim, p, base)) return;
  // Got to where a habit was taking them (schedules.ts): they get on with it.
  if (base && !life.leaving && habitStep(sim, p)) return;
  if (life.leaving && p.task !== 'leave') {
    life.outing = { why: 'Moved out', until: st.tick };
    p.task = 'leave';
    p.doing = 'Moving out';
  }
  // Off out: to work, or for whatever the flat doesn't have.
  if (p.task === 'leave') {
    if (Math.round(p.x) === edge && Math.round(p.s) === 0) {
      goAway(sim, p);
      return;
    }
    if (!setGoal(sim, p, [edge, 0])) {
      p.doing = 'Stuck: no way out';
      p.waitUntil = st.tick + 5 * TICKS_PER_MINUTE;
    }
    return;
  }
  if (!flat) {
    p.doing = 'Wondering where their flat went';
    p.waitUntil = st.tick + 30 * TICKS_PER_MINUTE;
    return;
  }
  const here = sim.layout.flatAt(Math.round(p.x), Math.round(p.s));
  if (here?.id !== flat.id || sim.layout.isDoorNode(sim.layout.node(Math.round(p.x), Math.round(p.s)))) {
    // Bike out of the rack: off to work on it.
    const hours = awayToday(sim, life);
    if (life.cycling && life.job && hours) {
      delete life.cycling;
      life.cycled = true;
      leaveFor(sim, p, 'At work', hours.back);
      return;
    }
    // On the way in, a look at the post in the lobby: where neighbours bump into each other.
    const room = sim.layout.roomOf[sim.layout.node(Math.round(p.x), Math.round(p.s))];
    if (room !== -1 && sim.layout.rooms[room].shared && life.postDay !== sim.day && random(st) < 0.6) {
      life.postDay = sim.day;
      p.doing = random(st) < 0.3 ? 'Reading a leaflet about bins' : 'Checking the post';
      p.waitUntil = st.tick + randInt(st, 3, 8) * TICKS_PER_MINUTE;
      return;
    }
    goHome(sim, p, flat);
    return;
  }
  const m = sim.minuteOfDay;
  // Off to their hours (work, or a student's lectures), leaving time for the stairs.
  const hours = dueOut(sim, p);
  if (hours) {
    if (life.job && cycleToWork(sim, p)) return;
    life.workedDay = sim.day;
    leaveFor(sim, p, life.job ? 'At work' : 'At college', hours.back);
    return;
  }
  const needs = life.needs;
  if (needs.bladder < SEEK.bladder) {
    if (tryUse(sim, p, flat, 'bladder')) return;
    leaveFor(sim, p, 'Popped to the pub for the loo', m + 25);
    return;
  }
  if (asleepHours(sim, life) || needs.sleep < SEEK.sleep) {
    goToSleep(sim, p, flat);
    return;
  }
  if (life.meal) {
    eat(sim, p, flat);
    return;
  }
  const morning = m >= wakeAt(sim, life) && m < wakeAt(sim, life) + 45;
  if (needs.hygiene < SEEK.hygiene || (morning && needs.hygiene < NEEDS.morningWash)) {
    if (tryUse(sim, p, flat, 'hygiene')) return;
  }
  const teatime = m >= 18 * 60 && m < 20 * 60 && needs.food < NEEDS.teatime;
  if (needs.food < SEEK.food || teatime) {
    if (tryUse(sim, p, flat, 'food')) return;
    leaveFor(sim, p, 'Out for chips', m + 40);
    return;
  }
  // A habit if one's due (schedules.ts): after the pressing needs, before boredom and chores.
  if (habitThink(sim, p, flat)) return;
  if (needs.fun < SEEK.fun) {
    if (tryUse(sim, p, flat, 'fun')) return;
    // Not if it'd make them late for work.
    if (m >= 10 * 60 && m < 22 * 60 && freeFor(sim, p, 150 + 60)) {
      leaveFor(sim, p, random(st) < 0.5 ? 'Out at the pub' : 'Out for a walk', m + randInt(st, 60, 150));
      return;
    }
  }
  if (needs.comfort < SEEK.comfort && tryUse(sim, p, flat, 'comfort')) return;
  if (errands(sim, p, flat)) return;
  // Musicians practise in the evenings (night owls until gone midnight).
  const evening = has(life, 'nightOwl') ? m >= 18 * 60 || m < 30 : m >= 18 * 60 && m < 21 * 60 + 30;
  if (has(life, 'musician') && evening && needs.fun < NEEDS.practiseUnder && random(st) < NEEDS.practiseChance) {
    p.doing = 'Practising';
    life.needs.fun = Math.min(1, needs.fun + NEEDS.practiseFun);
    p.waitUntil = st.tick + randInt(st, 30, 60) * TICKS_PER_MINUTE;
    return;
  }
  // Tidying up, unless they're messy. House-proud tenants can't leave it.
  const dirt = dirtOf(sim, flat.id);
  if (!has(life, 'messy') && dirt > (has(life, 'houseProud') ? NEEDS.tidyAtHouseProud : NEEDS.tidyAt)) {
    p.doing = 'Tidying up';
    tidy(sim, flat.id, NEEDS.tidyAmount);
    p.waitUntil = st.tick + randInt(st, 20, 40) * TICKS_PER_MINUTE;
    return;
  }
  // Maybe a moment (moments.ts), else pottering.
  if (momentThink(sim, p, flat)) return;
  potter(sim, p, flat);
}

// ------------------------------------------------------------------ using furniture

function offerOf(sim: Sim, u: { furniture: number; offer: number }): Offer | null {
  if (u.offer === -1) return EAT;
  if (u.offer === -2) return u.furniture === ON_THE_FLOOR ? FLOOR_SLEEP : SOFA_SLEEP;
  const f = sim.state.furniture.find((o) => o.id === u.furniture);
  return f ? (furnitureDef(f.def).offers?.[u.offer] ?? null) : null;
}

/** Spots taken by someone else. */
function taken(sim: Sim, f: Furniture, spot: number, me: Pawn): boolean {
  return sim.state.pawns.some((o) => o !== me && o.life?.using?.furniture === f.id && o.life.using.spot === spot);
}

interface Choice {
  f: Furniture;
  spot: number;
  offer: number;
  at: [number, number];
}

/** Furniture in the flat that meets a need (and works where it is), nearest first. */
export function choices(sim: Sim, p: Pawn, flat: Flat, match: (o: Offer, f: Furniture) => boolean): Choice[] {
  const lay = sim.layout;
  // Every cell of the flat (wall furniture hangs above where anyone stands).
  const inFlat = new Set(lay.flatCells(flat));
  const out: Choice[] = [];
  for (const f of sim.state.furniture) {
    if (!inFlat.has(lay.node(f.x, f.s)) || f.broken !== undefined) continue;
    const def = furnitureDef(f.def);
    const room = lay.roomOf[lay.node(f.x, f.s)];
    def.offers?.forEach((o, i) => {
      if (!match(o, f)) return;
      if (o.needsNearby && !sim.state.furniture.some((g) => (g.def === o.needsNearby || furnitureDef(g.def).as === o.needsNearby) && (inFlat.has(lay.node(g.x, g.s)) && (o.needsNearby === 'fridge' || lay.roomOf[lay.node(g.x, g.s)] === room)))) return;
      spotColumns(def, f.x, f.flip).forEach((x, spot) => {
        if (!taken(sim, f, spot, p)) out.push({ f, spot, offer: i, at: [x, f.s] });
      });
    });
  }
  return out.sort((a, b) => Math.abs(a.at[0] - p.x) + 4 * Math.abs(a.at[1] - p.s) - (Math.abs(b.at[0] - p.x) + 4 * Math.abs(b.at[1] - p.s)));
}

/** Goes to the nearest thing that meets a need and starts walking there. False if there's nothing. */
function tryUse(sim: Sim, p: Pawn, flat: Flat, need: NeedId): boolean {
  // Food means cooking if they can, else picking at the fridge.
  const life = p.life!;
  // Party animals don't do books.
  const list = choices(sim, p, flat, (o, f) => o.need === need && !o.errand && !(f.def === 'bookshelf' && has(life, 'partyAnimal')));
  if (need === 'food') list.sort((a, b) => Number(a.f.def !== 'cooker') - Number(b.f.def !== 'cooker'));
  // Quiet types would sooner have a book than the telly.
  if (need === 'fun' && ITEMS.keenReaders.some((t) => has(life, t))) list.sort((a, b) => Number(a.f.def !== 'bookshelf') - Number(b.f.def !== 'bookshelf'));
  // For fun, the telly comes first: a sofa with a telly beats the laptop.
  for (const c of list) {
    if (startUsing(sim, p, c.f.id, c.spot, c.offer, c.at)) return true;
  }
  return false;
}

function startUsing(sim: Sim, p: Pawn, furniture: number, spot: number, offer: number, at: [number, number]): boolean {
  const lay = sim.layout;
  const path = findPath(lay, lay.node(Math.round(p.x), Math.round(p.s)), lay.node(at[0], at[1]), keysOf(p));
  if (!path) return false;
  p.life!.using = { furniture, spot, offer, until: 0 };
  const o = offerOf(sim, p.life!.using);
  p.doing = o ? `Going to: ${o.doing.toLowerCase()}` : 'Off to do something';
  p.goal = at;
  p.path = path.map((n) => lay.xs(n));
  return true;
}

/** Called when they've got there, and then whenever they're idle while using. */
function continueUsing(sim: Sim, p: Pawn): void {
  const life = p.life!;
  const u = life.using!;
  const st = sim.state;
  const o = offerOf(sim, u);
  const f = st.furniture.find((x) => x.id === u.furniture);
  if (!o || (u.furniture !== ON_THE_FLOOR && u.offer !== -1 && !f)) {
    stopUsing(sim, p, false);
    return;
  }
  if (u.until === 0) {
    // Just arrived.
    u.until = st.tick + randInt(st, o.minutes[0], o.minutes[1]) * TICKS_PER_MINUTE;
    p.doing = o.doing;
    if (o.pose !== 'stand') p.pose = o.pose;
    if (f) p.facing = f.flip ? -1 : 1;
    if (o.pose === 'sleep') life.sleptOn = u.furniture === ON_THE_FLOOR ? 'floor' : u.offer === -2 ? 'sofa' : 'bed';
    if (f && o.join) meetAround(sim, p, f);
    return;
  }
  // Sitting out is for daylight and decent weather: when that turns, they go in.
  if (f && outdoors(sim, f) && !outdoorsOk(sim)) {
    stopUsing(sim, p, true);
    return;
  }
  const full = o.need !== 'sleep' && o.rate > 0 && life.needs[o.need] >= 1;
  const sleeping = o.pose === 'sleep';
  const woken = sleeping && !asleepHours(sim, life) && life.needs.sleep > 0.85;
  const due = st.tick >= u.until;
  if (sleeping ? woken || (due && life.needs.sleep >= 0.98) || life.needs.bladder < 0.1 : due || full) {
    stopUsing(sim, p, true);
    return;
  }
  if (o.pose !== 'stand') p.pose = o.pose;
  p.waitUntil = st.tick + TICKS_PER_MINUTE;
}

/** A piece of furniture was moved, turned or taken away: anyone using it or on their way to it stops. */
export function disturb(sim: Sim, furnitureId: number): void {
  for (const p of sim.state.pawns) {
    if (p.life?.using?.furniture !== furnitureId) continue;
    stopUsing(sim, p, false);
    p.path = [];
    p.goal = null;
    p.waitUntil = 0;
  }
}

function stopUsing(sim: Sim, p: Pawn, finished: boolean): void {
  const life = p.life!;
  const u = life.using!;
  const o = offerOf(sim, u);
  life.using = null;
  delete p.pose;
  if (!finished || !o) return;
  const used = sim.state.furniture.find((x) => x.id === u.furniture);
  if (used && u.offer >= 0) useUp(sim, used, p);
  if (o.memory) remember(sim, life, o.memory);
  if (o.doing === 'Cooking') life.meal = true;
  if (used?.def === 'washer') life.washedDay = sim.day;
  if (o.doing === 'Getting the bike out') life.cycling = true;
  if (u.offer === -1) {
    life.meal = false;
    remember(sim, life, 'cookedMeal');
    const f = sim.state.furniture.find((x) => x.id === u.furniture);
    if (f?.def === 'diningSet' || (f?.def === 'chair' && sim.state.furniture.some((g) => g.def === 'table' && g.s === f.s && Math.abs(g.x - f.x) <= 2))) remember(sim, life, 'ateAtTable');
    if (itemsIn(sim, life.flat, 'dishwasher') > 0) remember(sim, life, 'noWashUp');
  }
  if (o.pose === 'sleep') {
    if (life.sleptOn === 'floor') remember(sim, life, 'sleptFloor');
    else if (life.sleptOn === 'sofa') remember(sim, life, 'sleptSofa');
    // A cheap mattress is lumpy however long you lie on it; a posh one is the best night going.
    else if (used && gradeOf(used) === 'cheap') remember(sim, life, 'lumpyMattress');
    else {
      // Curtains keep the morning sun off: a darker bedroom and an easier lie-in.
      const curtained = itemsIn(sim, life.flat, 'curtains') > 0;
      if (curtained && life.needs.sleep > ITEMS.curtainsWell) remember(sim, life, 'darkBedroom');
      if (life.needs.sleep > (curtained ? ITEMS.curtainsWell : ITEMS.sleptWell)) remember(sim, life, used && gradeOf(used) === 'posh' ? 'sleptPosh' : 'sleptWell');
    }
  }
}

function goToSleep(sim: Sim, p: Pawn, flat: Flat): void {
  if (tryUse(sim, p, flat, 'sleep')) return;
  // No bed: the sofa, then the floor.
  const sofa = choices(sim, p, flat, (_o, f) => f.def === 'sofa')[0];
  if (sofa && startUsing(sim, p, sofa.f.id, sofa.spot, -2, sofa.at)) return;
  p.life!.using = { furniture: ON_THE_FLOOR, spot: 0, offer: -2, until: 0 };
  continueUsing(sim, p);
}

function eat(sim: Sim, p: Pawn, flat: Flat): void {
  // A chair by a table first, then anywhere to sit, else standing up.
  const seats = choices(sim, p, flat, (o) => o.pose === 'sit' && o.need === 'comfort' && !o.errand);
  seats.sort((a, b) => Number(!['chair', 'diningSet'].includes(a.f.def)) - Number(!['chair', 'diningSet'].includes(b.f.def)));
  for (const c of seats) if (startUsing(sim, p, c.f.id, c.spot, -1, c.at)) return;
  const life = p.life!;
  life.meal = false;
  life.needs.food = Math.min(1, life.needs.food + NEEDS.eatStanding);
  remember(sim, life, 'cookedMeal');
  remember(sim, life, 'ateStanding');
  p.doing = 'Eating standing up';
  p.waitUntil = sim.state.tick + 12 * TICKS_PER_MINUTE;
}

// ------------------------------------------------------------------ going out and coming home

function leaveFor(sim: Sim, p: Pawn, why: string, untilMinute: number): void {
  const st = sim.state;
  const dayStart = Math.floor(st.tick / TICKS_PER_DAY) * TICKS_PER_DAY;
  p.life!.outing = { why, until: dayStart + untilMinute * TICKS_PER_MINUTE };
  p.task = 'leave';
  p.doing = why === 'At work' ? 'Off to work' : 'Heading out';
  tenantThink(sim, p);
}

function goAway(sim: Sim, p: Pawn): void {
  const life = p.life!;
  const st = sim.state;
  const out = life.outing ?? { why: 'Out', until: st.tick + TICKS_PER_HOUR };
  delete life.outing;
  if (life.leaving) {
    st.pawns.splice(st.pawns.indexOf(p), 1);
    return;
  }
  life.away = { until: Math.max(st.tick + 15 * TICKS_PER_MINUTE, out.until), why: out.why };
  if (out.why === 'At work') life.workedDay = sim.day;
  p.doing = out.why;
  p.path = [];
  p.goal = null;
  delete p.front;
  delete p.frontTo;
}

/** Back from work or wherever: in at one end of the street and home. */
export function tenantReturns(sim: Sim, p: Pawn): void {
  const life = p.life!;
  const st = sim.state;
  const why = life.away?.why ?? '';
  if (why === 'At work') {
    if (life.cycled) remember(sim, life, 'cycledToWork');
    else if (random(st) < NEEDS.commute) remember(sim, life, 'commute');
    delete life.cycled;
    life.needs.bladder = Math.min(life.needs.bladder, 0.5);
  }
  for (const [need, gain] of Object.entries(OUTINGS[why] ?? {}) as [NeedId, number][]) life.needs[need] = Math.min(1, life.needs[need] + gain);
  life.away = null;
  p.exit = random(st) < 0.5 ? 0 : 1;
  p.x = p.exit === 0 ? 0 : st.w - 1;
  p.s = 0;
  p.task = 'go';
  p.doing = 'Heading home';
  p.waitUntil = 0;
}

function goHome(sim: Sim, p: Pawn, flat: Flat): void {
  const st = sim.state;
  const lay = sim.layout;
  p.task = 'go';
  const nodes = flatNodes(sim, flat).filter((n) => !lay.isDoorNode(n));
  if (nodes.length === 0 || !setGoal(sim, p, lay.xs(pick(st, nodes)))) {
    p.doing = `Can't get into ${flat.name}`;
    p.waitUntil = st.tick + 10 * TICKS_PER_MINUTE;
    return;
  }
  p.doing = 'Heading home';
}

function potter(sim: Sim, p: Pawn, flat: Flat): void {
  const st = sim.state;
  const lay = sim.layout;
  // Sociable types hang about on the landing outside their door, in the hope of a chat.
  const life = p.life!;
  const m = sim.minuteOfDay;
  if ((has(life, 'friendly') || has(life, 'busybody') || has(life, 'partyAnimal')) && m >= 9 * 60 && m < 21 * 60 && random(st) < 0.25) {
    const door = flat.doors[0].split(',').map(Number);
    const outside = [door[0] - 1, door[0] + 1].map((x) => lay.node(x, door[1])).find((n) => lay.roomOf[n] !== -1 && lay.rooms[lay.roomOf[n]].shared);
    if (outside !== undefined && setGoal(sim, p, lay.xs(outside))) {
      p.doing = 'Hanging about on the landing';
      p.waitUntil = st.tick + randInt(st, 10, 25) * TICKS_PER_MINUTE;
      return;
    }
  }
  if (p.life!.needs.comfort < 0.8 && random(st) < 0.4 && tryUse(sim, p, flat, 'comfort')) return;
  const nodes = flatNodes(sim, flat).filter((n) => !lay.isDoorNode(n));
  if (nodes.length > 0) setGoal(sim, p, lay.xs(pick(st, nodes)));
  p.doing = 'Pottering about';
  p.waitUntil = st.tick + randInt(st, 5, 20) * TICKS_PER_MINUTE;
}

/** For the info panel: how the flat they live in scores. */
export function homeScore(sim: Sim, p: Pawn) {
  return p.life ? flatScore(sim, p.life.flat) : null;
}

// ------------------------------------------------------------------ shared spaces

/** Is this piece out in the open (on the roof, in a garden)? */
function outdoors(sim: Sim, f: Furniture): boolean {
  const lay = sim.layout;
  const room = lay.roomOf[lay.node(f.x, f.s)];
  return room !== -1 && lay.rooms[room].outdoor;
}

/** Someone's at the grill in this room, with the sausages on. */
function hostAt(sim: Sim, room: number): boolean {
  const lay = sim.layout;
  return sim.state.pawns.some((o) => {
    const u = o.life?.using;
    if (!u || u.until === 0 || u.offer !== 0) return false;
    const g = sim.state.furniture.find((x) => x.id === u.furniture);
    return g?.def === 'bbq' && lay.roomOf[lay.node(g.x, g.s)] === room;
  });
}

/** Errands in the shared parts and out in the open (the laundry room, the roof), nearest first. Outdoors only in daylight and decent weather. */
function sharedChoices(sim: Sim, p: Pawn, match: (o: Offer, f: Furniture) => boolean): Choice[] {
  const lay = sim.layout;
  const fine = outdoorsOk(sim);
  const out: Choice[] = [];
  for (const f of sim.state.furniture) {
    if (f.broken !== undefined) continue;
    const room = lay.roomOf[lay.node(f.x, f.s)];
    if (room === -1 || (!lay.rooms[room].shared && !lay.rooms[room].outdoor) || (lay.rooms[room].outdoor && !fine)) continue;
    const def = furnitureDef(f.def);
    def.offers?.forEach((o, i) => {
      if (!o.errand || !match(o, f) || (o.join && !hostAt(sim, room))) return;
      spotColumns(def, f.x, f.flip).forEach((x, spot) => {
        if (!taken(sim, f, spot, p)) out.push({ f, spot, offer: i, at: [x, f.s] });
      });
    });
  }
  const far = (c: Choice) => Math.abs(c.at[0] - p.x) + 4 * Math.abs(c.at[1] - p.s);
  return out.sort((a, b) => far(a) - far(b));
}

/** Goes to the first of these that they can walk to. */
function goTo(sim: Sim, p: Pawn, list: Choice[]): boolean {
  for (const c of list) if (startUsing(sim, p, c.f.id, c.spot, c.offer, c.at)) return true;
  return false;
}

const SOCIABLE = ['friendly', 'busybody', 'partyAnimal'];

/**
 * Things they do because they feel like it rather than because they must: the washing every
 * few days, an hour out in the garden when it's nice, a barbecue (and joining one). Nothing
 * here rolls the dice unless there's somewhere to go, so a building without any carries on
 * exactly as before.
 */
function errands(sim: Sim, p: Pawn, flat: Flat): boolean {
  const life = p.life!;
  const st = sim.state;
  const m = sim.minuteOfDay;
  const U = SHARED_USE;
  // The washing: in the flat if there's a machine there, else down in the laundry room.
  if ((life.washedDay === undefined || sim.day - life.washedDay >= U.washEveryDays) && m >= U.washFrom && m < U.washTo) {
    const wash = (o: Offer) => o.doing === 'Doing the washing';
    if (goTo(sim, p, [...choices(sim, p, flat, wash), ...sharedChoices(sim, p, wash)])) return true;
  }
  // Joining a barbecue that's already going.
  const join = sharedChoices(sim, p, (o) => !!o.join);
  if (join.length > 0 && random(st) < U.joinChance) return goTo(sim, p, join);
  // Firing up the grill: sociable types sooner.
  const sociable = SOCIABLE.some((t) => has(life, t));
  const warm = outdoorTemp(sim) >= U.bbqTemp && m >= U.bbqFrom && m < U.bbqTo;
  const grill = warm ? sharedChoices(sim, p, (o) => o.doing === 'Firing up the barbecue') : [];
  if (grill.length > 0 && life.gardenDay !== sim.day && random(st) < U.bbqChance * (sociable ? U.sociableBbq : 1)) {
    life.gardenDay = sim.day;
    return goTo(sim, p, grill);
  }
  // An hour on the bench, if they're after fun or comfort and it's nice out.
  if (life.gardenDay === sim.day || (life.needs.fun >= U.leisureUnder && life.needs.comfort >= U.leisureUnder)) return false;
  const sit = sharedChoices(sim, p, (o, f) => f.def !== 'bbq' && !o.join && furnitureDef(f.def).space === 'garden');
  if (sit.length > 0 && random(st) < U.leisureChance) {
    life.gardenDay = sim.day;
    return goTo(sim, p, sit);
  }
  return false;
}

/** Arriving at the barbecue: a word with whoever's already there. */
function meetAround(sim: Sim, p: Pawn, f: Furniture): void {
  const lay = sim.layout;
  const room = lay.roomOf[lay.node(f.x, f.s)];
  const others = sim.state.pawns.filter((o) => {
    const g = o.life?.using && o.life.using.until > 0 ? sim.state.furniture.find((x) => x.id === o.life!.using!.furniture) : undefined;
    return o !== p && g && lay.roomOf[lay.node(g.x, g.s)] === room && (g.def === 'bbq' || g.def === 'parasolTable');
  });
  for (const o of others.slice(0, 4)) {
    rememberAbout(sim, p, 'chat', o);
    rememberAbout(sim, o, 'chat', p);
  }
}

/** Before going to work: maybe the bike. Asked once a day, and only if there's a rack to hand. */
function cycleToWork(sim: Sim, p: Pawn): boolean {
  const life = p.life!;
  if (life.cycleDay === sim.day) return false;
  const racks = sharedChoices(sim, p, (o) => o.doing === 'Getting the bike out');
  if (racks.length === 0) return false;
  life.cycleDay = sim.day;
  return random(sim.state) < SHARED_USE.cycleChance && goTo(sim, p, racks);
}
