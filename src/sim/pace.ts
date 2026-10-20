// How fast the clock runs. At 1x a game minute takes 0.3 real seconds, so a day is about
// seven minutes. Only the player sets the speed (spec 0.2): on a quiet night a Skip to morning
// button offers to run the ticks to 07:00 as fast as the phone can, and stops if anything stirs.

import type { Sim } from './sim';
import { TICKS_PER_DAY, TICKS_PER_MINUTE } from './state';
import { MAX_TICKS_PER_FRAME, QUIET_NIGHT_FROM, QUIET_NIGHT_TO, SECONDS_PER_GAME_MINUTE } from './tuning';

// The speeds are in tuning.ts.
export { MAX_TICKS_PER_FRAME, SECONDS_PER_GAME_MINUTE } from './tuning';
export const BASE_TICKS_PER_SECOND = TICKS_PER_MINUTE / SECONDS_PER_GAME_MINUTE;
const NIGHT_FROM = QUIET_NIGHT_FROM * 60;
const NIGHT_TO = QUIET_NIGHT_TO * 60;
/** Where a skip ends: 07:00. */
export const MORNING = 7 * 60;

/**
 * Nothing that wants you: no happening, no Denise, no question waiting in the chat, no card
 * open, nobody about who isn't a tenant (a burglar, a guest, a visitor; the cat may sleep).
 */
function nothingGoingOn(sim: Sim): boolean {
  const st = sim.state;
  if (st.story.running.length > 0 || st.handover.stop >= 0) return false;
  if (st.chat.some((c) => c.choices && c.chosen === undefined)) return false;
  if ((st.drip?.open.length ?? 0) > 0) return false;
  for (const p of st.pawns) {
    if (p.kind === 'animal' ? p.pose !== 'sleep' : !p.life) return false;
    if (p.life?.leaving) return false;
  }
  return true;
}

/** Every tenant asleep or out. */
function allAsleep(sim: Sim): boolean {
  return sim.state.pawns.every((p) => !p.life || p.life.away || p.pose === 'sleep');
}

/** Is it the dead of night, with every tenant asleep or out, and nothing going on that wants you? Shows the Skip to morning button. */
export function quietNight(sim: Sim): boolean {
  const m = sim.minuteOfDay;
  if (m < NIGHT_FROM && m >= NIGHT_TO) return false;
  return nothingGoingOn(sim) && allAsleep(sim);
}

/** How many ticks to run for a frame of `dt` seconds, and the fraction left over for next time. Nothing but the speed changes it. */
export function planTicks(dt: number, speed: number, carry: number): { ticks: number; carry: number } {
  const total = carry + dt * BASE_TICKS_PER_SECOND * speed;
  const ticks = Math.min(MAX_TICKS_PER_FRAME, Math.floor(total));
  // Past the cap the time is dropped, not owed, so a slow phone doesn't build up a debt.
  return { ticks, carry: total >= MAX_TICKS_PER_FRAME ? 0 : total - ticks };
}

/** Ticks from now to the next 07:00. */
export function ticksToMorning(sim: Sim): number {
  const at = MORNING * TICKS_PER_MINUTE;
  const into = sim.state.tick % TICKS_PER_DAY;
  return (at - into + TICKS_PER_DAY) % TICKS_PER_DAY || TICKS_PER_DAY;
}

/**
 * Skip to morning: runs up to `most` ticks, the same ticks the sim would run anyway, towards
 * 07:00. 'morning' when it gets there, 'woke' if something stirred on the way (checked each
 * game minute: anything going on, or before QUIET_NIGHT_TO a tenant up and about), 'more' if
 * it ran out of ticks for now.
 */
export function skipToMorning(sim: Sim, most: number): 'morning' | 'woke' | 'more' {
  for (let i = 0; i < most; i++) {
    sim.tick();
    if (sim.state.tick % TICKS_PER_DAY === MORNING * TICKS_PER_MINUTE) return 'morning';
    if (sim.state.tick % TICKS_PER_MINUTE === 0) {
      if (!nothingGoingOn(sim)) return 'woke';
      const m = sim.minuteOfDay;
      if ((m >= NIGHT_FROM || m < NIGHT_TO) && !allAsleep(sim)) return 'woke';
    }
  }
  return 'more';
}
