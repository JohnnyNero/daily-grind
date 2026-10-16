// Seeded random numbers (mulberry32). The generator's whole state is one
// integer stored in the sim state, so saves and replays stay deterministic.

export interface RngHolder {
  rng: number;
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
