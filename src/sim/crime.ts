// Burglars. The more worth taking (a telly, a laptop on a desk, a nice picture) and the
// easier the way in, the likelier one turns up, always in the small hours. They try the
// street door or a ground-floor window. Anyone awake nearby might spot them, and they leg
// it; new locks hold them up and sometimes put them off; an alarm sends them running. If
// they get in, they head for the flat with the most worth taking and help themselves. In a
// building worth more, they're greedier: two things at once, or a second flat on the way out.

import { post, poster, tenants } from './chat';
import { ALARM_PRICE, LOCKS_PRICE, POUND, book, furniturePrice, spend } from './economy';
import { beginHappening, canStart, finishHappening, running, threat } from './events';
import { tale } from './tales';
import { placeFurniture } from './build';
import { furnitureDef } from './defs';
import { household } from './leases';
import { addPawn, atNode, setGoal } from './pawns';
import { pick, randInt, random } from './rng';
import type { Sim } from './sim';
import { TICKS_PER_MINUTE, type Furniture, type Grade, type Pawn } from './state';
import { remember } from './thoughts';
import type { Flat } from './layout';
import { stat } from './stat';
import { gradeOf } from './grades';
import { BURGLARY as B, GRADES, RISK_WORDS } from './tuning';

const first = (p: Pawn) => p.name.split(' ')[0];
/** What a thing would cost new, at its grade: what it's worth to a burglar. */
const priceOf = (f: Furniture) => furniturePrice(f.def, gradeOf(f));

/** Things worth stealing in a flat. */
function valuables(sim: Sim, flat: Flat): Furniture[] {
  const lay = sim.layout;
  const cells = new Set(lay.flatCells(flat));
  return sim.state.furniture.filter((f) => furnitureDef(f.def).valuable && cells.has(lay.node(f.x, f.s)));
}

/** What a burglar would take from a flat, in the order they'd take it: the dearest first, so posh things go before anything else. */
export function pickings(sim: Sim, flat: Flat): Furniture[] {
  return valuables(sim, flat).sort((a, b) => priceOf(b) - priceOf(a));
}

/** Ways in from the street: the street door, and windows low enough to climb through. */
interface WayIn {
  entry: 'door' | 'window';
  /** Where they stand outside. */
  at: [number, number];
  /** Where they end up inside (through a window). */
  inside?: [number, number];
  /** The flat a window lets them straight into. */
  flat?: string;
}

export function waysIn(sim: Sim): WayIn[] {
  const st = sim.state;
  const lay = sim.layout;
  const { x0, x1 } = st.plot;
  const out: WayIn[] = [];
  const outside = (x: number, s: number) => {
    if (x < 0 || x >= lay.w || !lay.standable[lay.node(x, s)]) return false;
    const r = lay.roomOf[lay.node(x, s)];
    return x < x0 || x > x1 || r === -1 || lay.rooms[r].outdoor;
  };
  for (const [k, kind] of Object.entries(st.cells)) {
    const [x, s] = k.split(',').map(Number);
    if (kind === 'entrance') {
      // Outside the door, or on the street below its doorstep.
      for (const dx of [-1, 1]) {
        const r = outside(x + dx, s) ? s : outside(x + dx, s - 1) ? s - 1 : -1;
        if (r >= 0) out.push({ entry: 'door', at: [x + dx, r] });
      }
    }
    if (kind === 'window' && s <= 3) {
      for (const dx of [-1, 1]) {
        // Standing on the pavement (or whatever's outside) under the window.
        let ground = -1;
        for (let r = s; r >= 0; r--) if (outside(x + dx, r)) ground = r;
        if (ground === -1 || s - ground > 2) continue;
        for (let r = s; r >= Math.max(0, s - 2); r--) {
          const f = lay.flatAt(x - dx, r);
          if (f && lay.standable[lay.node(x - dx, r)]) {
            out.push({ entry: 'window', at: [x + dx, ground], inside: [x - dx, r], flat: f.id });
            break;
          }
        }
      }
    }
  }
  return out;
}

