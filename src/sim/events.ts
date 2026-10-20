// What happens. A storyteller deals out happenings, the way RimWorld's does: it runs busy and
// quiet in turns, never has more than a couple going at once, won't do the same sort of
// thing twice running (each happening's tags cool down), and goes easier when you're
// struggling and harder when you're flush. The first week is quiet, to get to know people.
// It also has a budget, as RimWorld's does: the more the building's worth and brings in, the
// bigger what it deals out (more guests, greedier burglars, stiffer fines, a bit more often).
//
// Some happenings come from the tenants rather than the storyteller (a party on a Friday, a
// row that turns into a fight), but they still ask it first, so they count towards the cap.

import { post, poster, recently, tenants, whoIs } from './chat';
import { POUND, book, letter } from './economy';
import { SHARED, noiseReaching } from './environment';
import { household } from './leases';
import { furnitureDef } from './defs';
import { furnitureValue } from './grades';
import { addPawn, setGoal } from './pawns';
import { pick, randInt, random } from './rng';
import type { Sim } from './sim';
import { chemistry, opinion, rememberAbout } from './social';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, seconds, type Happening, type Pawn } from './state';
import { remember } from './thoughts';
import { has } from './traits';
import { burglaryRisk, startBurglary } from './crime';
import { bookInspection, breakDown, worn } from './upkeep';
import { tale } from './tales';
import { noticeTrait } from './outcomes';
import { quietFor } from './handover';
import { AFFAIR, BURGLARY, CAP, COOLDOWN, COOLDOWN_OTHER, FIGHT, FIRST_DAY, PARTY, POINTS, STORY } from './tuning';
import { readFlags } from './flags';

// How often things happen, and how big, is in tuning.ts.
export { CAP, FIRST_DAY } from './tuning';

const hourOf = (sim: Sim) => Math.floor(sim.minuteOfDay / 60);
const weekday = (sim: Sim) => (sim.day - 1) % 7;
const first = (p: Pawn) => p.name.split(' ')[0];

// ------------------------------------------------------------------ the storyteller

/** Could a happening with these tags start now? */
export function canStart(sim: Sim, tags: string[]): boolean {
  const st = sim.state;
  if (quietFor(sim, FIRST_DAY)) return false;
  if (st.story.running.length >= CAP) return false;
  return tags.every((t) => (st.story.cooldowns[t] ?? 0) <= st.tick);
}

function coolDown(sim: Sim, tags: string[]): void {
  for (const t of tags) {
    // A tag like "party:flat-3" cools down by its own rule ("party:"), the plain one by "party".
    const days = (t.includes(':') ? COOLDOWN[`${t.split(':')[0]}:`] : COOLDOWN[t]) ?? COOLDOWN_OTHER;
    sim.state.story.cooldowns[t] = sim.state.tick + days * TICKS_PER_DAY;
  }
}

function begin(sim: Sim, kind: Happening['kind'], tags: string[], hours: number, pawns: Pawn[], flat?: string): Happening {
  const st = sim.state;
  const h: Happening = { id: st.nextId++, kind, until: st.tick + Math.round(hours * TICKS_PER_HOUR), pawns: pawns.map((p) => p.id), ...(flat ? { flat } : {}) };
  st.story.running.push(h);
  coolDown(sim, tags);
  return h;
}

function finish(sim: Sim, h: Happening): void {
  const st = sim.state;
  st.story.running = st.story.running.filter((x) => x !== h);
}

/** Behind on the mortgage, nearly broke or everyone fed up: go easy. */
export function struggling(sim: Sim): boolean {
  const st = sim.state;
  const ts = tenants(sim);
  const liking = ts.reduce((n, p) => n + p.life!.liking, 0) / Math.max(1, ts.length);
  return st.money < STORY.strugglingMoney || st.mortgage.missed > 0 || (ts.length > 0 && liking < STORY.strugglingLiking);
}

function flush(sim: Sim): boolean {
  return sim.state.money > STORY.flushMoney;
}

/** What the building's worth to the storyteller: its furniture, flats let, weekly rent roll and tenants. */
export function points(sim: Sim): number {
  const st = sim.state;
  const things = st.furniture.reduce((n, f) => n + furnitureValue(f), 0);
  const lets = Object.values(st.flats).filter((f) => f.lease);
  const roll = lets.reduce((n, f) => n + f.lease!.rent, 0) / POUND;
  return Math.round(things / POINTS.perFurniture + lets.length * POINTS.perLet + roll / POINTS.perRent + tenants(sim).length * POINTS.perTenant);
}

/** How hard it pushes: 1 for the building you started with, up to 2 for a big, full one. Never harder when you're struggling. */
export function threat(sim: Sim): number {
  if (struggling(sim)) return 1;
  return 1 + Math.max(0, Math.min(1, (points(sim) - POINTS.base) / (POINTS.base * 2)));
}

interface Option {
  tags: string[];
  /** Good for you (the storyteller deals more of these when you're struggling). */
  good?: boolean;
  weight: number;
  run(): boolean;
}

