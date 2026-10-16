// Manager calls: the few direct orders, for a crisis. Each one costs something and
// needs time before it can be used again, so they're a tool, not a habit.

import { addFame } from './business';
import type { Sim } from './sim';
import { TICKS_PER_HOUR, TICKS_PER_MINUTE } from './state';

export type CallId = 'allHands' | 'closeDoors' | 'compRound';

export interface CallDef {
  id: CallId;
  label: string;
  detail: string;
  /** Game time before it can be used again. */
  cooldown: number;
}

export const CALLS: readonly CallDef[] = [
  {
    id: 'allHands', label: 'All hands',
    detail: 'For 20 minutes everyone drops what they were settled into and piles in wherever the backlog is. Adds a little stress to everyone in.',
    cooldown: 2 * TICKS_PER_HOUR,
  },
  {
    id: 'closeDoors', label: 'Close the doors',
    detail: "Nobody new comes in for 20 minutes while you catch up. Some people will have walked past, and they'll mention it.",
    cooldown: 3 * TICKS_PER_HOUR,
  },
  {
    id: 'compRound', label: 'Comp a round',
    detail: "Everyone queuing or waiting gets something on the house: they're far more patient, and they'll talk about it. Costs what you give away.",
    cooldown: 4 * TICKS_PER_HOUR,
  },
];

const CALL_MINUTES = 20;
const COMP_COST = 150;

export function callReadyIn(sim: Sim, id: CallId): number {
  return Math.max(0, (sim.state.calls.ready[id] ?? 0) - sim.state.tick);
}

/** Why a call can't be made right now, or null. */
export function callProblem(sim: Sim, id: CallId): string | null {
  if (!sim.isOpen()) return "You're closed.";
  if (callReadyIn(sim, id) > 0) return 'Not again so soon.';
  if (id === 'compRound' && waitingGuests(sim).length === 0) return "There's nobody waiting.";
  if (id === 'allHands' && !sim.state.pawns.some((p) => p.staff && p.onMap)) return "There's nobody in.";
  return null;
}

function waitingGuests(sim: Sim) {
  return sim.state.pawns.filter((p) => p.visit && (p.visit.state === 'queuing' || p.visit.state === 'waiting'));
}

export function makeCall(sim: Sim, id: CallId): string | null {
  const problem = callProblem(sim, id);
  if (problem) return problem;
  const s = sim.state;
  const def = CALLS.find((c) => c.id === id)!;
  s.calls.ready[id] = s.tick + def.cooldown;
  if (id === 'allHands') {
    s.calls.allHandsUntil = s.tick + CALL_MINUTES * TICKS_PER_MINUTE;
    for (const p of s.pawns) if (p.staff && p.onMap) p.staff.stress = Math.min(100, p.staff.stress + 3);
    sim.log('All hands! Everyone piles in.', 'neutral', null, null, 0);
  } else if (id === 'closeDoors') {
    s.calls.closedUntil = s.tick + CALL_MINUTES * TICKS_PER_MINUTE;
    addFame(sim, -1);
    sim.log("The sign's flipped to 'Back in 20 minutes'.", 'neutral', null, null, 0);
  } else {
    const guests = waitingGuests(sim);
    for (const g of guests) g.visit!.patience = Math.min(1, g.visit!.patience + 0.4);
    const cost = COMP_COST * guests.length;
    s.money -= cost;
    s.today.other += cost;
    addFame(sim, 0.15 * guests.length);
    sim.log(`A round on the house for the ${guests.length} people waiting. The mood lifts.`, 'good', null, null, 0);
  }
  return null;
}

export function allHands(sim: Sim): boolean {
  return sim.state.calls.allHandsUntil > sim.state.tick;
}
