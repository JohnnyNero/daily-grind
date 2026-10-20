// The pacing soak (spec 6, chunk 8): does the building keep something on screen, and does the
// drip ask for a real decision now and then, and no more? Seeds 1, 2 and 4; a decent, a
// ruthless and a random landlord (and an absent one, who ignores every card); 21 days,
// sampled every game minute from 07:00 to 23:00.

import { describe, expect, it } from 'vitest';
import { cardDefOf } from '../src/sim/drip';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, type Card, type Pawn } from '../src/sim/state';
import { answerCard } from '../src/sim/drip';
import { landlord, type Cards, type Policy } from './policy';

const SEEDS = [1, 2, 4];
const DAYS = 21;
const WAKE = 7 * 60;
const SLEEP = 23 * 60;

/** The landlords: decent and ruthless take their button, random tosses a coin, absent ignores every card (and otherwise plays as decent or ruthless). */
type Mode = 'decent' | 'ruthless' | 'random' | 'absentDecent' | 'absentRuthless';

/** What an answer left that could still be seen later. */
interface Marks {
  tick: number;
  mems: { pawn: number; id: string; at: number }[];
  socs: { pawn: number; id: string; about: number; at: number }[];
  flags: string[];
  threads: string[];
  promises: { what: string; pawn: number }[];
  tales: number[];
  rents: { flat: string; rent: number }[];
  /** Filled in 3 game days later: something still shows. */
  live?: boolean;
}

interface Day {
  /** Cards from the budget and follow-ups (threads coming due), with the night before counted in. */
  drip: number;
  followUps: number;
  /** New letters with choices, new applicants and chat requests: what the decisions were. */
  letters: number;
  applicants: number;
  chats: number;
  /** A happening running or due, or two letters with choices waiting, at 07:00. */
  busy: boolean;
  decisions: number;
}

interface Run {
  days: Map<number, Day>;
  maxOpen: number;
  visible: number[];
  gaps: number[];
  sources: Record<string, number>;
  answered: Marks[];
  /** Threads that came back as cards, and promises that fell due (kept or broken), by week. */
  cameBack: number[];
  /** Each Sunday's recap: how many tales it told, and how many came from cards. */
  recaps: { day: number; tales: number; fromCards: number }[];
  /** Average liking at the end of each week. */
  liking: number[];
  /** Cards resolved by being ignored, and how many of those left someone `ignored` or `leftToIt`. */
  ignored: number;
  ignoredMarked: number;
}

