import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tenants } from '../src/sim/chat';
import { cardDef } from '../src/sim/cards';
import { fixtureSim, sitting } from '../src/sim/cards/rule';
import type { CardDef, CardSubject, Outcome } from '../src/sim/cards/types';
import { answerCard, cardSeen, dayBudget, dripDayStart, dripMorning, FLAGS, HOLD, openCard, openCards, READERS, resolveCard, setFlag, hasFlag, useCatalogue } from '../src/sim/drip';
import { hooksOf, HOOK_NAMES, readFlags } from '../src/sim/flags';
import { mend } from '../src/sim/upkeep';
import { burglaryRisk, waysIn } from '../src/sim/crime';
import * as pace from '../src/sim/pace';
import { planTicks, quietNight, skipToMorning } from '../src/sim/pace';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../src/sim/state';
import { DRIP } from '../src/sim/tuning';

// The drip engine (spec 1.1, 1.2, 1.5, 1.6) and Skip to morning (0.2), on a small test-only
// set of cards: the real catalogue is written elsewhere and checked by the rule test.

const MIN = TICKS_PER_MINUTE;
const choices = (): [{ label: string; note: string }, { label: string; note: string }] => [
  { label: 'Yes', note: 'Fine' },
  { label: 'No', note: 'Not fine' },
];
const base = { source: 'tenant' as const, turnsOn: ['test'], fixtures: [], hook: () => 'Something.', text: () => 'Something is happening.', choices };

/** About a tenant: listened to, shrugged at, or left to it. A thread when you say yes. */
const tMoment: CardDef = {
  ...base,
  id: 'tMoment',
  kind: 'moment',
  cooldownDays: 0,
  when: (sim) => tenants(sim).map((p) => ({ pawn: p.id })),
  resolve: (_sim, c, a): Outcome => ({ effects: [`mem:${c.pawn}:${a === 0 ? 'landlordListened' : a === 1 ? 'landlordShrugged' : 'leftToIt'}`], notice: 'Done.' }),
};
/** About nobody in particular, so only the budget limits it. Yes starts a thread. */
const tBuilding: CardDef = {
  ...base,
  id: 'tBuilding',
  source: 'building',
  kind: 'moment',
  cooldownDays: 0,
  when: () => [{}],
  resolve: (_sim, _c, a): Outcome => ({ effects: a === 0 ? ['flag:bigBins', 'thread:tFollow:5'] : a === 1 ? ['risk:burglary:1:2'] : ['flag:nextDoorSore::3'], notice: 'Done.' }),
};
const tAsk: CardDef = { ...tMoment, id: 'tAsk', kind: 'ask', resolve: (_sim, c, a) => ({ effects: [`mem:${c.pawn}:${a === 'ignored' ? 'ignored' : 'landlordListened'}`], notice: 'Asked.' }) };
const tNight: CardDef = { ...tBuilding, id: 'tNight', night: true, cooldownDays: 1, resolve: (_sim, _c, a) => ({ effects: [a === 'ignored' ? 'flag:strayKey::2' : 'flag:keyUnderMat::2'], notice: 'Night.' }) };
const tFollow: CardDef = { ...tBuilding, id: 'tFollow', followUp: true, cooldownDays: 0, when: (_sim, from?: CardSubject) => (from ? [{}] : []), resolve: () => ({ effects: ['flag:owes'], notice: 'Followed up.' }) };
const tNever: CardDef = { ...tBuilding, id: 'tNever', when: () => [] };
const tRow: CardDef = { ...tBuilding, id: 'tRow', followUp: true, resolve: (_sim, c) => ({ effects: [`act:row:${c.data!.a}:${c.data!.b}`], notice: 'They had it out.' }) };
const tPromise: CardDef = { ...tBuilding, id: 'tPromise', followUp: true, resolve: (_sim, c, a) => ({ effects: a === 0 ? [`promise:mend:${c.furniture}:2`] : [], notice: 'Promised.' }) };

const ALL = [tMoment, tBuilding, tAsk, tNight, tFollow, tNever, tRow, tPromise];

afterEach(() => useCatalogue(null));

/** Ticks to the next time it's this minute of the day. */
function runTo(sim: Sim, day: number, minute: number): void {
  sim.run((day - 1) * TICKS_PER_DAY + minute * MIN - sim.state.tick);
}

