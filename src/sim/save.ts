// Turning the game into text and back. Old saves are brought up to date here, and
// anything missing or broken is filled in or dropped rather than refusing to load.

import { isFurniture } from './defs';
import { Sim } from './sim';
import { SAVE_VERSION, type State } from './state';

export function serialize(sim: Sim): string {
  return JSON.stringify(sim.state);
}

export function deserialize(json: string): Sim {
  const raw = JSON.parse(json) as Partial<State>;
  if (typeof raw !== 'object' || raw === null || typeof raw.w !== 'number' || !raw.plot) {
    throw new Error("That doesn't look like a saved building.");
  }
  return new Sim(normalize(raw));
}

function normalize(raw: Partial<State>): State {
  const st = raw as State;
  if ((st.version ?? 0) > SAVE_VERSION) throw new Error('That save is from a newer version of the game.');
  st.version = SAVE_VERSION;
  st.walls ??= {};
  st.slabs ??= {};
  st.stairs ??= [];
  st.furniture = (st.furniture ?? []).filter((f) => isFurniture(f.def));
  st.pawns ??= [];
  st.timers ??= { passerby: st.tick, agent: st.tick };
  st.nextId = Math.max(st.nextId ?? 1, ...st.furniture.map((f) => f.id + 1), ...st.stairs.map((t) => t.id + 1), ...st.pawns.map((p) => p.id + 1));
  return st;
}
