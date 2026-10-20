// Breaks and inspirations you can watch. When a tenant kicks off (outcomes.ts) they don't
// only write a letter: they sulk on the landing, slam doors, kick the bins, refuse to get up,
// smash something, or carry their boxes out. Their traits pick which. A break is a state on
// the tenant (life.breakState) that tenantThink honours before anything else, with a bubble
// and a `doing` that noiseOf can hear.
//
// The good side uses the same state: a happy tenant tidies the stairwell, throws a barbecue
// in the lobby, mends a neighbour's broken thing, paints the lobby or leaves a plant.

import { breakIt } from './upkeep';
import { furnitureProblem, placeFurniture } from './build';
import { post, recently } from './chat';
import { SHARED, addDirt, tidy } from './environment';
import { furnitureDef } from './defs';
import type { Flat } from './layout';
import { household } from './leases';
import { choices } from './tenants';
import { setGoal } from './pawns';
import { pick, randInt, random } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_MINUTE, seconds, type BreakKind, type BreakState, type Furniture, type Pawn } from './state';
import { remember } from './thoughts';
import { has } from './traits';
import { rememberAbout } from './social';

type Level = 'minor' | 'major' | 'extreme';

const first = (p: Pawn) => p.name.split(' ')[0];
/** How long a break or a good turn goes on, and each step of it, is game time: a sulk lasts so many game minutes. */
const minutes = (n: number) => n * TICKS_PER_MINUTE;
/**
 * Its bubbles are timed in real time, so they stay readable: n is n × 0.9 real seconds at 1x
 * (what a game minute took before the clock went three times faster), whatever the clock does.
 */
const beats = (n: number) => seconds(n * 0.9);

// ------------------------------------------------------------------ places

/** A spot outside the flat's front door, on the landing. */
function landingOf(sim: Sim, flat: Flat): [number, number] | null {
  const lay = sim.layout;
  const door = flat.doors[0]?.split(',').map(Number);
  if (!door) return null;
  const n = [door[0] - 1, door[0] + 1].map((x) => lay.node(x, door[1])).find((m) => lay.roomOf[m] !== -1 && lay.rooms[lay.roomOf[m]].shared && lay.standable[m]);
  return n === undefined ? null : lay.xs(n);
}

/** Somewhere to stand in the shared parts (lobby, stairs, landings). */
function sharedSpots(sim: Sim): number[] {
  const lay = sim.layout;
  return lay.rooms.filter((r) => r.shared).flatMap((r) => r.nodes).filter((n) => !lay.isDoorNode(n) && lay.standable[n]);
}

/** Somewhere to stand in the flat. */
function flatSpot(sim: Sim, flat: Flat): [number, number] {
  const lay = sim.layout;
  const nodes = flat.rooms.flatMap((r) => lay.rooms[r].nodes).filter((n) => !lay.isDoorNode(n));
  return lay.xs(pick(sim.state, nodes));
}

/** Furniture standing in the shared parts. */
function sharedFurniture(sim: Sim): Furniture[] {
  const lay = sim.layout;
  const cells = new Set(lay.rooms.filter((r) => r.shared).flatMap((r) => r.cells));
  return sim.state.furniture.filter((f) => cells.has(lay.node(f.x, f.s)));
}

// ------------------------------------------------------------------ starting

/** Which break, for what level and who. Heavier numbers are likelier. */
function weights(level: Level, p: Pawn): [BreakKind, number][] {
  const life = p.life!;
  if (level === 'minor') {
    return [['sulk', 4], ...(has(life, 'complainer') ? ([['slam', 2]] as [BreakKind, number][]) : [])];
  }
  const out: [BreakKind, number][] = [['sulk', 2], ['bed', 2], ['slam', 2], ['bins', 2], ['tantrum', 2]];
  const bump = (k: BreakKind, n: number) => {
    const w = out.find((o) => o[0] === k);
    if (w) w[1] += n;
    else out.push([k, n]);
  };
  if (has(life, 'complainer')) {
    bump('slam', 3);
    bump('bins', 2);
  }
  if (has(life, 'messy')) {
    bump('bins', 3);
    bump('tantrum', 1);
  }
  if (has(life, 'clumsy')) bump('tantrum', 4);
  if (has(life, 'partyAnimal')) bump('music', 5);
  if (has(life, 'nightOwl')) bump('bed', 2);
  if (has(life, 'easyGoing')) {
    // Easy-going people sulk or sleep it off; they don't smash the place up.
    return out.filter((o) => ['sulk', 'bed'].includes(o[0])).map((o) => [o[0], o[1] + 2] as [BreakKind, number]);
  }
  return out;
}

