// Mood from needs. Low needs weigh more, so one desperate need drags mood down
// further than one full need lifts it.

import { NEEDS, type NeedValues } from './defs';

export function needWeight(v: number): number {
  const lack = 1 - v;
  return 1 + 3 * lack * lack;
}

export function moodFromNeeds(n: NeedValues): number {
  let sum = 0;
  let weights = 0;
  for (const def of NEEDS) {
    const v = n[def.id];
    const w = needWeight(v);
    sum += w * v;
    weights += w;
  }
  return sum / weights;
}

export function worstNeed(n: NeedValues): number {
  let worst = 1;
  for (const def of NEEDS) worst = Math.min(worst, n[def.id]);
  return worst;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
