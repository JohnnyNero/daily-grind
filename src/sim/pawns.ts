// People on the map. For now there are two kinds: passers-by who walk along the street,
// and the letting agent, who has keys to everything and calls round to look at flats
// (which proves every flat can be reached and left). Tenants come later.

import { findPath, type Keys } from './layout';
import { pick, randInt, random } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_HOUR, TICKS_PER_MINUTE, type Pawn } from './state';

/** Tiles per tick at a stroll: about two tiles a second at normal speed. */
const WALK = 0.08;
const CLIMB = 0.05;
const EPS = 1e-6;

const FIRST = ['Sam', 'Priya', 'Dave', 'Aisha', 'Tom', 'Mags', 'Kwame', 'Ellie', 'Gareth', 'Zara', 'Bill', 'Niamh', 'Raj', 'Jo', 'Callum', 'Bev', 'Tariq', 'Fiona', 'Lee', 'Mo'];
const LAST = ['Patel', 'Jones', 'Smith', 'Okafor', 'Murphy', 'Clarke', 'Nowak', 'Hughes', 'Ahmed', 'Walsh', 'Evans', 'Khan', 'Reid', 'Bell'];

/** Each pawn's last-seen building version, so paths are checked when the building changes. */
const seenVersion = new WeakMap<Pawn, number>();

export function keysOf(p: Pawn): Keys {
  return p.kind === 'agent' ? { all: true } : {};
}

export function stepPawns(sim: Sim): void {
  const st = sim.state;
  spawn(sim);
  for (const p of [...st.pawns]) step(sim, p);
}

function spawn(sim: Sim): void {
  const st = sim.state;
  const hour = Math.floor(sim.minuteOfDay / 60);
  if (st.tick >= st.timers.passerby) {
    const busy = hour >= 7 && hour < 23;
    const gap = busy ? randInt(st, 2, 12) : randInt(st, 20, 90);
    st.timers.passerby = st.tick + gap * TICKS_PER_MINUTE;
    addPawn(sim, 'passerby');
  }
  if (st.tick >= st.timers.agent && !st.pawns.some((p) => p.kind === 'agent')) {
    if (hour >= 9 && hour < 18 && sim.layout.flats.length > 0) addPawn(sim, 'agent');
    else st.timers.agent = st.tick + TICKS_PER_HOUR;
  }
}

function addPawn(sim: Sim, kind: Pawn['kind']): Pawn {
  const st = sim.state;
  const from: 0 | 1 = random(st) < 0.5 ? 0 : 1;
  const x = from === 0 ? 0 : st.w - 1;
  const p: Pawn = {
    id: st.nextId++,
    name: kind === 'agent' ? 'Denise from the letting agent' : `${pick(st, FIRST)} ${pick(st, LAST)}`,
    kind,
    x,
    s: 0,
    path: [],
    goal: null,
    task: kind === 'agent' ? 'go' : 'leave',
    exit: kind === 'agent' ? from : from === 0 ? 1 : 0,
    doing: kind === 'agent' ? 'Arriving' : 'Walking past',
    waitUntil: 0,
    flat: null,
    look: { skin: randInt(st, 0, 5), hair: randInt(st, 0, 7), top: randInt(st, 0, 9), legs: randInt(st, 0, 5) },
    facing: from === 0 ? 1 : -1,
  };
  st.pawns.push(p);
  seenVersion.set(p, sim.version);
  return p;
}

function removePawn(sim: Sim, p: Pawn): void {
  const st = sim.state;
  st.pawns.splice(st.pawns.indexOf(p), 1);
  if (p.kind === 'agent') st.timers.agent = st.tick + randInt(st, 2, 5) * TICKS_PER_HOUR;
}

/** Standing on a node, not part way along a step. (The pavement step crosses whole columns, so passing one doesn't count.) */
const atNode = (p: Pawn) =>
  Math.abs(p.x - Math.round(p.x)) < EPS && Math.abs(p.s - Math.round(p.s)) < EPS && !(p.front && Math.abs(p.x - (p.frontTo ?? p.x)) > EPS);

function step(sim: Sim, p: Pawn): void {
  const st = sim.state;
  if (atNode(p)) {
    p.x = Math.round(p.x);
    p.s = Math.round(p.s);
    // Paths in a save were made for the saved building, so a freshly loaded pawn is up to date.
    if (!seenVersion.has(p)) seenVersion.set(p, sim.version);
    if (seenVersion.get(p) !== sim.version) {
      seenVersion.set(p, sim.version);
      settle(sim, p);
      if (p.goal) setGoal(sim, p, p.goal);
    }
  }
  if (p.path.length > 0) {
    walk(p);
    return;
  }
  if (st.tick < p.waitUntil) return;
  think(sim, p);
}

