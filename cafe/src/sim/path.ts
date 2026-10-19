// A* over the tile grid. 8-directional; diagonals may not cut wall corners.

export type Passable = (x: number, y: number) => boolean;

export type Point = readonly [number, number];

const SQRT2 = Math.SQRT2;

export function findPath(
  w: number,
  h: number,
  passable: Passable,
  from: Point,
  to: Point,
): Point[] | null {
  const [sx, sy] = from;
  const [tx, ty] = to;
  if (!passable(tx, ty)) return null;
  if (sx === tx && sy === ty) return [[tx, ty]];

  const size = w * h;
  const g = new Float64Array(size).fill(Infinity);
  const f = new Float64Array(size).fill(Infinity);
  const came = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open: number[] = [];

  const idx = (x: number, y: number) => y * w + x;
  const heur = (x: number, y: number) => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };

  const start = idx(sx, sy);
  g[start] = 0;
  f[start] = heur(sx, sy);
  open.push(start);

  while (open.length > 0) {
    // The grid is tiny (a few hundred tiles), so a linear scan beats a heap's bookkeeping.
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (f[open[i]] < f[open[best]]) best = i;
    }
    const cur = open[best];
    open[best] = open[open.length - 1];
    open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;

    const cx = cur % w;
    const cy = (cur - cx) / w;
    if (cx === tx && cy === ty) {
      const path: Point[] = [];
      for (let n = cur; n !== -1; n = came[n]) path.push([n % w, Math.floor(n / w)]);
      path.reverse();
      return path;
    }

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (!passable(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!passable(cx + dx, cy) || !passable(cx, cy + dy))) continue;
        const n = idx(nx, ny);
        if (closed[n]) continue;
        const cost = g[cur] + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
        if (cost < g[n]) {
          g[n] = cost;
          f[n] = cost + heur(nx, ny);
          came[n] = cur;
          open.push(n);
        }
      }
    }
  }
  return null;
}
