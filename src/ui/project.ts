// The project bar (spec 4): "Next: furnish Flat 3. £340 of £610." Tap it for what it needs,
// which opens Build there.
//
// STUB from chunk 0: chunk 7 owns this file and fills it in. main.ts already makes one on the
// #project-bar mount point and calls `update` every frame.

import type { Sim } from '../sim/sim';

export class ProjectBar {
  /** Opens Build on a flat (or Build as it is, with no flat). Set by main.ts. */
  onOpen?: (flat?: string) => void;

  constructor(
    private readonly sim: Sim,
    private readonly root: HTMLElement,
  ) {
    this.root.hidden = true;
  }

  /** Every frame. */
  update(): void {
    void this.sim;
  }
}
