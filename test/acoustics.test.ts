// Noise by room (docs/specs/layout.md 2.1): noise passes room to room, one room deep; how
// much it matters depends on what the room's for; a flat hears itself at half, a couple not
// at all; everyone shrugs off a little; and a bedroom on the stairwell sleeps worse than one
// with the bathroom put between.

import { describe, expect, it } from 'vitest';
import { heardIn, listening, noiseFelt, roomThrough } from '../src/sim/acoustics';
import { placeFurniture } from '../src/sim/build';
import { makePerson } from '../src/sim/leases';
import { changeFacts } from '../src/sim/preview';
import { flatKind } from '../src/sim/rooms';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_HOUR, key, type Pawn, type State } from '../src/sim/state';
import { moveIn } from '../src/sim/tenants';
import { landlord } from './policy';
import { ACOUSTICS, NEED_THOUGHTS, NOISE } from '../src/sim/tuning';
import { thoughtsOf } from '../src/sim/thoughts';

/**
 * Fits out the right-hand flat on a storey (the bare first-floor one or the stripped top
 * one) as a one-bed with the same three rooms either way round: the bedroom on the stairwell
 * wall and the bathroom at the far end, or the bathroom on the stairwell and the bedroom at
 * the far end. The kitchen and living room is in the middle both times.
 */
function fit(st: State, storey: number, bedroomOnStairs: boolean): void {
  const at = (dx: number) => st.plot.x0 + dx;
  const row = 1 + storey * 4;
  const clear = (dx: number) => {
    delete st.cells[key(at(dx), row)];
    delete st.cells[key(at(dx), row + 2)];
  };
  const door = (dx: number) => {
    st.cells[key(at(dx), row)] = 'door';
    delete st.cells[key(at(dx), row + 1)];
    st.cells[key(at(dx), row + 2)] = 'wall';
  };
  st.furniture = st.furniture.filter((f) => !(f.s >= row && f.s <= row + 2 && f.x >= at(14) && f.x <= at(26)));
  const put = (def: string, dx: number, r = 0) => {
    const f = placeFurniture(st, def, at(dx), row + r);
    if (typeof f === 'string') throw new Error(`${def}: ${f}`);
  };
  clear(20);
  clear(24);
  if (bedroomOnStairs) {
    door(17);
    door(24);
    put('doubleBed', 14);
    put('radiator', 15, 1);
    put('cooker', 18);
    put('sofa', 19);
    put('tv', 22);
    put('toilet', 25);
    put('shower', 26);
  } else {
    door(16);
    door(23);
    put('toilet', 14);
    put('shower', 15);
    put('tv', 17);
    put('sofa', 19);
    put('cooker', 22);
    put('doubleBed', 24);
    put('radiator', 25, 1);
  }
  put('radiator', 20, 1);
  put('smokeAlarm', 18, 2);
}

function fitted(seed: number, bedroomOnStairs: boolean): { sim: Sim; ids: string[] } {
  const sim = Sim.create(seed);
  fit(sim.state, 1, bedroomOnStairs);
  fit(sim.state, 2, bedroomOnStairs);
  sim.changed();
  return { sim, ids: [sim.layout.flats[2].id, sim.layout.flats[4].id] };
}

/** A flat's rooms by name. */
function roomsOf(sim: Sim, flatId: string): Record<string, number> {
  return Object.fromEntries(flatKind(sim, flatId).rooms.map((r) => [r.name, r.room]));
}

/** Puts someone in a room, doing something, and not walking anywhere. */
function place(sim: Sim, p: Pawn, room: number, doing: string): void {
  const n = sim.layout.rooms[room].nodes.find((m) => !sim.layout.isDoorNode(m))!;
  [p.x, p.s] = sim.layout.xs(n);
  p.doing = doing;
  p.path = [];
  p.goal = null;
  p.life!.away = null;
  p.life!.using = null;
}

