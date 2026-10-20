// Ambient moments (spec 2.3): little scenes that cost the player nothing. One or two people
// and a place, 5 to 30 real seconds (timed in ticks: `seconds()` in state.ts), a bubble or a
// pose, and sometimes a social memory. They come from what's true now, the same way cards do.
// At most MOMENTS.most at once; one starting every MOMENTS.gap game minutes in waking hours.
//
// A tenant in a moment has `life.moment` set (state.ts). A moment is a short script of beats
// per person: walk to a place, then hold there (a bubble, a pose, a prop) for some real
// seconds. Two people keep step with each other: a beat can wait for the other to arrive,
// or for them to have got somewhere. `step` counts three to a beat: 3k heading there,
// 3k + 1 there but waiting for the other, 3k + 2 holding. The first person in the cast
// (the leader) finishing their script finishes the moment; a moment that runs out of time
// is dropped with nothing left behind. Who's home and awake comes from schedules.ts.
//
// Singing in the shower is the odd one: the singer is busy with the shower, so it's
// "passive" and just plays out on the minute.

import { addDirt, dirtOf, neighboursOf, outdoorTemp, SHARED } from './environment';
import { hasFlag } from './flags';
import { findPath, type Flat } from './layout';
import { furnitureDef } from './defs';
import { keysOf, setGoal } from './pawns';
import { pick, randInt, random } from './rng';
import { awayToday, bedtime, freeFor, homeAndAwake } from './schedules';
import type { Sim } from './sim';
import { opinion, rememberAbout } from './social';
import { TICKS_PER_MINUTE, seconds, type Life, type Pawn, type Pose, type State } from './state';
import { MOMENTS, MOVING_IN, SCHEDULES, SEEK, SOCIAL } from './tuning';
import { has } from './traits';

type Moment = NonNullable<Life['moment']>;

// ------------------------------------------------------------------ places

/** Where a beat happens, resolved when someone sets off for it. */
type Where =
  | 'entrance' // just inside the street door
  | 'lobby' // somewhere on the ground floor, in the shared parts
  | 'stairs' // a landing upstairs, or the lobby if the building's all one floor
  | 'landing' // outside their own front door
  | 'theirLanding' // outside the other person's front door, a step along
  | 'home' // somewhere in their flat
  | 'kitchen' // by their cooker, else anywhere in the flat
  | 'beside' // next to the other person, where they are now
  | 'seat'; // moving-in day: the seat they choose in their new flat

interface Beat {
  to: Where;
  /** For the info panel. */
  doing: string;
  /** The bubble while holding: words, and the pixel icon that stands in for them. */
  say?: { text: string; icon?: string };
  /** Real seconds at 1x to hold the beat (timed with `seconds()`). */
  hold: number;
  pose?: Pose;
  prop?: string;
  /** Don't set off until the other person has got this far (their `step`). */
  after?: number;
  /** Hold only once the other person is here too. */
  meet?: boolean;
}

/** A small number from a few ingredients, so a spot is the same each time it's asked for (no dice mid-moment). */
function hash(sim: Sim, ...n: number[]): number {
  return n.reduce((h, v) => Math.imul(h ^ (v + 0x9e37), 0x85ebca6b) >>> 0, sim.day);
}

const groundNodes = (sim: Sim): number[] => {
  const lay = sim.layout;
  return lay.rooms
    .filter((r) => r.shared)
    .flatMap((r) => r.nodes)
    .filter((n) => !lay.isDoorNode(n) && lay.standable[n] && lay.xs(n)[1] === groundRow(sim));
};

/** The row of the street door: the ground floor of the building. */
function groundRow(sim: Sim): number {
  const door = Object.entries(sim.state.cells).find(([, c]) => c === 'entrance');
  return door ? Number(door[0].split(',')[1]) : 1;
}

function entranceSpot(sim: Sim): [number, number] | null {
  const lay = sim.layout;
  const door = Object.entries(sim.state.cells).find(([, c]) => c === 'entrance');
  if (!door) return null;
  const [x, s] = door[0].split(',').map(Number);
  for (const dx of [1, -1, 2, -2]) {
    const n = lay.node(x + dx, s);
    if (x + dx >= 0 && x + dx < lay.w && lay.standable[n] && !lay.isDoorNode(n) && lay.roomOf[n] !== -1) return [x + dx, s];
  }
  return null;
}

/** A spot beside another, in the same room if there's room. */
function near(sim: Sim, at: [number, number]): [number, number] {
  const lay = sim.layout;
  const room = lay.roomOf[lay.node(at[0], at[1])];
  for (const dx of [1, -1, 2, -2]) {
    const x = at[0] + dx;
    if (x < 0 || x >= lay.w) continue;
    const n = lay.node(x, at[1]);
    if (lay.standable[n] && !lay.isDoorNode(n) && lay.roomOf[n] === room) return [x, at[1]];
  }
  return at;
}