function weighted(sim: Sim, list: [BreakKind, number][]): BreakKind {
  let r = random(sim.state) * list.reduce((n, o) => n + o[1], 0);
  return (list.find((o) => (r -= o[1]) < 0) ?? list[0])[0];
}

/** Sets a tenant's break going, the one their traits pick. Returns which. */
export function startBreak(sim: Sim, p: Pawn, level: Level, straw: string, leaving: boolean, only?: BreakKind): BreakKind | null {
  const life = p.life!;
  const flat = sim.layout.flat(life.flat);
  if (!flat || life.breakState || life.away || life.leaving) return null;
  const kind: BreakKind = only ?? (level === 'extreme' ? (leaving ? 'boxes' : 'tantrum') : weighted(sim, weights(level, p)));
  const st = sim.state;
  const length: Record<string, [number, number]> = {
    sulk: level === 'minor' ? [20, 40] : [45, 90],
    slam: level === 'minor' ? [10, 20] : [20, 40],
    bins: [15, 25],
    bed: [150, 240],
    tantrum: [15, 30],
    music: [30, 60],
    boxes: [60, 100],
  };
  if (!length[kind]) return null;
  const [lo, hi] = length[kind];
  begin(sim, p, { kind, until: st.tick + minutes(randInt(st, lo, hi)), straw, step: 0 });
  const name = first(p);
  const line: Partial<Record<BreakKind, string>> = {
    sulk: `${name} is sulking on the landing.`,
    slam: `${name} is slamming doors.`,
    bins: `${name} is off to kick the bins.`,
    bed: `${name} won't get up.`,
    tantrum: `${name} is having a tantrum in ${flat.name}.`,
    music: `${name} has put the music on, loudly, on purpose.`,
    boxes: `${name} is carrying boxes out.`,
  };
  if (level !== 'minor' || kind !== 'sulk') sim.notify(`${line[kind]} ${straw}.`);
  // Staying in bed means missing work.
  if (kind === 'bed' && life.job && (sim.day - 1) % 7 < 5 && sim.minuteOfDay < life.job.back - 60) life.workedDay = sim.day;
  return kind;
}

/** Whatever they were doing stops (except a step half way): the next think starts the break. */
function begin(_sim: Sim, p: Pawn, b: BreakState): void {
  const life = p.life!;
  life.using = null;
  delete life.outing;
  delete life.meal;
  delete p.pose;
  p.waitUntil = 0;
  life.breakState = b;
}

// ------------------------------------------------------------------ every think

/** Called first by tenantThink. True if the break (or good turn) used up this go. */
export function breakThink(sim: Sim, p: Pawn, flat: Flat): boolean {
  const life = p.life!;
  const b = life.breakState;
  if (!b) return false;
  const st = sim.state;
  if (life.leaving || life.away || st.tick >= b.until) {
    finish(sim, p, b);
    return false;
  }
  if (p.task === 'leave') p.task = 'go';
  STEPS[b.kind](sim, p, flat, b);
  return true;
}

function finish(sim: Sim, p: Pawn, b: BreakState): void {
  const life = p.life!;
  delete life.breakState;
  delete p.bubble;
  delete p.pose;
  p.path = p.path.slice(0, 1);
  p.goal = null;
  p.waitUntil = 0;
  p.task = 'go';
  // Nothing lands if they never got there.
  if (!life.leaving && b.step !== -1) ENDS[b.kind]?.(sim, p, b);
}

type Step = (sim: Sim, p: Pawn, flat: Flat, b: BreakState) => void;

const say = (sim: Sim, p: Pawn, text: string, mins: number) => {
  p.bubble = { text, until: sim.state.tick + beats(mins) };
};