/** Once an hour: the mood turns, happenings run their course, and maybe something new starts. */
export function storyHour(sim: Sim): void {
  const st = sim.state;
  const story = st.story;
  if (st.tick >= story.until) {
    story.busy = !story.busy;
    story.until = st.tick + (story.busy ? randInt(st, ...STORY.busyHours) : randInt(st, ...STORY.quietHours)) * TICKS_PER_HOUR;
  }
  for (const h of [...story.running]) {
    if (h.kind === 'affair') affairHour(sim, h);
    if (h.kind === 'party') partyHour(sim, h);
  }
  if (quietFor(sim, FIRST_DAY)) return;
  // Parties: Friday and Saturday evenings, if someone's that way inclined.
  if (hourOf(sim) === 19 && (weekday(sim) === 4 || weekday(sim) === 5)) maybeParty(sim);
  const easy = struggling(sim);
  const push = threat(sim);
  let chance = (story.busy ? STORY.busyChance : STORY.quietChance) * (1 + STORY.threatChance * (push - 1));
  if (easy) chance *= STORY.strugglingChance;
  if (random(st) > chance) return;
  const options: Option[] = [];
  // A card's `risk` moves these weights for a few days, never starts anything itself (flags.ts).
  const W = readFlags(sim, 'story.weights', STORY.weights);
  const pair = affairPair(sim);
  if (pair) options.push({ tags: ['romance'], weight: W.romance, run: () => startAffair(sim, pair[0], pair[1]) });
  const hour = hourOf(sim);
  if (hour >= 1 && hour <= 3) options.push({ tags: ['crime'], weight: burglaryRisk(sim) * W.crime, run: () => startBurglary(sim) });
  options.push({ tags: ['council'], weight: W.council * push, run: () => surpriseInspection(sim) });
  if (worn(sim).length > 0) options.push({ tags: ['repair'], weight: W.repair, run: () => breakDown(sim) });
  options.push({ tags: ['money'], good: true, weight: W.grant, run: () => grant(sim) });
  const usable = options
    .filter((o) => canStart(sim, o.tags) && o.weight > 0)
    .map((o) => ({ ...o, weight: o.weight * (o.good ? (easy ? STORY.goodWhenStruggling : 1) : easy ? STORY.badWhenStruggling : flush(sim) ? STORY.badWhenFlush : 1) }));
  const total = usable.reduce((n, o) => n + o.weight, 0);
  if (total <= 0) return;
  let r = random(st) * total;
  const o = usable.find((x) => (r -= x.weight) < 0) ?? usable[0];
  if (o.run()) coolDown(sim, o.tags);
}

/** Once a minute: happenings that need watching closely. */
export function eventsMinute(sim: Sim): void {
  const st = sim.state;
  for (const h of [...st.story.running]) {
    if (h.kind === 'party') partyMinute(sim, h);
    else if (h.kind === 'affair') affairMinute(sim, h);
    else if (h.kind === 'fight' && st.tick >= h.until) finish(sim, h);
  }
}

/** Noise from happenings: a party's host, and a burglar alarm going off. */
export function happeningNoise(sim: Sim, made: Map<string, number>): void {
  for (const h of sim.state.story.running) {
    if (h.kind === 'party' && h.flat) made.set(h.flat, (made.get(h.flat) ?? 0) + MUSIC[h.phase ?? 'swing'] * (h.volume ?? 1));
    if (h.kind === 'burglary' && h.flag === 'alarm' && sim.state.tick < h.until) made.set(SHARED, (made.get(SHARED) ?? 0) + BURGLARY.alarmNoise);
  }
}

export function running(sim: Sim, kind: Happening['kind'], flat?: string): Happening | undefined {
  return sim.state.story.running.find((h) => h.kind === kind && (flat === undefined || h.flat === flat));
}

export { begin as beginHappening, finish as finishHappening };

// ------------------------------------------------------------------ parties

function maybeParty(sim: Sim): void {
  const st = sim.state;
  for (const f of sim.layout.flats) {
    const people = household(sim, f.id).filter((p) => !p.life!.leaving);
    if (people.length === 0) continue;
    const animal = people.some((p) => has(p.life!, 'partyAnimal'));
    const chance = readFlags(sim, 'story.party', animal ? (st.story.busy ? PARTY.animalBusy : PARTY.animalQuiet) : people.length > 1 ? PARTY.household : PARTY.alone, { flat: f.id });
    if (random(st) > chance || !canStart(sim, ['party', `party:${f.id}`])) continue;
    startParty(sim, f.id);
    return;
  }
}