/** A spot on the landing outside a flat's front door. */
function landingOf(sim: Sim, flat: Flat | undefined): [number, number] | null {
  const lay = sim.layout;
  const door = flat?.doors[0]?.split(',').map(Number);
  if (!door) return null;
  const n = [door[0] - 1, door[0] + 1].map((x) => lay.node(x, door[1])).find((m) => lay.roomOf[m] !== -1 && lay.rooms[lay.roomOf[m]].shared && lay.standable[m]);
  return n === undefined ? null : lay.xs(n);
}

function flatSpot(sim: Sim, flat: Flat, ...n: number[]): [number, number] | null {
  const lay = sim.layout;
  const nodes = flat.rooms.flatMap((r) => lay.rooms[r].nodes).filter((m) => !lay.isDoorNode(m));
  return nodes.length === 0 ? null : lay.xs(nodes[hash(sim, ...n) % nodes.length]);
}

function spotFor(sim: Sim, where: Where, me: Pawn, other: Pawn | undefined, k: number): [number, number] | null {
  const lay = sim.layout;
  const flat = lay.flat(me.life!.flat);
  const salt = [me.id, k];
  switch (where) {
    case 'entrance':
      return entranceSpot(sim);
    case 'lobby': {
      const nodes = groundNodes(sim);
      return nodes.length === 0 ? null : lay.xs(nodes[hash(sim, ...salt) % nodes.length]);
    }
    case 'stairs': {
      const up = lay.rooms
        .filter((r) => r.shared)
        .flatMap((r) => r.nodes)
        .filter((n) => !lay.isDoorNode(n) && lay.standable[n] && lay.xs(n)[1] > groundRow(sim));
      return up.length === 0 ? spotFor(sim, 'lobby', me, other, k) : lay.xs(up[hash(sim, ...salt) % up.length]);
    }
    case 'landing':
      return landingOf(sim, flat);
    case 'theirLanding': {
      const at = landingOf(sim, lay.flat(other?.life?.flat ?? null));
      return at ? near(sim, at) : null;
    }
    case 'home':
      return flat ? flatSpot(sim, flat, ...salt) : null;
    case 'kitchen': {
      const cooker = flat && sim.state.furniture.find((f) => f.def === 'cooker' && lay.flatAt(f.x, f.s)?.id === flat.id);
      if (cooker && lay.standable[lay.node(cooker.x, cooker.s)]) return [cooker.x, cooker.s];
      return flat ? flatSpot(sim, flat, ...salt) : null;
    }
    case 'beside':
      return other ? near(sim, [Math.round(other.x), Math.round(other.s)]) : null;
    case 'seat':
      return seatFor(sim, me)?.at ?? null;
  }
}

// ------------------------------------------------------------------ moving-in day: where they sit

type SeatKind = 'sofa' | 'armchair' | 'chair' | 'bed' | 'floor';

/**
 * Where a new tenant sits down first. The household take it in turn (lowest id first):
 * sofa places, then the armchair, then the dining set, then the beds, then the floor. So a
 * flat with nowhere to sit sees its people on the bed, and nobody has to be told.
 */
function seatFor(sim: Sim, me: Pawn): { at: [number, number]; kind: SeatKind } | null {
  const lay = sim.layout;
  const flat = lay.flat(me.life!.flat);
  if (!flat) return null;
  const cells = new Set(lay.flatCells(flat));
  const places = (def: string, kind: SeatKind) =>
    sim.state.furniture
      .filter((f) => f.def === def && cells.has(lay.node(f.x, f.s)))
      .flatMap((f) => (furnitureDef(f.def).spots ?? [0]).map((o) => ({ at: [f.x + o, f.s] as [number, number], kind })))
      .filter((o) => lay.standable[lay.node(o.at[0], o.at[1])] === 1);
  const seats = [...places('sofa', 'sofa'), ...places('armchair', 'armchair'), ...places('diningSet', 'chair'), ...places('bed', 'bed'), ...places('doubleBed', 'bed')];
  const household = sim.state.pawns.filter((o) => o.life?.flat === flat.id && !o.life.leaving).sort((a, b) => a.id - b.id);
  const mine = seats[household.indexOf(me)];
  if (mine) return mine;
  const at = flatSpot(sim, flat, me.id);
  return at ? { at, kind: 'floor' } : null;
}

// ------------------------------------------------------------------ who's free

const minutes = (n: number) => n * TICKS_PER_MINUTE;

/**
 * Something matters more: they need the loo, food, a wash or their bed, or it's
 * nearly time for work. A moment doesn't start then (it's too short to need cutting off).
 */
function yields(sim: Sim, p: Pawn): boolean {
  const life = p.life!;
  const n = life.needs;
  if (n.bladder < SEEK.bladder || n.sleep < SEEK.sleep || n.food < SEEK.food || n.hygiene < SEEK.hygiene) return true;
  const m = sim.minuteOfDay;
  const away = awayToday(sim, life);
  return !!away && life.workedDay !== sim.day && m >= away.leave - 20 && m < away.back - 60;
}

/** In the building, awake, and not in the middle of anything that matters. */
function free(sim: Sim, p: Pawn): boolean {
  const life = p.life;
  if (p.kind !== 'tenant' || !life || !homeAndAwake(sim, p)) return false;
  if (life.moment || life.using || life.breakState || life.outing || life.cycling || life.leaving || life.meal) return false;
  if (p.partyAt || p.task === 'leave' || p.talkUntil !== undefined) return false;
  // A party, a fight or a break-in has them already.
  const taken = sim.state.story.running.some((h) => h.pawns.includes(p.id) || h.host === p.id || h.knock === p.id || h.invited?.includes(p.id) || h.joined?.includes(p.id));
  return !taken && !yields(sim, p);
}

