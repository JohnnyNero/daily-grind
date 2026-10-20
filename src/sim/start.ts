// The building you start with: a tired three-storey block on a 28-tile plot. A street door
// into a lobby with the bins, a door through to the stairwell up the middle, a cramped
// studio and a one-bed on each upper floor, a one-bed on the ground floor. The first-floor
// one-bed is unfurnished and the top one stripped to the brick. Most of what's in it is
// ordinary, but the ground-floor sofa is the cheap sort.

import { placeFurniture } from './build';
import { MORTGAGE, POUND, START_MONEY, flatInfo, goingRate } from './economy';
import { EXPECT_START } from './expectations';
import { rentScore, scoreFor } from './impressiveness';
import { makePerson, sittingTenants } from './leases';
import type { Sim } from './sim';
import { furnitureDef } from './defs';
import { random } from './rng';
import { emptyDrip } from './drip';
import { BILL_SHOWER_WEAR } from './tuning';
import { SAVE_VERSION, TICKS_PER_DAY, TICKS_PER_HOUR, isDoor, key, type CellKind, type Grade, type State } from './state';

const STREET = 10;
const BILLS_HABITS = ['paper', 'shops', 'telly', 'cuppa', 'earlyNight'];
const PLOT_W = 28;
const STOREYS = 3;

export function newState(seed: number): State {
  const st: State = {
    version: SAVE_VERSION,
    seed,
    rng: seed | 0,
    tick: 8 * TICKS_PER_HOUR,
    nextId: 1,
    w: STREET * 2 + PLOT_W,
    plot: { x0: STREET, x1: STREET + PLOT_W - 1 },
    cells: {},
    furniture: [],
    pawns: [],
    timers: { passerby: 8 * TICKS_PER_HOUR, agent: 9 * TICKS_PER_HOUR },
    money: START_MONEY,
    mortgage: { ...MORTGAGE, missed: 0, arrears: 0 },
    flats: {},
    applicants: [],
    post: [],
    ledger: [],
    notices: [],
    insulated: {},
    boiler: 1,
    cleaner: false,
    dirt: {},
    temps: {},
    noiseAvg: {},
    chat: [],
    works: { plan: null, job: null, progress: 0, waiting: false, flats: [] },
    // A quiet first week, to get to know the place.
    story: { busy: false, until: 7 * TICKS_PER_DAY, cooldowns: {}, running: [] },
    security: { locks: false, alarm: false },
    reviews: [],
    planning: { top: 0 },
    council: {},
    expect: { level: EXPECT_START, good: 0 },
    handover: { stop: 0, cast: [], met: [], done: [] },
    chronicle: { next: 1, tales: [] },
    drip: emptyDrip(),
    visitors: { next: {} },
    project: {},
  };
  buildShell(st);
  // You can build up to the roof as it stands; above that needs planning permission.
  st.planning.top = Math.max(...Object.keys(st.cells).map((k) => Number(k.split(',')[1])));
  // It's a tired building: everything in it has seen some use.
  for (const f of st.furniture) if (furnitureDef(f.def).offers) f.wear = 0.25 + random(st) * 0.5;
  return st;
}

/** Each storey is 4 rows: 3 of room and 1 of floor. */
export const STOREY = 4;
/** The building stands on a plinth one cell high, so the ground floor is a step up from the street. */
export const BASE = 1;

