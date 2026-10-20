import { describe, expect, it } from 'vitest';
import { furnitureProblem, placeFurniture } from '../src/sim/build';
import { flatInfo } from '../src/sim/economy';
import { skipHandover } from '../src/sim/handover';
import { accept, makePerson, newApplicant } from '../src/sim/leases';
import { HABIT_DEFS, awayToday, homeAndAwake, rollHabits } from '../src/sim/schedules';
import { Sim } from '../src/sim/sim';
import { scoreFor } from '../src/sim/impressiveness';
import { TICKS_PER_DAY, TICKS_PER_MINUTE, type NeedId, type Pawn, type Schedule } from '../src/sim/state';
import { HABITS, SCHEDULES } from '../src/sim/tuning';
import { landlord } from './policy';

const tenantsOf = (sim: Sim) => sim.state.pawns.filter((p) => p.life && !p.life.leaving);

/** Furnishes the bare flats with the basics and lets every flat to an applicant. */
function letEverything(sim: Sim): void {
  const st = sim.state;
  for (const f of sim.layout.flats) {
    const info = flatInfo(sim, f.id);
    if (info.lease) continue;
    const has = scoreFor(sim, f.id, 1).has;
    const want = [!has.bed && 'bed', !has.toilet && 'toilet', !has.wash && 'shower', !has.kitchen && 'cooker', !has.kitchen && 'fridge', 'sofa', 'smokeAlarm'].filter(Boolean) as string[];
    const cells = sim.layout.flatCells(f).map((n) => sim.layout.xs(n));
    for (const def of want) {
      for (const [x, s] of cells) {
        if (typeof furnitureProblem(st, def, x, s) === 'string') continue;
        placeFurniture(st, def, x, s, false, 'standard');
        break;
      }
    }
    sim.changed();
    const a = newApplicant(sim, f.id);
    st.applicants.push(a);
    accept(sim, a.id);
  }
}

interface Soak {
  /** Weekday samples 10:00 to 16:00: the share of tenants home and awake. */
  homeShare: number[];
  /** Waking-hours means of each need. */
  needs: Record<NeedId, number>;
  /** Working days: set off in time, and late. */
  onTime: number;
  late: string[];
  /** Habit slots: kept, and missed. */
  kept: number;
  missed: string[];
}

const soaks = new Map<number, Soak>();