/** How likely a break-in is, about 0 to 1: what's worth taking, how easy it is to get in, and what's in the way. */
export function burglaryRisk(sim: Sim): number {
  const st = sim.state;
  const lay = sim.layout;
  let worth = 0;
  // A posh telly is more of a draw than a cheap one.
  for (const f of lay.flats) worth += valuables(sim, f).reduce((n, v) => n + GRADES.burglar[gradeOf(v)], 0) * B.perValuable + (household(sim, f.id).length > 0 ? B.occupied : 0);
  const ways = waysIn(sim);
  const windows = ways.filter((w) => w.entry === 'window').length;
  const easy = (ways.some((w) => w.entry === 'door') ? B.door : 0) + Math.min(B.mostWindows, windows * B.window);
  // How tempting, times how easy (never more than certain), then whatever's in the way.
  const tempting = Math.min(1, stat(B.base, [B.perWorth * worth], [B.easyBase + easy * B.perEasy]));
  return stat(tempting, [], [st.security.locks ? B.locks : 1, st.security.alarm ? B.alarm : 1]);
}

export function riskWord(risk: number): string {
  return risk < RISK_WORDS.low ? 'Low' : risk < RISK_WORDS.some ? 'Some' : risk < RISK_WORDS.high ? 'High' : 'Very high';
}

/** Someone in a hoodie turns up in the small hours. */
export function startBurglary(sim: Sim): boolean {
  const st = sim.state;
  const lay = sim.layout;
  if (!canStart(sim, ['crime'])) return false;
  // The flat with the most worth taking (anywhere with people in has something).
  const scored = lay.flats.map((f) => ({ f, worth: valuables(sim, f).reduce((n, v) => n + priceOf(v), 0) + household(sim, f.id).length * B.household }));
  const best = scored.filter((x) => x.worth > 0).sort((a, b) => b.worth - a.worth)[0];
  if (!best) return false;
  const ways = waysIn(sim).filter((w) => w.entry === 'door' || w.flat === best.f.id);
  if (ways.length === 0) return false;
  const way = pick(st, ways);
  const p = addPawn(sim, 'burglar');
  p.name = 'Someone in a hoodie';
  p.look = { skin: p.look.skin, hair: 0, top: 0, legs: 0 };
  p.task = 'go';
  p.flat = best.f.id;
  p.doing = 'Having a look about';
  // The more the building's worth, the greedier they are.
  const push = threat(sim);
  const take = random(st) < push - B.twoThings ? 2 : 1;
  const more = random(st) < (push - B.secondFlat) * 2 ? 1 : 0;
  p.burgle = { stage: 'case', entry: way.entry, until: 0, at: way.at, ...(way.inside ? { inside: way.inside } : {}), ...(take > 1 ? { take } : {}), ...(more > 0 ? { more } : {}) };
  beginHappening(sim, 'burglary', ['crime'], 4, [p], best.f.id);
  return true;
}

/** A burglar's next move. False once they're off, so they walk away like anyone else. */
export function burglarThink(sim: Sim, p: Pawn): boolean {
  const st = sim.state;
  const lay = sim.layout;
  const b = p.burgle;
  if (!b || b.stage === 'out') {
    p.task = 'leave';
    return false;
  }
  if (b.stage === 'case') {
    const [x, s] = b.at!;
    if (Math.round(p.x) === x && Math.round(p.s) === s) {
      b.stage = 'try';
      b.until = st.tick + (st.security.locks ? B.tryMinutesLocks : B.tryMinutes) * TICKS_PER_MINUTE;
      p.doing = b.entry === 'door' ? 'Trying the street door' : 'Trying a window';
      p.waitUntil = b.until;
      return true;
    }
    if (!setGoal(sim, p, [x, s])) flee(sim, p, 'gaveUp');
    return true;
  }
  if (b.stage === 'try') {
    if (st.security.locks && random(st) < B.lockPutsOff) {
      flee(sim, p, 'gaveUp');
      return false;
    }
    if (st.security.alarm) {
      flee(sim, p, 'alarm');
      return false;
    }
    b.stage = 'in';
    if (b.entry === 'window' && b.inside) {
      [p.x, p.s] = b.inside;
    }
    p.doing = 'Creeping about';
  }
  // Inside: to the flat, then a rummage.
  const flat = lay.flat(p.flat);
  if (!flat) {
    flee(sim, p, 'gaveUp');
    return false;
  }
  const here = lay.flatAt(Math.round(p.x), Math.round(p.s));
  if (here?.id !== flat.id || lay.isDoorNode(lay.node(Math.round(p.x), Math.round(p.s)))) {
    const nodes = flat.rooms.flatMap((r) => lay.rooms[r].nodes).filter((n) => !lay.isDoorNode(n));
    if (nodes.length === 0 || !setGoal(sim, p, lay.xs(pick(st, nodes)))) flee(sim, p, 'gaveUp');
    return true;
  }
  if (p.doing !== 'Rummaging') {
    p.doing = 'Rummaging';
    p.waitUntil = st.tick + randInt(st, ...B.rummage) * TICKS_PER_MINUTE;
    return true;
  }
  return steal(sim, p, flat);
}