const inFlat = (sim: Sim, p: Pawn): boolean => !!sim.layout.flatAt(Math.round(p.x), Math.round(p.s));

function canGet(sim: Sim, p: Pawn, to: [number, number] | null): boolean {
  if (!to) return false;
  const lay = sim.layout;
  return findPath(lay, lay.node(Math.round(p.x), Math.round(p.s)), lay.node(to[0], to[1]), keysOf(p)) !== null;
}

/** Tenants in the building and awake, and not on their way out. */
export const tenantsIn = (sim: Sim): Pawn[] => sim.state.pawns.filter((p) => p.life && homeAndAwake(sim, p) && !p.life.outing);

// ------------------------------------------------------------------ the catalogue

interface MomentDef {
  id: string;
  /** Spec 2.3's number, for the record. */
  n: number;
  /** How likely, against the others. */
  weight: number;
  /** Who it's about (leader first), from what's true now; null if it can't happen. */
  cast(sim: Sim, leader: Pawn): Pawn[] | null;
  /** What each does (0 the leader, 1 the other). The leader finishing ends it. */
  beats(sim: Sim, me: Pawn, other: Pawn | undefined, role: number): Beat[];
  /** What it leaves behind, when it ran to the end. */
  end?(sim: Sim, cast: Pawn[]): void;
  /** Real seconds at 1x it runs at most (the leader's script is shorter than this). */
  seconds?: number;
  /** Plays out on the minute (the cast are busy with something else): a bubble for each, when (0 to 1 of the way through). */
  passive?: { at: number; who: number; say: { text: string; icon?: string } }[];
}

/** What piece of furniture they're using, if any. */
function usingNow(sim: Sim, p: Pawn): string | null {
  const u = p.life?.using;
  const f = u && sim.state.furniture.find((o) => o.id === u.furniture);
  return f ? f.def : null;
}

const hours = (sim: Sim): number => sim.minuteOfDay / 60;
const otherFlat = (a: Pawn, b: Pawn): boolean => a.life!.flat !== b.life!.flat;

/** Either holds something against the other: they keep out of each other's way. */
const grudge = (a: Pawn, b: Pawn): boolean => [[a, b], [b, a]].some(([x, y]) => x.life!.social.some((m) => m.about === y.id && (SOCIAL[m.id]?.value ?? 0) < 0));

/** Another free tenant to share a moment with, picked by the dice among those that pass `ok`. */
function partner(sim: Sim, leader: Pawn, ok: (o: Pawn) => boolean = () => true): Pawn | null {
  const list = sim.state.pawns.filter((o) => o !== leader && free(sim, o) && !grudge(leader, o) && ok(o));
  return list.length === 0 ? null : pick(paceOf(sim), list);
}

/** How the second person feels about the first, for deciding whether they'd help. */
const kindTo = (sim: Sim, b: Pawn, a: Pawn): boolean => has(b.life!, 'friendly') || (opinion(sim, b, a) >= 0 && !has(b.life!, 'complainer'));

