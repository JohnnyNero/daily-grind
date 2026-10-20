// The drip: a thin stream of real, two-choice decisions, nought to two a game day (spec 1).
// Every morning it sets the day's budget; through waking hours it now and then draws a card
// whose `when` is true from the catalogue (cards/), and it resolves cards when you answer,
// when a moment passes, or when an ask has soured three times. Answers are lists of effects
// (cards/types.ts) that this file applies: memories, money, flags, threads, promises, risk.
//
// The flags and their reader registry are in flags.ts, so the systems that read flags don't
// import the whole drip. The numbers are in tuning.ts (DRIP).

import { chatAct, post, whoIs } from './chat';
import { book, flatInfo } from './economy';
import { addDirt } from './environment';
import { maybeFight } from './events';
import { setFlag, flagsOf, expireFlags } from './flags';
import { household } from './leases';
import { noticeTrait } from './outcomes';
import { postAct } from './post';
import { random } from './rng';
import type { Sim } from './sim';
import { rememberAbout } from './social';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, seconds, type Card, type Drip, type Pawn, type TaleKind } from './state';
import { tale } from './tales';
import { addVisitor, visitorRoom } from './visitors';
import { remember } from './thoughts';
import { DRIP, EXPECT, FLAG_EFFECTS, SECONDS_PER_GAME_MINUTE, UPKEEP } from './tuning';
import { breakIt, bookInspection, mend } from './upkeep';
import { allCards, FIRST_WEEK_SCRIPT } from './cards';
import { makeCard, type Answer, type CardChoice, type CardDef, type CardSubject, type Effect, type ScriptBeat } from './cards/types';
import { furnitureDef } from './defs';

export { clearFlag, expireFlags, flagsOf, hasFlag, readFlags, setFlag, FLAGS, READERS } from './flags';

// ------------------------------------------------------------------ the catalogue

// Looked up lazily: the card files import the sim (for their fixtures), which imports this.
let testCards: { defs: readonly CardDef[]; beats: readonly ScriptBeat[]; byId: Map<string, CardDef> } | null = null;
let realById: Map<string, CardDef> | null = null;

const catalogue = (): readonly CardDef[] => testCards?.defs ?? allCards();
const script = (): readonly ScriptBeat[] => testCards?.beats ?? FIRST_WEEK_SCRIPT;

/** For tests: deal from these cards (and this first-week script) instead of the real ones. Null puts the real ones back. */
export function useCatalogue(defs: readonly CardDef[] | null, beats: readonly ScriptBeat[] = []): void {
  testCards = defs ? { defs, beats, byId: new Map(defs.map((c) => [c.id, c])) } : null;
}

/** The def an open card was dealt from. */
export function cardDefOf(id: string): CardDef | undefined {
  if (testCards) return testCards.byId.get(id);
  realById ??= new Map(allCards().map((c) => [c.id, c]));
  return realById.get(id);
}

// ------------------------------------------------------------------ the drip's state

/** A drip with nothing in it, for a new game and for old saves. Day 0 means no budget set yet: it's set the first waking minute. */
export function emptyDrip(day = 0): Drip {
  return { open: [], budget: 0, day, lastCard: 0, ignoredRun: 0, cooldowns: {}, threads: [], promises: [], flags: [], log: [], income: 0 };
}

/** The cards in the tray, newest last. */
export function openCards(sim: Sim): Card[] {
  return sim.state.drip?.open ?? [];
}

/** The tick the drip's day began: the last 07:00. Night cards belong to the day after them. */
export function dripDayStart(sim: Sim): number {
  const morning = DRIP.wakeFrom * TICKS_PER_MINUTE;
  return Math.floor((sim.state.tick - morning) / TICKS_PER_DAY) * TICKS_PER_DAY + morning;
}

/** The first week's script is playing: days 1 to 7, the handover not skipped, and there's a script. */
export function scriptActive(sim: Sim): boolean {
  return sim.day <= 7 && !sim.state.handover.skipped && script().length > 0;
}

/**
 * What the day's budget would be now (1.2, turned down): one card on about every other day
 * (DRIP.dayChance, and less while works are drawn or going), less one for each of a happening
 * running or due, two letters waiting, two applicants waiting, someone moving in or out today,
 * and three cards in a row ignored.
 */