/** Once a minute: is anyone awake to see them? */
export function crimeMinute(sim: Sim): void {
  const st = sim.state;
  const h = running(sim, 'burglary');
  if (!h) return;
  const p = st.pawns.find((x) => x.id === h.pawns[0]);
  if (!p) {
    if (h.flag !== 'alarm' || st.tick >= h.until) finishHappening(sim, h);
    return;
  }
  const b = p.burgle;
  if (!b || b.stage === 'out') return;
  const awake = (w: Pawn) => w.life && !w.life.away && w.pose !== 'sleep' && !w.life.leaving;
  if (b.stage === 'case' || b.stage === 'try') {
    // From the lobby, or out on the street.
    for (const w of st.pawns) {
      if (w === p || Math.abs(w.x - p.x) > 6 || w.s > 2.5) continue;
      if (w.kind === 'passerby' && random(st) < B.passerby) return flee(sim, p, 'passerby');
      if (awake(w) && random(st) < B.spotted) return flee(sim, p, 'spotted', w);
    }
    return;
  }
  // Inside: whoever lives there.
  for (const w of household(sim, p.flat ?? '')) {
    if (w.life!.away || !atNode(p)) continue;
    const here = sim.layout.flatAt(Math.round(p.x), Math.round(p.s));
    if (here?.id !== p.flat) continue;
    if (awake(w) ? random(st) < B.foundAwake : random(st) < B.foundAsleep) return flee(sim, p, 'spotted', w);
  }
}

/** In through a window, out the same way (they've no keys for the doors). */
function climbOut(p: Pawn): void {
  const b = p.burgle!;
  if (b.entry !== 'window' || !b.at) return;
  [p.x, p.s] = b.at;
  p.path = [];
}

function flee(sim: Sim, p: Pawn, why: 'spotted' | 'passerby' | 'alarm' | 'gaveUp', by?: Pawn): void {
  const st = sim.state;
  const b = p.burgle!;
  const wasInside = b.stage === 'in';
  if (wasInside) climbOut(p);
  b.stage = 'out';
  p.task = 'leave';
  // Halfway along the pavement in front of the building, they finish the step first (there's no turning round inside the wall).
  p.path = p.front ? p.path.slice(0, 1) : [];
  p.waitUntil = 0;
  p.doing = 'Legging it';
  const h = running(sim, 'burglary');
  const flatName = sim.layout.flat(p.flat)?.name ?? 'a flat';
  switch (why) {
    case 'spotted': {
      if (!by) return;
      remember(sim, by.life!, wasInside ? 'burgled' : 'attemptedBreakIn');
      tale(sim, 'burglaryFoiled', [by], { what: first(by) });
      sim.notify(wasInside ? `${first(by)} woke up to someone in ${flatName}. They ran off empty-handed.` : `${first(by)} spotted someone trying to get in. They legged it.`);
      if (!st.security.locks) {
        post(sim, by, wasInside ? 'There was someone IN OUR FLAT last night. Can we please get proper locks??' : 'Someone was trying to get in last night!! Can we get better locks on the doors?', [
          { label: `Fit better locks (${'£'}${LOCKS_PRICE / POUND})`, note: 'Harder to get in. Everyone feels safer.', act: 'locks' },
          { label: "It's a safe area really", note: 'They won\'t believe you', act: 'notMine' },
        ]);
      } else post(sim, by, 'Someone tried to get in last night. The locks held, but still.');
      return;
    }
    case 'passerby':
      sim.notify('A passer-by shouted at someone trying to get into your building. They ran off.');
      tale(sim, 'burglaryFoiled', [], { what: 'A passer-by' });
      return;
    case 'alarm': {
      if (h) {
        h.flag = 'alarm';
        h.until = st.tick + B.alarmMinutes * TICKS_PER_MINUTE;
      }
      for (const t of tenants(sim)) if (!t.life!.away) remember(sim, t.life!, 'attemptedBreakIn');
      sim.notify('The burglar alarm went off in the night. Whoever it was ran off. Everyone is awake now.');
      tale(sim, 'burglaryFoiled', [], { what: 'The alarm' });
      const who = poster(sim);
      if (who) post(sim, who, 'That alarm. At 3am. At least it works I suppose');
      return;
    }
    case 'gaveUp':
      if (st.security.locks) {
        sim.notify('Someone tried to get in last night, but the new locks held.');
        tale(sim, 'burglaryFoiled', [], { what: 'The new locks' });
      }
      return;
  }
}