function buildShell(st: State): void {
  const { x0, x1 } = st.plot;
  const at = (dx: number) => x0 + dx;
  const set = (dx: number, row: number, kind: CellKind) => {
    st.cells[key(at(dx), row)] = kind;
    if (isDoor(kind)) delete st.cells[key(at(dx), row + 1)];
  };
  // The plinth, the floors and the roof.
  for (let x = x0; x <= x1; x++) for (let r = 0; r < BASE; r++) st.cells[key(x, r)] = 'wall';
  for (let s = 1; s <= STOREYS; s++) {
    for (let x = x0; x <= x1; x++) st.cells[key(x, BASE + s * STOREY - 1)] = 'wall';
  }
  // A wall up a column of one storey, with a window or a door in it.
  const column = (dx: number, s: number, kind: 'wall' | 'window' | 'door' | 'flatDoor' | 'entrance') => {
    const row = BASE + s * STOREY;
    for (let r = 0; r < STOREY - 1; r++) set(dx, row + r, 'wall');
    if (kind === 'window') set(dx, row + 1, 'window');
    else if (kind !== 'wall') set(dx, row, kind);
  };
  // Columns: outer wall 0, studio 1-6, wall 7, stairwell 8-12, wall 13, one-bed 14-26, outer wall 27.
  for (let s = 0; s < STOREYS; s++) {
    column(0, s, s === 0 ? 'entrance' : 'window');
    column(PLOT_W - 1, s, 'window');
    // The studio's front door; on the ground floor, a door between the lobby and the stairs.
    column(7, s, s > 0 ? 'flatDoor' : 'door');
    column(13, s, 'flatDoor');
    // The one-bed: living room and kitchen, bedroom, bathroom. (The top one is gutted, but
    // the walls hold the roof up.)
    column(20, s, 'door');
    column(24, s, 'door');
  }
  // Up the stairwell: a flight from the lobby to the first floor, and another on to the second.
  for (const [dx, from] of [[9, BASE], [11, BASE + STOREY]]) for (let r = 0; r < STOREY; r++) set(dx, from + r, 'stair');

  const put = (def: string, dx: number, s: number, r = 0, flip = false, grade: Grade = 'standard') => {
    const f = placeFurniture(st, def, at(dx), BASE + s * STOREY + r, flip, grade);
    if (typeof f === 'string') throw new Error(`Start building: ${def} ${f}`);
  };
  // Lobby.
  put('bins', 1, 0);
  put('plant', 6, 0);
  put('clock', 4, 0, 2);
  put('radiator', 3, 0, 1);
  // Studios on floors 1 and 2.
  for (const s of [1, 2]) {
    put('bed', 1, s);
    put('picture', 1, s, 2);
    put('sink', 3, s);
    put('cupboard', 3, s, 2);
    put('cooker', 4, s);
    put('toilet', 5, s);
    put('mirror', 5, s, 1);
    put('shower', 6, s);
    put('radiator', 2, s, 1);
  }
  // The ground-floor one-bed is furnished; the one above is bare boards and radiators.
  put('radiator', 19, 1, 1);
  put('radiator', 23, 1, 1);
  for (const s of [0]) {
    // A cooker, the telly and the sofa in front of it: someone who works from home wants
    // somewhere to put their feet up without going out (b2: the room used to be all kitchen).
    put('cooker', 14, s);
    put('cupboard', 14, s, 2);
    put('tv', 15, s);
    put('sofa', 17, s, 0, true, 'cheap');
    put('picture', 18, s, 2);
    put('doubleBed', 21, s);
    put('shelf', 21, s, 2);
    put('toilet', 25, s);
    put('mirror', 25, s, 1);
    put('shower', 26, s);
    put('radiator', 19, s, 1);
    put('radiator', 23, s, 1);
  }
  // The council wants a smoke alarm in every flat people live in. The furnished ones have one.
  for (const s of [1, 2]) put('smokeAlarm', 2, s, 2);
  put('smokeAlarm', 16, 0, 2);
}

/**
 * The sitting tenants the building comes with, on old cheap rolling tenancies: someone
 * who works from home in the ground-floor one-bed and someone retired in the top-floor
 * studio, so there are two people in all day from the first morning. The other three flats
 * stand empty, so the first let comes early.
 */
export function startingTenants(sim: Sim): void {
  const st = sim.state;
  const flats = sim.layout.flats;
  // Works from home, and pays on the dot (the last landlord's words), so always pays early.
  const first = makePerson(st, undefined, 'home');
  first.traits = ['paysEarly', ...first.traits.filter((t) => t !== 'paysEarly' && t !== 'haggler')].slice(0, 3);
  // Bill, who's been here longer than the carpets.
  const bill = makePerson(st, undefined, 'retired');
  bill.name = `Bill ${bill.name.split(' ').slice(1).join(' ')}`;
  // Up with the lark, Bill: never a night owl.
  if (bill.traits.includes('nightOwl')) bill.traits = [...bill.traits.filter((t) => t !== 'nightOwl'), bill.traits.includes('friendly') ? 'handy' : 'friendly'];
  bill.note = 'Retired';
  if (flats[0]) sittingTenants(sim, flats[0].id, [first], 70 * POUND);
  // Bill's routines, which you could set a watch by: the paper at half eight, the shops at
  // eleven, the telly up loud at two, tea at half five, bed at ten.
  if (flats[3]) for (const p of sittingTenants(sim, flats[3].id, [bill], 55 * POUND)) p.life!.habits = [...BILLS_HABITS];
  // Bill's shower has seen better days: the first leak (card 5) comes through the ceiling below.
  const lay = sim.layout;
  const billsFlat = flats[3] ? new Set(lay.flatCells(flats[3])) : new Set<number>();
  const shower = st.furniture.find((f) => f.def === 'shower' && billsFlat.has(lay.node(f.x, f.s)));
  if (shower) shower.wear = BILL_SHOWER_WEAR;
  // Going rates start from how the flats score with their tenants in. Only a flat with the
  // basics in it goes on the market; the bare ones wait until you've furnished them.
  for (const f of flats) {
    const info = flatInfo(sim, f.id);
    info.tier = rentScore(sim, f.id).tier;
    if (info.lease) continue;
    info.asking = goingRate(sim, f.id);
    const has = scoreFor(sim, f.id, 1).has;
    info.listed = has.bed && has.toilet && has.wash && has.kitchen;
  }
  st.post.push({
    id: st.nextId++,
    day: 1,
    from: 'Northfold Building Society',
    title: 'Welcome to your mortgage',
    body: `Congratulations on your purchase. Your payment of £${MORTGAGE.payment / POUND} is due every Monday, starting on day 8. Miss four in a row and the building becomes ours, which we mention only for completeness.`,
    read: false,
  });
}