/** Runs minute by minute, noting each card as it appears: its def, its tick, and whether it was a follow-up. */
function watch(sim: Sim, days: number, each?: (sim: Sim) => void): { def: string; tick: number }[] {
  const seen = new Map<number, { def: string; tick: number }>();
  let most = 0;
  for (let i = 0; i < days * 24 * 60; i++) {
    sim.run(MIN);
    for (const c of openCards(sim)) if (!seen.has(c.id)) seen.set(c.id, { def: c.def, tick: c.tick });
    most = Math.max(most, openCards(sim).length);
    each?.(sim);
  }
  expect(most).toBeLessThanOrEqual(DRIP.maxOpen);
  return [...seen.values()];
}

describe('the day\'s budget', () => {
  it('is 2 on a quiet day, and 0 with a happening and two letters waiting', () => {
    useCatalogue(ALL);
    const sim = fixtureSim(1, 9, 7);
    const st = sim.state;
    st.story.running = [];
    st.applicants = [];
    st.post = [];
    delete st.council.visitDay;
    dripMorning(sim);
    expect(st.drip.budget).toBe(2);
    st.story.running.push({ id: 900, kind: 'party', until: st.tick + TICKS_PER_HOUR, pawns: [], flat: sim.layout.flats[0].id });
    for (const id of [901, 902]) st.post.push({ id, day: sim.day, from: 'Council', title: 'A letter', body: '', read: false, choices: [{ label: 'a', note: '', act: 'fine:0' }, { label: 'b', note: '', act: 'fine:0' }], dueDay: sim.day + 3 });
    dripMorning(sim);
    expect(st.drip.budget).toBe(0);
    expect(dayBudget(sim)).toBe(0);
  });

  it('three cards ignored in a row take one off, until you answer one', () => {
    useCatalogue([tBuilding]);
    const sim = fixtureSim(1, 9, 10);
    for (let i = 0; i < 3; i++) {
      const c = openCard(sim, 'tBuilding')!;
      resolveCard(sim, c.id, 'ignored');
    }
    expect(sim.state.drip.ignoredRun).toBe(3);
    useCatalogue([tNever]);
    runTo(sim, 10, 7 * 60 - 1);
    sim.state.story.running = [];
    sim.state.applicants = [];
    sim.state.post = [];
    delete sim.state.council.visitDay;
    // Nothing to deal from here, so the budget stays as the morning set it.
    useCatalogue([tNever]);
    runTo(sim, 10, 7 * 60);
    expect(sim.state.drip.budget).toBe(1);
    const c = openCard(sim, 'tNever')!;
    answerCard(sim, c.id, 1);
    expect(sim.state.drip.ignoredRun).toBe(0);
  });
});

describe('cadence', () => {
  it('over 14 days: never more than 2 cards a day plus one follow-up, 240 minutes apart, never more than 2 open', () => {
    useCatalogue([tBuilding, tNight, tFollow]);
    const sim = fixtureSim(5, 2, 7);
    // Answer yes to everything at once, so the tray never holds anything up and threads come.
    const cards = watch(sim, 14, (s) => {
      for (const c of [...openCards(s)]) if (c.def === 'tBuilding' && s.state.tick - c.tick >= 30 * MIN) answerCard(s, c.id, 0);
    });
    expect(cards.length).toBeGreaterThan(10);
    expect(cards.some((c) => c.def === 'tFollow')).toBe(true);
    const days = new Map<number, { plain: number; follow: number }>();
    for (const c of cards) {
      const day = Math.floor((c.tick - 7 * 60 * MIN) / TICKS_PER_DAY);
      const d = days.get(day) ?? { plain: 0, follow: 0 };
      if (c.def === 'tFollow') d.follow++;
      else d.plain++;
      days.set(day, d);
    }
    for (const [, d] of days) {
      expect(d.plain).toBeLessThanOrEqual(DRIP.perDay);
      expect(d.follow).toBeLessThanOrEqual(DRIP.overBudget);
    }
    const ticks = cards.map((c) => c.tick).sort((a, b) => a - b);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBeGreaterThanOrEqual(DRIP.minGap * MIN);
  });

  it('never more than 2 open when nobody answers anything, asks and all', () => {
    useCatalogue([tBuilding, tAsk, tMoment, tNight]);
    const sim = fixtureSim(2, 2, 7);
    const cards = watch(sim, 14);
    expect(cards.length).toBeGreaterThan(5);
  });

  it('an unspent budget is gone at 23:00, and no card is forced', () => {
    useCatalogue([tNever]);
    const sim = fixtureSim(1, 9, 6);
    const cards = watch(sim, 2, (s) => {
      if (s.minuteOfDay === 22 * 60 + 59) expect(s.state.drip.budget).toBeGreaterThan(0);
      if (s.minuteOfDay === 23 * 60) expect(s.state.drip.budget).toBe(0);
    });
    expect(cards).toEqual([]);
  });

  it('same seed, same cards', () => {
    const play = () => {
      useCatalogue([tBuilding, tMoment, tAsk, tNight, tFollow]);
      const sim = fixtureSim(3, 2, 7);
      watch(sim, 6, (s) => {
        for (const c of [...openCards(s)]) if (s.state.tick - c.tick >= 60 * MIN) answerCard(s, c.id, c.id % 2 === 0 ? 0 : 1);
      });
      return sim.state.drip.log;
    };
    const a = play();
    const b = play();
    expect(a.length).toBeGreaterThan(3);
    expect(b).toEqual(a);
  });
});