export function dayBudget(sim: Sim): number {
  const st = sim.state;
  const building = !!(st.works.job || st.works.plan);
  let n = random(st) < DRIP.dayChance * (building ? DRIP.buildingFactor : 1) ? DRIP.perDay : 0;
  if (st.story.running.length > 0 || st.council.visitDay === sim.day) n--;
  if (st.post.filter((l) => l.choices && l.chosen === undefined).length >= 2) n--;
  if (st.applicants.length >= 2) n--;
  if (Object.values(st.flats).some((f) => f.lease && (f.lease.startDay === sim.day || f.lease.notice?.day === sim.day))) n--;
  if (st.drip.ignoredRun >= DRIP.ignoredRun) n--;
  return Math.max(0, n);
}

function setBudget(sim: Sim): void {
  const d = sim.state.drip;
  d.day = sim.day;
  if (scriptActive(sim)) {
    // The first week's script sets the cards instead (a skipped beat gives its place back).
    d.budget = 0;
    d.cooldowns.script = sim.day;
    return;
  }
  delete d.cooldowns.script;
  d.budget = dayBudget(sim);
  // Yesterday brought both its cards: one today. Two a day, day after day, is a queue, not a drip.
  if (DRIP.perDay > 1 && d.cooldowns.dealtDay === sim.day - 1 && (d.cooldowns.dealt ?? 0) >= DRIP.perDay) d.budget = Math.min(d.budget, DRIP.perDay - 1);
  // A card in the night spent today's budget.
  if ((d.cooldowns.night ?? -1) >= dripDayStart(sim) - (24 * 60 - DRIP.wakeTo + DRIP.wakeFrom) * TICKS_PER_MINUTE) d.budget = Math.max(0, d.budget - 1);
}

// ------------------------------------------------------------------ the clock

/** 07:00: the day's budget (1.2), and promises checked against the real thing. */
export function dripMorning(sim: Sim): void {
  if (!sim.state.drip) return;
  setBudget(sim);
  checkPromises(sim);
}

/** Once a game hour: night cards, threads falling due, and what a squatter does to an empty flat. */
export function dripHour(sim: Sim): void {
  const st = sim.state;
  const d = st.drip;
  if (!d) return;
  const m = sim.minuteOfDay;
  if ((m >= DRIP.wakeTo || m < DRIP.wakeFrom) && roomFor(sim)) {
    // One night card a night at most: it spends the next day's budget.
    const tonight = m >= DRIP.wakeTo ? st.tick - (m - DRIP.wakeTo) * TICKS_PER_MINUTE : st.tick - (m + 24 * 60 - DRIP.wakeTo) * TICKS_PER_MINUTE;
    if ((d.cooldowns.night ?? -1) < tonight) {
      const options = candidates(sim, true);
      if (options.length > 0 && random(st) < DRIP.nightChance && deal(sim, options)) d.cooldowns.night = st.tick;
    }
  }
  followUps(sim);
  squatters(sim);
}

/** Once a game minute: sours waiting asks, resolves cards whose time is up, plays the first week's script, and every DRIP.tryEvery minutes in waking hours tries for a card. */
export function dripMinute(sim: Sim): void {
  const st = sim.state;
  const d = st.drip;
  if (!d) return;
  expireFlags(sim);
  const m = sim.minuteOfDay;
  // A new game starts after 07:00, and skipping the handover starts the budget at once.
  if (d.day !== sim.day && m >= DRIP.wakeFrom) setBudget(sim);
  else if (d.cooldowns.script === sim.day && !scriptActive(sim)) setBudget(sim);
  for (const c of [...d.open]) {
    const def = cardDefOf(c.def);
    // Someone who's gone can't be answered about: the card's subject, or anyone else it names.
    const gone = (id: unknown) => typeof id === 'number' && !st.pawns.some((p) => p.id === id);
    if (!def || gone(c.pawn) || PAWN_KEYS.some((k) => gone(c.data?.[k]))) {
      d.open = d.open.filter((x) => x !== c);
      continue;
    }
    if (c.waits) sour(sim, c);
    if (st.tick >= c.until && st.tick >= floorTick(c)) resolveCard(sim, c.id, 'ignored');
  }
  // 23:00: what's left of the day's budget is gone. Nothing is forced.
  if (m === DRIP.wakeTo) d.budget = 0;
  if (scriptActive(sim)) playScript(sim);
  if (m < DRIP.wakeFrom || m >= DRIP.wakeTo || m % DRIP.tryEvery !== 0) return;
  if (d.budget <= 0 || !roomFor(sim)) return;
  // Dice only once there's something to deal, so an empty catalogue changes nothing.
  const options = candidates(sim, false);
  if (options.length === 0) return;
  const late = m >= DRIP.lateFrom && d.lastCard < dripDayStart(sim);
  if (random(st) >= DRIP.tryChance * (late ? 2 : 1)) return;
  if (!deal(sim, options)) return;
  d.budget--;
  d.cooldowns.dealt = d.cooldowns.dealtDay === sim.day ? (d.cooldowns.dealt ?? 0) + 1 : 1;
  d.cooldowns.dealtDay = sim.day;
}