/** Heads for a spot. 'there' once they're on it; 'going' while on the way; 'stuck' (and the break is over) if there's no way. */
function reach(sim: Sim, p: Pawn, b: BreakState, to: [number, number]): 'there' | 'going' | 'stuck' {
  if (Math.round(p.x) === to[0] && Math.round(p.s) === to[1]) return 'there';
  if (setGoal(sim, p, to)) return 'going';
  b.until = 0;
  b.step = -1;
  return 'stuck';
}

/** Walk to a spot with `doing` and `bubble` showing; run `then` once there. */
function go(sim: Sim, p: Pawn, b: BreakState, to: [number, number] | null, doing: string, bubble: string, then: () => void): void {
  if (!to) {
    b.until = 0;
    b.step = -1;
    return;
  }
  p.doing = doing;
  const r = reach(sim, p, b, to);
  if (r === 'going') {
    say(sim, p, bubble, 3);
    p.waitUntil = 0;
  } else if (r === 'there') then();
}

const STEPS: Record<BreakKind, Step> = {
  sulk(sim, p, flat, b) {
    go(sim, p, b, landingOf(sim, flat) ?? (b.at ??= flatSpot(sim, flat)), 'Sulking on the landing', '…', () => {
      say(sim, p, '…', 10);
      p.waitUntil = sim.state.tick + minutes(8);
    });
  },
  slam(sim, p, flat, b) {
    b.at ??= flatSpot(sim, flat);
    const out = (b.step ?? 0) % 2 === 0;
    go(sim, p, b, out ? landingOf(sim, flat) : b.at, 'Slamming doors', '!', () => {
      b.step = (b.step ?? 0) + 1;
      say(sim, p, '!!', 3);
      p.waitUntil = sim.state.tick + minutes(3);
    });
  },
  bins(sim, p, _flat, b) {
    const bins = sharedFurniture(sim).filter((f) => f.def === 'bins' && f.broken === undefined);
    const at: [number, number] = bins[0] ? [bins[0].x, bins[0].s] : (b.at ??= sim.layout.xs(pick(sim.state, sharedSpots(sim))));
    go(sim, p, b, at, 'Kicking the bins', '#@!', () => {
      b.step = (b.step ?? 0) + 1;
      addDirt(sim, SHARED, 0.03);
      say(sim, p, '*clang*', 2);
      p.waitUntil = sim.state.tick + minutes(2);
      // Once, near the end, something gives.
      if (b.step === 4) {
        const list = sharedFurniture(sim).filter((f) => f.broken === undefined && (f.def === 'bins' || furnitureDef(f.def).decor));
        if (list.length > 0 && random(sim.state) < 0.5) {
          const f = pick(sim.state, list);
          breakIt(sim, f);
          sim.notify(`${first(p)} kicked the ${furnitureDef(f.def).name.toLowerCase()} in the lobby to bits. It'll need mending.`);
        }
      }
    });
  },
  bed(sim, p, flat, b) {
    const bed = choices(sim, p, flat, (_o, f) => f.def === 'bed')[0] ?? choices(sim, p, flat, (_o, f) => f.def === 'sofa')[0];
    const at = bed ? bed.at : (b.at ??= flatSpot(sim, flat));
    go(sim, p, b, at, 'Refusing to get up', 'Nope', () => {
      p.pose = 'sleep';
      p.doing = 'Refusing to get up';
      p.waitUntil = sim.state.tick + minutes(5);
    });
  },
  tantrum(sim, p, flat, b) {
    go(sim, p, b, (b.at ??= flatSpot(sim, flat)), 'Having a tantrum', '#@!', () => {
      b.step = (b.step ?? 0) + 1;
      say(sim, p, '#@!', 4);
      p.waitUntil = sim.state.tick + minutes(4);
      addDirt(sim, flat.id, 0.04);
      if (b.step === 2) smash(sim, p, flat);
    });
  },
  music(sim, p, flat, b) {
    go(sim, p, b, (b.at ??= flatSpot(sim, flat)), 'Blasting music out of spite', '♪', () => {
      say(sim, p, '♪♪', 8);
      p.waitUntil = sim.state.tick + minutes(6);
    });
  },
  boxes(sim, p, flat, b) {
    b.at ??= flatSpot(sim, flat);
    const out = (b.step ?? 0) % 2 === 0;
    go(sim, p, b, out ? landingOf(sim, flat) : b.at, 'Carrying boxes out', 'Boxes', () => {
      b.step = (b.step ?? 0) + 1;
      say(sim, p, 'Boxes', 4);
      p.waitUntil = sim.state.tick + minutes(3);
    });
  },
  tidy(sim, p, _flat, b) {
    go(sim, p, b, (b.at ??= sim.layout.xs(pick(sim.state, sharedSpots(sim)))), 'Tidying the stairwell', 'Right.', () => {
      tidy(sim, SHARED, 0.12);
      say(sim, p, 'Right.', 4);
      p.waitUntil = sim.state.tick + minutes(4);
    });
  },
  bbq(sim, p, _flat, b) {
    go(sim, p, b, (b.at ??= sim.layout.xs(pick(sim.state, sharedSpots(sim)))), 'At the barbecue', b.target === undefined ? 'Grub up' : 'Cheers', () => {
      say(sim, p, b.target === undefined ? 'Grub up' : 'Cheers', 6);
      p.waitUntil = sim.state.tick + minutes(5);
    });
  },
  mend(sim, p, _flat, b) {
    const f = sim.state.furniture.find((o) => o.id === b.target);
    if (!f || f.broken === undefined) {
      b.until = 0;
      b.step = -1;
      return;
    }
    const lay = sim.layout;
    const flat = lay.flatAt(f.x, f.s);
    const at = flat ? landingOf(sim, flat) : ([f.x, f.s] as [number, number]);
    go(sim, p, b, at, `Mending the ${furnitureDef(f.def).name.toLowerCase()}`, 'Hold this', () => {
      say(sim, p, 'There.', 4);
      p.waitUntil = sim.state.tick + minutes(8);
      b.step = 1;
      b.until = p.waitUntil;
    });
  },
  paint(sim, p, _flat, b) {
    go(sim, p, b, (b.at ??= sim.layout.xs(pick(sim.state, sharedSpots(sim)))), 'Painting the lobby', 'Fresh coat', () => {
      say(sim, p, 'Fresh coat', 10);
      p.waitUntil = sim.state.tick + minutes(10);
    });
  },
  plant(sim, p, _flat, b) {
    go(sim, p, b, b.at ?? null, 'Leaving a plant in the lobby', 'A plant', () => {
      say(sim, p, 'There.', 4);
      p.waitUntil = sim.state.tick + minutes(3);
      b.until = p.waitUntil;
    });
  },
};

