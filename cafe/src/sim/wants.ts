// Wants, Sims-style: each staff member has a couple of things they'd like to happen.
// Some happen on their own (a big tip day); many need the manager (a shorter shift,
// more time on the work they love). Meeting a want is a lasting mood boost.

import { WORK_TYPES, type WorkType } from './defs';
import { pick, random } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_HOUR, type Pawn, type Want } from './state';
import { addMemory } from './thoughts';

const WANTS_EACH = 2;
const WANT_LIFETIME_TICKS = 3 * 24 * TICKS_PER_HOUR;

interface WantDef {
  id: string;
  /** Builds a want for this person, or null if it doesn't fit them right now. */
  make: (sim: Sim, p: Pawn) => Omit<Want, 'since' | 'def'> | null;
  met: (sim: Sim, p: Pawn, w: Want) => boolean;
}

function hadMemorySince(p: Pawn, def: string, since: number, hours: number): boolean {
  return p.staff!.memories.some((m) => m.def === def && m.expires - hours * TICKS_PER_HOUR > since);
}

const WANTS: readonly WantDef[] = [
  {
    id: 'skillUp',
    make: (sim, p) => {
      const w = pick(sim.state, WORK_TYPES);
      const now = p.staff!.skills[w.id];
      if (now >= 9) return null;
      const target = Math.min(10, Math.floor(now) + 1);
      return { param: w.id, target, label: `Get better at ${w.label.toLowerCase()} (skill ${target})` };
    },
    met: (_s, p, w) => p.staff!.skills[w.param as WorkType] >= w.target,
  },
  {
    id: 'loveWork',
    make: (sim, p) => {
      const options = WORK_TYPES.filter((w) => p.staff!.priorities[w.id] !== 1);
      if (options.length === 0) return null;
      const w = pick(sim.state, options);
      return { param: w.id, target: 0, label: `Put me first on ${w.label.toLowerCase()}` };
    },
    met: (_s, p, w) => p.staff!.priorities[w.param as WorkType] === 1,
  },
  {
    id: 'shorterShift',
    make: (_s, p) => (p.shift.end - p.shift.start > 6 * 60 ? { param: null, target: 6 * 60, label: 'A shorter shift (6 hours or less)' } : null),
    met: (_s, p, w) => p.shift.end - p.shift.start <= w.target,
  },
  {
    id: 'earlyFinish',
    make: () => ({ param: null, target: 0, label: 'Get let off early one day' }),
    met: (sim, p) => p.staff!.homeEarlyDay === sim.day,
  },
  {
    id: 'tips',
    make: () => ({ param: null, target: 1000, label: 'Make £10 in tips in a day' }),
    met: (_s, p, w) => p.staff!.tipsToday >= w.target,
  },
  {
    id: 'lunch',
    make: () => ({ param: null, target: 0, label: 'A proper lunch break' }),
    met: (_s, p, w) => hadMemorySince(p, 'properLunch', w.since, 6),
  },
  {
    id: 'compliment',
    make: () => ({ param: null, target: 0, label: 'A compliment from a colleague' }),
    met: (_s, p, w) => hadMemorySince(p, 'complimented', w.since, 8),
  },
  {
    id: 'workWithFriend',
    make: (sim, p) => {
      const friends = sim.state.pawns.filter((o) => o.staff && !o.staff.quit && o.id !== p.id && sim.opinion(p, o) >= 20);
      if (friends.length === 0) return null;
      const f = pick(sim.state, friends);
      return { param: String(f.id), target: 0, label: `Work a shift with ${f.name}` };
    },
    met: (sim, p, w) => p.onMap && sim.state.pawns.some((o) => String(o.id) === w.param && o.onMap),
  },
];

export function topUpWants(sim: Sim, p: Pawn): void {
  const staff = p.staff;
  if (!staff) return;
  const s = sim.state;
  staff.wants = staff.wants.filter((w) => s.tick - w.since < WANT_LIFETIME_TICKS);
  for (let tries = 0; staff.wants.length < WANTS_EACH && tries < 12; tries++) {
    const def = pick(s, WANTS);
    if (staff.wants.some((w) => w.def === def.id)) continue;
    const made = def.make(sim, p);
    if (!made) continue;
    staff.wants.push({ def: def.id, since: s.tick, ...made });
  }
}

/** Checks everyone's wants; met ones become a lasting good mood and make room for new ones. */
export function checkWants(sim: Sim): void {
  for (const p of sim.state.pawns) {
    const staff = p.staff;
    if (!staff || staff.quit) continue;
    for (const w of [...staff.wants]) {
      const def = WANTS.find((d) => d.id === w.def);
      if (!def || !def.met(sim, p, w)) continue;
      staff.wants = staff.wants.filter((x) => x !== w);
      addMemory(sim, p, 'gotWant');
      const wish = w.label.charAt(0).toLowerCase() + w.label.slice(1);
      sim.log(`${p.name} got what they wanted: ${wish}.`, 'good', p.id, 'want', 3);
      if (random(sim.state) < 0.5) topUpWants(sim, p);
    }
  }
}
