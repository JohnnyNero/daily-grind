// Visitors (spec 2.2): people from outside who come in, do one thing, and go. Sandra the
// postie, couriers, takeaway riders, friends and family, Lorraine who does the stairs,
// tradespeople when something's mended. Also the animals: the building cat and the fox.
// A visitor is a pawn of kind 'visitor' (an animal, 'animal') with a `role`, and maybe a `prop`.
//
// How it hangs together. Each morning `plan` writes the day's callers into
// `state.visitors.next`: a due tick for each, under a key like `courier|2` (the part before
// the bar is the role). Keys starting `#` are markers (the day planned, the postie's last
// visit). `visitorsSpawn` sends them in when they're due, if there's room (VISITORS.most).
// Each visitor then works through a short list of stops (`stopsFor`): walk there, do the
// thing for a few real seconds, move on, and at the end walk off. Where they've got to is in
// `Pawn.act` ("to:1" heading for stop 1, "at:1" doing it), so a saved game picks up where it
// left off. The cat and the fox have minds of their own.
//
// Moving-in day (layout.md, payoff b): when you let a flat (`movingIn`, called from leases.ts
// accept) a van pulls up at the kerb (`van|<flat>` in the day's list; once it's here `#van|<flat>`
// holds the tick it arrived), two removal men carry boxes up to the flat, the van goes, and each
// new tenant picks somewhere to sit (`#settle|<flat>|<pawn>`; moments.ts, `settleIn`). That
// evening a takeaway comes for the new flat (`rider|first|<flat>`), and their bedtime is late.
//
// Left to other chunks: the window cleaner, the meter reader, the council officer, applicants
// viewing, kids on the pavement and pets (cards and moments can call `addVisitor`).

import { addDirt, binsOverflowing, SHARED } from './environment';
import { scoreFor } from './impressiveness';
import { household } from './leases';
import { settleIn } from './moments';
import { atNode, addPawn, setGoal } from './pawns';
import { pick, randInt, random, type RngHolder } from './rng';
import type { Keys } from './layout';
import { homeAndAwake } from './schedules';
import type { Sim } from './sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, seconds, type Pawn, type Pose } from './state';
import { remember } from './thoughts';
import { has } from './traits';
import { MOVING_IN, VISITORS } from './tuning';

/** A key that opens the street door and no flat's: the cleaner, the postie and the rest are let into the shared parts. */
const LET_IN = '*';
/** Roles that matter more than the rest: they can have the last space on the map. */
const PRIORITY = new Set(['postie', 'cleaner', 'tradesperson']);

type Spot = [number, number];

interface Stop {
  at: Spot;
  /** Real seconds at 1x. */
  secs: [number, number];
  /** On the way there, and when they've got there. */
  travel: string;
  doing: string;
  pose?: Pose;
  /** A bubble when they arrive: a pixel icon (art.ts) with its word as the fallback. */
  icon?: string;
  text?: string;
  /** Put down whatever's in their hand when this is done. */
  drop?: boolean;
  /** Checked before setting off and again on the way: true means miss this one out. */
  skip?: (sim: Sim, p: Pawn) => boolean;
  begin?: (sim: Sim, p: Pawn) => void;
  end?: (sim: Sim, p: Pawn) => void;
}

// ------------------------------------------------------------------ the day's callers

/**
 * Visitors have a random stream of their own (kept in `next['#rng']`), so who calls when never
 * shifts the main one: the same seed makes the same tenants and the same troubles, with or
 * without people knocking at the door.
 */
function vr(sim: Sim): RngHolder {
  const next = sim.state.visitors.next;
  return {
    get rng() {
      return next['#rng'] ?? (sim.state.seed ^ 0x5bd1e995) | 0;
    },
    set rng(v: number) {
      next['#rng'] = v;
    },
  };
}

const weekdayOf = (sim: Sim) => (sim.day - 1) % 7;
const dayStart = (sim: Sim) => (sim.day - 1) * TICKS_PER_DAY;
const at = (sim: Sim, minute: number) => dayStart(sim) + minute * TICKS_PER_MINUTE;
const tenantsIn = (sim: Sim) => sim.state.pawns.filter((p) => p.life && !p.life.leaving);