/** A party: guests turn up through the evening and go home in the small hours. */
export function startParty(sim: Sim, flatId: string): Happening | null {
  const st = sim.state;
  const people = household(sim, flatId);
  if (people.length === 0 || running(sim, 'party', flatId)) return null;
  const dayStart = Math.floor(st.tick / TICKS_PER_DAY) * TICKS_PER_DAY;
  // Over at half one, give or take.
  const ends = dayStart + TICKS_PER_DAY + randInt(st, 60, 150) * TICKS_PER_MINUTE;
  const h = begin(sim, 'party', ['party', `party:${flatId}`], (ends - st.tick) / TICKS_PER_HOUR, [], flatId);
  // A bigger, busier building, a bigger party.
  h.queue = randInt(st, ...PARTY.guests) + Math.round((threat(sim) - 1) * PARTY.guestsPerThreat);
  h.next = st.tick + randInt(st, 45, 80) * TICKS_PER_MINUTE;
  h.phase = 'arriving';
  const host = people.find((p) => has(p.life!, 'partyAnimal')) ?? people[0];
  h.host = host.id;
  host.partyAt = flatId;
  delete host.act;
  // Neighbours who like the host are asked along.
  h.invited = tenants(sim)
    .filter((n) => n.life!.flat !== flatId && !n.life!.away && !n.life!.leaving && !n.partyAt)
    .map((n) => ({ n, op: opinion(sim, n, host) + (has(n.life!, 'friendly') || has(n.life!, 'partyAnimal') ? PARTY.inviteFriendly : 0) }))
    .filter((c) => c.op >= PARTY.inviteOpinion && random(st) < PARTY.invite)
    .sort((x, y) => y.op - x.op)
    .slice(0, PARTY.mostInvited)
    .map((c) => c.n.id);
  if (has(host.life!, 'partyAnimal')) noticeTrait(sim, host, 'partyAnimal');
  if (random(st) < 0.6) post(sim, host, pick(st, ['Few people round tonight, sorry in advance if it gets loud x', 'Having some friends over later! Come up if you like 🎉', 'Bit of a do at ours tonight. Won\'t be late. (It will be late.)']));
  const name = sim.layout.flat(flatId)?.name ?? 'a flat';
  sim.notify(`${first(host)} is having a party in ${name} tonight.`);
  tale(sim, 'party', [host], { flat: flatId });
  return h;
}

type Phase = NonNullable<Happening['phase']>;

/** Where a party is in its evening: people arriving, full swing, winding down, seeing people off. */
function phaseOf(sim: Sim, h: Happening): Phase {
  const left = h.until - sim.state.tick;
  if (left <= 25 * TICKS_PER_MINUTE) return 'leaving';
  if (left <= 60 * TICKS_PER_MINUTE) return 'winding';
  return (h.queue ?? 0) > 0 ? 'arriving' : 'swing';
}

/** The music's own noise in each phase, before the volume knob. */
const MUSIC: Record<Phase, number> = PARTY.music;

const byId = (sim: Sim, id: number | undefined) => (id === undefined ? undefined : sim.state.pawns.find((p) => p.id === id));

/** The inside and outside of a flat's front door, and the shared landing round it. */
function doorSpots(sim: Sim, flatId: string): { inside?: [number, number]; landing: [number, number][] } {
  const lay = sim.layout;
  const flat = lay.flat(flatId);
  if (!flat) return { landing: [] };
  const [dx, ds] = flat.doors[0].split(',').map(Number);
  const near = [dx - 1, dx + 1].map((x) => lay.node(x, ds)).filter((n) => lay.roomOf[n] !== -1);
  const inside = near.find((n) => lay.rooms[lay.roomOf[n]].flat === flat.id);
  const landing = lay.rooms
    .filter((r) => r.shared)
    .flatMap((r) => r.nodes)
    .map((n) => lay.xs(n))
    .filter(([x, s]) => s === ds && Math.abs(x - dx) <= 3 && !lay.isDoorNode(lay.node(x, s)));
  return { inside: inside === undefined ? undefined : lay.xs(inside), landing };
}

/** Once a minute: the evening moves on, people arrive, neighbours come and knock. */
function partyMinute(sim: Sim, h: Happening): void {
  const st = sim.state;
  if (st.tick >= h.until || household(sim, h.flat!).length === 0) {
    endParty(sim, h, false);
    return;
  }
  const host = byId(sim, h.host);
  const phase = phaseOf(sim, h);
  if (phase !== h.phase) {
    h.phase = phase;
    if (phase === 'winding' && (h.volume ?? 1) > 1) {
      h.volume = 1;
      if (host) host.bubble = { text: 'Shh', until: st.tick + seconds(4) };
    }
    if (phase === 'leaving') {
      h.queue = 0;
      sendHome(sim, h);
    }
  }
  if ((h.queue ?? 0) > 0 && st.tick >= (h.next ?? 0)) {
    const g = addPawn(sim, 'guest');
    g.flat = h.flat!;
    g.task = 'go';
    g.doing = 'Off to a party';
    h.pawns.push(g.id);
    h.queue = (h.queue ?? 1) - 1;
    h.next = st.tick + randInt(st, 10, 35) * TICKS_PER_MINUTE;
    // The host drops what they're doing to say hello.
    h.greet = (h.greet ?? 0) + 1;
    if (host?.partyAt && host.path.length === 0) host.waitUntil = Math.min(host.waitUntil, st.tick);
  }
  if (phase !== 'leaving') invitedJoin(sim, h, host);
  knockAnswered(sim, h, host);
}

/** The neighbours who were asked wander over when they're free. */
function invitedJoin(sim: Sim, h: Happening, host: Pawn | undefined): void {
  const st = sim.state;
  if (!host) return;
  const hour = hourOf(sim);
  for (const id of h.invited ?? []) {
    const n = byId(sim, id);
    if (!n?.life || h.joined?.includes(id) || n.life.away || n.life.leaving || n.life.using || n.life.breakState || n.pose === 'sleep' || n.task === 'leave') continue;
    if (!(hour >= 19 || hour < 2) || random(st) > PARTY.join) continue;
    n.partyAt = h.flat!;
    delete n.act;
    n.path = [];
    n.goal = null;
    n.waitUntil = 0;
    n.doing = `Off to ${first(host)}'s party`;
    (h.joined ??= []).push(id);
    rememberAbout(sim, n, 'goodNight', host);
    rememberAbout(sim, host, 'chat', n);
    remember(sim, n.life, 'goodParty');
    sim.notify(`${first(n)} has gone up to ${first(host)}'s party.`);
  }
}