/** An empty building but for these flats' new tenants. */
function quietBuilding(sim: Sim): void {
  sim.state.pawns = [];
}

describe('noise by room', () => {
  it('passes to the rooms next door, one room deep: a bathroom between takes it', () => {
    const a = fitted(1, true);
    const b = fitted(1, false);
    const stairwell = (sim: Sim) => sim.layout.rooms.find((r) => r.shared && r.cells.some((n) => sim.layout.stair(...sim.layout.xs(n))))!.id;
    const ra = roomsOf(a.sim, a.ids[0]);
    const rb = roomsOf(b.sim, b.ids[0]);
    expect(roomThrough(a.sim, stairwell(a.sim), ra.Bedroom)).toBeGreaterThan(0);
    expect(roomThrough(b.sim, stairwell(b.sim), rb.Bathroom)).toBeGreaterThan(0);
    expect(roomThrough(b.sim, stairwell(b.sim), rb.Bedroom)).toBe(0);
    // A room hears the one above it, not the one above and along.
    const upA = roomsOf(a.sim, a.ids[1]);
    expect(roomThrough(a.sim, upA['Kitchen and living room'], ra['Kitchen and living room'])).toBeGreaterThan(0);
    expect(roomThrough(a.sim, upA['Kitchen and living room'], ra.Bedroom)).toBe(0);
  });

  it('matters most in a bedroom at night, and hardly in a bathroom', () => {
    expect(listening(['sleep'], true)).toBeGreaterThan(listening(['sleep'], false));
    expect(listening(['sleep'], false, true)).toBe(listening(['sleep'], true));
    expect(listening(['sit'], false)).toBeGreaterThan(listening(['wash'], false));
    expect(listening([], true)).toBe(0);
  });

  it('a flat hears itself at half, a couple not at all, and a neighbour they like at half', () => {
    const { sim, ids } = fitted(1, true);
    quietBuilding(sim);
    const rooms = roomsOf(sim, ids[0]);
    const [watcher, sleeper] = moveIn(sim, ids[0], [makePerson(sim.state, 'Hale', 'office'), makePerson(sim.state, 'Hale', 'office')]);
    place(sim, watcher, rooms['Kitchen and living room'], 'Watching telly');
    place(sim, sleeper, rooms.Bedroom, 'Idle');
    const street = heardIn(sim, rooms.Bedroom, sleeper, true).amount;
    // Sharers: the flatmate's telly through the bedroom wall, at half.
    const through = roomThrough(sim, rooms['Kitchen and living room'], rooms.Bedroom);
    expect(through).toBeGreaterThan(0);
    const sharer = heardIn(sim, rooms.Bedroom, sleeper).amount;
    expect(sharer - street).toBeCloseTo(NOISE.telly * through * ACOUSTICS.withinFlat, 6);
    // A couple: not at all.
    sleeper.life!.household = 'couple';
    watcher.life!.household = 'couple';
    sleeper.life!.partner = watcher.id;
    expect(heardIn(sim, rooms.Bedroom, sleeper).amount).toBeCloseTo(street, 6);
    // Next door's telly through the floor: in full, unless they get on.
    const above = roomsOf(sim, ids[1]);
    const [neighbour] = moveIn(sim, ids[1], [makePerson(sim.state, 'Okafor', 'office')]);
    place(sim, neighbour, above.Bedroom, 'Watching telly');
    const full = heardIn(sim, rooms.Bedroom, sleeper).amount;
    expect(full).toBeGreaterThan(street);
    for (const id of ['deepTalk', 'deepTalk', 'deepTalk', 'favour', 'favour', 'favour']) sleeper.life!.social.push({ id, about: neighbour.id, at: sim.state.tick });
    expect(heardIn(sim, rooms.Bedroom, sleeper).amount - street).toBeCloseTo((full - street) / 2, 6);
  });

  it('everyone shrugs off a little, and out of their flat they hear nothing of it', () => {
    const { sim, ids } = fitted(1, true);
    quietBuilding(sim);
    const rooms = roomsOf(sim, ids[0]);
    const [cook, sitter] = moveIn(sim, ids[0], [makePerson(sim.state, 'Hale', 'office'), makePerson(sim.state, 'Hale', 'office')]);
    place(sim, cook, rooms.Bedroom, 'Cooking');
    place(sim, sitter, rooms['Kitchen and living room'], 'Idle');
    expect(heardIn(sim, rooms['Kitchen and living room'], sitter).amount).toBeGreaterThan(0);
    expect(noiseFelt(sim, sitter).felt).toBe(0);
    place(sim, cook, rooms.Bedroom, 'Practising');
    expect(noiseFelt(sim, sitter).felt).toBeGreaterThan(0);
  });

  it('the building preview says a bedroom gets louder when a telly goes next to it', () => {
    const { sim, ids } = fitted(1, false);
    const name = sim.layout.flat(ids[0])!.name;
    const row = 5;
    const without = sim.state.furniture.filter((f) => !(f.s === row && ['sofa', 'tv'].includes(f.def)));
    const facts = changeFacts(sim, { furniture: without }, {}).map((f) => f.text);
    expect(facts).toContain(`${name} bedroom: louder`);
    expect(changeFacts(sim, {}, { furniture: without }).map((f) => f.text)).toContain(`${name} bedroom: quieter`);
  });
});