describe('ignoring a card', () => {
  beforeEach(() => useCatalogue(ALL));

  /** The day's budget already spent, so the drip deals nothing else while a test watches one card. */
  const spent = (sim: Sim) => {
    sim.state.drip.day = sim.day;
    sim.state.drip.budget = 0;
    return sim;
  };

  it('a moment resolves at its worst when its countdown ends', () => {
    const sim = spent(fixtureSim(1, 9, 10));
    const pawn = sitting(sim)[0];
    const c = openCard(sim, 'tMoment', { pawn: pawn.id })!;
    expect(c.until - c.tick).toBe(DRIP.life.moment * MIN);
    sim.run(c.until - sim.state.tick - MIN);
    expect(openCards(sim)).toHaveLength(1);
    sim.run(MIN);
    expect(openCards(sim)).toHaveLength(0);
    expect(sim.state.drip.log.at(-1)).toMatchObject({ card: 'tMoment', chose: 'ignored' });
    expect(pawn.life!.memories.some((m) => m.id === 'leftToIt')).toBe(true);
  });

  it('an ask gets kept waiting at 480 and 960 minutes, and resolves at its worst at 1,440', () => {
    // Only the ask in the catalogue, so nothing else comes in the day it waits.
    useCatalogue([tAsk]);
    const sim = spent(fixtureSim(1, 9, 8));
    const pawn = sitting(sim)[1];
    const c = openCard(sim, 'tAsk', { pawn: pawn.id })!;
    const waited = () => pawn.life!.memories.filter((m) => m.id === 'keptWaiting').length;
    sim.run(479 * MIN);
    expect(waited()).toBe(0);
    sim.run(MIN);
    expect(waited()).toBe(1);
    expect(c.step).toBe(1);
    sim.run(479 * MIN);
    expect(waited()).toBe(1);
    sim.run(MIN);
    expect(waited()).toBe(2);
    sim.run(479 * MIN);
    expect(openCards(sim)).toHaveLength(1);
    // The next morning's budget spent too, so the ask isn't dealt again the minute it goes.
    spent(sim);
    sim.run(MIN);
    expect(openCards(sim)).toHaveLength(0);
    expect(pawn.life!.memories.some((m) => m.id === 'ignored')).toBe(true);
    expect(waited()).toBe(2);
  });

  it('a card is never resolved before its 10-real-second tick', () => {
    const sim = spent(fixtureSim(1, 9, 10));
    const c = openCard(sim, 'tBuilding')!;
    // The UI saw it at 8x and its 10 seconds aren't up until well past its end.
    cardSeen(sim, c.id, c.until + 30 * MIN);
    sim.run(c.until + 29 * MIN - sim.state.tick);
    expect(openCards(sim)).toHaveLength(1);
    sim.run(MIN);
    expect(openCards(sim)).toHaveLength(0);
    // Held while the UI counts.
    const d = openCard(sim, 'tBuilding')!;
    cardSeen(sim, d.id, HOLD);
    sim.run(d.until - sim.state.tick + 60 * MIN);
    expect(openCards(sim)).toHaveLength(1);
    // Headless, as if at 1x: 10 real seconds is 33 game minutes, so it binds only when a card's nearly due.
    expect(Math.ceil((10 / 0.3) * MIN)).toBeLessThan(DRIP.life.door * MIN);
  });
});

