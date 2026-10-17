// Everything the manager (the player) can change: the rota, breaks, hiring and firing,
// the staff themselves, the menu and prices, the furniture, and saving.
// Each function validates its input and returns an error message instead of throwing,
// so the UI can show it.

import {
  BACKSTORIES, FIRST_NAMES, HAIR_COLOURS, HAIR_STYLES, MAX_STAFF, SKIN_TONES, TRAITS, WORK_TYPES,
  footprint, objectDef, rotationOf, serviceAt, spotsAt, type HairStyle, type Rotation, type Skills, type TraitId, type WorkType,
} from './defs';
import { pick, random, randRange } from './rng';
import { askingWage, canSpend } from './business';
import { passionsFor } from './normalize';
import { Sim } from './sim';
import { isShell } from './structure';
import { SERVICE_DEFS, reservedTiles, serviceSpots } from './service';
import { SAVE_VERSION, type Applicant, type ObjectInst, type Pawn, type SimState } from './state';
import { addMemory } from './thoughts';

export const APPLICANT_COUNT = 3;
const EARLIEST_START = 6 * 60;
const LATEST_END = 20 * 60;
const MIN_SHIFT = 2 * 60;

// ------------------------------------------------------------------ staff

export function randomTraits(sim: Sim, count = 2): TraitId[] {
  const s = sim.state;
  const traits: TraitId[] = [];
  while (traits.length < count) {
    const t = pick(s, TRAITS);
    if (traits.includes(t.id) || traits.some((id) => t.excludes?.includes(id) || TRAITS.find((x) => x.id === id)?.excludes?.includes(t.id))) continue;
    traits.push(t.id);
  }
  return traits;
}

export function makeApplicant(sim: Sim): Applicant {
  const s = sim.state;
  const taken = new Set([...s.pawns.map((p) => p.name), ...s.applicants.map((a) => a.name)]);
  const free = FIRST_NAMES.filter((n) => !taken.has(n));
  const skills = {} as Skills;
  for (const w of WORK_TYPES) skills[w.id] = Math.round(randRange(s, 0, 7) * 10) / 10;
  return {
    name: pick(s, free.length > 0 ? free : FIRST_NAMES),
    look: { skin: pick(s, SKIN_TONES), hair: pick(s, HAIR_COLOURS), hairStyle: pick(s, HAIR_STYLES), shirt: sim.venue.uniform.shirt, apron: sim.venue.uniform.apron },
    traits: randomTraits(sim),
    skills,
    backstory: pick(s, BACKSTORIES.filter((b) => !s.applicants.some((a) => a.backstory === b))),
    passions: passionsFor(s.nextId * 31 + s.applicants.length + Math.floor(random(s) * 1000)),
    wage: askingWage(skills),
  };
}

/** Keeps a few applicants waiting; one new face a day. */
export function refreshApplicants(sim: Sim): void {
  const s = sim.state;
  if (s.applicants.length >= APPLICANT_COUNT) s.applicants.shift();
  while (s.applicants.length < APPLICANT_COUNT) s.applicants.push(makeApplicant(sim));
}

function staffList(sim: Sim): Pawn[] {
  return sim.state.pawns.filter((p) => p.staff && !p.staff.quit);
}

export function hire(sim: Sim, index: number): Pawn | string {
  const s = sim.state;
  const a = s.applicants[index];
  if (!a) return 'That applicant has moved on.';
  if (staffList(sim).length >= MAX_STAFF) return `The café can't take more than ${MAX_STAFF} staff.`;
  s.applicants.splice(index, 1);
  // Two of the same name on one team gets confusing: the newcomer goes by their initial too.
  const taken = new Set(s.pawns.filter((x) => x.staff && !x.staff.quit).map((x) => x.name));
  const name = taken.has(a.name) ? `${a.name} ${'BCDFGHJKLMNPRSTW'[s.nextId % 16]}.` : a.name;
  const p = sim.addStaff({ start: 9 * 60, end: 17 * 60 }, { ...a, name });
  sim.log(`${p.name} joined the team. ${a.backstory}`, 'good', p.id, 'hire', 3);
  return p;
}

