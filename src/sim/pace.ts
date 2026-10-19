// How fast the clock runs. At 1x a game minute takes under a second of real time, so a
// day is about twenty-odd minutes. Quiet nights go faster on their own.

import type { Sim } from './sim';
import { TICKS_PER_MINUTE } from './state';

/** Real seconds per game minute at 1x (a day is 24 * 60 of these: about 21 minutes). */
export const SECONDS_PER_GAME_MINUTE = 0.9;
export const BASE_TICKS_PER_SECOND = TICKS_PER_MINUTE / SECONDS_PER_GAME_MINUTE;
/** A quiet night runs this many times faster than the speed you picked. */
export const NIGHT_BOOST = 4;
/** Night is from this hour to this one. */
const NIGHT_FROM = 23 * 60;
const NIGHT_TO = 6 * 60;
/** Never simulate more than this per frame, so a slow phone can't spiral (about 5ms here; the fastest real frame needs under 600). */
export const MAX_TICKS_PER_FRAME = 1500;

/** Is it the dead of night, with every tenant asleep or out, and nothing going on that wants you? */
export function quietNight(sim: Sim): boolean {
  const m = sim.minuteOfDay;
  if (m < NIGHT_FROM && m >= NIGHT_TO) return false;
  const st = sim.state;
  if (st.story.running.length > 0 || st.handover.stop >= 0) return false;
  if (st.chat.some((c) => c.choices && c.chosen === undefined)) return false;
  for (const p of st.pawns) {
    // Someone who isn't a tenant (a burglar, a guest, a passer-by) is something happening.
    if (!p.life) return false;
    if (p.life.leaving) return false;
    if (!p.life.away && p.pose !== 'sleep') return false;
  }
  return true;
}

/** How many ticks to run for a frame of `dt` seconds, and the fraction left over for next time. */
export function planTicks(dt: number, speed: number, quiet: boolean, carry: number): { ticks: number; carry: number } {
  const total = carry + dt * BASE_TICKS_PER_SECOND * speed * (quiet && speed > 0 ? NIGHT_BOOST : 1);
  const ticks = Math.min(MAX_TICKS_PER_FRAME, Math.floor(total));
  // Past the cap the time is dropped, not owed, so a slow phone doesn't build up a debt.
  return { ticks, carry: total >= MAX_TICKS_PER_FRAME ? 0 : total - ticks };
}