/** The one thing everyone at a party is doing: where they go next, and then what they do there. */
export function guestThink(sim: Sim, p: Pawn): boolean {
  const lay = sim.layout;
  const id = p.partyAt ?? p.flat;
  const h = running(sim, 'party', id ?? undefined);
  const flat = lay.flat(id);
  if (!h || !flat || p.act === 'home' || (!p.life && p.task === 'leave')) {
    delete p.pose;
    if (p.life) {
      // The party's key stays with them until they're out of the flat.
      const inside = flat && lay.flatAt(Math.round(p.x), Math.round(p.s))?.id === flat.id;
      if (!inside) {
        delete p.partyAt;
        delete p.act;
      }
      return false;
    }
    delete p.act;
    p.task = 'leave';
    p.doing = 'Going home';
    return false;
  }
  if (!p.life) p.task = 'look';
  if (p.act) {
    perform(sim, p, h);
    return true;
  }
  delete p.pose;
  const act = pickAct(sim, p, h);
  const spot = spotFor(sim, flat.id, act);
  const inFlat = lay.flatAt(Math.round(p.x), Math.round(p.s))?.id === flat.id;
  if (!spot || !setGoal(sim, p, spot)) {
    // No way there: if they're in, they stand about; if they're not, they give up and go home.
    if (!inFlat && !p.life) {
      p.task = 'leave';
      return false;
    }
    p.act = 'mingle';
    perform(sim, p, h);
    return true;
  }
  p.act = act;
  p.doing = !inFlat && !p.life ? 'Off to the party' : act === 'landing' || act === 'smoke' ? 'Popping out' : p.life ? 'Mingling at the party' : 'Off to the party';
  if (p.path.length === 0) perform(sim, p, h);
  return true;
}

/** What to do next: dance, talk, spill onto the landing, nip out for a smoke. */
function pickAct(sim: Sim, p: Pawn, h: Happening): string {
  const st = sim.state;
  if (p.id === h.host) {
    if ((h.greet ?? 0) > 0) {
      h.greet = (h.greet ?? 1) - 1;
      return 'greet';
    }
    if (h.phase === 'leaving') return 'seeOff';
    return random(st) < 0.35 ? 'dance' : 'mingle';
  }
  const phase = h.phase ?? 'swing';
  // One guest is always the smoker: the first who came from outside (an invited neighbour isn't).
  const smoker = h.pawns.find((id) => st.pawns.some((o) => o.id === id && !o.life));
  if (!p.life && p.id === smoker && phase !== 'arriving' && random(st) < 0.45) return 'smoke';
  const r = random(st);
  const dance = phase === 'swing' ? 0.45 : phase === 'arriving' ? 0.2 : 0.12;
  const out = phase === 'swing' ? 0.2 : 0.12;
  return r < dance ? 'dance' : r < dance + out ? 'landing' : 'mingle';
}

/** Where to be for it: inside the flat, on the landing outside the door, or on the pavement. */
function spotFor(sim: Sim, flatId: string, act: string): [number, number] | null {
  const st = sim.state;
  const lay = sim.layout;
  const flat = lay.flat(flatId)!;
  if (act === 'smoke') {
    const x = st.plot.x0 > 0 ? st.plot.x0 - 1 : st.plot.x1 + 1;
    return x < st.w ? [x, 0] : null;
  }
  const spots = doorSpots(sim, flatId);
  if (act === 'greet' || act === 'seeOff') return spots.inside ?? null;
  if (act === 'landing') return spots.landing.length > 0 ? pick(st, spots.landing) : null;
  const nodes = flat.rooms.flatMap((r) => lay.rooms[r].nodes).filter((n) => !lay.isDoorNode(n));
  return nodes.length > 0 ? lay.xs(pick(st, nodes)) : null;
}

/** Got there: do it for a while. */
function perform(sim: Sim, p: Pawn, h: Happening): void {
  const st = sim.state;
  const act = p.act ?? 'mingle';
  delete p.act;
  const host = p.id === h.host;
  // What you watch at a party is timed in real seconds, so it reads the same whatever the clock does.
  const wait = seconds(randInt(st, 7, 18));
  p.waitUntil = st.tick + wait;
  const say = (text: string, ticks = wait) => (p.bubble = { text, until: st.tick + ticks });
  switch (act) {
    case 'dance':
      p.pose = 'dance';
      p.doing = 'Dancing at the party';
      say('♪', seconds(5));
      return;
    case 'landing':
      p.doing = 'Out on the landing';
      say(pick(st, ['ha ha', '…']), seconds(5));
      return;
    case 'smoke':
      p.doing = 'Having a smoke out the front';
      say('~', seconds(5));
      return;
    case 'greet':
      p.waitUntil = st.tick + seconds(3);
      p.doing = 'Greeting guests';
      say('Hiya!', seconds(3));
      return;
    case 'seeOff':
      p.waitUntil = st.tick + seconds(4);
      p.doing = 'Seeing people off';
      say('Bye!', seconds(4));
      return;
    default:
      p.doing = h.phase === 'winding' || h.phase === 'leaving' ? 'Winding down at the party' : host ? 'Hosting the party' : 'Mingling at the party';
      if (random(st) < 0.4) say(pick(st, ['haha', '…', 'cheers', '!?']), seconds(4));
  }
}

