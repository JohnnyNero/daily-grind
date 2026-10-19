// A small stat pipeline, so a formula reads as "a base, then what changes it": start from
// the base, add the offsets, multiply by the factors, then (if there is one) run it through
// a curve. A factor of 1 or an offset of 0 does nothing, so a modifier that doesn't apply
// can stay in the list as `has(life, 'clumsy') ? 2.5 : 1`.
//
// Imports nothing, like tuning.ts, so it's always safe to import.

/** Points on a curve: [x, y], in order of x. */
export type Curve = readonly (readonly [number, number])[];

/** Base, plus each offset, times each factor (in that order), then the curve if there is one. */
export function stat(base: number, offsets: readonly number[] = [], factors: readonly number[] = [], shape?: Curve): number {
  let v = base;
  for (const o of offsets) v += o;
  for (const f of factors) v *= f;
  return shape ? curve(v, shape) : v;
}

/** Straight lines between points. Below the first point it heads straight for zero; past the last it stays level. */
export function curve(x: number, points: Curve): number {
  if (x <= points[0][0]) return points[0][1] * (x / points[0][0]);
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1][1];
}