const CATALOGUE: MomentDef[] = [
  {
    // 1. Two people at the street door; one holds it for the other.
    id: 'holdTheDoor',
    n: 1,
    weight: 3,
    cast: (sim, a) => {
      const b = partner(sim, a, (o) => otherFlat(a, o));
      return b ? [a, b] : null;
    },
    beats: (_s, _me, _o, role) =>
      role === 0
        ? [{ to: 'entrance', doing: 'Holding the door', say: { text: 'After you' }, hold: 3, meet: true }, { to: 'lobby', doing: 'Heading in', hold: 2 }]
        : [{ to: 'entrance', doing: 'Getting the door held', say: { text: 'Cheers' }, hold: 3, meet: true }, { to: 'lobby', doing: 'Heading in', hold: 2 }],
    // Only the one who had the door held remembers it, and only if they know each other already: strangers just nod.
    end: (sim, [a, b]) => {
      if (opinion(sim, b, a) >= 5) rememberAbout(sim, b, 'chat', a);
    },
  },
  {
    // 2. Dropped shopping on the stairs: a neighbour helps, or walks past.
    id: 'droppedShopping',
    n: 2,
    weight: 2,
    cast: (sim, a) => {
      if (!canGet(sim, a, spotFor(sim, 'stairs', a, undefined, 0))) return null;
      const b = partner(sim, a, (o) => otherFlat(a, o));
      return b ? [a, b] : null;
    },
    beats: (sim, me, other, role) => {
      const helps = role === 0 ? !!other && kindTo(sim, other, me) : kindTo(sim, me, other!);
      return role === 0
        ? [
            { to: 'stairs', doing: 'Struggling up with the shopping', pose: 'carry', prop: 'box', hold: 0.5 },
            { to: 'stairs', doing: 'Picking up the shopping', say: { text: 'Oh no', icon: 'box' }, pose: 'carry', prop: 'box', hold: 3, meet: true },
            { to: 'stairs', doing: helps ? 'Thanking a neighbour' : 'Muttering', say: { text: helps ? 'Ta' : '...' }, hold: 2 },
          ]
        : [
            { to: 'beside', doing: 'Spotting a neighbour in trouble', hold: 0, after: 3 },
            { to: 'beside', doing: helps ? 'Helping with the shopping' : 'Walking past the shopping', pose: helps ? 'carry' : undefined, hold: 3, meet: true },
            { to: 'beside', doing: helps ? 'Giving a neighbour a hand' : 'Not stopping', say: helps ? { text: 'There you go' } : { text: '...' }, hold: 2 },
          ];
    },
    end: (sim, [a, b]) => rememberAbout(sim, a, kindTo(sim, b, a) ? 'favour' : 'slight', b),
  },
  {
    // 7. Singing in the shower; next door bangs on the wall.
    id: 'showerSinging',
    n: 7,
    weight: 2,
    passive: [
      { at: 0, who: 0, say: { text: '♪', icon: 'music' } },
      { at: 0.4, who: 0, say: { text: '♪♪', icon: 'music' } },
      { at: 0.6, who: 1, say: { text: 'Bang bang' } },
    ],
    seconds: 7,
    cast: (sim, a) => {
      if (usingNow(sim, a) !== 'shower') return null;
      const neighbours = neighboursOf(sim, a.life!.flat);
      const next = sim.state.pawns.filter((o) => o.life && neighbours.includes(o.life.flat) && has(o.life, 'lightSleeper') && free(sim, o) && o.life.flat !== a.life!.flat);
      return next.length === 0 ? null : [a, pick(paceOf(sim), next)];
    },
    beats: () => [],
    end: (sim, [a, b]) => rememberAbout(sim, b, 'slight', a),
  },
  {
    // Alone in the shower, nobody to mind.
    id: 'showerAlone',
    n: 7,
    weight: 1,
    passive: [
      { at: 0, who: 0, say: { text: '♪', icon: 'music' } },
      { at: 0.5, who: 0, say: { text: '♪♪', icon: 'music' } },
    ],
    seconds: 6,
    cast: (sim, a) => (usingNow(sim, a) === 'shower' ? [a] : null),
    beats: () => [],
  },
  {
    // Tasting the sauce.
    id: 'tastingTheSauce',
    n: 8,
    weight: 1.5,
    passive: [
      { at: 0, who: 0, say: { text: 'Mm', icon: 'fork' } },
      { at: 0.5, who: 0, say: { text: 'More salt', icon: 'fork' } },
    ],
    seconds: 6,
    cast: (sim, a) => (usingNow(sim, a) === 'cooker' ? [a] : null),
    beats: () => [],
  },
  {
    // Tea, at last.
    id: 'tuckingIn',
    n: 8,
    weight: 1.5,
    passive: [
      { at: 0, who: 0, say: { text: 'Mm', icon: 'fork' } },
      { at: 0.5, who: 0, say: { text: 'Proper tea', icon: 'fork' } },
    ],
    seconds: 6,
    cast: (_sim, a) => (a.life!.using?.offer === -1 ? [a] : null),
    beats: () => [],
  },
  {
    // A long day, a long yawn.
    id: 'yawning',
    n: 14,
    weight: 1,
    passive: [
      { at: 0, who: 0, say: { text: 'Ahh', icon: 'zz' } },
      { at: 0.5, who: 0, say: { text: 'Zz', icon: 'zz' } },
    ],
    seconds: 6,
    cast: (sim, a) => (a.pose === 'sit' && usingNow(sim, a) !== 'toilet' && a.life!.using!.offer !== -1 ? [a] : null),
    beats: () => [],
  },
  {
    // Laughing at the telly.
    id: 'laughingAtTheTelly',
    n: 14,
    weight: 2,
    passive: [
      { at: 0, who: 0, say: { text: 'Ha!' } },
      { at: 0.5, who: 0, say: { text: 'Ha ha ha' } },
    ],
    seconds: 6,
    cast: (sim, a) => (usingNow(sim, a) === 'sofa' && a.pose === 'sit' ? [a] : null),
    beats: () => [],
  },
  {
    // 8. Burnt toast: the alarm goes, the tea towel waves.
    id: 'burntToast',
    n: 8,
    weight: 2,
    cast: (sim, a) => (has(a.life!, 'clumsy') && inFlat(sim, a) && sim.layout.flat(a.life!.flat) ? [a] : null),
    beats: () => [
      { to: 'kitchen', doing: 'Making toast', say: { text: 'Toast', icon: 'fork' }, hold: 1.5 },
      { to: 'kitchen', doing: 'Waving a tea towel at the smoke alarm', say: { text: 'Beep beep', icon: '!' }, pose: 'wave', hold: 3 },
      { to: 'kitchen', doing: 'Scraping the toast', say: { text: '*cough*' }, hold: 2 },
    ],
    end: (sim, [a]) => addDirt(sim, a.life!.flat, 0.02),
  },
  {
    // 9. Pacing the landing on a call.
    id: 'pacingOnACall',
    n: 9,
    weight: 2,
    cast: (sim, a) => (a.life!.schedule === 'home' && canGet(sim, a, spotFor(sim, 'landing', a, undefined, 0)) ? [a] : null),
    beats: () => [
      { to: 'landing', doing: 'Pacing the landing on a call', say: { text: 'Mm-hm', icon: 'phone' }, pose: 'phone', hold: 4 },
      { to: 'home', doing: 'Still on the phone', say: { text: 'Right, right', icon: 'phone' }, pose: 'phone', hold: 3 },
    ],
  },
  {
    // 13. Lingering by the post to see who's in.
    id: 'lingering',
    n: 13,
    weight: 2,
    cast: (sim, a) => (has(a.life!, 'busybody') && canGet(sim, a, spotFor(sim, 'lobby', a, undefined, 0)) ? [a] : null),
    beats: () => [
      { to: 'lobby', doing: 'Seeing who is in', say: { text: '?', icon: 'envelope' }, hold: 4 },
      { to: 'stairs', doing: 'Having a look who is about', say: { text: 'Hm' }, hold: 2.5 },
    ],
  },
  {
    // 14. Dancing in the kitchen: a couple, in the evening.
    id: 'kitchenDancing',
    n: 14,
    weight: 3,
    cast: (sim, a) => {
      const mate = a.life!.partner === undefined ? undefined : sim.state.pawns.find((o) => o.id === a.life!.partner);
      const h = hours(sim);
      if (!mate || !free(sim, mate) || mate.life!.flat !== a.life!.flat || h < 18 || h >= 23) return null;
      return inFlat(sim, a) && inFlat(sim, mate) ? [a, mate] : null;
    },
    beats: (_s, _me, _o, role) =>
      role === 0
        ? [{ to: 'kitchen', doing: 'Dancing in the kitchen', say: { text: '♪', icon: 'music' }, pose: 'dance', hold: 8, meet: true }]
        : [{ to: 'beside', doing: 'Dancing in the kitchen', say: { text: '♥', icon: 'heart' }, pose: 'dance', hold: 8, meet: true }],
  },
  {
    // 15. Borrowing sugar: knock, cup, a chat on the doorstep.
    id: 'borrowingSugar',
    n: 15,
    weight: 2,
    cast: (sim, a) => {
      const b = partner(sim, a, (o) => otherFlat(a, o) && opinion(sim, a, o) >= 0 && (has(a.life!, 'friendly') || has(o.life!, 'friendly') || opinion(sim, a, o) >= 15));
      if (!b) return null;
      return canGet(sim, a, spotFor(sim, 'theirLanding', a, b, 0)) ? [a, b] : null;
    },
    beats: (_s, _me, _o, role) =>
      role === 0
        ? [
            { to: 'theirLanding', doing: 'Knocking next door for sugar', say: { text: 'Got any sugar?', icon: 'cup' }, hold: 3 },
            { to: 'theirLanding', doing: 'Chatting on the doorstep', say: { text: 'Lifesaver' }, hold: 3, meet: true },
          ]
        : [
            { to: 'landing', doing: 'Handing over a cup of sugar', say: { text: 'Course', icon: 'cup' }, hold: 3, after: 1, meet: true },
            { to: 'landing', doing: 'Chatting on the doorstep', say: { text: 'Any time' }, hold: 3 },
          ],
    end: (sim, [a, b]) => rememberAbout(sim, a, 'favour', b),
  },
  {
    // 16. Busking on the step; someone drops a coin.
    id: 'busking',
    n: 16,
    weight: 1,
    cast: (sim, a) => {
      const h = hours(sim);
      if (!has(a.life!, 'musician') || h < 10 || h >= 18 || outdoorTemp(sim) < 10) return null;
      return canGet(sim, a, spotFor(sim, 'entrance', a, undefined, 0)) ? [a] : null;
    },
    beats: () => [
      { to: 'entrance', doing: 'Busking on the step', say: { text: '♪', icon: 'music' }, hold: 10 },
      { to: 'entrance', doing: 'Counting the takings', say: { text: '£', icon: '£' }, hold: 2 },
    ],
  },
  {
    // 18. Night owl and early bird cross on the stairs.
    id: 'owlAndLark',
    n: 18,
    weight: 3,
    cast: (sim, a) => {
      const h = hours(sim);
      if (h < 7 || h >= 9.5) return null;
      const owl = (p: Pawn) => has(p.life!, 'nightOwl') || p.life!.schedule === 'nights';
      const lark = (p: Pawn) => p.life!.schedule === 'early' || p.life!.schedule === 'office';
      const b = partner(sim, a, (o) => otherFlat(a, o) && ((owl(a) && lark(o)) || (lark(a) && owl(o))));
      return b && canGet(sim, a, spotFor(sim, 'stairs', a, b, 0)) ? [owl(a) ? b : a, owl(a) ? a : b] : null;
    },
    // The leader is the early bird.
    beats: (_s, _me, _o, role) => [
      { to: 'stairs', doing: 'Passing a neighbour on the stairs', say: { text: role === 0 ? 'Morning.' : 'Night.' }, hold: 3, meet: true },
      { to: 'stairs', doing: 'Carrying on up the stairs', hold: 2.5 },
    ],
    end: (sim, [a, b]) => {
      rememberAbout(sim, a, 'chat', b);
      rememberAbout(sim, b, 'chat', a);
    },
  },
  {
    // 21. Pats pockets at the door, then finds the keys.
    id: 'patsPockets',
    n: 21,
    weight: 2,
    cast: (sim, a) => (canGet(sim, a, spotFor(sim, 'entrance', a, undefined, 0)) ? [a] : null),
    beats: () => [
      { to: 'entrance', doing: 'Patting pockets for the keys', say: { text: '?' }, pose: 'phone', hold: 3 },
      { to: 'entrance', doing: 'Finding the keys', say: { text: 'Ah.' }, hold: 2.5 },
    ],
  },
  {
    // 24. Trip on the stairs: a sofa in the lobby, or filthy stairs.
    id: 'tripOnTheStairs',
    n: 24,
    weight: 3,
    cast: (sim, a) => {
      if (!has(a.life!, 'clumsy') || !(hasFlag(sim, 'lobbySofa') || dirtOf(sim, SHARED) > 0.6)) return null;
      return canGet(sim, a, spotFor(sim, 'stairs', a, undefined, 0)) ? [a] : null;
    },
    beats: () => [
      { to: 'stairs', doing: 'Tripping on the stairs', say: { text: 'Whoa!', icon: '!' }, hold: 3 },
      { to: 'stairs', doing: 'Dusting themselves off', say: { text: 'Fine, fine' }, hold: 3 },
    ],
    end: (sim, [a]) => {
      // Filthy stairs are somebody's fault; the messiest tenant gets the blame.
      if (dirtOf(sim, SHARED) <= 0.6) return;
      const messy = sim.state.pawns.find((o) => o !== a && o.life && has(o.life, 'messy'));
      if (messy) rememberAbout(sim, a, 'slight', messy);
    },
  },
  {
    // Moving-in day: once the van has gone, each new tenant picks somewhere to sit and puts the
    // kettle on. Never picked by the scheduler (no one casts it); visitors.ts starts it.
    id: 'settlingIn',
    n: 0,
    weight: 0,
    seconds: MOVING_IN.settleSeconds,
    cast: () => null,
    beats: (sim, me) => {
      const kind = seatFor(sim, me)?.kind ?? 'floor';
      const sit = {
        sofa: { doing: 'Trying out the sofa', say: { text: 'Not bad' } },
        armchair: { doing: 'Trying out the armchair', say: { text: 'Ooh' } },
        chair: { doing: 'Sitting at the table', say: { text: 'Home.' } },
        bed: { doing: 'Sitting on the bed', say: { text: 'Right.' } },
        floor: { doing: 'Sitting on a box', say: { text: 'Cuppa?', icon: 'cup' } },
      }[kind];
      return [
        { to: 'seat', ...sit, pose: 'sit', hold: MOVING_IN.sitSeconds },
        { to: 'kitchen', doing: 'Putting the kettle on', say: { text: 'Tea?', icon: 'cup' }, hold: MOVING_IN.teaSeconds },
      ];
    },
  },
];