describe('flags', () => {
  it('one for good survives save and load; a timed one goes when it\'s due', () => {
    useCatalogue(ALL);
    const sim = fixtureSim(1, 9, 10);
    setFlag(sim, 'bigBins');
    setFlag(sim, 'estimated', undefined, sim.state.tick + TICKS_PER_DAY);
    const back = deserialize(serialize(sim));
    expect(hasFlag(back, 'bigBins')).toBe(true);
    expect(hasFlag(back, 'estimated')).toBe(true);
    back.run(TICKS_PER_DAY + MIN);
    expect(hasFlag(back, 'bigBins')).toBe(true);
    expect(hasFlag(back, 'estimated')).toBe(false);
    expect(back.state.drip.flags.some((f) => f.id === 'estimated')).toBe(false);
  });

  it('every flag has a reader, and every hook a flag names is read', () => {
    for (const [id, def] of Object.entries(FLAGS)) {
      expect(def.readBy.length, id).toBeGreaterThan(0);
      for (const hook of hooksOf(def)) expect(READERS[id]?.[hook as keyof (typeof READERS)[string]], `${id} at ${hook}`).toBeTypeOf('function');
      for (const hook of Object.keys(READERS[id] ?? {})) expect(def.readBy, `${id} reads ${hook} but doesn't say so`).toContain(hook);
    }
    for (const id of Object.keys(READERS)) {
      expect(id in FLAGS || id.startsWith('risk:'), id).toBe(true);
      for (const hook of Object.keys(READERS[id])) expect(HOOK_NAMES).toContain(hook);
    }
  });

  it('do what they say where they\'re read', () => {
    const sim = fixtureSim(1, 9, 10);
    const risk = burglaryRisk(sim);
    setFlag(sim, 'keyUnderMat');
    expect(burglaryRisk(sim)).toBeGreaterThan(risk);
    const flat = sim.layout.flats[0].id;
    expect(readFlags(sim, 'letting.hours', 10, { flat })).toBe(10);
    setFlag(sim, 'slowLet', flat, sim.state.tick + TICKS_PER_DAY);
    expect(readFlags(sim, 'letting.hours', 10, { flat })).toBeGreaterThan(10);
    const windows = waysIn(sim).filter((w) => w.entry === 'window' && w.flat);
    if (windows.length > 0) {
      setFlag(sim, 'bars', windows[0].flat);
      expect(waysIn(sim).filter((w) => w.entry === 'window' && w.flat === windows[0].flat)).toHaveLength(0);
    }
  });
});

describe('what cards lead to', () => {
  beforeEach(() => useCatalogue(ALL));

  it('a happening a card leads to goes through the storyteller and puts its tag on cooldown', () => {
    const sim = fixtureSim(1, 10, 15);
    const [a, b] = sitting(sim);
    const st = sim.state;
    st.story.running = [];
    st.story.cooldowns = {};
    for (let i = 0; i < 3; i++) {
      a.life!.social.push({ id: 'row', about: b.id, at: st.tick });
      b.life!.social.push({ id: 'row', about: a.id, at: st.tick });
    }
    // A fight's a sure thing for these two this week.
    setFlag(sim, 'risk:fight', `4@${a.id}`, st.tick + TICKS_PER_DAY);
    const c = openCard(sim, 'tRow', { data: { a: a.id, b: b.id } })!;
    resolveCard(sim, c.id, 0);
    expect(st.story.running.some((h) => h.kind === 'fight')).toBe(true);
    expect(st.story.cooldowns.fight).toBeGreaterThan(st.tick);
    // And with fights cooling down, the same row starts nothing.
    st.story.running = [];
    const d = openCard(sim, 'tRow', { data: { a: a.id, b: b.id } })!;
    resolveCard(sim, d.id, 0);
    expect(st.story.running.some((h) => h.kind === 'fight')).toBe(false);
  });

  it('a promise checks the real thing on its day', () => {
    const setUp = () => {
      const sim = fixtureSim(1, 9, 10);
      const shower = sim.state.furniture.find((f) => f.def === 'shower' && (f.wear ?? 0) > 0.6)!;
      const bill = sitting(sim)[1];
      const c = openCard(sim, 'tPromise', { pawn: bill.id, furniture: shower.id })!;
      resolveCard(sim, c.id, 0);
      expect(sim.state.drip.promises).toHaveLength(1);
      return { sim, shower, bill };
    };
    const has = (sim: Sim, id: number, mem: string) => sim.state.pawns.find((p) => p.id === id)!.life!.memories.some((m) => m.id === mem);
    // Kept: mended in time.
    const kept = setUp();
    expect(mend(kept.sim, kept.shower.id)).toBeNull();
    runTo(kept.sim, 10, 7 * 60 + 1);
    expect(has(kept.sim, kept.bill.id, 'keptPromise')).toBe(true);
    expect(kept.sim.state.drip.promises).toHaveLength(0);
    // Broken: still worn the morning after the day.
    const broken = setUp();
    runTo(broken.sim, 11, 7 * 60 + 1);
    expect(has(broken.sim, broken.bill.id, 'brokePromise')).toBe(false);
    expect(broken.sim.state.drip.promises).toHaveLength(1);
    runTo(broken.sim, 12, 7 * 60 + 1);
    expect(has(broken.sim, broken.bill.id, 'brokePromise')).toBe(true);
    expect(broken.sim.state.chat.some((m) => m.text.startsWith('Still waiting on the shower'))).toBe(true);
  });
});