/** Everyone not yet on their way out goes, one after another. */
function sendHome(sim: Sim, h: Happening): void {
  const st = sim.state;
  let i = 0;
  for (const id of [...h.pawns, ...(h.joined ?? [])]) {
    const g = byId(sim, id);
    if (!g || (!g.life && g.task === 'leave') || (g.life && (!g.partyAt || g.act === 'home'))) continue;
    delete g.pose;
    if (g.life) {
      g.act = 'home';
      g.life.needs.fun = 1;
    } else {
      delete g.act;
      g.task = 'leave';
    }
    g.doing = g.life ? 'Heading home' : 'Getting their coat';
    g.waitUntil = st.tick + seconds(i++ * 1.5);
    if (i < 4) g.bubble = { text: 'Night!', until: st.tick + seconds(3) };
  }
}

/** Neighbours' words: music up, and then the knock at the door. */
function partyHour(sim: Sim, h: Happening): void {
  const st = sim.state;
  const hour = hourOf(sim);
  if (h.phase === 'swing' && h.volume === undefined && hour >= 21 && hour <= 23 && random(st) < PARTY.louder) {
    h.volume = 2;
    const host = byId(sim, h.host);
    if (host) host.bubble = { text: '♪♪', until: st.tick + seconds(5) };
  }
  if (h.flag || !(hour >= 23 || hour < 3)) return;
  const made = sim.noise();
  const bothered = tenants(sim).filter((p) => p.life!.flat !== h.flat && !p.life!.away && noiseReaching(sim, made, p.life!.flat).amount >= 1);
  if (bothered.length === 0) return;
  // Some knock on the door; the rest take it to the chat. Only someone up can knock: anyone in
  // bed posts from under the duvet. Someone up but busy (cooking, on the sofa) puts it down and goes.
  const up = bothered.filter((p) => p.pose !== 'sleep' && !p.partyAt && !p.life!.breakState && !p.life!.outing && p.task !== 'leave');
  const landing = doorSpots(sim, h.flat!).landing;
  if (up.length > 0 && landing.length > 0 && random(st) < PARTY.knock) {
    const who = poster(sim, up)!;
    const was = who.life!.using;
    who.life!.using = null;
    if (setGoal(sim, who, landing[0])) {
      delete who.pose;
      h.flag = 'knocking';
      h.knock = who.id;
      who.waitUntil = st.tick;
      who.doing = `Going to knock on ${sim.layout.flat(h.flat!)?.name ?? 'next door'}`;
      return;
    }
    who.life!.using = was;
  }
  complain(sim, h, poster(sim, bothered)!);
}

/** True while a neighbour is on their way to knock about a party, or waiting at the door: tenantThink leaves them to it. */
export function onKnock(sim: Sim, p: Pawn): boolean {
  return sim.state.story.running.some((h) => h.kind === 'party' && h.knock === p.id && sim.state.tick < h.until);
}

/** The neighbour's at the door (or couldn't get there): the host turns it down, or doesn't. */
function knockAnswered(sim: Sim, h: Happening, host: Pawn | undefined): void {
  if (h.knock === undefined) return;
  const st = sim.state;
  const n = byId(sim, h.knock);
  if (!n?.life || n.life.away || !host) {
    delete h.knock;
    h.flag = 'complained';
    return;
  }
  // Something else took over on the way (a break of their own, a trip out, a sit down): they put it in the chat instead.
  if (n.life.breakState || n.life.using || n.life.outing || n.task === 'leave' || n.pose === 'sleep') {
    delete h.knock;
    h.flag = 'complained';
    complain(sim, h, n);
    return;
  }
  const going = `Going to knock on ${sim.layout.flat(h.flat!)?.name ?? 'next door'}`;
  if (n.path.length > 0) {
    // A word with someone on the stairs doesn't make them forget what they were going up for.
    if (n.talkUntil === undefined) n.doing = going;
    return;
  }
  delete h.knock;
  h.flag = 'complained';
  const lay = sim.layout;
  const [dx, ds] = lay.flat(h.flat!)!.doors[0].split(',').map(Number);
  if (Math.round(n.s) !== ds || Math.abs(n.x - dx) > 4) {
    complain(sim, h, n);
    return;
  }
  const name = lay.flat(h.flat!)?.name ?? 'next door';
  n.talkUntil = st.tick + seconds(3);
  n.bubble = { text: '!', until: n.talkUntil };
  n.doing = `Knocking on ${name} about the noise`;
  n.facing = dx >= n.x ? 1 : -1;
  const calm = has(host.life!, 'partyAnimal') ? PARTY.calmPartyAnimal : PARTY.calm;
  if (random(st) < calm) {
    h.volume = 0.5;
    host.bubble = { text: 'Sorry!', until: st.tick + seconds(4) };
    sim.notify(`${first(n)} knocked on ${name} about the noise. The music went down.`);
  } else {
    host.bubble = { text: '♪♪', until: st.tick + seconds(4) };
    rememberAbout(sim, n, 'slight', host);
    complain(sim, h, n);
  }
}