const BY_ID = new Map(CATALOGUE.map((d) => [d.id, d]));

/** Every kind of moment, for tests and the like. */
export const MOMENT_KINDS: readonly string[] = CATALOGUE.map((d) => d.id);

// ------------------------------------------------------------------ the scheduler

/** Mixed into the game's seed for the moments' own dice. Any number does; it only has to differ from the game's. */
const MOMENT_DICE = 6;

/** When the next one is due, when each kind last started, and the moments' own dice, so they never move the rest of the game's (saved with the game). */
function paceOf(sim: Sim): NonNullable<State['moments']> {
  const st = sim.state;
  if (!st.moments) {
    const dice = { rng: (st.seed ^ MOMENT_DICE) | 0 };
    st.moments = { next: st.tick + minutes(randInt(dice, MOMENTS.gap[0], MOMENTS.gap[1])), last: {}, rng: dice.rng };
  }
  return st.moments;
}

/** How many moments are running (two people in one moment count once). */
export function momentsRunning(sim: Sim): number {
  return sim.state.pawns.filter((p) => p.life?.moment && p.life.moment.kind !== 'settlingIn' && (p.life.moment.with === undefined || p.id < p.life.moment.with)).length;
}

/**
 * Moving-in day (visitors.ts calls this once the van has gone): this new tenant picks somewhere
 * to sit and puts the kettle on. False if they're busy or asleep or can't get there; try again later.
 */
