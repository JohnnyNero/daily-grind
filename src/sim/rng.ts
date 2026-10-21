// Seeded random numbers (mulberry32). The generator's whole state is one
// integer stored in the sim state, so saves and replays stay deterministic.

export interface RngHolder {
  rng: number;
}

/**
 * Dice of their own, kept in `rec[key]` and started from `start` the first time: a part of the
 * game that rolls these never moves anyone else's luck, and nothing else moves its.
 */
export function diceIn(rec: object, key: string, start: number): RngHolder {
  const r = rec as Record<string, number | undefined>;
  return {
    get rng() {
      return r[key] ?? start | 0;
    },
    set rng(v: number) {
      r[key] = v;
    },
  };
}

/** A small hash of a string, for starting dice of their own (a flat's, by its id). */
export function hashOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h | 0;
}

export function random(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) | 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(h: RngHolder, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(random(h) * (maxInclusive - minInclusive + 1));
}

export function randRange(h: RngHolder, min: number, max: number): number {
  return min + random(h) * (max - min);
}

export function pick<T>(h: RngHolder, items: readonly T[]): T {
  return items[Math.floor(random(h) * items.length)];
}