describe('Skip to morning', () => {
  /** A played game, at its first quiet night. */
  function quiet(seed: number): Sim {
    const sim = Sim.create(seed);
    sim.run(23 * TICKS_PER_HOUR - sim.state.tick);
    for (let i = 0; i < 6 * 60 && !quietNight(sim); i++) sim.run(MIN);
    expect(quietNight(sim)).toBe(true);
    return sim;
  }

  it('plays the same ticks as running to 07:00', () => {
    const a = quiet(7);
    const b = deserialize(serialize(a));
    const from = a.state.tick;
    const result = skipToMorning(a, TICKS_PER_DAY);
    expect(result).not.toBe('more');
    if (result === 'morning') expect(a.minuteOfDay).toBe(7 * 60);
    b.run(a.state.tick - from);
    expect(serialize(b)).toBe(serialize(a));
  });

  it('stops when something wakes', () => {
    // A quiet night first (the test cards would deal their own in the evening), then the thread.
    const sim = quiet(7);
    useCatalogue(ALL);
    sim.state.drip.threads.push({ card: 'tFollow', due: sim.state.tick + TICKS_PER_HOUR, data: {} });
    expect(skipToMorning(sim, TICKS_PER_DAY)).toBe('woke');
    expect(openCards(sim).map((c) => c.def)).toEqual(['tFollow']);
    expect(sim.minuteOfDay).not.toBe(7 * 60);
    expect(quietNight(sim)).toBe(false);
  });

  it('nothing else changes the speed', () => {
    expect('NIGHT_BOOST' in pace).toBe(false);
    expect(planTicks.length).toBe(3);
    const sim = quiet(7);
    expect(quietNight(sim)).toBe(true);
    expect(planTicks(0.1, 1, 0)).toEqual(planTicks(0.1, 1, 0));
    expect(planTicks(0.1, 1, 0).ticks).toBe(Math.floor(0.1 * pace.BASE_TICKS_PER_SECOND));
  });
});

describe('the first week', () => {
  it('plays the script instead of the daily budget: only follow-up cards, at most 3 a day', () => {
    useCatalogue(null);
    const sim = Sim.create(1);
    const cards = watch(sim, 7, (s) => {
      for (const c of [...openCards(s)]) if (s.state.tick - c.tick >= 40 * MIN) answerCard(s, c.id, 0);
    });
    expect(cards.length).toBeGreaterThanOrEqual(7);
    const perDay = new Map<number, number>();
    for (const c of cards) {
      expect(cardDef(c.def)?.followUp, c.def).toBe(true);
      const day = Math.floor(c.tick / TICKS_PER_DAY);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    for (const [, n] of perDay) expect(n).toBeLessThanOrEqual(3);
  });
});

describe('the drip\'s day', () => {
  it('starts at 07:00, so night cards belong to the day after', () => {
    const sim = fixtureSim(1, 9, 3);
    expect(dripDayStart(sim)).toBe(7 * TICKS_PER_DAY + 7 * TICKS_PER_HOUR);
    sim.state.tick = 8 * TICKS_PER_DAY + 7 * TICKS_PER_HOUR;
    expect(dripDayStart(sim)).toBe(sim.state.tick);
  });
});