export function fire(sim: Sim, p: Pawn): string | null {
  const staff = p.staff;
  if (!staff || staff.quit) return 'They already left.';
  staff.quit = true;
  staff.fired = true;
  staff.mentalBreak = null;
  sim.log(`You let ${p.name} go.`, 'neutral', p.id, 'fired', 6);
  if (p.onMap) {
    sim.endJob(p);
    p.job = sim.leaveJob('Clearing out their locker');
  } else {
    sim.removeStaff(p);
  }
  return null;
}

export function orderBreak(sim: Sim, p: Pawn): string | null {
  if (!p.staff || !p.onMap) return "They're not in.";
  if (p.staff.mentalBreak) return "They're... already taking a break of sorts.";
  p.staff.forcedBreak = true;
  sim.endJob(p);
  return null;
}

export function sendHomeEarly(sim: Sim, p: Pawn): string | null {
  if (!p.staff || !p.onMap) return "They're not in.";
  p.staff.homeEarlyDay = sim.day;
  addMemory(sim, p, 'letOffEarly');
  return null;
}

export function setShift(sim: Sim, p: Pawn, start: number, end: number): string | null {
  // Shifts can run from early morning to half an hour after closing (never past midnight).
  const latest = Math.min(23 * 60 + 30, Math.max(LATEST_END, sim.venue.hours.close + 30));
  const s = Math.max(EARLIEST_START, Math.min(latest - MIN_SHIFT, Math.round(start / 30) * 30));
  const e = Math.max(s + MIN_SHIFT, Math.min(latest, Math.round(end / 30) * 30));
  p.shift = { start: s, end: e };
  return null;
}

/** Where someone goes when there's a rush on (null: same as usual). */
export function setRushStation(p: Pawn, work: WorkType | null): string | null {
  if (!p.staff) return 'Only staff have stations.';
  p.staff.rushStation = work;
  return null;
}

/** Puts someone on a station (or back to going where they're needed, with null). */
export function setStation(sim: Sim, p: Pawn, work: WorkType | null): string | null {
  if (!p.staff) return 'Only staff have stations.';
  if (work !== null && !WORK_TYPES.some((w) => w.id === work)) return 'Unknown station.';
  p.staff.station = work;
  p.staff.focus = work ? { work, lastDone: sim.state.tick, since: sim.state.tick } : null;
  return null;
}

/** Sets which weekdays (0 = Monday) someone is off. They need at least one working day. */
export function setDaysOff(p: Pawn, days: number[]): string | null {
  if (!p.staff) return 'Only staff have days off.';
  const clean = [...new Set(days.filter((d) => d >= 0 && d <= 6))].sort();
  if (clean.length >= 7) return 'They need to work at least one day.';
  p.staff.daysOff = clean;
  return null;
}

export interface StaffChanges {
  name?: string;
  skin?: string;
  hair?: string;
  hairStyle?: HairStyle;
  traits?: TraitId[];
  /** Up to three lines they come out with. */
  catchphrases?: string[];
}

export function editStaff(p: Pawn, c: StaffChanges): string | null {
  if (!p.staff) return 'Only staff can be edited.';
  if (c.name !== undefined) {
    const name = c.name.trim().slice(0, 16);
    if (!name) return 'Everyone needs a name.';
    p.name = name;
  }
  if (c.skin) p.look.skin = c.skin;
  if (c.hair) p.look.hair = c.hair;
  if (c.hairStyle) p.look.hairStyle = c.hairStyle;
  if (c.traits) {
    if (c.traits.length > 3) return 'Three traits at most.';
    for (const t of c.traits) {
      const def = TRAITS.find((x) => x.id === t);
      if (!def) return 'Unknown trait.';
      const clash = c.traits.find((o) => def.excludes?.includes(o));
      if (clash) return `${def.label} and ${TRAITS.find((x) => x.id === clash)!.label} don't go together.`;
    }
    p.staff.traits = [...c.traits];
  }
  if (c.catchphrases) {
    const lines = c.catchphrases.map((l) => l.trim().replace(/^["“]|["”]$/g, '').slice(0, 60)).filter(Boolean);
    if (lines.length > 3) return 'Three catchphrases at most.';
    p.staff.catchphrases = lines;
  }
  return null;
}

