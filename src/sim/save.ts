// Turning the game into text and back. Old saves are brought up to date here, and
// anything missing or broken is filled in or dropped rather than refusing to load.

import { isFurniture } from './defs';
import { MORTGAGE, START_MONEY } from './economy';
import { Sim } from './sim';
import { SAVE_VERSION, type State } from './state';
import { noWorks } from './works';

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
  // Version 2 added money, leases, letters and traits.
  st.money ??= START_MONEY;
  st.mortgage ??= { ...MORTGAGE, missed: 0, arrears: 0 };
  st.flats ??= {};
  st.applicants ??= [];
  st.post ??= [];
  st.ledger ??= [];
  st.notices ??= [];
  // Version 3 added the neighbours: insulation, the boiler, dirt, warmth, noise, the chat.
  st.insulated ??= {};
  st.boiler ??= 1;
  st.cleaner ??= false;
  st.dirt ??= {};
  st.temps ??= {};
  st.noiseAvg ??= {};
  st.chat ??= [];
  // Version 4 added the builders.
  st.works ??= noWorks();
  st.works.flats ??= [];
  for (const p of st.pawns) {
    if (!p.life) continue;
    p.life.social ??= [];
    p.life.needs.warmth ??= 1;
    p.life.needs.quiet ??= 1;
    p.life.traits ??= [];
    p.life.revealed ??= [];
    p.life.under ??= { minor: 0, major: 0, extreme: 0 };
    p.life.calmUntil ??= 0;
    p.life.since ??= 1;
  }
  const planned = [st.works.plan, st.works.job].flatMap((p) => (p ? [...p.furniture, ...p.stairs] : []));
  st.nextId = Math.max(st.nextId ?? 1, ...st.furniture.map((f) => f.id + 1), ...st.stairs.map((t) => t.id + 1), ...st.pawns.map((p) => p.id + 1), ...planned.map((o) => o.id + 1));
  return st;
}