/** Keys in a card's data that name another person (cards/*.ts). */
const PAWN_KEYS = ['noisy', 'tenant', 'partner', 'about', 'bill', 'host', /* chunk b2: */ 'rider', 'owner', 'friend', 'cook', 'slacker', 'smoker', 'neighbour', 'helper', 'asker'];

/** Room in the tray, and long enough since the last card. */
function roomFor(sim: Sim): boolean {
  const d = sim.state.drip;
  return d.open.length < DRIP.maxOpen && (d.lastCard === 0 || sim.state.tick - d.lastCard >= DRIP.minGap * TICKS_PER_MINUTE);
}

/** The tick before which a card can't resolve by itself: 10 real seconds after it appeared, as the UI saw it, or as if at 1x. */
export function floorTick(c: Card): number {
  return c.seenBy ?? c.tick + seconds(DRIP.floorSeconds);
}

/** Every DRIP.life.askStep minutes an ask waits, the tenant gets more fed up. The last step is its end (until). */
function sour(sim: Sim, c: Card): void {
  const step = Math.min(DRIP.life.askSteps - 1, Math.floor((sim.state.tick - c.tick) / (DRIP.life.askStep * TICKS_PER_MINUTE)));
  while ((c.step ?? 0) < step) {
    c.step = (c.step ?? 0) + 1;
    const p = pawnOf(sim, c.pawn);
    if (p?.life) remember(sim, p.life, 'keptWaiting');
  }
}

// ------------------------------------------------------------------ dealing

interface Option {
  def: CardDef;
  subject: CardSubject;
  weight: number;
}

/** Every card that could come now, with who it'd be about and how much it weighs. */
function candidates(sim: Sim, night: boolean): Option[] {
  const st = sim.state;
  const d = st.drip;
  const live = new Set<number>([...d.promises.map((p) => p.pawn), ...d.threads.map((t) => Number(t.data.pawn)).filter((n) => !Number.isNaN(n))]);
  const out: Option[] = [];
  for (const def of catalogue()) {
    if (def.followUp || (night && !def.night)) continue;
    if ((d.cooldowns[def.id] ?? 0) > st.tick || d.open.some((c) => c.def === def.id)) continue;
    for (const s of def.when(sim)) {
      if (s.pawn !== undefined && ((d.cooldowns[`pawn:${s.pawn}`] ?? 0) > st.tick || d.open.some((c) => c.pawn === s.pawn))) continue;
      const weight = (s.weight ?? 1) * (s.pawn !== undefined && live.has(s.pawn) ? DRIP.liveWeight : 1);
      if (weight > 0) out.push({ def, subject: s, weight });
    }
  }
  return out;
}

/**
 * Draws a card, then who it's about. Cards are weighed, not subjects: a card that could be
 * about anyone (a parcel, a drill) weighs what its likeliest subject does, not that times
 * the number of tenants, or it crowds out the cards about one particular person.
 */
function deal(sim: Sim, options: Option[]): Card | null {
  const byCard = new Map<CardDef, Option[]>();
  for (const o of options) byCard.set(o.def, [...(byCard.get(o.def) ?? []), o]);
  // After a quiet spell with nothing opened that could come back, lean on cards where saying
  // yes (the first answer) can open a thread or a promise, so being decent keeps coming back
  // when cards are rare. Anything else can still come.
  const quiet = sim.state.tick - (sim.state.drip.lastOpened ?? 0) >= DRIP.tailDays * TICKS_PER_DAY;
  const leanOn = (def: CardDef) => quiet && (def.opens ?? []).includes(0);
  const cards = [...byCard.values()].map((os) => ({ os, weight: Math.max(...os.map((o) => o.weight)) * (DRIP.sourceWeight[os[0].def.source] ?? 1) * (leanOn(os[0].def) ? DRIP.tailWeight : 1) }));
  const draw = <T extends { weight: number }>(xs: T[]): T => {
    let r = random(sim.state) * xs.reduce((n, x) => n + x.weight, 0);
    return xs.find((x) => (r -= x.weight) < 0) ?? xs[xs.length - 1];
  };
  const { os } = draw(cards);
  const o = os.length === 1 ? os[0] : draw(os);
  return put(sim, o.def, o.subject);
}