function complain(sim: Sim, h: Happening, who: Pawn): void {
  const hour = hourOf(sim);
  const name = sim.layout.flat(h.flat!)?.name ?? 'next door';
  h.flag = 'complained';
  post(sim, who, `Is there a PARTY in ${name}?? It's ${hour < 10 ? `${hour}am` : 'gone eleven'}`, [
    { label: `Tell ${name} to wrap it up`, note: '', act: `endParty:${h.flat}` },
    { label: 'Let them have their night', note: '', act: 'notMine' },
  ]);
}

/** Over: the guests go home, and there's the mess (and sometimes something broken). */
export function endParty(sim: Sim, h: Happening, early: boolean): void {
  const st = sim.state;
  finish(sim, h);
  sendHome(sim, h);
  const host = byId(sim, h.host);
  if (host) {
    delete host.partyAt;
    delete host.act;
    delete host.pose;
    host.waitUntil = 0;
  }
  if (h.knock !== undefined) delete h.knock;
  const flatId = h.flat!;
  const people = household(sim, flatId);
  for (const p of people) {
    remember(sim, p.life!, early ? 'partyShutDown' : 'threwParty');
    p.life!.needs.fun = 1;
  }
  st.dirt[flatId] = Math.min(1, (st.dirt[flatId] ?? 0) + PARTY.mess);
  st.dirt[SHARED] = Math.min(1, (st.dirt[SHARED] ?? 0) + PARTY.stairsMess);
  const name = sim.layout.flat(flatId)?.name ?? 'the flat';
  const clumsy = people.some((p) => has(p.life!, 'clumsy'));
  if (random(st) < (clumsy ? PARTY.damageClumsy : PARTY.damage)) {
    const lay = sim.layout;
    const flat = lay.flat(flatId);
    const cells = new Set(flat ? lay.flatCells(flat) : []);
    const things = st.furniture.filter((f) => !f.broken && cells.has(lay.node(f.x, f.s)) && f.def !== 'radiator');
    if (things.length > 0) {
      const f = pick(st, things);
      f.wear = 1;
      f.broken = sim.day;
      sim.notify(`Something got broken at the party in ${name}.`);
      tale(sim, 'partyDamage', people.slice(0, 1), { flat: flatId, what: furnitureDef(f.def).name.toLowerCase() });
    }
  }
  if (early) {
    sim.notify(`The party in ${name} is over. ${people.length === 1 ? `${first(people[0])} is` : 'They\'re'} sulking.`);
    tale(sim, 'partyShutDown', people.slice(0, 1), { flat: flatId });
  }
}

// ------------------------------------------------------------------ fights

/** A row between two people who already can't stand each other might turn into a fight. */
export function maybeFight(sim: Sim, a: Pawn, b: Pawn): boolean {
  const st = sim.state;
  const rows = a.life!.social.filter((m) => m.about === b.id && m.id === 'row').length;
  const bad = Math.min(opinion(sim, a, b), opinion(sim, b, a));
  if (rows < FIGHT.rows && bad > FIGHT.hate) return false;
  if (random(st) > readFlags(sim, 'story.fight', FIGHT.chance, { pawn: a, other: b }) || !canStart(sim, ['fight'])) return false;
  startFight(sim, a, b);
  return true;
}

export function startFight(sim: Sim, a: Pawn, b: Pawn): void {
  const st = sim.state;
  // A fight is something you watch: about twenty real seconds, whatever the clock does.
  const h = begin(sim, 'fight', ['fight'], seconds(18) / TICKS_PER_HOUR, [a, b]);
  rememberAbout(sim, a, 'fight', b);
  rememberAbout(sim, b, 'fight', a);
  remember(sim, a.life!, 'cantStand');
  remember(sim, b.life!, 'cantStand');
  for (const [p, q] of [[a, b], [b, a]]) {
    p.talkUntil = st.tick + seconds(14);
    p.bubble = { text: '!!', until: p.talkUntil };
    p.doing = `Fighting with ${first(q)}`;
  }
  const seen = tenants(sim).filter((w) => w !== a && w !== b && !w.life!.away && Math.abs(w.s - a.s) < 0.1 && Math.abs(w.x - a.x) <= 8);
  for (const w of seen) remember(sim, w.life!, 'sawFight');
  const filmer = bystanders(sim, h, a, b, seen);
  const witness = filmer ?? seen[0] ?? poster(sim, tenants(sim).filter((p) => p !== a && p !== b));
  if (witness) post(sim, witness, filmer ? pick(st, [`Got the whole thing on video. Not posting it. (Posting it.) ${first(a)} v ${first(b)}`, `Filmed it, obviously. ${first(a)} and ${first(b)}. On the stairs.`]) : `There is an actual FIGHT on the stairs. ${first(a)} and ${first(b)}. Someone do something`);
  sim.notify(`${first(a)} and ${first(b)} are fighting.`);
  tale(sim, 'fight', [a, b]);
  if (random(st) < FIGHT.police) {
    letter(sim, {
      from: 'Harrowgate Police',
      title: 'Disturbance at Albert Terrace',
      body: `Officers attended your building following reports of a disturbance between two residents. No further action. We would gently point out that this is the third building on your street this month.`,
    });
  }
}

/**
 * Whoever's out on the stairs reacts: one might step in (and take a hit for it), the nosy
 * film it, the sensible go and shut their door. A shove can break something on the landing.
 * Returns the one filming, if anyone is.
 */
