// Visitors (spec 2.2): people from outside who come in, do one thing, and go. Sandra the
// postie, couriers, takeaway riders, friends and family, partners staying over, Lorraine who
// does the stairs, the window cleaner, the meter reader, tradespeople, the council officer,
// kids on the pavement. Also the animals: the building cat, pets, the fox. A visitor is a
// pawn of kind 'visitor' (an animal, 'animal') with a `role`, and maybe a `prop`.
//
// STUB from chunk 0: chunk 4 owns this file (and the spawn caps in pawns.ts) and fills it in,
// keeping these signatures. pawns.ts already calls `visitorsSpawn` every tick, hands visitors
// and animals to `visitorThink`, and asks `visitorKeys` which doors they can open.

import type { Keys } from './layout';
import { addPawn } from './pawns';
import type { Sim } from './sim';
import type { Pawn } from './state';
import { VISITORS } from './tuning';

/** Every tick, from pawns.ts: anyone due turns up (State.visitors.next holds when, by role). */
export function visitorsSpawn(_sim: Sim): void {}

/** Once a game hour: work out when each kind is next due (the postie tomorrow, couriers, the fox on bin nights). */
export function visitorsHour(_sim: Sim): void {}

/** A visitor's or an animal's next move, when they've nothing to walk to. False hands them back to pawns.ts (which walks them off). */
export function visitorThink(_sim: Sim, _p: Pawn): boolean {
  return false;
}

/** The doors a visitor can open: none by default (a tradesperson gets the flat they're mending, Lorraine the shared parts). */
export function visitorKeys(_p: Pawn): Keys {
  return {};
}

/** Visitors and animals on the map now. */
export function visitorsOnMap(sim: Sim): Pawn[] {
  return sim.state.pawns.filter((p) => p.kind === 'visitor' || p.kind === 'animal');
}

/** Room for another (VISITORS.most, not counting party guests or applicants with Denise). */
export function visitorRoom(sim: Sim): boolean {
  return visitorsOnMap(sim).filter((p) => p.kind === 'visitor').length < VISITORS.most;
}

/** Someone comes in from the street for a reason: a pawn with this role, heading for the building. Cards can use it (a courier at the door). */
export function addVisitor(sim: Sim, role: string, kind: 'visitor' | 'animal' = 'visitor'): Pawn {
  const p = addPawn(sim, kind);
  p.role = role;
  p.task = 'go';
  p.doing = 'Calling round';
  return p;
}
