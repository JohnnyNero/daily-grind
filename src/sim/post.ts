// Letters that need a decision. Each choice is a small action written as text (so it
// saves), worked out here. Ignore a letter past its deadline and its fallback happens.

import { book, flatInfo } from './economy';
import { bookInspection } from './upkeep';
import { takeAdvance } from './handover';
import { household } from './leases';
import type { Sim } from './sim';
import { remember } from './thoughts';

export function choose(sim: Sim, letterId: number, index: number): void {
  const l = sim.state.post.find((x) => x.id === letterId);
  if (!l?.choices || l.chosen !== undefined || !l.choices[index]) return;
  l.chosen = index;
  l.read = true;
  act(sim, l.choices[index].act);
}

/** Every morning: letters past their deadline get their fallback. */
export function postMorning(sim: Sim): void {
  for (const l of sim.state.post) {
    if (l.choices && l.chosen === undefined && l.dueDay !== undefined && sim.day > l.dueDay) choose(sim, l.id, l.fallback ?? 0);
  }
}

function act(sim: Sim, text: string): void {
  const [kind, a, b] = text.split(':');
  switch (kind) {
    case 'rent': {
      const lease = flatInfo(sim, a).lease;
      if (!lease) return;
      lease.rent = Number(b);
      delete lease.rise;
      for (const p of household(sim, a)) remember(sim, p.life!, 'agreedHaggle');
      return;
    }
    case 'refuse':
      for (const p of household(sim, a)) remember(sim, p.life!, 'refusedHaggle');
      return;
    case 'fine':
      book(sim, 'Council fixed penalty', -Number(a));
      return;
    case 'advance':
      takeAdvance(sim, Number(a));
      return;
    case 'inspect':
      bookInspection(sim, 2, 'Following a complaint from a tenant');
      return;
  }
}
export { act as postAct };