export function settleIn(sim: Sim, p: Pawn): boolean {
  const def = BY_ID.get('settlingIn')!;
  // As with any other moment, nobody is kept from work by it; nor sent to bed halfway to the sofa.
  const runs = runsFor(def) + SCHEDULES.spare;
  if (!free(sim, p) || !freeFor(sim, p, runs) || sim.minuteOfDay + runs > bedtime(sim, p.life!)) return false;
  if (!def.beats(sim, p, undefined, 0).every((b, k) => canGet(sim, p, spotFor(sim, b.to, p, undefined, k)))) return false;
  begin(sim, def, [p]);
  return true;
}

/** Once a game minute: maybe start a moment somewhere (the scheduler), and end ones whose time is up. */
export function momentsMinute(sim: Sim): void {
  const st = sim.state;
  for (const p of [...st.pawns]) {
    const m = p.life?.moment;
    if (!m) continue;
    const def = BY_ID.get(m.kind);
    const cast = castOf(sim, p);
    const broken = !def || cast.some((o) => !o.life || o.life.away || o.life.leaving || o.life.breakState || o.life.moment?.kind !== m.kind) || (m.with !== undefined && cast.length < 2);
    if (def?.passive && !broken) {
      if (m.lead) playPassive(sim, def, cast, m);
      if (st.tick < m.until) continue;
      finish(sim, p, true);
    } else if (broken || st.tick >= m.until) {
      finish(sim, p, false);
    }
  }
  const pace = paceOf(sim);
  if (st.tick < pace.next) return;
  if (!waking(sim) || tenantsIn(sim).length < 3 || momentsRunning(sim) >= MOMENTS.most) return;
  const people = st.pawns.filter((p) => p.life);
  // Start with whoever the dice pick, so it isn't always the same tenant.
  const order = [...people];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random(pace) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const p of order) if (tryStart(sim, p)) return;
}