// ------------------------------------------------------------------ starting team (before opening)

/** True until the first staff member arrives, while the starting team can still be reshaped. */
export function isSetup(sim: Sim): boolean {
  return sim.day === 1 && sim.state.pawns.every((p) => !p.onMap) && sim.state.log.length === 0;
}

/** A whole new random person in this slot: name, looks, traits and skills. */
export function rerollStarter(sim: Sim, p: Pawn): void {
  const s = sim.state;
  if (!p.staff) return;
  const taken = new Set(s.pawns.filter((x) => x.id !== p.id).map((x) => x.name));
  const free = FIRST_NAMES.filter((n) => !taken.has(n));
  p.name = pick(s, free.length > 0 ? free : FIRST_NAMES);
  p.look = { ...p.look, skin: pick(s, SKIN_TONES), hair: pick(s, HAIR_COLOURS), hairStyle: pick(s, HAIR_STYLES) };
  p.staff.traits = randomTraits(sim);
  for (const w of WORK_TYPES) p.staff.skills[w.id] = Math.round(randRange(s, 1, 8) * 10) / 10;
  // A starter with a station (the cook) stays good at it.
  if (p.staff.station) p.staff.skills[p.staff.station] = Math.max(p.staff.skills[p.staff.station], 5);
}

/** Adds someone to the starting team, on the venue's next default shift. */
export function addStarter(sim: Sim): Pawn | string {
  const staff = staffList(sim);
  if (!isSetup(sim)) return 'The doors are already open; hire from the applicants instead.';
  if (staff.length >= MAX_STAFF) return `The café can't take more than ${MAX_STAFF} staff.`;
  const shifts = sim.venue.shifts;
  return sim.addStarterStaff(shifts[staff.length % shifts.length]);
}

/** Takes someone off the starting team. They were never hired, so nobody misses them. */
export function removeStarter(sim: Sim, p: Pawn): string | null {
  if (!isSetup(sim)) return 'The doors are already open; let them go from the Staff panel instead.';
  if (staffList(sim).length <= 1) return 'Someone has to open up.';
  const s = sim.state;
  s.pawns = s.pawns.filter((x) => x.id !== p.id);
  for (const key of Object.keys(s.relations)) {
    if (key.split(':').map(Number).includes(p.id)) delete s.relations[key];
  }
  return null;
}

// ------------------------------------------------------------------ menu

export function setPrice(sim: Sim, name: string, price: number): string | null {
  const item = sim.state.menu.find((m) => m.name === name);
  if (!item) return 'Not on the menu.';
  const min = Math.round(item.basePrice * 0.5);
  const max = item.basePrice * 2;
  item.price = Math.max(min, Math.min(max, Math.round(price / 10) * 10));
  return null;
}

export function setEnabled(sim: Sim, name: string, enabled: boolean): string | null {
  const item = sim.state.menu.find((m) => m.name === name);
  if (!item) return 'Not on the menu.';
  if (!enabled && sim.state.menu.filter((m) => m.enabled).length <= 1) return 'You need something on the menu.';
  item.enabled = enabled;
  return null;
}

export { priceRatio } from './business';

// ------------------------------------------------------------------ furniture

/** Tiles furniture and walls may never cover: service spots, the queue and pickup zones, the way in. */
export function keepClear(sim: Sim, ignore: ObjectInst | null = null): readonly (readonly [number, number])[] {
  const own = ignore ? serviceAt(ignore.def, ignore.x, ignore.y, rotationOf(ignore)) : null;
  const mine = (x: number, y: number) => !!own && ((own.staff[0] === x && own.staff[1] === y) || (own.guest?.[0] === x && own.guest?.[1] === y));
  return reservedTiles(sim).filter(([x, y]) => !mine(x, y));
}