/** How long a card lasts, in ticks (1.1). */
function lifeOf(sim: Sim, def: CardDef, subject: CardSubject): number {
  const L = DRIP.life;
  switch (def.kind) {
    case 'door':
      return L.door * TICKS_PER_MINUTE;
    case 'moment':
      return L.moment * TICKS_PER_MINUTE;
    case 'ask':
      return L.askStep * L.askSteps * TICKS_PER_MINUTE;
    case 'promise': {
      // Until the end of the promised day.
      const by = Number(subject.data?.byDay ?? sim.day + 1);
      return Math.max(L.moment * TICKS_PER_MINUTE, by * TICKS_PER_DAY - sim.state.tick);
    }
  }
}

/**
 * Cards about someone at the door, and who: the drip puts them on the map when the card opens
 * (a card's `when` and `resolve` never change the state). Roles are visitors.ts's.
 */
export const CARD_VISITORS: Record<string, string> = {
  parcel: 'courier',
  meterReader: 'meterReader',
  meterAgain: 'meterReader',
  manInAVan: 'van',
};

/** Puts a card in the tray, no questions asked. */
function put(sim: Sim, def: CardDef, subject: CardSubject): Card {
  const st = sim.state;
  const d = st.drip;
  const card = makeCard(sim, def, subject, st.tick + lifeOf(sim, def, subject));
  // Someone at the door the card's about, if they aren't about already (visitors.ts walks them).
  const role = CARD_VISITORS[def.id];
  if (role && card.visitor === undefined && visitorRoom(sim)) card.visitor = addVisitor(sim, role).id;
  d.open.push(card);
  d.lastCard = st.tick;
  d.cooldowns[def.id] = st.tick + def.cooldownDays * TICKS_PER_DAY;
  if (card.pawn !== undefined) d.cooldowns[`pawn:${card.pawn}`] = st.tick + DRIP.perPerson * TICKS_PER_DAY;
  return card;
}

/**
 * Opens a card now, on this subject, if it can (room in the tray, not already open). For the
 * first week's script, threads, and tests. Null if it can't.
 */
export function openCard(sim: Sim, def: string, subject: CardSubject = {}): Card | null {
  const d = sim.state.drip;
  const cd = cardDefOf(def);
  if (!cd || d.open.length >= DRIP.maxOpen || d.open.some((c) => c.def === def)) return null;
  return put(sim, cd, subject);
}

/**
 * The first week: each beat comes at its time, or as soon after as its card's `when` holds and
 * there's room, within DRIP.beatWait; otherwise it's skipped and gives its place to the
 * ordinary drip. Beats don't wait for the gap or the per-person rest.
 */
function playScript(sim: Sim): void {
  const d = sim.state.drip;
  const m = sim.minuteOfDay;
  for (const beat of script()) {
    if (beat.day !== sim.day || m < beat.minute) continue;
    const key = `beat:${beat.day}:${beat.minute}:${beat.card}`;
    if (d.cooldowns[key]) continue;
    const def = cardDefOf(beat.card);
    const subjects = def && !d.open.some((c) => c.def === def.id) ? def.when(sim) : [];
    if (subjects.length > 0 && d.open.length < DRIP.maxOpen) {
      put(sim, def!, subjects[0]);
      d.cooldowns[key] = 1;
    } else if (m > beat.minute + DRIP.beatWait) {
      d.cooldowns[key] = 1;
      d.budget++;
    }
  }
}

/** Threads falling due arrive on top of the budget, but wait for room and the gap, and only one a day comes over it. */
function followUps(sim: Sim): void {
  const st = sim.state;
  const d = st.drip;
  for (const t of [...d.threads]) {
    if (t.due > st.tick) continue;
    // Too long waiting: the moment's gone.
    if (st.tick - t.due > 2 * TICKS_PER_DAY) {
      d.threads = d.threads.filter((x) => x !== t);
      continue;
    }
    if (!roomFor(sim) || (d.cooldowns.followUp ?? 0) > st.tick) return;
    const def = cardDefOf(t.card);
    const from = subjectFrom(t.data);
    const now = def && !d.open.some((c) => c.def === def.id) ? def.when(sim, from) : [];
    d.threads = d.threads.filter((x) => x !== t);
    if (now.length === 0) continue;
    const s = now[0];
    put(sim, def!, { ...from, ...s, data: { ...from.data, ...s.data } });
    d.cooldowns.followUp = dripDayStart(sim) + TICKS_PER_DAY;
  }
}