/** A small seeded coin, so the random landlord never touches the game's own dice. */
function coin(seed: number): () => number {
  let a = (seed * 0x9e3779b1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const people = (sim: Sim): Pawn[] => sim.state.pawns.filter((p) => p.life);

function snapshot(sim: Sim) {
  const st = sim.state;
  return {
    mems: new Set(people(sim).flatMap((p) => p.life!.memories.map((m) => `${p.id}|${m.id}|${m.at}`))),
    socs: new Set(people(sim).flatMap((p) => p.life!.social.map((m) => `${p.id}|${m.id}|${m.about}|${m.at}`))),
    flags: new Set(st.drip.flags.map((f) => `${f.id}|${f.subject ?? ''}`)),
    threads: st.drip.threads.length,
    promises: st.drip.promises.length,
    tales: new Set(st.chronicle.tales.map((t) => t.id)),
    rents: new Map(Object.entries(st.flats).map(([id, f]) => [id, f.lease?.rent ?? -1])),
  };
}

/** Answers a card and notes what it left behind. */
function answerNoting(sim: Sim, c: Card, choice: 0 | 1, into: Marks[]): void {
  const st = sim.state;
  const before = snapshot(sim);
  answerCard(sim, c.id, choice);
  const marks: Marks = { tick: st.tick, mems: [], socs: [], flags: [], threads: [], promises: [], tales: [], rents: [] };
  for (const p of people(sim)) {
    for (const m of p.life!.memories) if (!before.mems.has(`${p.id}|${m.id}|${m.at}`)) marks.mems.push({ pawn: p.id, id: m.id, at: m.at });
    for (const m of p.life!.social) if (!before.socs.has(`${p.id}|${m.id}|${m.about}|${m.at}`)) marks.socs.push({ pawn: p.id, ...m });
  }
  marks.flags = st.drip.flags.map((f) => `${f.id}|${f.subject ?? ''}`).filter((k) => !before.flags.has(k));
  marks.threads = st.drip.threads.slice(before.threads).map((t) => t.card);
  marks.promises = st.drip.promises.slice(before.promises).map((p) => ({ what: p.what, pawn: p.pawn }));
  marks.tales = st.chronicle.tales.filter((t) => !before.tales.has(t.id)).map((t) => t.id);
  for (const [id, f] of Object.entries(st.flats)) if (f.lease && before.rents.get(id) !== f.lease.rent) marks.rents.push({ flat: id, rent: f.lease.rent });
  into.push(marks);
}

/** Three days on: does anything the answer left still show? */
function stillShows(sim: Sim, m: Marks, opened: { def: string; tick: number }[], recapped: Set<number>): boolean {
  const st = sim.state;
  const pawn = (id: number) => st.pawns.find((p) => p.id === id);
  if (m.mems.some((x) => pawn(x.pawn)?.life?.memories.some((y) => y.id === x.id && y.at === x.at))) return true;
  if (m.socs.some((x) => pawn(x.pawn)?.life?.social.some((y) => y.id === x.id && y.about === x.about && y.at === x.at))) return true;
  if (m.flags.some((k) => st.drip.flags.some((f) => `${f.id}|${f.subject ?? ''}` === k))) return true;
  // A thread still on its way, or one that has come back as a card.
  if (m.threads.some((card) => st.drip.threads.some((t) => t.card === card) || opened.some((o) => o.def === card && o.tick > m.tick))) return true;
  // A promise still waiting, or kept or broken (and remembered).
  if (m.promises.some((x) => st.drip.promises.some((p) => p.what === x.what && p.pawn === x.pawn) || pawn(x.pawn)?.life?.memories.some((y) => (y.id === 'keptPromise' || y.id === 'brokePromise') && y.at > m.tick))) return true;
  if (m.tales.some((id) => recapped.has(id))) return true;
  if (m.rents.some((r) => st.flats[r.flat]?.lease?.rent === r.rent)) return true;
  return false;
}

/** The tale kinds only the drip's cards write (state.ts, TaleKind). */
const CARD_TALES = new Set<string>(['parcelNicked', 'lockout', 'cowboy', 'leak', 'cat', 'kittens', 'brokePromise', 'pritchard', 'fakeMeterMan', 'deposit', 'squatter', 'badTurn']);

const runs = new Map<string, Run>();

function play(seed: number, mode: Mode): Run {
  const key = `${seed}|${mode}`;
  if (runs.has(key)) return runs.get(key)!;
  const sim = Sim.create(seed);
  const st = sim.state;
  const policy: Policy = mode === 'ruthless' || mode === 'absentRuthless' ? 'ruthless' : 'decent';
  const run: Run = { days: new Map(), maxOpen: 0, visible: [], gaps: [], sources: {}, answered: [], cameBack: [0, 0, 0], recaps: [], liking: [], ignored: 0, ignoredMarked: 0 };
  const toss = coin(seed);
  const cards: Cards | undefined =
    mode === 'absentDecent' || mode === 'absentRuthless'
      ? 'ignore'
      : (s, c) => answerNoting(s, c, mode === 'decent' ? 0 : mode === 'ruthless' ? 1 : toss() < 0.5 ? 0 : 1, run.answered);
  const day = (d: number): Day => {
    if (!run.days.has(d)) run.days.set(d, { drip: 0, followUps: 0, busy: false, decisions: 0, letters: 0, applicants: 0, chats: 0 });
    return run.days.get(d)!;
  };
  const seenCards = new Set<number>();
  const seenLetters = new Set<number>(st.post.map((l) => l.id));
  const seenApplicants = new Set<number>(st.applicants.map((a) => a.id));
  const seenChats = new Set<number>(st.chat.map((c) => c.id));
  const promised = new Set<string>();
  const opened: { def: string; tick: number }[] = [];
  const bubbles = new Map<number, string>();
  const onMap = new Set<number>();
  const moments = new Set<string>();
  let lastLog = -1;
  let lastEvent = -1;
  const recapped = new Set<number>();
  const end = DAYS * TICKS_PER_DAY;
  while (st.tick < end) {
    // Threads due by the end of this minute: a card of one of these that opens now is it coming back.
    const due = new Set(st.drip.threads.filter((t) => t.due <= st.tick + TICKS_PER_MINUTE).map((t) => t.card));
    const followUpAt = st.drip.cooldowns.followUp;
    sim.run(TICKS_PER_MINUTE);
    const week = Math.floor((sim.day - 1) / 7);
    const m = sim.minuteOfDay;
    const waking = m >= WAKE && m < SLEEP;
    // Night cards spend the next day's budget, so they count for that day.
    const cardDay = m < WAKE ? sim.day : m >= SLEEP ? sim.day + 1 : sim.day;
    if (m === WAKE) day(sim.day).busy = st.story.running.length > 0 || st.council.visitDay === sim.day || st.post.filter((l) => l.choices && l.chosen === undefined).length >= 2;
    // New cards, letters with choices, applicants.
    run.maxOpen = Math.max(run.maxOpen, st.drip.open.length);
    for (const c of st.drip.open) {
      if (seenCards.has(c.id)) continue;
      seenCards.add(c.id);
      const def = cardDefOf(c.def)!;
      opened.push({ def: c.def, tick: st.tick });
      run.sources[def.source] = (run.sources[def.source] ?? 0) + 1;
      const thread = due.has(c.def) && st.drip.cooldowns.followUp !== followUpAt;
      // The first week's script deals its own (followUp) cards; after that a followUp card only comes from a thread.
      if (thread || def.followUp) day(cardDay).followUps++;
      else day(cardDay).drip++;
      day(cardDay).decisions++;
      if (thread) run.cameBack[week]++;
    }
    // A promise falling due: kept or broken, someone remembers it.
    for (const p of people(sim)) {
      for (const x of p.life!.memories) {
        if ((x.id !== 'keptPromise' && x.id !== 'brokePromise') || promised.has(`${p.id}|${x.at}`)) continue;
        promised.add(`${p.id}|${x.at}`);
        run.cameBack[week]++;
      }
    }
    for (const l of st.post) {
      if (seenLetters.has(l.id)) continue;
      seenLetters.add(l.id);
      if (l.choices) {
        day(sim.day).decisions++;
        day(sim.day).letters++;
      }
      // The Sunday recap: which tales it told.
      const week = /^Week (\d+) at /.exec(l.title);
      if (week) {
        const told = st.chronicle.tales.filter((t) => l.body.includes(t.text) || l.body.includes(t.text.charAt(0).toLowerCase() + t.text.slice(1)));
        for (const t of told) recapped.add(t.id);
        const fromCards = told.filter((t) => CARD_TALES.has(t.kind));
        run.recaps.push({ day: sim.day, tales: told.length, fromCards: fromCards.length });
      }
    }
    for (const a of st.applicants) {
      if (seenApplicants.has(a.id)) continue;
      seenApplicants.add(a.id);
      day(sim.day).decisions++;
      day(sim.day).applicants++;
    }
    for (const c of st.chat) {
      if (seenChats.has(c.id)) continue;
      seenChats.add(c.id);
      if (c.choices) day(sim.day).chats++;
    }
    // Cards resolved by being ignored: someone should hold it against you.
    for (const e of st.drip.log) {
      if (e.tick <= lastLog) continue;
      if (e.chose === 'ignored') {
        run.ignored++;
        if (people(sim).some((p) => p.life!.memories.some((x) => (x.id === 'ignored' || x.id === 'leftToIt') && x.at === e.tick))) run.ignoredMarked++;
      }
    }
    lastLog = st.drip.log.length > 0 ? st.drip.log[st.drip.log.length - 1].tick : lastLog;
    // What's on screen: who can be seen, and what has just started.
    let started = false;
    const here = new Set<number>();
    for (const p of st.pawns) {
      if (p.kind === 'passerby' || p.kind === 'animal' || p.life?.away) continue;
      here.add(p.id);
      if (!onMap.has(p.id)) started = true;
      const b = p.bubble ? `${p.bubble.text}|${p.bubble.until}` : '';
      if (b && bubbles.get(p.id) !== b) started = true;
      bubbles.set(p.id, b);
      const mo = p.life?.moment;
      if (mo && !moments.has(`${p.id}@${mo.until}`)) {
        moments.add(`${p.id}@${mo.until}`);
        started = true;
      }
    }
    onMap.clear();
    for (const id of here) onMap.add(id);
    if (waking) {
      const visible = st.pawns.filter((p) => (p.kind === 'tenant' || p.kind === 'visitor' || p.kind === 'agent' || p.kind === 'guest') && !p.life?.away && p.pose !== 'sleep').length;
      run.visible.push(visible);
      if (m === WAKE) lastEvent = m;
      if (started) {
        run.gaps.push(m - lastEvent);
        lastEvent = m;
      }
      if (m === SLEEP - 1) run.gaps.push(SLEEP - lastEvent);
    }
    // The end of each week: how much they like the place.
    if (m === 24 * 60 - 1 && sim.day % 7 === 0) {
      const t = people(sim).filter((p) => !p.life!.leaving);
      run.liking.push(t.reduce((n, p) => n + p.life!.liking, 0) / Math.max(1, t.length));
    }
    // Three days on from each answer, check what's left.
    for (const a of run.answered) if (a.live === undefined && st.tick - a.tick >= 3 * TICKS_PER_DAY) a.live = stillShows(sim, a, opened, recapped);
    if (st.tick % TICKS_PER_HOUR === 0) landlord(sim, policy, cards);
  }
  runs.set(key, run);
  return run;
}

const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / Math.max(1, xs.length);
const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const MODES: Mode[] = ['decent', 'ruthless', 'random'];

describe('the pacing soak', () => {
  for (const seed of SEEDS) {
    for (const mode of MODES) {
      describe(`seed ${seed}, ${mode}`, () => {
        it('drip cards: 0 to 2 a day plus at most one follow-up; a mean of 1 to 1.6 a day each week from week two; busy days have at most one', () => {
          const r = play(seed, mode);
          for (const d of range(8, DAYS)) {
            const x = r.days.get(d) ?? { drip: 0, followUps: 0, busy: false, decisions: 0 };
            expect(x.drip, `day ${d}`).toBeLessThanOrEqual(2);
            expect(x.followUps, `day ${d}`).toBeLessThanOrEqual(1);
            if (x.busy) expect(x.drip, `busy day ${d}`).toBeLessThanOrEqual(1);
          }
          for (const week of [2, 3]) {
            const perDay = mean(range(week * 7 - 6, week * 7).map((d) => r.days.get(d)?.drip ?? 0));
            expect(perDay, `week ${week}`).toBeGreaterThanOrEqual(1);
            expect(perDay, `week ${week}`).toBeLessThanOrEqual(1.6);
          }
        });

        it('decisions of any kind: 2 to 5 a day from day 8, on average; never more than 2 cards open', () => {
          const r = play(seed, mode);
          const perDay = mean(range(8, DAYS).map((d) => r.days.get(d)?.decisions ?? 0));
          expect(perDay).toBeGreaterThanOrEqual(2);
          expect(perDay).toBeLessThanOrEqual(5);
          expect(r.maxOpen).toBeLessThanOrEqual(2);
        });

        it('at least 2 people about in 95% of waking minutes; something new on screen at least every 67 game minutes, 9 times in 10', () => {
          const r = play(seed, mode);
          expect(r.visible.filter((n) => n >= 2).length / r.visible.length).toBeGreaterThanOrEqual(0.95);
          expect(percentile(r.gaps, 0.9)).toBeLessThanOrEqual(67);
        });

        it('street cards are at most 30% of the mix', () => {
          const r = play(seed, mode);
          const all = Object.values(r.sources).reduce((n, x) => n + x, 0);
          expect(all).toBeGreaterThan(0);
          expect((r.sources.street ?? 0) / all).toBeLessThanOrEqual(0.3);
        });
      });
    }

    it(`seed ${seed}: random answers leave a mark that still shows 3 days later, 60% of the time`, () => {
      const checked = play(seed, 'random').answered.filter((a) => a.live !== undefined);
      expect(checked.length).toBeGreaterThan(10);
      expect(checked.filter((a) => a.live).length / checked.length).toBeGreaterThanOrEqual(0.6);
    });

    it(`seed ${seed}: decent answers come back: a thread or promise card each week from week two, and 2 of each Sunday's tales from cards`, () => {
      const r = play(seed, 'decent');
      expect(r.cameBack[1], 'week 2').toBeGreaterThanOrEqual(1);
      expect(r.cameBack[2], 'week 3').toBeGreaterThanOrEqual(1);
      for (const recap of r.recaps.filter((x) => x.day >= 14)) expect(recap.fromCards, `day ${recap.day}`).toBeGreaterThanOrEqual(2);
    });

    it(`seed ${seed}: ignoring hurts: an absent landlord ends each week less liked, and every ignored card leaves an ignored or leftToIt`, () => {
      const decent = play(seed, 'decent');
      const ruthless = play(seed, 'ruthless');
      const absentD = play(seed, 'absentDecent');
      const absentR = play(seed, 'absentRuthless');
      for (let w = 0; w < 3; w++) {
        expect(absentD.liking[w], `week ${w + 1}, against decent`).toBeLessThan(decent.liking[w]);
        expect(absentR.liking[w], `week ${w + 1}, against ruthless`).toBeLessThan(ruthless.liking[w]);
      }
      for (const a of [absentD, absentR]) {
        expect(a.ignored).toBeGreaterThan(0);
        expect(a.ignoredMarked).toBe(a.ignored);
      }
    });
  }

  it('prints the numbers', () => {
    for (const seed of SEEDS) {
      for (const mode of [...MODES, 'absentDecent', 'absentRuthless'] as Mode[]) {
        const r = play(seed, mode);
        const drip = range(8, DAYS).map((d) => r.days.get(d)?.drip ?? 0);
        const all = Object.values(r.sources).reduce((n, x) => n + x, 0);
        const checked = r.answered.filter((a) => a.live !== undefined);
        console.log(
          `seed ${seed} ${mode.padEnd(14)} drip/day wk2 ${mean(drip.slice(0, 7)).toFixed(2)} wk3 ${mean(drip.slice(7)).toFixed(2)} [${drip.join('')}${range(8, DAYS).map((d) => (r.days.get(d)?.busy ? 'b' : '.')).join('')}]` +
            ` | decisions/day ${mean(range(8, DAYS).map((d) => r.days.get(d)?.decisions ?? 0)).toFixed(2)}` +
            ` (letters ${mean(range(8, DAYS).map((d) => r.days.get(d)?.letters ?? 0)).toFixed(2)} applicants ${mean(range(8, DAYS).map((d) => r.days.get(d)?.applicants ?? 0)).toFixed(2)} chat ${mean(range(8, DAYS).map((d) => r.days.get(d)?.chats ?? 0)).toFixed(2)} follow-ups ${mean(range(8, DAYS).map((d) => r.days.get(d)?.followUps ?? 0)).toFixed(2)}) | open max ${r.maxOpen}` +
            ` | visible>=2 ${((100 * r.visible.filter((n) => n >= 2).length) / r.visible.length).toFixed(1)}% | gap p90 ${percentile(r.gaps, 0.9)} p50 ${percentile(r.gaps, 0.5)}` +
            ` | street ${((100 * (r.sources.street ?? 0)) / Math.max(1, all)).toFixed(0)}% of ${all} | marks ${checked.filter((a) => a.live).length}/${checked.length}` +
            ` | back ${r.cameBack.join(',')} | recaps ${r.recaps.map((x) => `${x.fromCards}/${x.tales}`).join(' ')} | liking ${r.liking.map((x) => x.toFixed(0)).join(',')} | ignored ${r.ignoredMarked}/${r.ignored}`,
        );
      }
    }
  });
});