/** 14 days with every flat let by the decent landlord, watched every game minute. */
function soak(seed: number): Soak {
  if (soaks.has(seed)) return soaks.get(seed)!;
  const sim = Sim.create(seed);
  skipHandover(sim);
  letEverything(sim);
  const out: Soak = { homeShare: [], needs: {} as Record<NeedId, number>, onTime: 0, late: [], kept: 0, missed: [] };
  const sums: Record<string, number> = {};
  let needSamples = 0;
  // Per tenant and day: when they went off to their hours, and which habit slots they started.
  const leftAt = new Map<string, number>();
  const started = new Set<string>();
  const goingTo = new Map(Object.values(HABIT_DEFS).map((d) => [d.going, d.id]));
  const doingAt = new Map(Object.values(HABIT_DEFS).map((d) => [d.doing, d.id]));
  // Due slots, checked once the day is done: tenant, habit, day, slot time, and whether they were free then.
  const due: { p: Pawn; habit: string; day: number; at: number }[] = [];
  const end = sim.state.tick + 14 * TICKS_PER_DAY;
  while (sim.state.tick < end) {
    sim.run(TICKS_PER_MINUTE);
    if (sim.state.tick % (60 * TICKS_PER_MINUTE) === 0) landlord(sim, 'decent');
    const m = sim.minuteOfDay;
    const day = sim.day;
    const ts = tenantsOf(sim);
    const weekday = (day - 1) % 7 < 5;
    if (weekday && m >= 10 * 60 && m < 16 * 60 && ts.length > 0) out.homeShare.push(ts.filter((p) => homeAndAwake(sim, p)).length / ts.length);
    for (const p of ts) {
      const life = p.life!;
      if (m >= 7 * 60 && m < 23 * 60 && !life.away) {
        for (const [k, v] of Object.entries(life.needs)) sums[k] = (sums[k] ?? 0) + v;
        needSamples++;
      }
      const left = `${p.id}:${day}`;
      if (!leftAt.has(left) && (life.away?.why === 'At work' || life.away?.why === 'At college')) leftAt.set(left, m);
      const habit = goingTo.get(p.doing) ?? doingAt.get(p.doing);
      if (habit) started.add(`${p.id}:${habit}:${day}`);
    }
    // At each habit's time, note who's free to keep it: at home in their flat, awake, not busy or on their way out.
    for (const p of ts) {
      const life = p.life!;
      const here = sim.layout.flatAt(Math.round(p.x), Math.round(p.s));
      if (here?.id !== life.flat || !homeAndAwake(sim, p) || life.using || p.task === 'leave' || life.breakState || life.moment) continue;
      for (const id of life.habits) {
        const def = HABIT_DEFS[id];
        for (const at of def.at) if (m === at && (!def.ok || def.ok(sim, p))) due.push({ p, habit: id, day, at });
      }
    }
  }
  for (const k of Object.keys(sums)) out.needs[k as NeedId] = sums[k] / needSamples;
  // Working days: off the map by the start of their hours (a few minutes' grace for the stairs).
  for (const [k, m] of leftAt) {
    const [id, day] = k.split(':').map(Number);
    const p = sim.state.pawns.find((o) => o.id === id);
    if (!p?.life) continue;
    const hours = awayToday({ day, state: sim.state } as unknown as Sim, p.life);
    if (!hours) continue;
    if (m <= hours.leave + 5) out.onTime++;
    else out.late.push(`${p.name} (${p.life.schedule}) day ${day} left at ${m}, due ${hours.leave}`);
  }
  for (const d of due) {
    if (started.has(`${d.p.id}:${d.habit}:${d.day}`)) out.kept++;
    else out.missed.push(`${d.p.name} ${d.habit} day ${d.day}`);
  }
  soaks.set(seed, out);
  return out;
}

const SEEDS = [1, 2, 3];