function bystanders(sim: Sim, h: Happening, a: Pawn, b: Pawn, seen: Pawn[]): Pawn | null {
  const st = sim.state;
  const lay = sim.layout;
  // Someone mid-tantrum has their own problems.
  const outAndAbout = (w: Pawn) => !w.life!.using && !w.life!.breakState && w.pose !== 'sleep' && w.life!.flat !== undefined && lay.rooms[lay.roomOf[lay.node(Math.round(w.x), Math.round(w.s))]]?.shared === true;
  let stoppedIt = false;
  let filmer: Pawn | null = null;
  for (const w of seen) {
    if (!outAndAbout(w)) continue;
    const life = w.life!;
    const fond = Math.max(opinion(sim, w, a), opinion(sim, w, b));
    const stepIn = (fond >= FIGHT.fondOpinion ? FIGHT.stepInFond : FIGHT.stepIn) + (has(life, 'friendly') ? FIGHT.stepInFriendly : 0) + (has(life, 'handy') ? FIGHT.stepInHandy : 0);
    if (!stoppedIt && random(st) < stepIn && setGoal(sim, w, [Math.round(a.x), Math.round(a.s)])) {
      stoppedIt = true;
      const side = opinion(sim, w, b) > opinion(sim, w, a) ? b : a;
      rememberAbout(sim, side, 'favour', w);
      remember(sim, life, 'brokeItUp');
      w.doing = `Breaking up ${first(a)} and ${first(b)}`;
      w.bubble = { text: 'Oi!', until: st.tick + seconds(3) };
      w.waitUntil = st.tick + seconds(3);
      // It stops soon after they get there.
      h.until = st.tick + seconds(2);
      for (const p of [a, b]) {
        p.talkUntil = h.until;
        p.bubble = { text: '…', until: h.until };
      }
      sim.notify(`${first(w)} stepped in and broke up the fight. ${first(side)} owes them one.`);
    } else if (has(life, 'busybody') ? random(st) < FIGHT.filmBusybody : random(st) < FIGHT.film) {
      filmer ??= w;
      w.doing = 'Filming the fight';
      w.bubble = { text: '● REC', until: h.until };
      w.talkUntil = h.until;
    } else if (random(st) < FIGHT.hide) {
      const flat = lay.flat(life.flat);
      const nodes = flat ? flat.rooms.flatMap((r) => lay.rooms[r].nodes).filter((n) => !lay.isDoorNode(n)) : [];
      if (nodes.length > 0 && setGoal(sim, w, lay.xs(pick(st, nodes)))) {
        w.doing = 'Hiding in their flat';
        w.bubble = { text: '!?', until: st.tick + seconds(3) };
        w.waitUntil = st.tick + seconds(7);
      }
    }
  }
  // A shove into the furniture.
  if (outAndAbout(a) && random(st) < FIGHT.shove) {
    const shared = new Set(lay.rooms.filter((r) => r.shared).flatMap((r) => r.cells));
    const things = st.furniture.filter((f) => !f.broken && f.def !== 'radiator' && f.s === Math.round(a.s) && Math.abs(f.x - a.x) <= 6 && shared.has(lay.node(f.x, f.s)));
    if (things.length > 0) {
      const f = pick(st, things);
      f.wear = 1;
      f.broken = sim.day;
      sim.notify(`The ${furnitureDef(f.def).name.toLowerCase()} got knocked over in the scuffle.`);
    }
  }
  return filmer;
}

// ------------------------------------------------------------------ affairs

/** Someone attached, and someone else they get on with rather too well. */
function affairPair(sim: Sim): [Pawn, Pawn] | null {
  const ts = tenants(sim);
  for (const a of ts) {
    const la = a.life!;
    if (la.partner === undefined || la.affair !== undefined) continue;
    for (const b of ts) {
      if (b === a || b.id === la.partner || b.life!.affair !== undefined || b.life!.flat === la.flat) continue;
      if (chemistry(sim, a.id, b.id) > AFFAIR.chemistry && opinion(sim, a, b) >= AFFAIR.opinion && opinion(sim, b, a) >= AFFAIR.opinionBack) return [a, b];
    }
  }
  return null;
}

export function startAffair(sim: Sim, a: Pawn, b: Pawn): boolean {
  const st = sim.state;
  const partner = st.pawns.find((p) => p.id === a.life!.partner);
  if (!partner?.life) return false;
  a.life!.affair = b.id;
  b.life!.affair = a.id;
  begin(sim, 'affair', ['romance'], randInt(st, ...AFFAIR.days) * 24, [a, b, partner]);
  rememberAbout(sim, a, 'flirt', b);
  rememberAbout(sim, b, 'flirt', a);
  return true;
}

function affairPeople(sim: Sim, h: Happening): [Pawn, Pawn, Pawn] | null {
  const [a, b, c] = h.pawns.map((id) => sim.state.pawns.find((p) => p.id === id));
  if (!a?.life || !b?.life || !c?.life || a.life.leaving || b.life.leaving) return null;
  return [a, b, c];
}

function endAffair(sim: Sim, h: Happening): void {
  finish(sim, h);
  for (const id of h.pawns.slice(0, 2)) {
    const p = sim.state.pawns.find((x) => x.id === id);
    if (p?.life) delete p.life.affair;
  }
}