/** Writes today's callers down. Anything long past is left out, so a game loaded at teatime isn't mobbed. */
function plan(sim: Sim): void {
  const st = sim.state;
  const next = st.visitors.next;
  next['#day'] = sim.day;
  const wd = weekdayOf(sim);
  const weekend = wd >= 5;
  const now = st.tick;
  const put = (key: string, minute: number) => {
    const due = at(sim, minute);
    if (due >= now - TICKS_PER_HOUR) next[key] = Math.max(due, now);
  };
  // Sandra, every morning. If the game starts late in the morning she still does her round.
  const sandra = VISITORS.postie + randInt(vr(sim), -VISITORS.jitter, VISITORS.jitter);
  if (sim.minuteOfDay < 12 * 60 || at(sim, sandra) >= now) next.postie = Math.max(at(sim, sandra), now);
  // Lorraine, if she's paid.
  if (st.cleaner) {
    next['#cleaner'] = sim.day;
    put('cleaner', VISITORS.cleaner + randInt(vr(sim), 0, 10));
  }
  // Couriers, spread through the working day.
  const couriers = randInt(vr(sim), ...VISITORS.couriers);
  for (let i = 0; i < couriers; i++) put(`courier|${i}`, randInt(vr(sim), VISITORS.courierFrom, VISITORS.courierTo));
  if (tenantsIn(sim).length === 0) return;
  // Takeaways: busy Fridays, now and then other evenings.
  const riders = wd === 4 ? VISITORS.riderFriday : random(vr(sim)) < VISITORS.riderChance ? 1 : 0;
  for (let i = 0; i < riders; i++) put(`rider|${i}`, randInt(vr(sim), wd === 4 ? 19 * 60 + 30 : VISITORS.riderFrom, VISITORS.riderTo));
  // Friends: afternoons and evenings, more at the weekend.
  const friends = randInt(vr(sim), ...(weekend ? VISITORS.friendsWeekend : VISITORS.friends));
  for (let i = 0; i < friends; i++) put(`friend|${i}`, randInt(vr(sim), weekend ? 12 * 60 : VISITORS.friendFrom, VISITORS.friendTo));
  // Family: weekends, over tea.
  if (weekend && random(vr(sim)) < VISITORS.familyChance) put('family|0', randInt(vr(sim), VISITORS.familyFrom, VISITORS.familyTo));
}

/** Every tick, from pawns.ts: anyone due turns up (State.visitors.next holds when, by role). */
export function visitorsSpawn(sim: Sim): void {
  const st = sim.state;
  const next = st.visitors.next;
  if (next["#day"] !== sim.day) plan(sim);
  movingDay(sim);
  for (const key of Object.keys(next).sort()) {
    if (key.startsWith('#') || st.tick < next[key]) continue;
    const role = key.split('|')[0];
    const priority = PRIORITY.has(role);
    const late = st.tick - next[key] > VISITORS.staleHours * TICKS_PER_HOUR * (priority ? 2 : 1);
    // One space is kept back for the postie, the cleaner and the tradespeople. The van isn't a person.
    const room = role === 'van' || visitorsOnMap(sim).filter((p) => p.kind === 'visitor' && p.role !== 'mover').length < VISITORS.most - (priority ? 0 : 1);
    if (!room && !late) continue;
    delete next[key];
    if (!room) continue;
    launch(sim, key);
  }
}

/** Once a game hour: the cat is here if it's meant to be, and the fox comes on bin nights. */
export function visitorsHour(sim: Sim): void {
  const st = sim.state;
  const next = st.visitors.next;
  const hour = Math.floor(sim.minuteOfDay / 60);
  // The cat, once you let it stay.
  if (st.cat) {
    const cat = st.pawns.find((p) => p.id === st.cat!.pawn) ?? st.pawns.find((p) => p.role === 'cat');
    if (cat) {
      st.cat.pawn = cat.id;
      cat.role = 'cat';
      cat.kind = 'animal';
    } else {
      st.cat.pawn = addVisitor(sim, 'cat', 'animal').id;
    }
  }
  // Lorraine, if you started paying her after the day was planned (but not after the morning).
  if (st.cleaner && next['#cleaner'] !== sim.day && sim.minuteOfDay < 11 * 60) {
    next['#cleaner'] = sim.day;
    next.cleaner = st.tick + randInt(vr(sim), 5, 60) * TICKS_PER_MINUTE;
  }
  // The fox, at night, if the bins are full: at most once a night.
  if (hour >= 23 || hour < 4) {
    const night = hour >= 23 ? sim.day : sim.day - 1;
    if (next['#fox'] !== night && next.fox === undefined && binsOverflowing(sim) && random(vr(sim)) < VISITORS.foxChance) {
      next['#fox'] = night;
      next.fox = st.tick + randInt(vr(sim), 5, 50) * TICKS_PER_MINUTE;
    }
  }
}