/** The best thing they can carry (two, if they're greedy), then out, or on to the next flat. False once they're off. */
function steal(sim: Sim, p: Pawn, flat: Flat): boolean {
  const st = sim.state;
  const b = p.burgle!;
  const things = pickings(sim, flat).slice(0, b.take ?? 1);
  const people = household(sim, flat.id);
  st.furniture = st.furniture.filter((f) => !things.includes(f));
  const thing = things[0];
  const what = things.length > 0 ? things.map((t) => furnitureDef(t.def).name.toLowerCase()) : null;
  const took = what ? (what.length > 1 ? `the ${what[0]} and the ${what[1]}` : `the ${what[0]}`) : null;
  for (const t of people) remember(sim, t.life!, 'burgled');
  tale(sim, 'burglary', people, { flat: flat.id, what: took ?? 'nothing worth having' });
  if (people.length === 0) {
    sim.notify(took ? `Someone broke into ${flat.name} in the night and took ${took}.` : `Someone broke into ${flat.name} in the night and found nothing worth taking.`);
  } else {
    sim.notify(`${flat.name} has been burgled.`);
    const lead = people[0];
    if (!thing) {
      post(sim, lead, 'We\'ve been burgled. They took a laptop and my nan\'s ring. Can we get better locks at least?', st.security.locks ? undefined : [
        { label: `Fit better locks (£${LOCKS_PRICE / POUND})`, note: 'Harder to get in. Everyone feels safer.', act: 'locks' },
        { label: 'That\'s what contents insurance is for', note: 'They won\'t forget it', act: 'notMine' },
      ]);
    } else {
      const name = furnitureDef(thing.def).name.toLowerCase();
      // Like for like: a posh one for a posh one.
      const grade = gradeOf(thing);
      post(sim, lead, `We've been burgled. They took ${took}! Are you replacing ${things.length > 1 ? `the ${name} at least` : 'it'}?`, [
        { label: `Replace the ${name} (£${priceOf(thing) / POUND})`, note: 'They\'ll appreciate it', act: `replace:${thing.def}:${thing.x}:${thing.s}:${thing.flip ? 1 : 0}${grade === 'standard' ? '' : `:${grade}`}` },
        { label: 'That\'s what contents insurance is for', note: 'They won\'t forget it', act: 'notMine' },
      ]);
    }
  }
  // Greedy: on to the next best flat, from the inside.
  const next = (b.more ?? 0) > 0 ? sim.layout.flats.filter((f) => f.id !== flat.id && valuables(sim, f).length > 0)[0] : undefined;
  if (next) {
    b.more = (b.more ?? 1) - 1;
    p.flat = next.id;
    p.doing = 'Creeping about';
    return true;
  }
  climbOut(p);
  b.stage = 'out';
  p.task = 'leave';
  p.doing = 'Legging it';
  return false;
}

/** Answers in the chat about break-ins. */
export function crimeAct(sim: Sim, kind: string, args: string[], from: Pawn | undefined): boolean {
  const st = sim.state;
  switch (kind) {
    case 'locks':
      if (fitLocks(sim)) for (const t of tenants(sim)) remember(sim, t.life!, 'landlordListened');
      return true;
    case 'replace': {
      const [def, x, s, flip, g] = args;
      const grade: Grade = g === 'cheap' || g === 'posh' ? g : 'standard';
      const price = furniturePrice(def, grade);
      if (st.money < price) return true;
      if (typeof placeFurniture(st, def, Number(x), Number(s), flip === '1', grade) !== 'string') {
        book(sim, `Replaced the stolen ${furnitureDef(def).name.toLowerCase()}`, -price);
        if (from?.life) for (const t of household(sim, from.life.flat)) remember(sim, t.life!, 'landlordListened');
      }
      return true;
    }
  }
  return false;
}

export function fitLocks(sim: Sim): boolean {
  if (sim.state.security.locks || !spend(sim, 'New locks on the street door and windows', LOCKS_PRICE)) return false;
  sim.state.security.locks = true;
  return true;
}

export function fitAlarm(sim: Sim): boolean {
  if (sim.state.security.alarm || !spend(sim, 'Burglar alarm fitted', ALARM_PRICE)) return false;
  sim.state.security.alarm = true;
  return true;
}