const waking = (sim: Sim): boolean => sim.minuteOfDay >= 7 * 60 && sim.minuteOfDay < 23 * 60;

/** Tried just before a tenant potters about, after habits: true if they've started a moment. */
export function momentThink(sim: Sim, p: Pawn, _flat: Flat): boolean {
  const pace = paceOf(sim);
  if (sim.state.tick < pace.next || !waking(sim) || momentsRunning(sim) >= MOMENTS.most || tenantsIn(sim).length < 3) return false;
  return tryStart(sim, p) && !!p.life?.moment && !BY_ID.get(p.life.moment.kind)?.passive;
}

/** Picks a kind for this leader (by weight, less likely if it happened lately) and starts it. */
function tryStart(sim: Sim, leader: Pawn): boolean {
  const st = sim.state;
  const pace = paceOf(sim);
  const passiveOk = !!leader.life?.using;
  if (!passiveOk && !free(sim, leader)) return false;
  const options: { def: MomentDef; cast: Pawn[]; weight: number }[] = [];
  for (const def of CATALOGUE) {
    if (!!def.passive !== passiveOk) continue;
    const cast = def.cast(sim, leader);
    if (!cast || cast.length === 0 || cast.some((p) => !p.life)) continue;
    // The same two people don't keep running into each other: a few days between scenes for a pair.
    if (cast.length === 2 && st.tick - (pace.last[pairKey(cast)] ?? -Infinity) < minutes(PAIR_DAYS * 24 * 60)) continue;
    const lately = st.tick - (pace.last[def.id] ?? -Infinity) < minutes(240);
    options.push({ def, cast, weight: def.weight * (lately ? 0.15 : 1) });
  }
  if (options.length === 0) return false;
  let r = random(pace) * options.reduce((n, o) => n + o.weight, 0);
  const chosen = options.find((o) => (r -= o.weight) < 0) ?? options[0];
  const { def, cast } = chosen;
  // Nobody is kept from work by it: it has to be over, with their spare minutes for the stairs to
  // come, before they'd set off (schedules.ts). Cut short by the clock it would be no scene at all.
  if (!def.passive && !cast.every((p) => freeFor(sim, p, runsFor(def) + SCHEDULES.spare))) return false;
  // Every beat has to be somewhere they can get to.
  if (!def.passive && !cast.every((p, i) => def.beats(sim, p, cast[1 - i], i).every((b, k) => canGet(sim, p, spotFor(sim, b.to, p, cast[1 - i], k))))) return false;
  begin(sim, def, cast);
  pace.last[def.id] = st.tick;
  if (cast.length === 2) pace.last[pairKey(cast)] = st.tick;
  pace.next = st.tick + minutes(randInt(pace, MOMENTS.gap[0], MOMENTS.gap[1]));
  return true;
}

/** Game minutes a moment can run at most. */
const runsFor = (def: MomentDef): number => Math.ceil(seconds(def.seconds ?? MOMENTS.seconds[1]) / TICKS_PER_MINUTE);

const PAIR_DAYS = 3;
const pairKey = (cast: Pawn[]): string => `pair:${Math.min(cast[0].id, cast[1].id)}-${Math.max(cast[0].id, cast[1].id)}`;

function begin(sim: Sim, def: MomentDef, cast: Pawn[]): void {
  const until = sim.state.tick + seconds(def.seconds ?? MOMENTS.seconds[1]);
  cast.forEach((p, i) => {
    const life = p.life!;
    life.moment = { kind: def.id, until, step: 0, with: cast[1 - i]?.id, lead: i === 0 };
    if (def.passive) return;
    // Whatever they were doing stops (except a step half way); the next think starts the moment.
    delete p.pose;
    p.waitUntil = 0;
    p.path = p.path.slice(0, 1);
    p.goal = null;
  });
}

