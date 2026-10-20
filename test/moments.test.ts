import { describe, expect, it } from 'vitest';
import { MOMENT_KINDS, momentsRunning, tenantsIn } from '../src/sim/moments';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, TICKS_PER_SECOND } from '../src/sim/state';
import { SOCIAL } from '../src/sim/tuning';
import { landlord } from './policy';

interface Seen {
  kind: string;
  start: number;
  end?: number;
  /** Game minute of the day it began. */
  at: number;
}

/** Plays a decent landlord, watching every game minute, and notes each moment from start to finish. */
function watch(seed: number, days: number) {
  const sim = Sim.create(seed);
  const open = new Map<string, Seen>();
  const all: Seen[] = [];
  let worst = 0;
  const idle: number[] = [];
  let since = 0;
  for (let t = 0; t < days * TICKS_PER_DAY; t += TICKS_PER_MINUTE) {
    sim.run(TICKS_PER_MINUTE);
    if (sim.state.tick % TICKS_PER_HOUR === 0) landlord(sim, 'decent');
    worst = Math.max(worst, momentsRunning(sim));
    const now = new Set<string>();
    for (const p of sim.state.pawns) {
      const m = p.life?.moment;
      if (!m) continue;
      // Moving-in day's sitting down (visitors.ts starts it; the scheduler never does) is no ambient moment: a tenant's break can cut it short.
      if (m.kind === 'settlingIn') continue;
      if (m.with !== undefined && !m.lead) continue;
      // The same person can start another the minute one ends, so a moment is who and when it runs out.
      const id = `${p.id}@${m.until}`;
      now.add(id);
      if (!open.has(id)) {
        const s: Seen = { kind: m.kind, start: sim.state.tick, at: sim.minuteOfDay };
        open.set(id, s);
        all.push(s);
        since = 0;
      }
    }
    for (const [id, s] of open) {
      if (!now.has(id)) {
        s.end = sim.state.tick;
        open.delete(id);
      }
    }
    // Minutes of waking hours with 3 or more tenants in and nothing started.
    const people = tenantsIn(sim).length;
    const waking = sim.minuteOfDay >= 7 * 60 && sim.minuteOfDay < 23 * 60;
    if (waking && people >= 3) {
      since++;
      idle.push(since);
    } else if (!waking) since = 0;
  }
  return { sim, all, worst, longestWait: Math.max(0, ...idle) };
}

describe('ambient moments', () => {
  it('has a catalogue, and every kind it can play is named', () => {
    expect(MOMENT_KINDS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(MOMENT_KINDS).size).toBe(MOMENT_KINDS.length);
  });

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`seed ${seed}: never more than 2 at once, one starts at least every 100 minutes, each runs 5 to 30 seconds`, () => {
      const { all, worst, longestWait } = watch(seed, 10);
      expect(all.length).toBeGreaterThan(20);
      expect(worst).toBeLessThanOrEqual(2);
      expect(longestWait).toBeLessThanOrEqual(100);
      for (const s of all.filter((m) => m.end !== undefined)) {
        const secs = (s.end! - s.start) / TICKS_PER_SECOND;
        // A game minute is 0.3 of a second: allow one for how often it's checked.
        expect(secs, `${s.kind} on day ${Math.floor(s.start / TICKS_PER_DAY) + 1}`).toBeGreaterThanOrEqual(5 - 0.3);
        expect(secs, s.kind).toBeLessThanOrEqual(30 + 0.3);
      }
    });
  }

  it('plays a good mix, not the same scene over and over', () => {
    const { all } = watch(2, 10);
    const kinds = new Set(all.map((m) => m.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(5);
    for (const k of kinds) expect(all.filter((m) => m.kind === k).length / all.length, k).toBeLessThan(0.5);
  });

  it('only leaves marks that exist, and the same seed plays the same moments', () => {
    const a = watch(4, 4);
    const b = watch(4, 4);
    expect(a.all.map((m) => `${m.kind}@${m.start}`)).toEqual(b.all.map((m) => `${m.kind}@${m.start}`));
    for (const p of a.sim.state.pawns) for (const s of p.life?.social ?? []) expect(SOCIAL[s.id], s.id).toBeDefined();
  });

  it('survives a save and load in the middle of one', () => {
    const sim = Sim.create(3);
    let loaded = sim;
    for (let i = 0; i < 3 * 24 * 60; i++) {
      loaded.run(TICKS_PER_MINUTE);
      if (momentsRunning(loaded) > 0) {
        loaded = deserialize(serialize(loaded));
        loaded.run(60 * TICKS_PER_MINUTE);
        break;
      }
    }
    expect(momentsRunning(loaded)).toBeLessThanOrEqual(2);
    expect(loaded.state.pawns.filter((p) => p.life?.moment && !p.life.moment.kind).length).toBe(0);
  });
});