/** You can't sell the last one of these. */
function essential(sim: Sim): string[] {
  return [SERVICE_DEFS.till, SERVICE_DEFS.pickup, sim.venue.drinkStation, 'sink', 'toilet'];
}

export { footprint } from './defs';

/** Someone is using it, sitting at it, or on their way to clear it. */
function inUse(sim: Sim, o: ObjectInst): boolean {
  return Object.keys(sim.state.reservations).some((k) => k.startsWith(`obj:${o.id}:`) || k === `dish:${o.id}`);
}

/** Tiles someone has claimed to stand or sit on (a seat they're heading for, say). */
function claimedSpots(sim: Sim): [number, number][] {
  const out: [number, number][] = [];
  for (const key of Object.keys(sim.state.reservations)) {
    const [kind, id, spot] = key.split(':');
    if (kind !== 'obj') continue;
    const o = sim.world.objectById(Number(id));
    const at = o ? sim.world.spots(o)[Number(spot)] : undefined;
    if (at) out.push(at);
  }
  return out;
}

/**
 * Null if `def` can stand at (x, y) turned `rot` quarter turns; otherwise why not.
 * `ignore` is the object being moved.
 */
export function placementProblem(sim: Sim, def: string, x: number, y: number, ignore: ObjectInst | null = null, rot: Rotation = 0): string | null {
  const d = objectDef(def);
  const w = sim.world;
  const label = d.label.toLowerCase();
  if (d.counterSection && def !== sim.venue.counter) return "That's not for sale here.";
  if (d.service) {
    if (sim.state.objects.some((o) => o.def === def && o !== ignore)) return `There's already a ${label}. Drag it to move it.`;
    if (sim.state.pawns.some((p) => p.kind === 'guest')) return 'Wait until the customers have gone.';
  }
  const clear = keepClear(sim, ignore);
  for (const [tx, ty] of footprint(def, x, y, rot)) {
    if (!w.inBounds(tx, ty)) return "That's off the edge.";
    const t = w.tile(tx, ty);
    if (t.wall) return "There's a wall in the way.";
    if (t.door) return "That would block a door.";
    if (d.floors && !d.floors.includes(t.floor)) return `${d.label}s don't go there.`;
    if (clear.some(([kx, ky]) => kx === tx && ky === ty)) return 'That spot has to stay clear for service.';
    for (const o of sim.state.objects) {
      if (o === ignore) continue;
      if (w.tilesOf(o).some(([ox, oy]) => ox === tx && oy === ty)) return 'Something is already there.';
    }
    if (d.blocks && sim.state.pawns.some((p) => p.onMap && Math.round(p.x) === tx && Math.round(p.y) === ty)) return 'Someone is standing there.';
    if (d.blocks && claimedSpots(sim).some(([cx, cy]) => cx === tx && cy === ty)) return "Someone's about to sit there.";
  }
  for (const [sx, sy] of spotsAt(def, x, y, rot)) {
    if (!w.inBounds(sx, sy) || w.tile(sx, sy).wall) return "Nobody could get to it there.";
  }
  // A service point needs open floor where staff stand behind it and customers in front.
  const at = serviceAt(def, x, y, rot);
  if (at) {
    for (const [tx, ty] of at.guest ? [at.staff, at.guest] : [at.staff]) {
      if (!w.inBounds(tx, ty)) return 'There has to be room either side of it.';
      const t = w.tile(tx, ty);
      if (t.wall || t.door || isShell(sim, tx, ty)) return 'It needs open floor behind for staff' + (at.guest ? ' and in front for customers.' : '.');
      const blocker = sim.state.objects.find((o) => o !== ignore && w.tilesOf(o).some(([ox, oy]) => ox === tx && oy === ty));
      if (blocker) return `The ${objectDef(blocker.def).label.toLowerCase()} is in the way of where people stand to use it.`;
    }
  }
  return null;
}