/** A tantrum breaks something of theirs. */
function smash(sim: Sim, p: Pawn, flat: Flat): void {
  const lay = sim.layout;
  const cells = new Set(lay.flatCells(flat));
  const mine = sim.state.furniture.filter((f) => f.broken === undefined && cells.has(lay.node(f.x, f.s)));
  const usable = mine.filter((f) => furnitureDef(f.def).offers);
  const list = usable.length > 0 ? usable : mine;
  if (list.length === 0) return;
  const f = pick(sim.state, list);
  breakIt(sim, f);
  sim.notify(`${first(p)} broke the ${furnitureDef(f.def).name.toLowerCase()} in ${flat.name}. In a temper.`);
}

// ------------------------------------------------------------------ when they finish

const ENDS: Partial<Record<BreakKind, (sim: Sim, p: Pawn, b: BreakState) => void>> = {
  tidy(sim, p) {
    for (const o of everyone(sim)) remember(sim, o.life!, 'stairsDone');
    sim.notify(`${first(p)} tidied the stairwell. Nobody asked.`);
  },
  bbq(sim, p, b) {
    // Only the host's end counts for the building; guests just get their sausage.
    remember(sim, p.life!, 'gotBarbecue');
    if (b.target === undefined) {
      addDirt(sim, SHARED, 0.08);
      sim.notify(`${first(p)}'s lobby barbecue has finished. The lobby smells of sausages.`);
      return;
    }
    const host = sim.state.pawns.find((o) => o.id === b.target);
    if (host?.life) {
      rememberAbout(sim, p, 'chat', host);
      rememberAbout(sim, host, 'chat', p);
    }
  },
  mend(sim, p, b) {
    const f = sim.state.furniture.find((o) => o.id === b.target);
    if (!f || f.broken === undefined) return;
    f.wear = 0.4;
    delete f.broken;
    delete f.reported;
    sim.changed();
    const flat = sim.layout.flatAt(f.x, f.s);
    const name = furnitureDef(f.def).name.toLowerCase();
    const owners = flat ? household(sim, flat.id).filter((o) => o !== p) : [];
    for (const o of owners) {
      remember(sim, o.life!, 'mendedForMe');
      rememberAbout(sim, o, 'favour', p);
    }
    sim.notify(`${first(p)} mended the ${name}${flat ? ` in ${flat.name}` : ' in the lobby'} for a neighbour. For free.`);
  },
  paint(sim, p) {
    tidy(sim, SHARED, 0.2);
    for (const o of everyone(sim)) remember(sim, o.life!, 'freshPaint');
    post(sim, p, 'Painted the lobby. Magnolia. Hope that is all right.');
    sim.notify(`${first(p)} painted the lobby. It looks better.`);
  },
  plant(sim, p, b) {
    if (!b.at) return;
    const placed = placeFurniture(sim.state, 'plant', b.at[0], b.at[1]);
    if (typeof placed === 'string') return;
    sim.changed();
    sim.notify(`${first(p)} left a plant in the lobby. It looks happy. For now.`);
  },
};

