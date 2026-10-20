// Always a project (spec 4): something visible to save for, one at a time. Picked from the
// real building in order (the list's bare flat; the stripped flat from week two; locks; a
// laundry, bike store or garden; insulation where the noise is worst; posh furniture once it
// opens). The player can pin a different one (State.project.pinned).
//
// STUB from chunk 0: chunk 7 owns this file (and ui/project.ts) and fills it in, keeping these
// signatures.

import type { Sim } from './sim';

export interface Project {
  /** Stable, for pinning: 'furnish:flat-3', 'locks', 'insulate:flat-2'. */
  id: string;
  /** "Furnish Flat 3". */
  label: string;
  /** What it costs, in pence. */
  cost: number;
  /** Where Build should open for it, if anywhere. */
  flat?: string;
  /** What it needs, in a line, for when you tap the bar. */
  needs: string;
}

/** The project now: the pinned one if it still makes sense, else the first in order. Null if there's nothing to save for. */
export function nextProject(_sim: Sim): Project | null {
  return null;
}

/** Days until you can afford it, guessing from this week's rent less the bills; null if never at this rate. */
export function projectEta(_sim: Sim, _p: Project): number | null {
  return null;
}

/** Pins a project by id, or unpins (undefined). */
export function pinProject(sim: Sim, id: string | undefined): void {
  if (id === undefined) delete sim.state.project.pinned;
  else sim.state.project.pinned = id;
}
