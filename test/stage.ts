// Setting a scene by hand, so a test checks what happens next rather than hoping the dice
// put everyone in the right place.

import type { Sim } from '../src/sim/sim';
import type { Pawn } from '../src/sim/state';

/** Puts a tenant in their own flat, up, rested and doing nothing in particular. */
export function homeAndAwake(sim: Sim, p: Pawn): Pawn {
  const lay = sim.layout;
  const life = p.life!;
  const flat = lay.flat(life.flat)!;
  const n = flat.rooms.flatMap((r) => lay.rooms[r].nodes).find((m) => lay.standable[m] && !lay.isDoorNode(m))!;
  [p.x, p.s] = lay.xs(n);
  life.away = null;
  delete life.outing;
  delete life.breakState;
  life.using = null;
  life.needs.sleep = 1;
  delete p.pose;
  delete p.act;
  delete p.partyAt;
  p.path = [];
  p.goal = null;
  // Not halfway along the pavement either.
  delete p.front;
  delete p.frontTo;
  p.task = 'go';
  p.waitUntil = 0;
  return p;
}
