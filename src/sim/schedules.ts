// Who's home when (spec 2.1): each tenant has a schedule (office hours, an early or late
// shift, nights, working from home, a student's odd hours, retired), and one or two habits
// that replace some of their pottering at about the same time each day, so you get to know
// them. Habits meet no needs and cost nothing.
//
// STUB from chunk 0: chunk 3 owns this file and fills it in, keeping these signatures. It also
// changes tenants.ts (wake, bed and the work check read the schedule), leases.ts (`makePerson`
// rolls a schedule instead of LETTING.working) and start.ts (Flat 1 works from home, Bill's
// routine). Until then everyone behaves as before: a job means office-style hours.

import type { Flat } from './layout';
import type { RngHolder } from './rng';
import type { Sim } from './sim';
import type { Life, Pawn, Person, Schedule } from './state';

export type { Schedule } from './state';

/** For a tenant with no schedule (an old save, or someone made before schedules): from their job. */
export function scheduleFromJob(job: Person['job']): Schedule {
  return job ? 'office' : 'retired';
}

/** A new person's schedule, and the job that goes with it (null for home, retired). Chunk 3 rolls it with SCHEDULES.share. */
export function rollSchedule(_rng: RngHolder, job: Person['job']): Schedule {
  return scheduleFromJob(job);
}

/** One or two habits for a tenant, by id, picked by schedule and traits (HABITS). */
export function rollHabits(_rng: RngHolder, _life: Life): string[] {
  return [];
}

/** Today's hours away, in minutes of the day (`back` past 24 * 60 for nights), or null for a day in. */
export function awayToday(sim: Sim, life: Life): { leave: number; back: number } | null {
  const weekday = (sim.day - 1) % 7 < 5;
  return life.job && weekday ? { leave: life.job.leave, back: life.job.back } : null;
}

/** In the building, awake and on the map: what moments and visitors look for. */
export function homeAndAwake(_sim: Sim, p: Pawn): boolean {
  return !!p.life && !p.life.away && !p.life.leaving && p.pose !== 'sleep';
}

/** 07:00: tenants without habits (new, or from an old save) get theirs. */
export function schedulesMorning(_sim: Sim): void {}

/**
 * Tried just before a tenant potters about (tenants.ts): if one of their habits is due, they
 * start it (walk somewhere, set `doing`, a pose, a prop, a bubble, a wait) and this says true.
 */
export function habitThink(_sim: Sim, _p: Pawn, _flat: Flat): boolean {
  return false;
}