/** A thread keeps the card's subject: pawn, flat, furniture and visitor, and the card's data beside them. */
function subjectData(c: Card): Record<string, string | number> {
  return {
    ...c.data,
    ...(c.pawn !== undefined ? { pawn: c.pawn } : {}),
    ...(c.flat !== undefined ? { flat: c.flat } : {}),
    ...(c.furniture !== undefined ? { furniture: c.furniture } : {}),
    ...(c.visitor !== undefined ? { visitor: c.visitor } : {}),
  };
}

function subjectFrom(data: Record<string, string | number>): CardSubject {
  const { pawn, flat, furniture, visitor, ...rest } = data;
  return {
    ...(pawn !== undefined ? { pawn: Number(pawn) } : {}),
    ...(flat !== undefined ? { flat: String(flat) } : {}),
    ...(furniture !== undefined ? { furniture: Number(furniture) } : {}),
    ...(visitor !== undefined ? { visitor: Number(visitor) } : {}),
    data: rest,
  };
}

// ------------------------------------------------------------------ answering

/** You answered: 0 or 1 is the button. Applies that choice's effects and closes the card. An error message, or null. */
export function answerCard(sim: Sim, cardId: number, choice: 0 | 1): string | null {
  if (!sim.state.drip.open.some((c) => c.id === cardId)) return 'Too late: that one\'s gone.';
  resolveCard(sim, cardId, choice);
  return null;
}

/** Resolves a card as it stands (a button, or ignored), applying the effects. Shared by answering, timing out and the tests. */
export function resolveCard(sim: Sim, cardId: number, answer: Answer): void {
  const st = sim.state;
  const d = st.drip;
  const card = d.open.find((c) => c.id === cardId);
  if (!card) return;
  d.open = d.open.filter((c) => c !== card);
  const def = cardDefOf(card.def);
  if (!def) return;
  const out = def.resolve(sim, card, answer);
  for (const e of out.effects) applyEffect(sim, card, e);
  if (out.notice) sim.notify(out.notice);
  d.log.push({ tick: st.tick, card: card.def, chose: answer });
  if (d.log.length > DRIP.logSize) d.log.splice(0, d.log.length - DRIP.logSize);
  d.ignoredRun = answer === 'ignored' ? d.ignoredRun + 1 : 0;
}

/**
 * The UI reports the tick at which a card has been up for DRIP.floorSeconds real seconds
 * (1.1). The card never resolves before it. Saves and replays keep it, like a button press.
 * Headless runs never call it: the drip then works it out as if at 1x. The UI holds a card it
 * has just seen with HOLD until the seconds are up.
 */
export function cardSeen(sim: Sim, cardId: number, tick: number): void {
  const c = sim.state.drip.open.find((x) => x.id === cardId);
  if (c) c.seenBy = tick;
}

/** A tick that never comes: what the UI reports while it's still counting a card's 10 seconds. */
export const HOLD = Number.MAX_SAFE_INTEGER;

// ------------------------------------------------------------------ effects

const pawnOf = (sim: Sim, id: number | string | undefined): Pawn | undefined => (id === undefined || id === '' ? undefined : sim.state.pawns.find((p) => p.id === Number(id)));