/** Flood fill from the entrance: can everyone still get everywhere they need to? */
export function reachProblem(sim: Sim): string | null {
  const s = sim.state;
  const seen = new Uint8Array(s.w * s.h);
  const [ex, ey] = sim.venue.entry[0];
  const stack: [number, number][] = [[ex, ey]];
  seen[ey * s.w + ex] = 1;
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.world.passable(nx, ny) || seen[ny * s.w + nx]) continue;
      seen[ny * s.w + nx] = 1;
      stack.push([nx, ny]);
    }
  }
  const reach = (x: number, y: number) => sim.world.inBounds(x, y) && seen[y * s.w + x] === 1;
  if (serviceSpots(sim).some(([x, y]) => !reach(x, y))) return 'That would cut off the till or the pickup.';
  // Nobody on the premises may be shut in. Someone between tiles counts if either side is open.
  for (const p of s.pawns) {
    if (!p.onMap) continue;
    const [fx, fy, cx, cy] = [Math.floor(p.x), Math.floor(p.y), Math.ceil(p.x), Math.ceil(p.y)];
    if (![[fx, fy], [cx, cy], [fx, cy], [cx, fy]].some(([x, y]) => reach(x, y))) return `That would shut ${p.name} in.`;
  }
  for (const o of s.objects) {
    const spots = sim.world.spots(o);
    if (spots.length > 0 && !spots.some(([x, y]) => reach(x, y))) return `That would block the ${objectDef(o.def).label.toLowerCase()}.`;
  }
  return null;
}

/** Moves (and optionally turns) a piece of furniture. `rot` defaults to how it's turned now. */
export function moveObject(sim: Sim, id: number, x: number, y: number, rot?: Rotation): string | null {
  const o = sim.world.objectById(id);
  if (!o) return "It's gone.";
  const d = objectDef(o.def);
  if (d.fixed) return `The ${d.label.toLowerCase()} is fixed in place.`;
  if (inUse(sim, o)) return 'Someone is using it right now.';
  const turn = rot ?? rotationOf(o);
  const problem = placementProblem(sim, o.def, x, y, o, turn);
  if (problem) return problem;
  const before = { x: o.x, y: o.y, rot: o.rot };
  o.x = x;
  o.y = y;
  if (turn) o.rot = turn;
  else delete o.rot;
  sim.world.rebuild();
  const blocked = reachProblem(sim);
  if (blocked) {
    o.x = before.x;
    o.y = before.y;
    if (before.rot) o.rot = before.rot;
    else delete o.rot;
    sim.world.rebuild();
    return blocked;
  }
  sim.reroute();
  return null;
}

/** A quarter turn clockwise, where it stands. */
export function rotateObject(sim: Sim, id: number): string | null {
  const o = sim.world.objectById(id);
  if (!o) return "It's gone.";
  return moveObject(sim, id, o.x, o.y, ((rotationOf(o) + 1) % 4) as Rotation);
}

export function buyObject(sim: Sim, def: string, x: number, y: number, rot: Rotation = 0): string | null {
  const d = objectDef(def);
  if (d.price === undefined || d.fixed) return "That's not for sale.";
  if (!canSpend(sim, d.price)) return "The bank won't lend any more. Get back in the black first.";
  const problem = placementProblem(sim, def, x, y, null, rot);
  if (problem) return problem;
  const o = sim.world.placeObject({ def, x, y, rot });
  const blocked = reachProblem(sim);
  if (blocked) {
    sim.state.objects = sim.state.objects.filter((x2) => x2 !== o);
    sim.world.rebuild();
    return blocked;
  }
  sim.state.money -= d.price;
  sim.reroute();
  return null;
}