/** Something's been mended (upkeep.ts): send a tradesperson to the flat it's in, or the shared parts. */
export function visitorsMended(sim: Sim, flatId: string | null, def: string, id: number): void {
  sim.state.visitors.next[`tradesperson|${flatId ?? '-'}|${def}|${id}`] = sim.state.tick + 2 * TICKS_PER_MINUTE;
}

/** Sandra's been this morning: the post badge lights (UI only; the letters are made when they always were). */
export function postieHasBeen(sim: Sim): boolean {
  return sim.state.visitors.next['#postieDay'] === sim.day;
}

/** A due caller, from its key. */
function launch(sim: Sim, key: string): void {
  const st = sim.state;
  const [role, a, def] = key.split('|');
  if (role === 'cleaner' && !st.cleaner) return;
  if (role === 'van') return pullUp(sim, a);
  if (role === 'rider') {
    // The first night in a new flat: the takeaway is for them.
    const first = a === 'first';
    const host = first ? household(sim, def).find((t) => homeAndAwake(sim, t)) : hungryHost(sim);
    if (!host) return;
    if (first) for (const t of household(sim, def)) remember(sim, t.life!, 'firstNight');
    const p = addVisitor(sim, 'rider');
    p.flat = host.life!.flat;
    p.doing = 'On the way with a takeaway';
    return;
  }
  if (role === 'friend' || role === 'family') {
    if (!pickHost(sim)) return;
    addVisitor(sim, role);
    return;
  }
  if (role === 'fox') {
    if (!st.pawns.some((p) => p.role === 'fox')) addVisitor(sim, 'fox', 'animal');
    return;
  }
  if (role === 'tradesperson') {
    const p = addVisitor(sim, role);
    p.flat = a === '-' || !sim.layout.flat(a) ? null : a;
    p.name = `${tradeName(def)}`;
    p.note = p.name;
    return;
  }
  addVisitor(sim, role);
}

const tradeName = (def: string | undefined) =>
  def === 'cooker' || def === 'fridge' || def === 'washer' || def === 'kettle' ? 'Terry the sparky' : def === 'sink' || def === 'shower' || def === 'toilet' || def === 'radiator' ? 'Gary the plumber' : 'Mick the handyman';

// ------------------------------------------------------------------ who they call on

/** Someone in and awake to open the door to a friend: the friendly and the party animals more often. */
function pickHost(sim: Sim): Pawn | null {
  const homes = tenantsIn(sim).filter((p) => homeAndAwake(sim, p) && !p.partyAt && !p.life!.moment);
  if (homes.length === 0) return null;
  const weights = homes.map((p) => 1 + (has(p.life!, 'friendly') ? 3 : 0) + (has(p.life!, 'partyAnimal') ? 3 : 0));
  let r = random(vr(sim)) * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < homes.length; i++) {
    r -= weights[i];
    if (r <= 0) return homes[i];
  }
  return homes[homes.length - 1];
}

/** Who a rider is for: someone in who's hungry and has no kitchen, or it's Takeaway Friday and they're not a keen cook. */
function hungryHost(sim: Sim): Pawn | null {
  const friday = weekdayOf(sim) === 4 && sim.minuteOfDay >= 19 * 60;
  const wanting = tenantsIn(sim).filter((p) => {
    if (!homeAndAwake(sim, p)) return false;
    const kitchen = scoreFor(sim, p.life!.flat, 1).has.kitchen;
    return (!kitchen && p.life!.needs.food < VISITORS.hungry) || (friday && !has(p.life!, 'keenCook'));
  });
  return wanting.length > 0 ? pick(vr(sim), wanting) : null;
}

const nobodyIn = (sim: Sim, flatId: string | null) => !household(sim, flatId ?? '').some((p) => homeAndAwake(sim, p));
const anyoneIn = (sim: Sim) => tenantsIn(sim).some((p) => homeAndAwake(sim, p));

// ------------------------------------------------------------------ becoming a visitor

/** Someone comes in from the street for a reason: a pawn with this role, heading for the building. Cards can use it (a courier at the door). Check `visitorRoom` first. */
export function addVisitor(sim: Sim, role: string, kind: 'visitor' | 'animal' = 'visitor'): Pawn {
  // addPawn rolls a look from the main stream; put it back so visitors don't shift the main game.
  const keep = sim.state.rng;
  const p = addPawn(sim, kind);
  sim.state.rng = keep;
  p.role = role;
  p.task = 'go';
  p.doing = 'Calling round';
  dress(sim, p, role);
  return p;
}