/** Does one effect (1.5). Effects are text, so they save and replay; see cards/types.ts for the kinds. */
export function applyEffect(sim: Sim, card: Card, e: Effect): void {
  const st = sim.state;
  const d = st.drip;
  const [kind, a = '', b = '', c = '', ...more] = e.split(':');
  const rest = (from: number) => e.split(':').slice(from).join(':');
  switch (kind) {
    case 'mem': {
      const p = pawnOf(sim, a);
      if (p?.life) remember(sim, p.life, b);
      return;
    }
    case 'soc': {
      const p = pawnOf(sim, a);
      const q = pawnOf(sim, c);
      if (p && q) rememberAbout(sim, p, b, q);
      return;
    }
    case 'pay': {
      let amount = Math.round(Number(a)) || 0;
      // Money from cards in the first week is capped, so the Monday squeeze still means something.
      if (amount > 0 && sim.day <= 7) {
        amount = Math.min(amount, Math.max(0, DRIP.firstWeekIncome - d.income));
        d.income += amount;
      }
      if (amount !== 0) book(sim, rest(2) || 'A word in the lobby', amount);
      return;
    }
    case 'mend':
      mend(sim, Number(a));
      return;
    case 'wear': {
      const f = st.furniture.find((x) => x.id === Number(a));
      const w = Number(b);
      if (!f || Number.isNaN(w)) return;
      if (w >= 1) {
        if (f.broken === undefined) breakIt(sim, f);
        return;
      }
      f.wear = Math.max(0, w);
      if (f.broken !== undefined) {
        delete f.broken;
        sim.changed();
      }
      return;
    }
    case 'rent': {
      const lease = flatInfo(sim, a).lease;
      if (lease) lease.rent = Math.max(0, lease.rent + (Math.round(Number(b)) || 0));
      return;
    }
    case 'flag':
      setFlag(sim, a, b || undefined, c ? st.tick + Number(c) * TICKS_PER_DAY : undefined, DRIP.maxFlags);
      // The building cat: visitors.ts brings its pawn on the hour once State.cat exists.
      if (a === 'buildingCat' && !st.cat) st.cat = { pawn: -1, since: sim.day };
      return;
    case 'reveal': {
      const p = pawnOf(sim, a);
      if (p?.life) noticeTrait(sim, p, b);
      return;
    }
    case 'tale': {
      const pawns = e.split(':').slice(2).map((id) => pawnOf(sim, id)).filter((p): p is Pawn => p !== undefined);
      const what = card.data?.what;
      tale(sim, a as TaleKind, pawns, { ...(card.flat ? { flat: card.flat } : {}), ...(what !== undefined ? { what: String(what) } : {}) });
      return;
    }
    case 'chat':
      post(sim, null, rest(1));
      return;
    case 'thread': {
      // `thread:<card>:<hours>:<key>=<value>,...`: anything after the hours goes in the follow-up's data too.
      const extra = Object.fromEntries(rest(3).split(',').filter((kv) => kv.includes('=')).map((kv) => {
        const [k, v] = kv.split('=');
        return [k, Number.isNaN(Number(v)) ? v : Number(v)];
      }));
      if (d.threads.length < DRIP.maxThreads) {
        d.threads.push({ card: a, due: st.tick + Math.round((Number(b) || 24) * TICKS_PER_HOUR), data: { ...subjectData(card), ...extra } });
        d.lastOpened = st.tick;
      }
      return;
    }
    case 'promise':
      d.promises.push({ what: a, arg: b, byDay: sim.day + (Number(c) || 7), pawn: card.pawn ?? -1 });
      d.lastOpened = st.tick;
      return;
    case 'risk': {
      // A storyteller weight a step up or down for some days; never starts anything itself.
      const steps = Number(b) || 1;
      const who = more[0];
      setFlag(sim, `risk:${a}`, who ? `${steps}@${who}` : String(steps), st.tick + (Number(c) || 3) * TICKS_PER_DAY, DRIP.maxFlags);
      return;
    }
    case 'inspect':
      bookInspection(sim, Number(a) || 5, rest(2) || 'A tenant has written to us');
      return;
    case 'expect':
      st.expect ??= { level: EXPECT.start, good: 0 };
      st.expect.level = Math.max(0, Math.min(100, st.expect.level + (Number(a) || 0)));
      return;
    case 'lose':
      st.applicants = st.applicants.filter((x) => x.id !== Number(a));
      return;
    case 'act':
      act(sim, card, a, e.split(':').slice(2));
      return;
  }
}

const POST_ACTS = ['rent', 'refuse', 'fine', 'advance', 'inspect'];

/**
 * Existing chat and post acts, so nothing's written twice. Also `prepay:<flat>:<days>` (rent
 * paid ahead), and `row:<a>:<b>`: two tenants have it out, and if it turns into a fight that's
 * the storyteller's, through its cap and cooldowns (events.ts `maybeFight`), so a card never
 * piles a happening on.
 */
