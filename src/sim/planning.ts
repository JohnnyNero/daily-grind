// Planning permission. You can build what you like up to the roofline the building came with;
// going higher needs the council's say-so. You apply with a fee, wait a few days, and they
// say yes or (for reasons of their own) no. Approval is for a height, and lasts.

import { PLANNING_FEE, POUND, letter, spend } from './economy';
import { pick, random } from './rng';
import type { Sim } from './sim';
import { STOREY } from './start';
import { readFlags } from './flags';

const DECISION_DAYS = 3;

/** The top row of a building's cells. */
export function topRow(cells: Record<string, unknown>): number {
  let top = -1;
  for (const k of Object.keys(cells)) top = Math.max(top, Number(k.split(',')[1]));
  return top;
}

/** Does building this need planning permission first? */
export function needsPlanning(sim: Sim, cells: Record<string, unknown>): boolean {
  return topRow(cells) > sim.state.planning.top;
}

export function planningProblem(sim: Sim, top: number): string | null {
  const p = sim.state.planning;
  if (p.applied) return `Waiting on the council (they decide on day ${p.applied.decideDay})`;
  if (top <= p.top) return 'You don\'t need permission for that';
  if (sim.state.money < PLANNING_FEE) return `The fee is £${PLANNING_FEE / POUND}`;
  return null;
}

/** Apply to build up to this row. */
export function applyForPlanning(sim: Sim, top: number): string | null {
  const problem = planningProblem(sim, top);
  if (problem) return problem;
  spend(sim, 'Planning application fee', PLANNING_FEE);
  const decideDay = sim.day + DECISION_DAYS;
  sim.state.planning.applied = { top, decideDay };
  letter(sim, {
    from: 'Harrowgate City Council, Planning',
    title: 'Application received',
    body: `Thank you for your application to extend upwards. Neighbours have been notified, and one has already written in. You will have our decision on day ${decideDay}.`,
  });
  return null;
}

const REFUSALS = [
  'It would be out of keeping with the character of the street, which the committee described as "tired, but in a nice way".',
  'The neighbour at number 14 objected on the grounds that it would block their view of the gasworks.',
  'The drawings were in pencil.',
  'The committee could not agree, and in the absence of agreement the answer is no.',
];

/** Every morning: a decision, if one's due. Taller asks are likelier to be turned down. */
export function planningMorning(sim: Sim): void {
  const st = sim.state;
  const p = st.planning;
  if (!p.applied || sim.day < p.applied.decideDay) return;
  const { top } = p.applied;
  delete p.applied;
  const storeys = Math.ceil((top - p.top) / STOREY);
  const from = 'Harrowgate City Council, Planning';
  // Next door's mood counts for something (flags.ts).
  if (random(st) < readFlags(sim, 'planning.chance', Math.max(0.3, 0.9 - 0.15 * storeys))) {
    p.top = top;
    letter(sim, { from, title: 'Planning permission granted', body: `Permission is granted to build up to ${storeys} storey${storeys > 1 ? 's' : ''} above your current roof. Please be considerate of the neighbours. They have asked us to say that.` });
  } else {
    letter(sim, { from, title: 'Planning permission refused', body: `${pick(st, REFUSALS)} You may apply again.` });
  }
}