/** If the building changed under them (a wall where they stand, a floor taken away), find somewhere to stand. */
function settle(sim: Sim, p: Pawn): void {
  const lay = sim.layout;
  for (let s = p.s; s >= 0; s--) {
    for (let d = 0; d < lay.w; d++) {
      for (const x of [p.x - d, p.x + d]) {
        if (x < 0 || x >= lay.w || !lay.standable[lay.node(x, s)]) continue;
        p.x = x;
        p.s = s;
        return;
      }
    }
  }
}

function setGoal(sim: Sim, p: Pawn, goal: [number, number]): boolean {
  const lay = sim.layout;
  p.goal = goal;
  const path = findPath(lay, lay.node(Math.round(p.x), Math.round(p.s)), lay.node(goal[0], goal[1]), keysOf(p));
  if (!path) {
    p.path = [];
    return false;
  }
  p.path = path.map((n) => lay.xs(n));
  return true;
}

function walk(p: Pawn): void {
  const [tx, ts] = p.path[0];
  const dx = tx - p.x;
  const ds = ts - p.s;
  if (Math.abs(dx) > EPS) p.facing = dx > 0 ? 1 : -1;
  // A step longer than one tile along the ground is the pavement past the front of the building.
  if (atNode(p)) {
    if (Math.abs(ds) < EPS && Math.abs(dx) > 1.5) {
      p.front = true;
      p.frontTo = tx;
    } else {
      delete p.front;
      delete p.frontTo;
    }
  }
  const speed = Math.abs(ds) > EPS ? CLIMB : WALK;
  const dist = Math.abs(dx) > EPS ? Math.abs(dx) : Math.abs(ds);
  if (dist <= speed) {
    p.x = tx;
    p.s = ts;
    p.path.shift();
    if (p.path.length === 0) p.goal = null;
    return;
  }
  const f = speed / dist;
  p.x += dx * f;
  p.s += ds * f;
}

function think(sim: Sim, p: Pawn): void {
  const st = sim.state;
  const lay = sim.layout;
  const edge = p.exit === 0 ? 0 : st.w - 1;
  if (p.task === 'leave') {
    if (Math.round(p.x) === edge && Math.round(p.s) === 0) {
      removePawn(sim, p);
      return;
    }
    p.doing = p.kind === 'agent' ? 'Off to the next viewing' : 'Walking past';
    if (!setGoal(sim, p, [edge, 0])) {
      // Shut in: wait for a way out.
      p.doing = 'Stuck: no way out';
      p.waitUntil = st.tick + 5 * TICKS_PER_MINUTE;
    }
    return;
  }
  if (p.task === 'look') {
    const others = lay.flats.filter((f) => f.id !== p.flat);
    if (others.length > 0 && random(st) < 0.5) {
      p.task = 'go';
      p.flat = pick(st, others).id;
    } else {
      p.task = 'leave';
      p.flat = null;
    }
    think(sim, p);
    return;
  }
  // Going to a flat: once there, look round for a while.
  const flat = lay.flat(p.flat) ?? (lay.flats.length > 0 ? pick(st, lay.flats) : undefined);
  if (!flat) {
    p.task = 'leave';
    return;
  }
  const here = lay.flatAt(Math.round(p.x), Math.round(p.s));
  if (p.flat === flat.id && here?.id === flat.id && !lay.isDoorNode(lay.node(Math.round(p.x), Math.round(p.s)))) {
    p.task = 'look';
    p.doing = `Looking round ${flat.name}`;
    p.waitUntil = st.tick + randInt(st, 15, 40) * TICKS_PER_MINUTE;
    return;
  }
  p.flat = flat.id;
  const nodes = flat.rooms.flatMap((r) => lay.rooms[r].nodes);
  const target = lay.xs(pick(st, nodes));
  p.doing = `Heading to ${flat.name}`;
  if (!setGoal(sim, p, target)) {
    p.doing = `Can't get into ${flat.name}`;
    p.task = 'leave';
    p.flat = null;
    p.waitUntil = st.tick + 2 * TICKS_PER_MINUTE;
  }
}