function act(sim: Sim, card: Card, kind: string, args: string[]): void {
  if (kind === 'row') {
    const p = pawnOf(sim, args[0]);
    const q = pawnOf(sim, args[1]);
    if (!p?.life || !q?.life) return;
    rememberAbout(sim, p, 'row', q);
    rememberAbout(sim, q, 'row', p);
    maybeFight(sim, p, q);
    return;
  }
  if (kind === 'prepay') {
    // Rent paid ahead: those days are already paid for.
    const lease = flatInfo(sim, args[0]).lease;
    if (lease) lease.prepaid = (lease.prepaid ?? 0) + (Number(args[1]) || 0);
    return;
  }
  if (POST_ACTS.includes(kind)) postAct(sim, [kind, ...args].join(':'));
  else chatAct(sim, [kind, ...args].join(':'), card.pawn ?? 0);
}

// ------------------------------------------------------------------ promises

/** How to tell a promise was kept, by its kind. A card chunk can add kinds here. */
export const PROMISE_CHECKS: Record<string, (sim: Sim, arg: string) => boolean> = {
  // Mended: working and no longer worn.
  mend: (sim, arg) => {
    const f = sim.state.furniture.find((x) => x.id === Number(arg));
    return f !== undefined && f.broken === undefined && (f.wear ?? 0) < UPKEEP.worn;
  },
};

/** Every morning: a promise kept is remembered; one past its day and not kept is a broken promise, and a moan in the chat. */
function checkPromises(sim: Sim): void {
  const d = sim.state.drip;
  for (const p of [...d.promises]) {
    const check = PROMISE_CHECKS[p.what];
    const kept = check ? check(sim, p.arg) : false;
    if (!kept && sim.day <= p.byDay) continue;
    d.promises = d.promises.filter((x) => x !== p);
    const who = pawnOf(sim, p.pawn);
    if (!who?.life) continue;
    if (kept) {
      remember(sim, who.life, 'keptPromise');
      continue;
    }
    remember(sim, who.life, 'brokePromise');
    const thing = p.what === 'mend' ? sim.state.furniture.find((f) => f.id === Number(p.arg)) : undefined;
    const what = thing ? furnitureDef(thing.def).name.toLowerCase() : 'it';
    post(sim, who, `Still waiting on the ${what}. I was told day ${p.byDay}. It's day ${sim.day}.`);
    tale(sim, 'brokePromise', [who], { what, flat: who.life.flat });
  }
}

// ------------------------------------------------------------------ flags that do things over time

/** A squatter in an empty flat: wear and dirt creep up (flags.ts `squatter`). */
function squatters(sim: Sim): void {
  for (const f of flagsOf(sim, 'squatter')) {
    if (!f.subject || household(sim, f.subject).length > 0) continue;
    addDirt(sim, f.subject, FLAG_EFFECTS.squatterDirtHour);
    for (const thing of sim.state.furniture) {
      if (thing.broken !== undefined || sim.layout.flatAt(thing.x, thing.s)?.id !== f.subject) continue;
      thing.wear = Math.min(0.99, (thing.wear ?? 0) + FLAG_EFFECTS.squatterWearHour);
    }
  }
}

// ------------------------------------------------------------------ for the tray

export interface CardView {
  card: Card;
  /** The slim line, the name line, the full text and the two buttons. */
  hook: string;
  name: string;
  text: string;
  choices: [CardChoice, CardChoice];
  icon?: string;
  /** How much of its time is left, 0 to 1, in game time; and for an ask, the steps it sours in. */
  left: number;
  steps: number;
  /** Real seconds left at 1x, for screen readers. */
  seconds: number;
}

/** What the tray shows for a card, worked out from its def. Null for one whose def has gone. */
export function viewOf(sim: Sim, card: Card): CardView | null {
  const def = cardDefOf(card.def);
  if (!def) return null;
  const p = pawnOf(sim, card.pawn);
  const name = def.name?.(sim, card) ?? (p ? whoIs(sim, p) : card.flat ? (sim.layout.flat(card.flat)?.name ?? '') : '');
  const total = Math.max(1, card.until - card.tick);
  const leftTicks = Math.max(0, card.until - sim.state.tick);
  return {
    card,
    hook: def.hook(sim, card),
    name,
    text: def.text(sim, card),
    choices: def.choices(sim, card),
    ...(def.icon ? { icon: def.icon } : {}),
    left: leftTicks / total,
    steps: card.waits ? DRIP.life.askSteps : 1,
    seconds: (leftTicks / TICKS_PER_MINUTE) * SECONDS_PER_GAME_MINUTE,
  };
}
