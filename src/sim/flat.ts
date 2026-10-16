// The staff flat: the back plot behind the venue can become a flat where staff live.
// Live-ins stay on site off shift and get on with life (sleep, food, telly, each other),
// driven by the same needs and object offers as everything else. They pay a little rent,
// never miss a shift to the commute, and are never quite off the clock.

import { canSpend } from './business';
import { reachProblem } from './manage';
import { randInt } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_MINUTE, type Job, type Pawn } from './state';
import { PLOT_W } from './world';

/** Rent a live-in pays each night, pence. */
export const FLAT_RENT = 800;
export const FLAT_COST = 150000;

export function beds(sim: Sim): number {
  return sim.state.objects.filter((o) => o.def === 'bed').length;
}

export function hasFlat(sim: Sim): boolean {
  return beds(sim) > 0 && sim.state.tiles.some((t) => t.floor === 'R' && !t.wall);
}

export function liveIns(sim: Sim): Pawn[] {
  return sim.state.pawns.filter((p) => p.staff?.livesIn && !p.staff.quit);
}

/** Someone who lives in and has a flat to go back to. */
export function livesHere(sim: Sim, p: Pawn): boolean {
  return p.staff?.livesIn === true && !p.staff.quit && hasFlat(sim);
}

export function setLivesIn(sim: Sim, p: Pawn, on: boolean): string | null {
  if (!p.staff || p.staff.quit) return "They're not on the team.";
  if (!on) {
    p.staff.livesIn = false;
    return null;
  }
  if (!hasFlat(sim)) return 'There is no staff flat yet. Build one on the plot out back.';
  if (liveIns(sim).length >= beds(sim)) return 'Every bed is taken. Buy another bed for the flat.';
  p.staff.livesIn = true;
  sim.log(`${p.name} has moved into the staff flat.`, 'good', p.id, 'movedIn', 4);
  return null;
}

/** Each morning: rent in, and anyone without a bed moves back out. */
export function flatMorning(sim: Sim): void {
  const s = sim.state;
  const residents = liveIns(sim);
  const spare = hasFlat(sim) ? beds(sim) : 0;
  residents.slice(spare).forEach((p) => {
    p.staff!.livesIn = false;
    sim.log(`${p.name} has moved out of the flat: no bed.`, 'bad', p.id, 'movedOut', 4);
  });
  const paying = Math.min(residents.length, spare);
  s.money += paying * FLAT_RENT;
  s.today.takings += paying * FLAT_RENT;
}

/** Late evening until their next shift: bedtime. */
export function bedtime(sim: Sim, p: Pawn): boolean {
  const m = sim.minuteOfDay;
  return m >= 22 * 60 || m < p.shift.start - 30;
}

/** Off-shift life in the flat: bed at night, otherwise whatever they need most, or pottering about. */
export function homeJob(sim: Sim, p: Pawn, needJob: (bed: boolean) => boolean): Job | null {
  if (bedtime(sim, p) && needJob(true) && p.job) {
    p.job.home = true;
    return p.job;
  }
  if (needJob(false) && p.job) {
    p.job.home = true;
    return p.job;
  }
  const s = sim.state;
  const home: [number, number][] = [];
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const t = sim.world.tile(x, y);
      if (t.floor === 'R' && !t.wall && sim.world.passable(x, y)) home.push([x, y]);
    }
  }
  if (home.length === 0) return null;
  const [x, y] = home[randInt(s, 0, home.length - 1)];
  const go = sim.gotoStep(x, y);
  go.path = sim.pathFrom(p, x, y);
  if (!go.path) return null;
  const job = sim.makeJob('Pottering about at home', [go, { kind: 'wait', ticksLeft: randInt(s, 10, 30) * TICKS_PER_MINUTE }]);
  return { ...job, idle: true, home: true };
}

/** The plot is still bare (nothing built on it yet). */
function plotIsBare(sim: Sim): boolean {
  const s = sim.state;
  const x0 = s.w - PLOT_W;
  for (let y = 1; y < s.h; y++) {
    for (let x = x0; x < s.w - 1; x++) {
      const t = sim.world.tile(x, y);
      if (t.floor === 'P') continue;
      if (t.floor !== 'Y' || t.wall) return false;
    }
  }
  return !s.objects.some((o) => o.x >= x0);
}

/**
 * Builds a standard flat on the back plot: three beds, a kitchen table, a fridge, a sofa,
 * a telly and a loo, with a door through from the staff room. Edit it afterwards in build mode.
 */
export function buildStaffFlat(sim: Sim): string | null {
  const s = sim.state;
  if (hasFlat(sim)) return "There's already a flat.";
  if (!plotIsBare(sim)) return "Something's already built on the plot. Use build mode to finish the flat by hand.";
  if (!canSpend(sim, FLAT_COST)) return "The bank won't lend for that.";
  const x0 = s.w - PLOT_W;
  const top = 1;
  const bottom = 9;
  const before = s.tiles.map((t) => ({ ...t }));
  const set = (x: number, y: number, floor: 'R' | 'T' | 'S', wall = false, door = false) => {
    s.tiles[y * s.w + x] = { floor, wall, door };
  };
  for (let y = top; y < bottom; y++) for (let x = x0; x < s.w - 1; x++) set(x, y, 'R');
  for (let x = x0; x < s.w; x++) set(x, bottom, 'R', true);
  set(s.w - 2, top, 'T');
  // A door from the staff room: the first wall tile on the plot's edge with staff room behind it.
  const doorY = [3, 2, 4, 1, 5].find((y) => {
    const inside = sim.world.tile(x0 - 2, y);
    return inside.floor === 'S' && !inside.wall && sim.world.tile(x0 - 1, y).wall;
  }) ?? 3;
  set(x0 - 1, doorY, 'S', false, true);
  const objects = [
    { def: 'bed', x: x0, y: top }, { def: 'bed', x: x0 + 1, y: top }, { def: 'bed', x: x0 + 2, y: top },
    { def: 'fridge', x: x0 + 5, y: top }, { def: 'toilet', x: s.w - 2, y: top },
    { def: 'staffTable', x: x0 + 4, y: top + 4 }, { def: 'staffSofa', x: x0 + 1, y: bottom - 1 },
    { def: 'tv', x: x0 + 1, y: bottom - 3 },
  ];
  const placed: number[] = [];
  try {
    for (const o of objects) placed.push(sim.world.placeObject(o).id);
  } catch {
    s.tiles = before;
    s.objects = s.objects.filter((o) => !placed.includes(o.id));
    sim.world.rebuild();
    return "The flat wouldn't fit. Try building it by hand.";
  }
  const blocked = reachProblem(sim);
  if (blocked) {
    s.tiles = before;
    s.objects = s.objects.filter((o) => !placed.includes(o.id));
    sim.world.rebuild();
    return blocked;
  }
  s.money -= FLAT_COST;
  s.today.repairs += FLAT_COST;
  sim.log('The staff flat is ready: three beds, a telly and a door through from the staff room.', 'good', null, 'flatBuilt', 6);
  return null;
}