/** What noise is doing to how much someone likes living here: their labelled thoughts about it. */
const NOISE_THOUGHTS = ['Kept awake', ...NEED_THOUGHTS.quiet.map((b) => b.label)];
function noiseLiking(sim: Sim, p: Pawn): number {
  return thoughtsOf(sim, p)
    .filter((t) => NOISE_THOUGHTS.some((l) => t.label.startsWith(l)))
    .reduce((n, t) => n + t.value, 0);
}

describe('a bedroom on the stairwell, over six weeks', () => {
  it('sleeps worse and is liked less than the same flat with the bathroom on the stairwell', () => {
    const blank = () => ({ kept: 0, quiet: 0, nights: 0, liking: 0, n: 0 });
    const totals = { bed: blank(), bath: blank() };
    for (const seed of [1, 2, 3]) {
      for (const bedroomOnStairs of [true, false]) {
        const t = totals[bedroomOnStairs ? 'bed' : 'bath'];
        const { sim, ids } = fitted(seed, bedroomOnStairs);
        const kept = new Set<string>();
        for (let h = 0; h < 42 * 24; h++) {
          sim.run(TICKS_PER_HOUR);
          landlord(sim, 'decent');
          const hour = h % 24;
          for (const p of sim.state.pawns) {
            if (!p.life || p.life.leaving || !ids.includes(p.life.flat)) continue;
            for (const m of p.life.memories) if (m.id === 'keptAwake') kept.add(`${p.id}@${m.at}`);
            t.liking += noiseLiking(sim, p);
            t.n++;
            if ((hour >= 23 || hour < 6) && !p.life.away) {
              t.quiet += p.life.needs.quiet;
              t.nights++;
            }
          }
        }
        t.kept += kept.size;
        expect(sim.state.repossessed, `seed ${seed}`).toBeUndefined();
      }
    }
    const per = (t: ReturnType<typeof blank>) => ({ kept: t.kept, quiet: t.quiet / t.nights, liking: t.liking / t.n });
    const bed = per(totals.bed);
    const bath = per(totals.bath);
    console.log('bedroom on the stairs', bed, 'bathroom on the stairs', bath);
    // Kept awake more, and less quiet at night...
    expect(bed.kept).toBeGreaterThan(bath.kept * 2);
    expect(bed.quiet).toBeLessThan(bath.quiet);
    // ...and it costs them in how much they like living here: the noise thoughts weigh more.
    expect(bath.liking - bed.liking).toBeGreaterThan(0.5);
    // (The bathroom's side of it, further from the pipes, comes with the risers: layout L4.)
  }, 900000);
});