function castOf(sim: Sim, p: Pawn): Pawn[] {
  const other = p.life?.moment?.with === undefined ? undefined : sim.state.pawns.find((o) => o.id === p.life!.moment!.with);
  return other ? [p, other] : [p];
}

/** Ends the moment for everyone in it. Done, it leaves its mark; dropped, nothing. */
function finish(sim: Sim, p: Pawn, done: boolean): void {
  const m = p.life?.moment;
  if (!m) return;
  const def = BY_ID.get(m.kind);
  const cast = castOf(sim, p);
  // Leader first.
  cast.sort((a, b) => Number(!!b.life!.moment?.lead) - Number(!!a.life!.moment?.lead));
  const done_ = cast.slice();
  for (const o of cast) {
    delete o.life!.moment;
    if (o.bubble?.kind === 'moment') delete o.bubble;
    if (!def?.passive) {
      delete o.pose;
      delete o.prop;
      o.path = o.path.slice(0, 1);
      o.goal = null;
      o.waitUntil = 0;
    }
  }
  if (done && def?.end && cast.every((o) => o.life && !o.life.away)) def.end(sim, done_);
}

/** A passive moment's bubbles, each shown once when its time comes. `step` counts how many have gone up. */
function playPassive(sim: Sim, def: MomentDef, cast: Pawn[], m: Moment): void {
  const total = seconds(def.seconds ?? 7);
  const gone = total - (m.until - sim.state.tick);
  const list = def.passive!;
  while (m.step < list.length && gone >= list[m.step].at * total) {
    const b = list[m.step++];
    const who = cast[b.who] ?? cast[0];
    who.bubble = { text: b.say.text, icon: b.say.icon, until: sim.state.tick + seconds(2), kind: 'moment' };
  }
}

// ------------------------------------------------------------------ carrying on

/**
 * A tenant in a moment (`life.moment`) carries on with it: called in tenantThink straight
 * after breaks, before anything else they'd do. True if the moment had them do something.
 */
export function momentStep(sim: Sim, p: Pawn, _flat: Flat): boolean {
  const life = p.life!;
  const m = life.moment;
  if (!m) return false;
  const st = sim.state;
  const def = BY_ID.get(m.kind);
  if (!def) {
    delete life.moment;
    return false;
  }
  if (def.passive) return false;
  const other = m.with === undefined ? undefined : st.pawns.find((o) => o.id === m.with);
  const stillTogether = m.with === undefined || (other?.life?.moment?.with === p.id && other.life.moment.kind === m.kind);
  if (st.tick >= m.until || !stillTogether) {
    finish(sim, p, false);
    return false;
  }
  const role = m.lead ? 0 : 1;
  const beats = def.beats(sim, p, other, role);
  for (;;) {
    const k = Math.floor(m.step / 3);
    const phase = m.step % 3;
    if (k >= beats.length) {
      // The leader's script is the moment; the other waits for it to end.
      if (role === 0) {
        finish(sim, p, true);
        return false;
      }
      p.waitUntil = Math.min(m.until, st.tick + minutes(1));
      return true;
    }
    const beat = beats[k];
    const theirs = other?.life?.moment?.step ?? Infinity;
    if (phase === 0) {
      if (beat.after !== undefined && theirs < beat.after) {
        p.doing = 'Waiting a moment';
        p.waitUntil = Math.min(m.until, st.tick + 10);
        return true;
      }
      const to = spotFor(sim, beat.to, p, other, k);
      if (!to) {
        finish(sim, p, false);
        return false;
      }
      p.doing = beat.doing;
      if (beat.prop) p.prop = beat.prop;
      if (beat.pose) p.pose = beat.pose;
      if (Math.round(p.x) !== to[0] || Math.round(p.s) !== to[1]) {
        if (!setGoal(sim, p, to)) {
          finish(sim, p, false);
          return false;
        }
        return true;
      }
      m.step = 3 * k + 1;
      continue;
    }
    if (phase === 1) {
      // There. If the other has to be here too, wait for them.
      if (beat.meet && theirs < 3 * k + 1) {
        p.doing = beat.doing;
        if (beat.pose) p.pose = beat.pose;
        p.waitUntil = Math.min(m.until, st.tick + 10);
        return true;
      }
      const hold = Math.min(seconds(beat.hold), Math.max(0, m.until - st.tick));
      if (beat.say) p.bubble = { text: beat.say.text, icon: beat.say.icon, until: st.tick + hold, kind: 'moment' };
      if (beat.pose) p.pose = beat.pose;
      if (beat.prop) p.prop = beat.prop;
      p.doing = beat.doing;
      p.waitUntil = st.tick + hold;
      m.step = 3 * k + 2;
      // The scene is their talk: no chatting on top of it.
      for (const o of other ? [p, other] : [p]) o.life!.lastTalk = st.tick + hold;
      // A face towards the other.
      if (other && Math.abs(other.x - p.x) > 0.01) p.facing = other.x > p.x ? 1 : -1;
      return true;
    }
    // The hold is over.
    delete p.pose;
    if (p.bubble?.kind === 'moment') delete p.bubble;
    m.step = 3 * (k + 1);
  }
}
