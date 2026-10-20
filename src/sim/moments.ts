// Ambient moments (spec 2.3): little scenes that cost the player nothing. One or two people
// and a place, 5 to 30 real seconds (timed in ticks: `seconds()` in state.ts), a bubble or a
// pose, and sometimes a social memory. They come from what's true now, the same way cards do.
// At most MOMENTS.most at once; one starting every MOMENTS.gap game minutes in waking hours.
//
// STUB from chunk 0: chunk 5 owns this file and fills it in, keeping these signatures. A
// tenant in a moment has `life.moment` set (state.ts); for who's home and awake, use
// schedules.ts (`homeAndAwake`, `awayToday`), whatever chunk 3 does inside them.

import type { Flat } from './layout';
import type { Sim } from './sim';
import type { Pawn } from './state';

/** Once a game minute: maybe start a moment somewhere (the scheduler), and end ones whose time is up. */
export function momentsMinute(_sim: Sim): void {}

/** How many moments are running. */
export function momentsRunning(sim: Sim): number {
  return sim.state.pawns.filter((p) => p.life?.moment).length;
}

/**
 * A tenant in a moment (`life.moment`) carries on with it: called in tenantThink straight
 * after breaks, before anything else they'd do. True if the moment had them do something.
 */
export function momentStep(_sim: Sim, _p: Pawn, _flat: Flat): boolean {
  return false;
}

/** Tried just before a tenant potters about, after habits: true if they've started a moment. */
export function momentThink(_sim: Sim, _p: Pawn, _flat: Flat): boolean {
  return false;
}
