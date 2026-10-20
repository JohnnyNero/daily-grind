import { describe, expect, it } from 'vitest';
import { expectGrade, expectName, expectThought, expectationsMorning, EXPECT_START } from '../src/sim/expectations';
import { MAX_TICKS_PER_FRAME, NIGHT_BOOST, BASE_TICKS_PER_SECOND, planTicks, quietNight } from '../src/sim/pace';
import { flatInfo } from '../src/sim/economy';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/state';
import { likingTarget, rentThought, thoughtsOf } from '../src/sim/thoughts';

const tenant = (sim: Sim) => sim.state.pawns.find((p) => p.life)!;

describe('expectations', () => {
  it('start low, and rise in a well-run building', () => {
    const sim = Sim.create(1);
    expect(expectName(sim)).toBe('Low');
    for (const r of [5, 5, 4, 5]) sim.state.reviews.push({ day: 1, who: 'A', flat: 'F', stars: r, text: 'Lovely.' });
    sim.state.expect.good = 40;
    for (const f of sim.layout.flats) flatInfo(sim, f.id).tier = 'Nice';
    for (let i = 0; i < 60; i++) expectationsMorning(sim);
    expect(sim.state.expect.level).toBeGreaterThan(60);
    expect(expectGrade(sim)).toBeGreaterThanOrEqual(2);
  });

  it('fall back when things go badly, faster than they rose', () => {
    const sim = Sim.create(1);
    sim.state.expect.level = 80;
    for (const r of [1, 1, 2, 1]) sim.state.reviews.push({ day: 1, who: 'A', flat: 'F', stars: r, text: 'Avoid.' });
    for (const f of sim.layout.flats) flatInfo(sim, f.id).tier = 'Shabby';
    sim.state.expect.good = 0;
    const before = sim.state.expect.level;
    expectationsMorning(sim);
    expect(before - sim.state.expect.level).toBeGreaterThan(1.5);
    for (let i = 0; i < 40; i++) expectationsMorning(sim);
    expect(sim.state.expect.level).toBeLessThan(45);
  });

  it('counts good days only while tenants are happy, and loses them when they are not', () => {
    const sim = Sim.create(2);
    for (const p of sim.state.pawns) if (p.life) p.life.liking = 70;
    expectationsMorning(sim);
    expect(sim.state.expect.good).toBe(1);
    for (const p of sim.state.pawns) if (p.life) p.life.liking = 20;
    sim.state.expect.good = 10;
    expectationsMorning(sim);
    expect(sim.state.expect.good).toBe(7);
  });

  it('lower the liking of the same tenant in the same flat, as a labelled thought', () => {
    const sim = Sim.create(3);
    // The one in the weaker flat: the other's flat is nice enough for anyone.
    const p = sim.state.pawns.find((q) => q.life && flatInfo(sim, q.life.flat).tier === 'Decent')!;
    sim.state.expect.level = 5;
    const low = thoughtsOf(sim, p);
    sim.state.expect.level = 95;
    const high = thoughtsOf(sim, p);
    expect(low.some((t) => t.label.startsWith('Expected better'))).toBe(false);
    const hoped = high.find((t) => t.label.startsWith('Expected better'));
    // A decent flat is a disappointment to someone who expects a great deal.
    expect(hoped).toBeDefined();
    expect(hoped!.value).toBeLessThan(0);
    expect(likingTarget(high)).toBeLessThan(likingTarget(low));
    // Every point is still a listed thought.
    expect(likingTarget(high)).toBeCloseTo(50 + high.reduce((n, t) => n + t.value, 0), 6);
  });

  it('feels worse about the same tier the more is expected, and only below what they expect', () => {
    expect(expectThought('Plain', 0)).toBeNull();
    expect(expectThought('Plain', 1)).toBeNull();
    expect(expectThought('Plain', 2)!.value).toBe(-3);
    expect(expectThought('Shabby', 3)!.value).toBeLessThan(expectThought('Plain', 3)!.value);
    expect(expectThought('Nice', 3)).toBeNull();
  });

  it('narrow the fair-rent band', () => {
    expect(rentThought(105, 100, 0)).toBeNull();
    expect(rentThought(105, 100, 3)!.label).toBe('Rent is steep');
    expect(rentThought(93, 100, 0)!.label).toBe('Fair rent');
    expect(rentThought(93, 100, 3)).toBeNull();
  });

  it('survive a save', () => {
    const sim = Sim.create(4);
    sim.state.expect.level = 61;
    expect(deserialize(serialize(sim)).state.expect.level).toBe(61);
    const raw = JSON.parse(serialize(sim));
    delete raw.expect;
    expect(deserialize(JSON.stringify(raw)).state.expect.level).toBe(EXPECT_START);
  });

  it('move with the morning clock in a real game', () => {
    const sim = Sim.create(5);
    sim.run(10 * TICKS_PER_DAY);
    expect(sim.state.expect.level).toBeGreaterThanOrEqual(0);
    expect(sim.state.expect.level).toBeLessThanOrEqual(100);
  });
});

describe('pace', () => {
  it('a day takes about seven minutes at 1x', () => {
    const minutes = TICKS_PER_DAY / BASE_TICKS_PER_SECOND / 60;
    expect(minutes).toBeGreaterThan(6.5);
    expect(minutes).toBeLessThan(7.5);
  });

  it('runs quiet nights faster, but not by day, and not when paused', () => {
    const plain = planTicks(0.1, 1, false, 0).ticks;
    expect(planTicks(0.1, 1, true, 0).ticks).toBeGreaterThanOrEqual(plain * NIGHT_BOOST - 1);
    expect(planTicks(0.1, 0, true, 0).ticks).toBe(0);
  });

  it('caps a frame so a slow phone stays smooth, and does not owe the lost time', () => {
    const p = planTicks(0.25, 8, true, 0);
    expect(p.ticks).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME);
    expect(planTicks(10, 8, true, 0).carry).toBe(0);
  });

  it('only skips when everyone is asleep or out and nothing is happening', () => {
    const sim = Sim.create(6);
    sim.state.handover.stop = -1;
    sim.state.pawns = sim.state.pawns.filter((p) => p.life);
    // Midday: never.
    sim.state.tick = 12 * TICKS_PER_HOUR;
    expect(quietNight(sim)).toBe(false);
    // Three in the morning, everyone in bed.
    sim.state.tick = 3 * TICKS_PER_HOUR;
    for (const p of sim.state.pawns) if (p.life) p.pose = 'sleep';
    expect(quietNight(sim)).toBe(true);
    // Someone awake.
    const t = tenant(sim);
    t.pose = undefined;
    expect(quietNight(sim)).toBe(false);
    t.pose = 'sleep';
    // A happening.
    sim.state.story.running.push({ id: 99, kind: 'party', until: sim.state.tick + 100, pawns: [] });
    expect(quietNight(sim)).toBe(false);
    sim.state.story.running = [];
    // A request waiting for an answer.
    sim.state.chat.push({ id: 98, tick: sim.state.tick, from: t.id, who: 'X', text: 'Hi', choices: [{ label: 'a', note: '', act: 'x' }] });
    expect(quietNight(sim)).toBe(false);
    sim.state.chat = [];
    expect(quietNight(sim)).toBe(true);
  });

  it('really does find quiet nights in a played game', () => {
    const sim = Sim.create(7);
    let quiet = 0;
    for (let h = 0; h < 5 * 24 * 4; h++) {
      sim.run(TICKS_PER_HOUR / 4);
      if (quietNight(sim)) quiet++;
    }
    expect(quiet).toBeGreaterThan(5);
  });
});
