import { describe, expect, it } from 'vitest';
import v9 from './fixtures/v9-save.json?raw';
import { burglaryRisk, waysIn } from '../src/sim/crime';
import { binsOverflowing, gasBill } from '../src/sim/environment';
import { expectTarget } from '../src/sim/expectations';
import { READERS, readFlags, setFlag, type FlagHook } from '../src/sim/flags';
import { addPawn, setGoal } from '../src/sim/pawns';
import { BASE_TICKS_PER_SECOND } from '../src/sim/pace';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { SAVE_VERSION, TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, TICKS_PER_SECOND, seconds, type State } from '../src/sim/state';
import { issues } from '../src/sim/upkeep';

describe('the clock', () => {
  it('runs a game day in 28,800 ticks, about seven real minutes at 1x', () => {
    expect(TICKS_PER_MINUTE).toBe(20);
    expect(TICKS_PER_DAY).toBe(28_800);
    // Ticks a real second didn't change: 66.7 at 1x.
    expect(BASE_TICKS_PER_SECOND).toBeCloseTo(200 / 3, 6);
    expect(TICKS_PER_SECOND).toBeCloseTo(BASE_TICKS_PER_SECOND, 6);
    expect(TICKS_PER_DAY / BASE_TICKS_PER_SECOND / 60).toBeCloseTo(7.2, 1);
  });

  it('walks into the building in the same ticks as before the clock sped up', () => {
    const sim = Sim.create(1);
    const lay = sim.layout;
    const flat = lay.flats[3];
    const nodes = flat.rooms.flatMap((r) => lay.rooms[r].nodes).filter((n) => !lay.isDoorNode(n)).map((n) => lay.xs(n)).sort((a, b) => b[0] - a[0]);
    const p = addPawn(sim, 'agent');
    p.x = 0;
    p.s = 0;
    expect(setGoal(sim, p, nodes[0])).toBe(true);
    let ticks = 0;
    while (p.path.length > 0 && ticks < 5000) {
      sim.run(1);
      ticks++;
    }
    // From the street end to the far side of the top-floor studio, up two flights: 511 ticks then and now.
    expect(ticks).toBe(511);
  });

  it('times a bubble in real seconds: three seconds is 200 ticks', () => {
    expect(seconds(3)).toBe(200);
    const sim = Sim.create(2);
    // Someone walking past: nothing else gives them a bubble.
    const p = addPawn(sim, 'passerby');
    p.bubble = { text: '♪', until: sim.state.tick + seconds(3) };
    sim.run(199);
    expect(p.bubble?.until).toBeGreaterThan(sim.state.tick);
    sim.run(1);
    expect(p.bubble!.until).toBeLessThanOrEqual(sim.state.tick);
  });
});

describe('a version 9 save', () => {
  // Made by the game as it was before the clock change: day 3, 14:37 (ticks of 60 a minute).
  const old = JSON.parse(v9) as State;

  it('loads at the same game time, with every tick divided by three', () => {
    expect(old.version).toBe(9);
    const sim = deserialize(v9);
    const st = sim.state;
    expect(st.version).toBe(SAVE_VERSION);
    expect(st.tick).toBe(Math.round(old.tick / 3));
    expect(sim.day).toBe(3);
    expect(sim.minuteOfDay).toBe(14 * 60 + 37);
    // Timers and memories keep their place in game time.
    expect(st.timers.agent).toBe(Math.round(old.timers.agent / 3));
    const was = old.pawns.find((p) => p.life?.away)!;
    const now = st.pawns.find((p) => p.id === was.id)!;
    expect(now.life!.away!.until).toBe(Math.round(was.life!.away!.until / 3));
    expect(now.life!.memories[0].at).toBe(Math.round(was.life!.memories[0].at / 3));
    expect(st.story.until).toBe(Math.round(old.story.until / 3));
    for (const [id, f] of Object.entries(st.flats)) expect(f.nextApplicant).toBe(Math.round(old.flats[id].nextApplicant / 3));
  });

  it('gets an empty drip, schedules from jobs, no habits, and no visitors', () => {
    const st = deserialize(v9).state;
    expect(st.drip.open).toEqual([]);
    expect(st.drip.flags).toEqual([]);
    expect(st.drip.threads).toEqual([]);
    expect(st.visitors.next).toEqual({});
    expect(st.project).toEqual({});
    for (const p of st.pawns.filter((x) => x.life)) {
      expect(p.life!.schedule).toBe(p.life!.job ? 'office' : 'retired');
      expect(p.life!.habits).toEqual([]);
    }
  });

  it('plays on from there, and saves and loads as version 10 without shrinking again', () => {
    const sim = deserialize(v9);
    sim.run(6 * TICKS_PER_HOUR);
    const again = deserialize(serialize(sim));
    expect(again.state.tick).toBe(sim.state.tick);
    expect(serialize(again)).toBe(serialize(sim));
  });
});

describe('flag hooks', () => {
  const HOOKS: FlagHook[] = ['crime.risk', 'crime.ways', 'council.issues', 'upkeep.wear', 'planning.chance', 'letting.hours', 'outcomes.goodDays', 'outcomes.payEarly', 'expect.target', 'bills.gas', 'bins.overflowing', 'dirt.shared', 'story.weights', 'story.fight', 'story.party', 'story.split'];

  it('hand back exactly what they were given with no flags set, or with flags nobody reads', () => {
    const sim = Sim.create(3);
    const value = { any: 'thing' };
    for (const h of HOOKS) expect(readFlags(sim, h, value as never)).toBe(value);
    setFlag(sim, 'nobodyReadsThis');
    for (const h of HOOKS) expect(readFlags(sim, h, value as never)).toBe(value);
  });

  it('change nothing in a seeded game when the flags set have no readers', () => {
    const a = Sim.create(4);
    const b = Sim.create(4);
    setFlag(b, 'nobodyReadsThis');
    a.run(2 * TICKS_PER_DAY);
    b.run(2 * TICKS_PER_DAY);
    b.state.drip.flags = [];
    expect(serialize(b)).toBe(serialize(a));
  });

  it('are wired in: a reader on a live flag changes what the system works out', () => {
    const sim = Sim.create(5);
    READERS.testFlag = {
      'crime.risk': () => 0.99,
      'crime.ways': () => [],
      'council.issues': (_s, _f, list) => [...list, 'A test'],
      'expect.target': () => 77,
      'bills.gas': () => 12345,
      'bins.overflowing': () => true,
    };
    try {
      expect(burglaryRisk(sim)).not.toBe(0.99);
      setFlag(sim, 'testFlag', undefined, sim.state.tick + TICKS_PER_HOUR);
      expect(burglaryRisk(sim)).toBe(0.99);
      expect(waysIn(sim)).toEqual([]);
      expect(issues(sim)).toContain('A test');
      expect(expectTarget(sim)).toBe(77);
      expect(gasBill(sim)).toBe(12345);
      expect(binsOverflowing(sim)).toBe(true);
      // A timed flag stops counting when its time is up.
      sim.run(TICKS_PER_HOUR);
      expect(burglaryRisk(sim)).not.toBe(0.99);
    } finally {
      delete READERS.testFlag;
    }
  });
});
