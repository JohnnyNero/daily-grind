// Regulars: guests who come back. Each has a usual, a visit count, opinions of the
// staff, and possibly a grudge. Happy one-off guests sometimes become regulars;
// regulars greet the staff they like, and remember the ones who wronged them.

import { pick, random, randInt } from './rng';
import type { Sim } from './sim';
import type { Pawn, Regular } from './state';
import { addMemory, hasTrait } from './thoughts';

const MAX_REGULARS = 20;
const BECOME_REGULAR_CHANCE = 0.07;
const MILESTONES = [10, 25, 50, 100] as const;
/** Milestones big enough for the hall of fame. */
const FAMOUS_MILESTONE = 25;
const SURNAME_INITIALS = 'ABCDEFGHJKLMNPRSTW';

function nextVisit(sim: Sim): number {
  return sim.day + randInt(sim.state, 1, 4);
}

/** Regulars need names you can tell apart: "Sam" becomes "Sam K." if there's already a Sam. */
function uniqueName(sim: Sim, name: string): string {
  const s = sim.state;
  const taken = new Set([...s.pawns.filter((p) => p.staff).map((p) => p.name), ...s.regulars.map((r) => r.name)]);
  if (!taken.has(name)) return name;
  for (let i = 0; i < 20; i++) {
    const candidate = `${name} ${pick(s, SURNAME_INITIALS.split(''))}.`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${name} ${r100(sim)}`;
}

function r100(sim: Sim): number {
  return randInt(sim.state, 2, 99);
}

/** Chance that a given arrival is a regular rather than a stranger. */
export function regularArrivalChance(sim: Sim): number {
  return Math.min(0.4, availableRegulars(sim).length * 0.03);
}

export function availableRegulars(sim: Sim): Regular[] {
  const s = sim.state;
  const here = new Set(s.pawns.map((p) => p.visit?.regularId).filter((id) => id !== null && id !== undefined));
  return s.regulars.filter((r) => !here.has(r.id) && r.lastVisitDay !== sim.day && sim.day >= r.nextVisitDay);
}

/** Dresses a freshly spawned guest as a regular and says hello. */
export function makeRegular(sim: Sim, g: Pawn, r: Regular): void {
  const v = g.visit!;
  g.name = r.name;
  g.look = { ...r.look };
  v.regularId = r.id;
  v.items = [sim.state.menu.find((m) => m.name === r.usual && m.enabled) ? r.usual : v.items[0]];
  v.eatIn = r.eatIn;
  r.lastVisitDay = sim.day;
  r.nextVisitDay = nextVisit(sim);
  greet(sim, g, r);
}

function staffOnSite(sim: Sim): Pawn[] {
  return sim.state.pawns.filter((p) => p.staff && p.onMap && !p.staff.quit);
}

function greet(sim: Sim, g: Pawn, r: Regular): void {
  const v = g.visit!;
  const onSite = staffOnSite(sim);
  if (r.grudge && onSite.some((p) => p.id === r.grudge!.staffId)) {
    v.patience *= 0.7;
    sim.log(`${r.name} is back. They haven't forgotten ${r.grudge.what} by ${r.grudge.staffName}.`, 'bad', g.id, 'grudge', 5);
    return;
  }
  const favourite = onSite.filter((p) => (r.likes[p.id] ?? 0) >= 15).sort((a, b) => (r.likes[b.id] ?? 0) - (r.likes[a.id] ?? 0))[0];
  if (favourite && random(sim.state) < 0.35) {
    sim.log(`${r.name} is in for their usual ${r.usual} and asking after ${favourite.name}.`, 'good', g.id, null, 0);
  }
}

/** After a regular collects their order. */
export function regularServed(sim: Sim, g: Pawn, satisfaction: number, server: Pawn | undefined): void {
  const r = sim.state.regulars.find((x) => x.id === g.visit?.regularId);
  if (!r) return;
  r.visits++;
  if (server) {
    r.likes[server.id] = Math.max(-50, Math.min(50, (r.likes[server.id] ?? 0) + (satisfaction - 0.6) * 20));
    if ((r.likes[server.id] ?? 0) >= 15) addMemory(sim, server, hasTrait(server, 'peoplePerson') ? 'favouriteRegularPP' : 'favouriteRegular');
  }
  if (r.grudge && server && satisfaction > 0.8 && server.id === r.grudge.staffId) {
    sim.log(`${r.name} and ${server.name} have made up. Over an excellent ${r.usual}.`, 'good', g.id, 'makeUp', 5);
    r.grudge = null;
  }
  if ((MILESTONES as readonly number[]).includes(r.visits)) {
    for (const p of staffOnSite(sim)) addMemory(sim, p, 'regularBiscuits');
    const text = `It's ${r.name}'s ${r.visits}th visit. They brought biscuits for the staff.`;
    if (r.visits >= FAMOUS_MILESTONE) sim.log(text, 'good', g.id, 'milestone', 6);
    else sim.log(text, 'good', g.id, 'regularVisits', 4);
  }
}

/** A happy stranger might decide this is their café now. */
export function maybeBecomeRegular(sim: Sim, g: Pawn, satisfaction: number, server: Pawn | undefined): void {
  const s = sim.state;
  const v = g.visit!;
  if (v.regularId !== null || v.critic || satisfaction < 0.8 || s.regulars.length >= MAX_REGULARS) return;
  if (random(s) >= BECOME_REGULAR_CHANCE) return;
  g.name = uniqueName(sim, g.name);
  const r: Regular = {
    id: s.nextId++,
    name: g.name,
    look: { ...g.look },
    usual: v.items[0],
    eatIn: v.eatIn,
    visits: 1,
    lastVisitDay: sim.day,
    nextVisitDay: nextVisit(sim),
    likes: server ? { [server.id]: 10 } : {},
    grudge: null,
  };
  s.regulars.push(r);
  v.regularId = r.id;
  sim.log(`${g.name} says they'll be back for another ${r.usual}. A new regular.`, 'good', g.id, 'newRegular', 3);
}

/** A regular was wronged: they walked out, or got told off. */
export function regularWronged(sim: Sim, g: Pawn, by: Pawn | undefined, what: string): void {
  const r = sim.state.regulars.find((x) => x.id === g.visit?.regularId);
  if (!r) return;
  if (by) {
    r.likes[by.id] = Math.max(-50, (r.likes[by.id] ?? 0) - 20);
    r.grudge = { staffId: by.id, staffName: by.name, what };
  }
  // Regulars give a café a few chances, but not endless ones.
  if (r.grudge && (r.likes[r.grudge.staffId] ?? 0) <= -40) {
    sim.state.regulars = sim.state.regulars.filter((x) => x !== r);
    sim.log(`${r.name} has found a new café. They won't be back.`, 'bad', null, 'lostRegular', 6);
  }
}

export function regularFor(sim: Sim, g: Pawn): Regular | undefined {
  return sim.state.regulars.find((x) => x.id === g.visit?.regularId);
}

/** Storyteller event: a regular's birthday visit. */
export function birthdayVisit(sim: Sim, spawn: () => Pawn): boolean {
  const options = availableRegulars(sim).filter((r) => r.visits >= 3);
  if (options.length === 0) return false;
  const r = pick(sim.state, options);
  const g = spawn();
  makeRegular(sim, g, r);
  g.visit!.patience = 1;
  for (const p of staffOnSite(sim)) addMemory(sim, p, 'birthdaySong');
  sim.log(`It's ${r.name}'s birthday. The staff sang. Badly. ${r.name} loved it.`, 'good', g.id, 'birthday', 5);
  return true;
}
