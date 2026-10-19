// The building you start with: a tired three-storey block on a 28-tile plot. A street door
// into a lobby with the bins, a stairwell up the middle, a cramped studio and a one-bed on
// each upper floor, a one-bed on the ground floor, and the top one-bed stripped to the brick.

import { placeFurniture, placeSegment, placeStair } from './build';
import { TICKS_PER_HOUR, key, type State } from './state';

const STREET = 10;
const PLOT_W = 28;
const STOREYS = 3;

export function newState(seed: number): State {
  const st: State = {
    version: 1,
    seed,
    rng: seed | 0,
    tick: 8 * TICKS_PER_HOUR,
    nextId: 1,
    w: STREET * 2 + PLOT_W,
    plot: { x0: STREET, x1: STREET + PLOT_W - 1 },
    walls: {},
    slabs: {},
    stairs: [],
    furniture: [],
    pawns: [],
    timers: { passerby: 8 * TICKS_PER_HOUR, agent: 9 * TICKS_PER_HOUR },
  };
  buildShell(st);
  return st;
}

function buildShell(st: State): void {
  const { x0, x1 } = st.plot;
  const at = (dx: number) => x0 + dx;
  for (let level = 1; level <= STOREYS; level++) {
    for (let x = x0; x <= x1; x++) st.slabs[key(x, level)] = true;
  }
  const seg = (dx: number, s: number, kind: Parameters<typeof placeSegment>[3]) => {
    const problem = placeSegment(st, at(dx), s, kind);
    if (problem) throw new Error(`Start building: ${problem} at ${dx},${s}`);
  };
  // Columns: outer wall 0, studio 1-6, wall 7, stairwell 8-12, wall 13, one-bed 14-26, outer wall 27.
  for (let s = 0; s < STOREYS; s++) {
    seg(0, s, s === 0 ? 'entrance' : 'window');
    seg(PLOT_W - 1, s, 'window');
    if (s > 0) seg(7, s, 'flatDoor');
    seg(13, s, 'flatDoor');
    // The one-bed: living room and kitchen, bedroom, bathroom. The top one is gutted.
    if (s < 2) {
      seg(20, s, 'door');
      seg(24, s, 'door');
    }
  }
  const stairs = (dx: number, s: number, dir: 1 | -1) => {
    const problem = placeStair(st, at(dx), s, dir);
    if (problem) throw new Error(`Start building: ${problem}`);
  };
  stairs(8, 0, 1);
  stairs(8, 1, -1);

  const put = (def: string, dx: number, s: number, r = 0, flip = false) => {
    const f = placeFurniture(st, def, at(dx), s, r, flip);
    if (typeof f === 'string') throw new Error(`Start building: ${def} ${f}`);
  };
  // Lobby.
  put('bins', 1, 0);
  put('plant', 6, 0);
  put('clock', 4, 0, 2);
  // Studios on floors 1 and 2.
  for (const s of [1, 2]) {
    put('bed', 1, s);
    put('picture', 1, s, 2);
    put('sink', 3, s);
    put('cupboard', 3, s, 2);
    put('cooker', 4, s);
    put('toilet', 5, s);
    put('mirror', 5, s, 1);
    put('shower', 6, s);
  }
  // One-beds on the ground and first floors.
  for (const s of [0, 1]) {
    put('fridge', 14, s);
    put('cooker', 15, s);
    put('cupboard', 15, s, 2);
    put('sink', 16, s);
    put('sofa', 17, s, 0, true);
    put('picture', 18, s, 2);
    put('doubleBed', 21, s);
    put('shelf', 21, s, 2);
    put('toilet', 25, s);
    put('mirror', 25, s, 1);
    put('shower', 26, s);
  }
}