const everyone = (sim: Sim) => sim.state.pawns.filter((o) => o.life && !o.life.leaving);

// ------------------------------------------------------------------ inspirations

/** True when someone is free to do a good turn: awake, in, and not already busy. */
function free(sim: Sim, p: Pawn): boolean {
  const life = p.life!;
  const m = sim.minuteOfDay;
  return !life.breakState && !life.away && !life.leaving && p.pose !== 'sleep' && m >= 9 * 60 && m < 20 * 60;
}

/** The good turns this happy tenant could do on the map right now. */
export function inspirations(sim: Sim, p: Pawn): (() => void)[] {
  const st = sim.state;
  const life = p.life!;
  const out: (() => void)[] = [];
  if (!free(sim, p) || !sim.layout.flat(life.flat)) return out;
  const spots = sharedSpots(sim);
  if (spots.length === 0) return out;
  const spot = () => sim.layout.xs(pick(st, spots));
  const name = first(p);

  out.push(() => {
    begin(sim, p, { kind: 'tidy', until: st.tick + minutes(randInt(st, 25, 40)), step: 0 });
  });

  const guests = everyone(sim).filter((o) => o !== p && free(sim, o) && !o.life!.using && o.life!.flat !== life.flat);
  if (guests.length > 0 && !recently(sim, 'Small barbecue in the lobby')) {
    out.push(() => {
      const until = st.tick + minutes(randInt(st, 45, 75));
      const at = spot();
      const going = guests.filter(() => random(st) < 0.7);
      if (going.length === 0) going.push(guests[0]);
      begin(sim, p, { kind: 'bbq', until, at, step: 0 });
      for (const g of going.slice(0, 3)) begin(sim, g, { kind: 'bbq', until, at: sim.layout.xs(pick(st, spots)), step: 0, target: p.id });
      post(sim, p, 'Small barbecue in the lobby. Bring your own sausages. It is a very small barbecue.');
      sim.notify(`${name} is having a barbecue in the lobby.`);
    });
  }

  if (has(life, 'handy')) {
    const lay = sim.layout;
    const broken = st.furniture.filter((f) => {
      if (f.broken === undefined) return false;
      const flat = lay.flatAt(f.x, f.s);
      if (!flat) return sharedFurniture(sim).includes(f);
      return flat.id !== life.flat && household(sim, flat.id).length > 0 && landingOf(sim, flat) !== null;
    });
    if (broken.length > 0) {
      out.push(() => {
        begin(sim, p, { kind: 'mend', until: st.tick + minutes(90), target: pick(st, broken).id, step: 0 });
      });
    }
  }

  out.push(() => {
    begin(sim, p, { kind: 'paint', until: st.tick + minutes(randInt(st, 40, 70)), at: spot(), step: 0 });
  });

  const plants = sharedFurniture(sim).filter((f) => f.def === 'plant').length;
  if (plants < 3) {
    const lay = sim.layout;
    const where = spots.map((n) => lay.xs(n)).find(([x, s]) => furnitureProblem(st, 'plant', x, s) === null);
    if (where) out.push(() => begin(sim, p, { kind: 'plant', until: st.tick + minutes(40), at: where, step: 0 }));
  }
  return out;
}