/** Name, look and what's in their hand. */
function dress(sim: Sim, p: Pawn, role: string): void {
  switch (role) {
    case 'postie':
      p.name = 'Sandra the postie';
      p.note = 'Brings the post. Knows everyone.';
      p.look = { skin: 2, hair: 1, top: 1, legs: 1 };
      p.doing = 'Bringing the post';
      break;
    case 'cleaner':
      p.name = 'Lorraine who does the stairs';
      p.note = 'Does the stairs and the lobby.';
      p.look = { skin: 1, hair: 3, top: 4, legs: 2 };
      p.prop = 'mop';
      p.doing = 'Coming to do the stairs';
      break;
    case 'courier':
      p.note = 'Delivering a parcel.';
      p.prop = 'parcel';
      p.doing = 'Looking for the address';
      break;
    case 'rider':
      p.note = 'Delivering a takeaway.';
      p.prop = 'box';
      break;
    case 'friend':
    case 'family': {
      const host = pickHost(sim);
      p.flat = host?.life!.flat ?? null;
      const first = host?.name.split(' ')[0] ?? 'Someone';
      if (role === 'family') p.name = `${first}'s ${pick(vr(sim), ['mum', 'dad', 'brother', 'sister', 'daughter'])}`;
      else p.name = `${p.name.split(' ')[0]}, a friend of ${first}'s`;
      p.note = role === 'family' ? 'Come for tea.' : 'Come round for a natter.';
      p.doing = `Calling on ${first}`;
      break;
    }
    case 'mover':
      p.name = 'Del the removal man';
      p.note = 'Moving someone in.';
      p.doing = 'Unloading the van';
      break;
    case 'tradesperson':
      p.name = 'Mick the handyman';
      p.note = 'Here to mend something.';
      p.prop = 'toolbox';
      p.doing = 'Carrying a toolbox';
      break;
    case 'cat':
      p.name = 'The building cat';
      p.note = 'Has opinions about the stairs.';
      p.doing = 'Prowling';
      break;
    case 'fox':
      p.name = 'A fox';
      p.note = 'Up to no good, in a small way.';
      p.doing = 'Sniffing about';
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ where things are

function entrance(sim: Sim): Spot | null {
  for (const [k, kind] of Object.entries(sim.state.cells)) {
    if (kind === 'entrance') return k.split(',').map(Number) as Spot;
  }
  return null;
}

const standable = (sim: Sim, x: number, s: number) => x >= 0 && x < sim.layout.w && s >= 0 && sim.layout.standable[sim.layout.node(x, s)] === 1;

/** The pavement outside the street door. */
function doorstep(sim: Sim): Spot | null {
  const e = entrance(sim);
  if (!e) return null;
  const { x0, x1 } = sim.state.plot;
  for (const dx of [-1, 1]) {
    const x = e[0] + dx;
    if (x >= x0 && x <= x1) continue;
    for (const s of [e[1], e[1] - 1]) if (standable(sim, x, s)) return [x, s];
  }
  return null;
}

/** The standing places in the lobby, nearest the street door first. */
function lobby(sim: Sim): Spot[] {
  const lay = sim.layout;
  const e = entrance(sim);
  if (!e) return [];
  for (const dx of [1, -1]) {
    const n = lay.node(e[0] + dx, e[1]);
    const r = lay.roomOf[n];
    if (r < 0 || !lay.rooms[r].shared) continue;
    return lay.rooms[r].nodes
      .filter((m) => !lay.isDoorNode(m))
      .map((m) => lay.xs(m))
      .sort((a, b) => Math.abs(a[0] - e[0]) - Math.abs(b[0] - e[0]) || a[1] - b[1]);
  }
  return [];
}

/** A spot in the lobby a couple of tiles in, where you'd stand to sort the post. */
function lobbySpot(sim: Sim): Spot | null {
  const l = lobby(sim).filter((s) => s[1] === (entrance(sim)?.[1] ?? 0));
  return l.length > 0 ? l[Math.min(2, l.length - 1)] : (lobby(sim)[0] ?? null);
}

/** Every standing place in the shared parts. */
function sharedNodes(sim: Sim): Spot[] {
  const lay = sim.layout;
  return lay.rooms
    .filter((r) => r.shared && !r.outdoor)
    .flatMap((r) => r.nodes)
    .filter((m) => !lay.isDoorNode(m))
    .map((m) => lay.xs(m));
}

/** Places along the stairs and landings to mop: the lobby first, then up through the building. */
function mopSpots(sim: Sim): Spot[] {
  const nodes = sharedNodes(sim);
  const rows = [...new Set(nodes.map((n) => n[1]))].sort((a, b) => a - b);
  if (rows.length === 0) return [];
  const chosen = new Set<number>([rows[0]]);
  for (const f of [1 / 3, 2 / 3, 1]) chosen.add(rows[Math.min(rows.length - 1, Math.round((rows.length - 1) * f))]);
  return [...chosen]
    .sort((a, b) => a - b)
    .map((s) => {
      const row = nodes.filter((n) => n[1] === s).sort((a, b) => a[0] - b[0]);
      return row[Math.floor(row.length / 2)];
    });
}

/** The shared standing place just outside a flat's front door: its doormat. */
function doormat(sim: Sim, flatId: string): Spot | null {
  const lay = sim.layout;
  const f = lay.flat(flatId);
  if (!f) return null;
  for (const k of f.doors) {
    const [dx, ds] = k.split(',').map(Number);
    for (const o of [-1, 1]) {
      const n = lay.node(dx + o, ds);
      const r = lay.roomOf[n];
      if (lay.standable[n] && r >= 0 && lay.rooms[r].shared) return [dx + o, ds];
    }
  }
  return null;
}

/** Where a friend sits: the sofa, or failing that anywhere in the flat. */
function sofaSpot(sim: Sim, flatId: string): Spot | null {
  const lay = sim.layout;
  const f = lay.flat(flatId);
  if (!f) return null;
  const cells = new Set(lay.flatCells(f));
  const sofa = sim.state.furniture.find((x) => x.def === 'sofa' && cells.has(lay.node(x.x, x.s)));
  if (sofa && standable(sim, sofa.x, sofa.s)) return [sofa.x, sofa.s];
  const nodes = f.rooms.flatMap((r) => lay.rooms[r].nodes).filter((n) => !lay.isDoorNode(n));
  return nodes.length > 0 ? lay.xs(nodes[0]) : null;
}

/** Somewhere to work in a flat (or the shared parts): the middle of its rooms. */
function workSpot(sim: Sim, flatId: string | null): Spot | null {
  const lay = sim.layout;
  const f = flatId ? lay.flat(flatId) : undefined;
  const nodes = f ? f.rooms.flatMap((r) => lay.rooms[r].nodes).filter((n) => !lay.isDoorNode(n)).map((n) => lay.xs(n)) : sharedNodes(sim);
  nodes.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return nodes.length > 0 ? nodes[Math.floor(nodes.length / 2)] : null;
}

// ------------------------------------------------------------------ what each one does

const tickBubble = (sim: Sim, p: Pawn, text: string, icon?: string) => {
  p.bubble = { text, until: sim.state.tick + seconds(4), icon, kind: 'moment' };
};

/** The list of stops for a role. Worked out afresh each time, so it only depends on the building and the pawn. */
function stopsFor(sim: Sim, p: Pawn): Stop[] {
  const out: Stop[] = [];
  const add = (s: Stop | null) => s && out.push(s);
  const step = doorstep(sim);
  const mat = lobbySpot(sim);
  switch (p.role) {
    case 'postie':
      if (mat) {
        add({
          at: mat,
          secs: VISITORS.postieSeconds,
          travel: 'Bringing the post',
          doing: 'Putting the post out',
          icon: 'envelope',
          text: 'Post',
          begin: (s, v) => {
            s.state.visitors.next['#postieDay'] = s.day;
            // A word with whoever's about.
            const near = s.state.pawns.find((t) => t.life && homeAndAwake(s, t) && Math.round(t.s) === mat[1] && Math.abs(t.x - mat[0]) <= 4);
            if (near) {
              tickBubble(s, v, 'Morning!');
              if (!near.bubble) near.bubble = { text: 'Morning, Sandra', until: s.state.tick + seconds(4), kind: 'talk' };
            }
          },
        });
      }
      break;
    case 'courier':
      if (step) {
        add({ at: step, secs: VISITORS.buzzSeconds, travel: 'Looking for the address', doing: 'Buzzing a flat', pose: 'carry', icon: 'box', text: 'Parcel', begin: (s, v) => !anyoneIn(s) && tickBubble(s, v, '?') });
      }
      if (mat) add({ at: mat, secs: [2, 4], travel: 'Carrying a parcel in', doing: 'Leaving a parcel', icon: 'box', text: 'Parcel', drop: true, skip: (s) => !anyoneIn(s) });
      break;
    case 'rider':
      if (step) {
        add({
          at: step,
          secs: VISITORS.buzzSeconds,
          travel: 'On the way with a takeaway',
          doing: 'Waiting for the door',
          pose: 'carry',
          icon: 'fork',
          text: 'Food',
          drop: true,
          begin: (s, v) => {
            const host = household(s, v.flat ?? '').find((t) => homeAndAwake(s, t));
            if (host && !host.bubble) host.bubble = { text: 'Dinner!', until: s.state.tick + seconds(4), icon: 'fork', kind: 'moment' };
          },
        });
      }
      break;
    case 'friend':
    case 'family': {
      const flat = sim.layout.flat(p.flat);
      const door = flat ? (flat.doors[0]?.split(',').map(Number) as Spot | undefined) : undefined;
      const seat = flat ? sofaSpot(sim, flat.id) : null;
      const family = p.role === 'family';
      if (flat && door && seat) {
        add({ at: door, secs: [3, 5], travel: `Going up to ${flat.name}`, doing: `Knocking at ${flat.name}`, icon: 'phone', text: 'Knock', skip: (s, v) => nobodyIn(s, v.flat) });
        add({
          at: seat,
          secs: family ? VISITORS.familySeconds : VISITORS.friendSeconds,
          travel: `Going in to ${flat.name}`,
          doing: family ? 'Sitting down for tea' : 'Sitting on the sofa',
          pose: 'sit',
          icon: family ? 'cup' : undefined,
          text: family ? 'Tea?' : 'Hiya',
          skip: (s, v) => nobodyIn(s, v.flat),
          begin: (s, v) => {
            for (const t of household(s, v.flat ?? '')) if (homeAndAwake(s, t)) remember(s, t.life!, family ? 'familyRound' : 'friendRound');
          },
        });
      }
      break;
    }
    case 'mover': {
      // Boxes from the van to the middle of the flat, a few trips each, then the van doors.
      const spot = p.flat ? workSpot(sim, p.flat) : null;
      const trips = Math.min(MOVING_IN.mostTrips, MOVING_IN.baseTrips + household(sim, p.flat ?? '').length);
      if (step && spot) {
        for (let i = 0; i < trips; i++) {
          add({ at: step, secs: MOVING_IN.boxSeconds, travel: 'Back to the van', doing: 'Getting a box off the van', pose: 'carry', icon: 'box', text: 'Box', begin: (_s, v) => void (v.prop = 'box') });
          add({ at: spot, secs: MOVING_IN.putDownSeconds, travel: 'Carrying a box up', doing: 'Putting a box down', icon: 'box', text: 'Box', drop: true });
        }
        add({ at: step, secs: MOVING_IN.shutSeconds, travel: 'Back to the van', doing: 'Shutting the van up' });
      }
      break;
    }
    case 'tradesperson': {
      const spot = workSpot(sim, p.flat);
      if (spot) add({ at: spot, secs: VISITORS.tradeSeconds, travel: 'Carrying a toolbox', doing: 'Mending something', icon: 'spanner', text: 'Bang', drop: true });
      break;
    }
    case 'cleaner': {
      const spots = mopSpots(sim);
      spots.forEach((spot, i) => {
        add({
          at: spot,
          secs: VISITORS.mopSeconds,
          travel: 'Off to do the stairs',
          doing: i === 0 ? 'Mopping the lobby' : 'Mopping the stairs',
          pose: 'mop',
          icon: i === 0 ? 'bucket' : undefined,
          text: i === 0 ? 'Mop' : undefined,
          end: i === spots.length - 1 ? (s) => s.state.cleaner && (s.state.dirt[SHARED] = 0) : undefined,
        });
      });
      break;
    }
    case 'fox': {
      const lay = sim.layout;
      const shared = new Set(lay.rooms.filter((r) => r.shared).flatMap((r) => r.cells));
      const bins = sim.state.furniture.find((f) => f.def === 'bins' && shared.has(lay.node(f.x, f.s)));
      if (bins && standable(sim, bins.x, bins.s)) {
        add({
          at: [bins.x, bins.s],
          secs: VISITORS.foxSeconds,
          travel: 'Sniffing about',
          doing: 'Knocking the bins over',
          icon: 'paw',
          text: 'Crash',
          begin: (s) => addDirt(s, SHARED, 0.12),
        });
      }
      break;
    }
    default:
      // Whoever a card sent: they come in, stand about looking for the right door, and go.
      if (mat) add({ at: mat, secs: [3, 6], travel: 'Looking for the right door', doing: 'Looking for the right door', icon: '?', text: '?' });
  }
  return out;
}

/** A visitor's or an animal's next move, when they've nothing to walk to. False hands them back to pawns.ts (which walks them off). */
export function visitorThink(sim: Sim, p: Pawn): boolean {
  if (p.role === 'cat') return catThink(sim, p);
  if (p.task === 'leave') return false;
  return errandThink(sim, p);
}

function parseAct(act: string | undefined): ['to' | 'at', number] {
  const m = /^(to|at):(\d+)$/.exec(act ?? '');
  return m ? [m[1] as 'to' | 'at', Number(m[2])] : ['to', 0];
}

function errandThink(sim: Sim, p: Pawn): boolean {
  const st = sim.state;
  const stops = stopsFor(sim, p);
  let [phase, n] = parseAct(p.act);
  if (phase === 'at') {
    const done = stops[n];
    if (done) {
      done.end?.(sim, p);
      if (done.drop) delete p.prop;
    }
    n++;
    delete p.pose;
    delete p.bubble;
  }
  // Nobody calls round in the small hours.
  const m = sim.minuteOfDay;
  const curfew = (p.role === 'friend' || p.role === 'family') && (m >= VISITORS.curfew || m < 6 * 60);
  for (; n < stops.length && !curfew; n++) {
    const stop = stops[n];
    if (stop.skip?.(sim, p)) continue;
    if (Math.round(p.x) === stop.at[0] && Math.round(p.s) === stop.at[1] && atNode(p)) {
      p.act = `at:${n}`;
      p.doing = stop.doing;
      if (stop.pose) p.pose = stop.pose;
      else delete p.pose;
      if (stop.icon) tickBubble(sim, p, stop.text ?? '', stop.icon);
      stop.begin?.(sim, p);
      p.waitUntil = st.tick + seconds(randInt(vr(sim), stop.secs[0], stop.secs[1]));
      return true;
    }
    if (setGoal(sim, p, stop.at)) {
      p.act = `to:${n}`;
      p.doing = stop.travel;
      if (p.prop && p.prop !== 'mop') p.pose = 'carry';
      else delete p.pose;
      return true;
    }
    // No way there: miss it out.
  }
  // All done: off home.
  p.task = 'leave';
  delete p.act;
  delete p.bubble;
  p.doing = p.prop && p.prop !== 'mop' ? 'Heading off' : 'Heading off';
  if (p.prop && p.prop !== 'mop') p.pose = 'carry';
  else delete p.pose;
  return false;
}

// ------------------------------------------------------------------ the cat

/** Where the cat might doze: its favourite's doormat, doormats, the stairs, the doorstep in the sun. */
function catSpot(sim: Sim): { at: Spot; why: string } | null {
  const st = sim.state;
  const lay = sim.layout;
  const fav = st.cat?.favourite !== undefined ? st.pawns.find((p) => p.id === st.cat!.favourite) : undefined;
  const r = random(vr(sim));
  const hour = Math.floor(sim.minuteOfDay / 60);
  if (fav?.life && r < 0.3) {
    const mat = doormat(sim, fav.life.flat);
    if (mat) return { at: mat, why: `Waiting outside ${fav.name.split(' ')[0]}'s door` };
  }
  const sun = doorstep(sim);
  if (r < 0.5 && sun && hour >= 10 && hour < 17) return { at: sun, why: 'Asleep in the sun' };
  if (r < 0.75) {
    const mats = lay.flats.map((f) => doormat(sim, f.id)).filter((m): m is Spot => !!m);
    if (mats.length > 0) return { at: pick(vr(sim), mats), why: 'Asleep on a doormat' };
  }
  const nodes = sharedNodes(sim);
  return nodes.length > 0 ? { at: pick(vr(sim), nodes), why: 'Asleep on the stairs' } : null;
}

function catThink(sim: Sim, p: Pawn): boolean {
  const st = sim.state;
  if (!st.cat) {
    // Gone (you shooed it): off down the street.
    p.task = 'leave';
    delete p.pose;
    return false;
  }
  p.task = 'go';
  const m = /^cat\|(\d+)\|(\d+)\|(.*)$/.exec(p.act ?? '');
  if (m && Math.round(p.x) === Number(m[1]) && Math.round(p.s) === Number(m[2]) && atNode(p)) {
    // There: a nap.
    p.pose = 'sleep';
    p.doing = m[3];
    p.act = undefined;
    delete p.act;
    p.waitUntil = st.tick + seconds(randInt(vr(sim), ...VISITORS.catNap));
    if (random(vr(sim)) < 0.5) tickBubble(sim, p, 'Purr', 'paw');
    return true;
  }
  delete p.pose;
  const spot = catSpot(sim);
  if (!spot || !setGoal(sim, p, spot.at)) {
    p.doing = 'Prowling';
    p.waitUntil = st.tick + seconds(randInt(vr(sim), 3, 8));
    delete p.act;
    return true;
  }
  p.act = `cat|${spot.at[0]}|${spot.at[1]}|${spot.why}`;
  p.doing = 'Prowling';
  // Already there: the next think settles it.
  return true;
}

/** The doors a visitor can open: the street door (and so the shared parts), and a flat only if they're expected there. */
export function visitorKeys(p: Pawn): Keys {
  const expected = (p.role === 'friend' || p.role === 'family' || p.role === 'tradesperson' || p.role === 'mover') && p.flat;
  return { flats: expected ? [LET_IN, p.flat!] : [LET_IN] };
}

/** Visitors and animals on the map now. */
export function visitorsOnMap(sim: Sim): Pawn[] {
  return sim.state.pawns.filter((p) => p.kind === 'visitor' || p.kind === 'animal');
}

/** Room for another (VISITORS.most, not counting party guests or applicants with Denise). */
export function visitorRoom(sim: Sim): boolean {
  return visitorsOnMap(sim).filter((p) => p.kind === 'visitor' && p.role !== 'mover').length < VISITORS.most;
}

// ------------------------------------------------------------------ moving-in day

/** A flat's just been let (leases.ts accept): the van is on its way. Not for sitting tenants, who were there already. */
export function movingIn(sim: Sim, flatId: string, pawns: Pawn[]): void {
  if (pawns.length === 0) return;
  const st = sim.state;
  let due = st.tick + randInt(vr(sim), ...MOVING_IN.vanAfter) * TICKS_PER_MINUTE;
  // Nobody moves house in the dark: it waits for the morning.
  const m = Math.floor(due / TICKS_PER_MINUTE) % (24 * 60);
  const midnight = due - (due % TICKS_PER_DAY);
  if (m < MOVING_IN.vanFrom) due = midnight + (MOVING_IN.vanFrom + randInt(vr(sim), 0, 30)) * TICKS_PER_MINUTE;
  else if (m >= MOVING_IN.vanUntil) due = midnight + TICKS_PER_DAY + (MOVING_IN.vanFrom + randInt(vr(sim), 0, 30)) * TICKS_PER_MINUTE;
  st.visitors.next[`van|${flatId}`] = due;
}

/** The vans at the kerb now, for drawing: which flat they're for and the tile they're in front of. */
export function vansAtKerb(sim: Sim): { flat: string; x: number }[] {
  const step = doorstep(sim);
  const base = step ? step[0] : sim.state.plot.x0 - 3;
  return Object.keys(sim.state.visitors.next)
    .filter((k) => k.startsWith('#van|'))
    .sort()
    .map((k, i) => ({ flat: k.slice(5), x: base + i * 4 }));
}

/** The van's here: two removal men get out. */
function pullUp(sim: Sim, flatId: string | undefined): void {
  const st = sim.state;
  if (!flatId || household(sim, flatId).length === 0 || st.visitors.next[`#van|${flatId}`] !== undefined) return;
  const step = doorstep(sim);
  if (!step) return;
  st.visitors.next[`#van|${flatId}`] = st.tick;
  ['Del the removal man', "Wayne, Del's lad"].forEach((name, i) => {
    const p = addVisitor(sim, 'mover');
    p.name = name;
    p.flat = flatId;
    p.x = step[0];
    p.s = step[1];
    p.waitUntil = st.tick + seconds(2 * i + 1);
  });
}

/** Every tick: the van goes when its men are done; then the new tenants sit down; and the first night's takeaway. */
function movingDay(sim: Sim): void {
  const st = sim.state;
  const next = st.visitors.next;
  for (const key of Object.keys(next).sort()) {
    if (key.startsWith('#van|')) {
      const flatId = key.slice(5);
      const working = st.pawns.some((p) => p.role === 'mover' && p.flat === flatId && p.task !== 'leave');
      // (A mover who's been shut in with no way out counts as done after a while.)
      if (working && st.tick - next[key] < 3 * TICKS_PER_HOUR) continue;
      delete next[key];
      for (const p of st.pawns) if (p.role === 'mover' && p.flat === flatId) p.task = 'leave';
      for (const t of household(sim, flatId)) next[`#settle|${flatId}|${t.id}`] = st.tick + MOVING_IN.settleHours * TICKS_PER_HOUR;
      const m = sim.minuteOfDay;
      if (m < MOVING_IN.takeawayLast) next[`rider|first|${flatId}`] = Math.max(st.tick + 10 * TICKS_PER_MINUTE, at(sim, Math.max(m, MOVING_IN.takeawayFrom) + randInt(vr(sim), 0, MOVING_IN.takeawayTo - MOVING_IN.takeawayFrom)));
    } else if (key.startsWith('#settle|') && st.tick % TICKS_PER_MINUTE === 0) {
      const p = st.pawns.find((o) => o.id === Number(key.split('|')[2]));
      if (!p?.life || p.life.leaving || st.tick > next[key] || settleIn(sim, p)) delete next[key];
    }
  }
}
