// The simulation: the saved state, the layout worked out from it, and the clock.

import { Layout } from './layout';
import { stepPawns } from './pawns';
import { newState } from './start';
import { moveIn } from './tenants';
import { TICKS_PER_DAY, TICKS_PER_MINUTE, type State } from './state';

export class Sim {
  /** Bumped by every change to the building, so anything worked out from it knows to redo it. */
  version = 0;
  private cached: { version: number; layout: Layout } | null = null;

  constructor(public state: State) {}

  /** A fresh game: the starting building, with a couple already living on the ground floor. */
  static create(seed: number): Sim {
    const sim = new Sim(newState(seed));
    const first = sim.layout.flats[0];
    if (first) moveIn(sim, first.id, 2);
    return sim;
  }

  get layout(): Layout {
    if (!this.cached || this.cached.version !== this.version) {
      this.cached = { version: this.version, layout: new Layout(this.state) };
    }
    return this.cached.layout;
  }

  /** Call after changing the building. */
  changed(): void {
    this.version++;
  }

  get day(): number {
    return Math.floor(this.state.tick / TICKS_PER_DAY) + 1;
  }

  /** Minutes since midnight. */
  get minuteOfDay(): number {
    return Math.floor((this.state.tick % TICKS_PER_DAY) / TICKS_PER_MINUTE);
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tick();
  }

  tick(): void {
    this.state.tick++;
    stepPawns(this);
  }
}