export function sellObject(sim: Sim, id: number): string | null {
  const s = sim.state;
  const o = sim.world.objectById(id);
  if (!o) return "It's gone.";
  const d = objectDef(o.def);
  if (d.fixed || d.price === undefined) return `The ${d.label.toLowerCase()} stays.`;
  if (inUse(sim, o)) return 'Someone is using it right now.';
  if (essential(sim).includes(o.def) && s.objects.filter((x) => x.def === o.def).length <= 1) {
    return `You need at least one ${d.label.toLowerCase()}.`;
  }
  if ((s.dirty[o.id] ?? 0) > 0) {
    s.sinkDirty += s.dirty[o.id];
    delete s.dirty[o.id];
  }
  s.objects = s.objects.filter((x) => x !== o);
  sim.world.rebuild();
  s.money += Math.round(d.price / 2);
  return null;
}

export function sellValue(def: string): number {
  return Math.round((objectDef(def).price ?? 0) / 2);
}

// ------------------------------------------------------------------ saving

export function serialize(sim: Sim): string {
  return JSON.stringify(sim.state);
}

/** Brings an older save up to date, one version at a time. */
function migrate(state: SimState & { version: number }): void {
  if ((state.version as number) === 1) {
    for (const p of state.pawns) {
      if (p.staff) {
        p.staff.priorities.cleaning ??= 3;
        p.staff.skills.cleaning ??= 3;
        p.staff.wants ??= [];
      }
      if (p.visit) {
        p.visit.regularId ??= null;
        p.visit.spilt ??= false;
      }
    }
    state.regulars ??= [];
    state.spills ??= [];
    state.hallOfFame ??= [];
    (state as { version: number }).version = 2;
  }
  if ((state.version as number) === 2) {
    // Venues arrived: item kinds became generic, and conditions got venue-neutral names.
    const kind = (k: string) => (k === 'coffee' ? 'drink' : k === 'cake' ? 'food' : k) as 'drink' | 'food';
    state.venue ??= 'cafe';
    for (const m of state.menu) m.kind = kind(m.kind);
    for (const o of state.orders) for (const i of o.items) i.kind = kind(i.kind);
    for (const p of state.pawns) {
      const c = p.carrying as { kind: string; item?: string } | null;
      if (!c) continue;
      if (c.kind === 'coffee' || c.kind === 'cake') c.kind = kind(c.kind);
      if (c.item) c.item = kind(c.item);
    }
    const condition = (id: string) => (id === 'espressoBroken' ? 'stationBroken' : id === 'noCake' ? 'noFood' : id);
    for (const c of state.conditions) c.id = condition(c.id) as typeof c.id;
    (state as { version: number }).version = 3;
  }
}

/** Restores a saved café. Throws with a readable message if the save can't be used. */
export function deserialize(json: string): Sim {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("That file isn't a Daily Grind save.");
  }
  const notASave = new Error("That file isn't a Daily Grind save.");
  const state = data as Partial<SimState>;
  if (!state || typeof state !== 'object' || !Array.isArray(state.pawns) || !Array.isArray(state.tiles)) throw notASave;
  if (typeof state.version === 'number' && state.version > SAVE_VERSION) throw new Error('That save is from a newer version of the game.');
  try {
    migrate(state as SimState & { version: number });
  } catch {
    throw notASave;
  }
  if (state.version !== SAVE_VERSION) throw notASave;
  // Everything the sim relies on must be present and the right shape.
  const arrays = ['objects', 'queue', 'orders', 'log', 'recaps', 'menu', 'applicants', 'conditions', 'regulars', 'spills', 'hallOfFame'] as const;
  const numbers = ['tick', 'w', 'h', 'rng', 'nextId', 'money', 'reputation', 'sinkDirty'] as const;
  if (arrays.some((k) => !Array.isArray(state[k])) || numbers.some((k) => typeof state[k] !== 'number')) throw notASave;
  if (!state.story || !state.today || !state.reservations || !state.relations || !state.dirty) throw notASave;
  if (state.tiles.length !== (state.w ?? 0) * (state.h ?? 0)) throw notASave;
  try {
    return new Sim(state.seed ?? 1, state as SimState);
  } catch {
    throw notASave;
  }
}