/** Evenings: they find an excuse to meet on the landing outside the other one's flat. */
function affairHour(sim: Sim, h: Happening): void {
  const st = sim.state;
  const people = affairPeople(sim, h);
  if (!people || st.tick >= h.until) {
    endAffair(sim, h);
    return;
  }
  const [a, b] = people;
  const hour = hourOf(sim);
  if (hour < 19 || hour > 22 || random(st) > AFFAIR.meet) return;
  if ([a, b].some((p) => p.life!.away || p.pose === 'sleep' || p.life!.using)) return;
  const lay = sim.layout;
  const flat = lay.flat(b.life!.flat);
  if (!flat) return;
  const door = flat.doors[0].split(',').map(Number);
  const spots = [door[0] - 1, door[0] + 1].map((x) => lay.node(x, door[1])).filter((n) => lay.roomOf[n] !== -1 && lay.rooms[lay.roomOf[n]].shared);
  if (spots.length === 0) return;
  const [x, s] = lay.xs(spots[0]);
  for (const [p, q] of [[a, b], [b, a]]) {
    if (!setGoal(sim, p, [x, s])) return;
    p.doing = `Whispering with ${first(q)} on the landing`;
    p.waitUntil = st.tick + randInt(st, 25, 45) * TICKS_PER_MINUTE;
  }
  const busy = tenants(sim).find((p) => p !== a && p !== b && has(p.life!, 'busybody'));
  if (busy && random(st) < 0.3 && !recently(sim, 'Not to gossip', 3)) post(sim, busy, `Not to gossip but ${first(a)} and ${first(b)} are on the landing AGAIN 👀`);
}

/** Anyone who walks past while they're whispering on the landing might put two and two together. */
function affairMinute(sim: Sim, h: Happening): void {
  const st = sim.state;
  const people = affairPeople(sim, h);
  if (!people) return;
  const [a, b, partner] = people;
  if (!a.doing.startsWith('Whispering') || a.path.length > 0) return;
  const seen = tenants(sim).filter((w) => w !== a && w !== b && !w.life!.away && w.pose !== 'sleep' && Math.abs(w.s - a.s) < 0.1 && Math.abs(w.x - a.x) <= 4);
  for (const w of seen) {
    const odds = w === partner ? 1 : has(w.life!, 'busybody') ? AFFAIR.spotBusybody : AFFAIR.spot;
    if (random(st) < odds) {
      found(sim, h, w);
      return;
    }
  }
}

/** Found out: the partner's told (or sees for themselves), and it all comes out in the chat. */
export function found(sim: Sim, h: Happening, by: Pawn): void {
  const st = sim.state;
  const people = affairPeople(sim, h);
  endAffair(sim, h);
  if (!people) return;
  const [a, b, partner] = people;
  const pl = partner.life!;
  if (pl.partner === a.id) {
    delete pl.partner;
    delete a.life!.partner;
    pl.exes = [...(pl.exes ?? []), a.id];
    a.life!.exes = [...(a.life!.exes ?? []), partner.id];
  }
  rememberAbout(sim, partner, 'cheatedOn', a);
  rememberAbout(sim, partner, 'cheatedOn', b);
  remember(sim, pl, 'cheatedOn');
  for (const p of [a, b]) remember(sim, p.life!, 'caughtOut');
  if (by !== partner) post(sim, by, `I wasn't going to say anything but ${first(partner)} deserves to know. ${first(a)} and ${first(b)}. On the landing. Every night.`);
  post(sim, partner, pick(st, [`Thanks everyone. Really. ${whoIs(sim, a).split(' · ')[0]}, your stuff's on the landing.`, `So that's what "popping out for milk" means.`, `Great. Brilliant. Love that for me.`]));
  sim.notify(`${first(partner)} has found out about ${first(a)} and ${first(b)}.`);
  tale(sim, 'affair', [a, b, partner]);
  // Sometimes the two of them end up together after all.
  if (random(st) < AFFAIR.together) {
    a.life!.partner = b.id;
    b.life!.partner = a.id;
  }
}

// ------------------------------------------------------------------ small things

function surpriseInspection(sim: Sim): boolean {
  if (sim.state.council.visitDay !== undefined) return false;
  bookInspection(sim, STORY.inspectionDays, 'As part of our programme of routine inspections');
  return true;
}

function grant(sim: Sim): boolean {
  const st = sim.state;
  const amount = randInt(st, ...STORY.grantFifties) * 50 * POUND;
  book(sim, 'Warm Homes grant', amount);
  tale(sim, 'grant', [], { what: `£${amount / POUND}` });
  letter(sim, {
    from: 'Harrowgate City Council, Warm Homes Fund',
    title: 'Your grant',
    body: `Following your application (we have no record of an application, but the form was filled in), we are pleased to award you £${amount / POUND} towards keeping your tenants warm. We trust it will be spent on that.`,
  });
  return true;
}

/** For the chat: tenants' answerable requests about happenings. */
export function happeningAct(sim: Sim, kind: string, arg: string, from: Pawn | undefined): boolean {
  switch (kind) {
    case 'endParty': {
      const h = running(sim, 'party', arg);
      if (h) endParty(sim, h, true);
      if (from?.life) remember(sim, from.life, 'landlordListened');
      for (const p of household(sim, arg)) remember(sim, p.life!, 'toldOff');
      return true;
    }
  }
  return false;
}
