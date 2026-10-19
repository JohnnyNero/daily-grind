// The simulation: the saved state, the layout worked out from it, and the clock.

import { Layout } from './layout';
import { stepPawns } from './pawns';
import { newState } from './start';
import { morning, mortgageDue, weeklyBills } from './economy';
import { applicantsHour, rentMorning } from './leases';
import { outcomesHour } from './outcomes';
import { postMorning } from './post';
import { chatMorning } from './chat';
import { environmentHour, noiseMade } from './environment';
import { forgetSocial, romanceHour, requestsHour, socialMinute } from './social';
import { startingTenants } from './start';
import { worksHour, worksMinute } from './works';
import { eventsMinute, storyHour } from './events';
import { crimeMinute } from './crime';
import { councilMorning, upkeepHour } from './upkeep';
import { planningMorning } from './planning';
import { expectationsMorning } from './expectations';
import { handoverHour, startHandover } from './handover';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, type State } from './state';

export class Sim {
  /** Bumped by every change to the building, so anything worked out from it knows to redo it. */
  version = 0;
  private cached: { version: number; layout: Layout } | null = null;

  constructor(public state: State) {}

  /** A fresh game: the starting building, with its sitting tenants. */
  static create(seed: number): Sim {
    const sim = new Sim(newState(seed));
    startingTenants(sim);
    startHandover(sim);
    return sim;
  }

  private noiseCache: { tick: number; made: Map<string, number> } | null = null;

  /** Noise being made in each flat (and the shared parts) right now. Worked out once a tick. */
  noise(): Map<string, number> {
    if (this.noiseCache?.tick !== this.state.tick) this.noiseCache = { tick: this.state.tick, made: noiseMade(this) };
    return this.noiseCache.made;
  }

  /** A short piece of news for the player. */
  notify(text: string): void {
    const n = this.state.notices;
    n.push({ tick: this.state.tick, text });
    if (n.length > 40) n.splice(0, n.length - 40);
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
    const st = this.state;
    st.tick++;
    if (st.repossessed !== undefined) return;
    if (st.tick % TICKS_PER_HOUR === 0) this.hour();
    if (st.tick % TICKS_PER_MINUTE === 0) {
      socialMinute(this);
      worksMinute(this);
      eventsMinute(this);
      crimeMinute(this);
    }
    stepPawns(this);
  }

  private hour(): void {
    const st = this.state;
    const hour = Math.floor(this.minuteOfDay / 60);
    if (hour === 7) {
      morning(this);
      expectationsMorning(this);
      rentMorning(this);
      postMorning(this);
      chatMorning(this);
      councilMorning(this);
      planningMorning(this);
    }
    environmentHour(this);
    worksHour(this);
    romanceHour(this);
    requestsHour(this);
    upkeepHour(this);
    handoverHour(this);
    storyHour(this);
    if (hour === 4) for (const p of st.pawns) if (p.life) forgetSocial(this, p);
    // Mondays at nine: the mortgage and the bills.
    if (hour === 9 && (this.day - 1) % 7 === 0 && this.day > 1) {
      weeklyBills(this);
      mortgageDue(this);
    }
    applicantsHour(this);
    for (const p of [...st.pawns]) if (p.life) outcomesHour(this, p);
  }
}