describe('schedules', () => {
  it('rolls schedules in their shares, with jobs to match', () => {
    const sim = Sim.create(9);
    const counts: Record<string, number> = {};
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const p = makePerson(sim.state);
      counts[p.schedule!] = (counts[p.schedule!] ?? 0) + 1;
      const working = ['office', 'early', 'late', 'nights'].includes(p.schedule!);
      expect(!!p.job, p.schedule).toBe(working);
    }
    for (const [s, share] of Object.entries(SCHEDULES.share)) expect(counts[s] / n, s).toBeCloseTo(share, 1);
  });

  it('gives everyone one or two habits that suit them', () => {
    const sim = Sim.create(9);
    for (let i = 0; i < 500; i++) {
      const person = makePerson(sim.state);
      const life = { schedule: person.schedule as Schedule, traits: person.traits } as Parameters<typeof rollHabits>[1];
      const habits = rollHabits(sim.state, life);
      expect(habits.length).toBeGreaterThanOrEqual(1);
      expect(habits.length).toBeLessThanOrEqual(HABITS.most);
      if (person.schedule === 'home') expect(habits).toContain('laptop');
      for (const h of habits) expect(HABIT_DEFS[h]).toBeDefined();
    }
  });

  it('the starting cast: Flat 1 works from home, Bill keeps his routine', () => {
    const sim = Sim.create(4);
    const [one, , , four] = sim.layout.flats;
    const flat1 = tenantsOf(sim).find((p) => p.life!.flat === one.id)!;
    const bill = tenantsOf(sim).find((p) => p.life!.flat === four.id)!;
    expect(flat1.life!.schedule).toBe('home');
    expect(flat1.life!.traits).toContain('paysEarly');
    expect(bill.name.startsWith('Bill ')).toBe(true);
    expect(bill.life!.schedule).toBe('retired');
    expect(bill.life!.habits).toEqual(expect.arrayContaining(['paper', 'shops', 'telly', 'cuppa', 'earlyNight']));
    // Both in most of the day from the first morning, and nearly always one of them.
    skipHandover(sim);
    let flat1s = 0;
    let either = 0;
    let bills = 0;
    let samples = 0;
    for (let t = 0; t < 3 * TICKS_PER_DAY; t += TICKS_PER_MINUTE) {
      sim.run(TICKS_PER_MINUTE);
      const m = sim.minuteOfDay;
      if (m < 10 * 60 || m >= 16 * 60) continue;
      samples++;
      if (homeAndAwake(sim, flat1)) flat1s++;
      if (homeAndAwake(sim, bill)) bills++;
      if (homeAndAwake(sim, flat1) || homeAndAwake(sim, bill)) either++;
    }
    expect(flat1s / samples).toBeGreaterThan(0.6);
    expect(bills / samples).toBeGreaterThan(0.5);
    expect(either / samples).toBeGreaterThan(0.85);
  });

  it('on weekdays 10:00 to 16:00, at least 40% of tenants are home and awake', () => {
    for (const seed of SEEDS) {
      const s = soak(seed);
      const mean = s.homeShare.reduce((a, b) => a + b, 0) / s.homeShare.length;
      expect(mean, `seed ${seed}`).toBeGreaterThanOrEqual(0.4);
    }
  });

  it('nobody misses work, or a habit, for the walk', () => {
    const all = SEEDS.map(soak);
    const onTime = all.reduce((n, s) => n + s.onTime, 0);
    const late = all.flatMap((s) => s.late);
    const kept = all.reduce((n, s) => n + s.kept, 0);
    const missed = all.flatMap((s) => s.missed);
    expect(onTime).toBeGreaterThan(30);
    expect(late.length / (onTime + late.length), late.slice(0, 5).join('; ')).toBeLessThanOrEqual(0.05);
    expect(kept).toBeGreaterThan(30);
    expect(missed.length / (kept + missed.length), missed.slice(0, 5).join('; ')).toBeLessThanOrEqual(0.15);
  });

  it('needs stay in their bands', () => {
    // Before schedules (everyone office hours or none), this soak's waking means were about:
    // sleep 0.58, food 0.56, hygiene 0.68, bladder 0.62, fun 0.42, comfort 0.43.
    for (const seed of SEEDS) {
      const { needs } = soak(seed);
      expect(needs.sleep, `seed ${seed}`).toBeGreaterThan(0.5);
      expect(needs.food, `seed ${seed}`).toBeGreaterThan(0.48);
      expect(needs.hygiene, `seed ${seed}`).toBeGreaterThan(0.6);
      expect(needs.bladder, `seed ${seed}`).toBeGreaterThan(0.55);
      expect(needs.fun, `seed ${seed}`).toBeGreaterThan(0.32);
      expect(needs.comfort, `seed ${seed}`).toBeGreaterThan(0.32);
    }
  });

  it('night-shift tenants sleep in the day and are out at night', () => {
    const sim = Sim.create(6);
    skipHandover(sim);
    letEverything(sim);
    const nights = tenantsOf(sim).find((p) => p.life!.flat !== sim.layout.flats[0].id && p.life!.flat !== sim.layout.flats[3].id)!;
    const person = makePerson(sim.state, undefined, 'nights');
    nights.life!.schedule = 'nights';
    nights.life!.job = person.job;
    nights.life!.habits = [];
    let dayAsleep = 0;
    let daySamples = 0;
    let nightOut = 0;
    let nightSamples = 0;
    for (let t = 0; t < 7 * TICKS_PER_DAY; t += 10 * TICKS_PER_MINUTE) {
      sim.run(10 * TICKS_PER_MINUTE);
      const wd = (sim.day - 1) % 7;
      const m = sim.minuteOfDay;
      // Mornings after a shift (Tuesday to Saturday), and the shifts themselves (Monday to Friday nights).
      if (wd >= 1 && wd <= 5 && m >= 9 * 60 && m < 13 * 60) {
        daySamples++;
        if (nights.pose === 'sleep') dayAsleep++;
      }
      if (wd <= 4 && m >= 22 * 60) {
        nightSamples++;
        if (nights.life!.away) nightOut++;
      }
    }
    expect(dayAsleep / daySamples).toBeGreaterThan(0.75);
    expect(nightOut / nightSamples).toBeGreaterThan(0.9);
  });
});
