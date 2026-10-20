// The card tray (spec 1.1): at most two slim cards just above the tenant bar, newest on top.
// Tap one to open it over the building; tap a button to answer. Also the `!` taps on the
// building and the edge chips' hit areas, and the red dots on Done and Close while a card
// waits in Build or behind a panel.
//
// STUB from chunk 0: chunk 1 owns this file and fills it in. main.ts already makes one on the
// #tray mount point in the dock and calls `update` every frame.

import type { Sim } from '../sim/sim';

export class CardTray {
  /** Called when a card is opened, so the camera can pan to its subject (main.ts). */
  onFocus?: (cardId: number) => void;
  /** Called when a card's been answered, with the toast's words. */
  onNotify?: (text: string) => void;

  constructor(
    private readonly sim: Sim,
    private readonly root: HTMLElement,
  ) {
    this.root.hidden = true;
  }

  /** Every frame. `now` is performance.now(), for the 10-real-second floor. */
  update(_now: number): void {
    this.root.hidden = (this.sim.state.drip?.open.length ?? 0) === 0;
  }
}
