// Upkeep. Furniture wears out with use (faster with clumsy tenants) and breaks, and a broken
// thing does nothing until it's mended. Tenants ask in the chat; handy ones sometimes fix
// things themselves. And the council: inspections, improvement notices and fines, on what's
// really wrong with the building rather than a coin toss.

import { post } from './chat';
import { COUNCIL_FINE, COUNCIL_FINE_CAP, POUND, book, furniturePrice, letter, spend } from './economy';
import { SHARED, dirtOf, itemsIn, tempOf } from './environment';
import { furnitureDef } from './defs';
import { gradeOf, wearFactor } from './grades';
import { scoreFor } from './impressiveness';
import { household } from './leases';
import { pick, random } from './rng';
import type { Sim } from './sim';
import type { Furniture, Pawn } from './state';
import { remember } from './thoughts';
import { has } from './traits';
import { noticeTrait } from './outcomes';
import { threat } from './events';
import { tale } from './tales';
import { stat } from './stat';
import { COUNCIL, UPKEEP } from './tuning';

/** Wear from one go on something: about 250 goes from new to broken. */
export const WEAR_PER_USE = UPKEEP.wearPerUse;

/** Wear from a go on a piece of furniture. Clumsy people are harder on things; handy ones gentler. */
export function useUp(sim: Sim, f: Furniture, p: Pawn): void {
  if (f.broken) return;
  const life = p.life!;
  const rate = stat(WEAR_PER_USE, [], [has(life, 'clumsy') ? UPKEEP.clumsy : 1, has(life, 'handy') ? UPKEEP.handy : 1, wearFactor(f)]);
  f.wear = Math.min(1, (f.wear ?? 0) + rate);
  if (f.wear >= 1) {
    breakIt(sim, f);
    if (has(life, 'clumsy') && random(sim.state) < UPKEEP.clumsyNoticed) noticeTrait(sim, p, 'clumsy');
  }
}

export function breakIt(sim: Sim, f: Furniture): void {
  f.wear = 1;
  f.broken = sim.day;
  delete f.reported;
  // Anyone using it stops; it no longer counts towards the flat.
  for (const p of sim.state.pawns) if (p.life?.using?.furniture === f.id) p.life.using.until = sim.state.tick;
  sim.changed();
  const flat = sim.layout.flatAt(f.x, f.s);
  tale(sim, 'broken', flat ? household(sim, flat.id) : [], { flat: flat?.id, what: furnitureDef(f.def).name.toLowerCase() });
}

/** Pieces in lived-in flats that are close to going. */
export function worn(sim: Sim): Furniture[] {
  const lay = sim.layout;
  const lived = new Set<number>();
  for (const f of lay.flats) if (household(sim, f.id).length > 0) for (const c of lay.flatCells(f)) lived.add(c);
  return sim.state.furniture.filter((f) => !f.broken && (f.wear ?? 0) > UPKEEP.worn && lived.has(lay.node(f.x, f.s)) && furnitureDef(f.def).offers);
}

/** The storyteller: something gives up. The bathroom and kitchen first. */
export function breakDown(sim: Sim): boolean {
  const list = worn(sim);
  if (list.length === 0) return false;
  const wet = list.filter((f) => ['bathroom', 'kitchen'].includes(furnitureDef(f.def).group));
  breakIt(sim, pick(sim.state, wet.length > 0 ? wet : list));
  return true;
}

export function repairCost(f: Furniture): number {
  return Math.max(UPKEEP.repairLeast, Math.round((furniturePrice(f.def, gradeOf(f)) * UPKEEP.repairShare) / (5 * POUND)) * 5 * POUND);
}

export function condition(f: Furniture): string {
  if (f.broken) return 'Broken';
  const w = f.wear ?? 0;
  return w < 0.25 ? 'Like new' : w < 0.5 ? 'A bit worn' : w < 0.8 ? 'Worn' : 'On its last legs';
}

/** Gets someone out to mend it (or service it, if it's only worn). */
export function mend(sim: Sim, id: number): string | null {
  const f = sim.state.furniture.find((x) => x.id === id);
  if (!f) return 'Gone';
  const cost = repairCost(f);
  if (!spend(sim, `Repairs: ${furnitureDef(f.def).name.toLowerCase()}`, cost)) return `Not enough money (${'£'}${cost / POUND})`;
  const wasBroken = f.broken !== undefined;
  const asked = f.reported;
  f.wear = 0;
  delete f.broken;
  delete f.reported;
  if (wasBroken) sim.changed();
  if (asked) {
    const flat = sim.layout.flatAt(f.x, f.s);
    if (flat) for (const p of household(sim, flat.id)) remember(sim, p.life!, 'landlordListened');
  }
  return null;
}

/** Broken things in a flat. */
export function brokenIn(sim: Sim, flatId: string): Furniture[] {
  const lay = sim.layout;
  const flat = lay.flat(flatId);
  if (!flat) return [];
  const cells = new Set(lay.flatCells(flat));
  return sim.state.furniture.filter((f) => f.broken !== undefined && cells.has(lay.node(f.x, f.s)));
}

/** Once an hour: broken things get reported, and handy tenants have a go themselves. */
export function upkeepHour(sim: Sim): void {
  const st = sim.state;
  for (const flat of sim.layout.flats) {
    const people = household(sim, flat.id).filter((p) => !p.life!.away && p.pose !== 'sleep');
    if (people.length === 0) continue;
    for (const f of brokenIn(sim, flat.id)) {
      const handy = people.find((p) => has(p.life!, 'handy'));
      if (handy && random(st) < UPKEEP.handyFix) {
        f.wear = UPKEEP.handyFixWear;
        delete f.broken;
        delete f.reported;
        sim.changed();
        sim.notify(`${handy.name.split(' ')[0]} fixed the ${furnitureDef(f.def).name.toLowerCase()} in ${flat.name} themselves.`);
        noticeTrait(sim, handy, 'handy');
        continue;
      }
      if (f.reported || random(st) > UPKEEP.report) continue;
      f.reported = true;
      const name = furnitureDef(f.def).name.toLowerCase();
      post(sim, pick(st, people), pick(st, [`The ${name}'s packed in. Can you get someone out?`, `So the ${name} has died. Any chance of it being fixed this week?`, `Not to be a pain but the ${name} is broken. Properly broken.`]), [
        { label: `Get it mended (£${repairCost(f) / POUND})`, note: 'They\'ll be pleased', act: `mend:${f.id}` },
        { label: 'Have you tried giving it a kick?', note: 'It stays broken. They\'ll remember.', act: 'notMine' },
      ]);
    }
  }
}

// ------------------------------------------------------------------ the council

/** What an inspector would write down. */
export function issues(sim: Sim): string[] {
  const out: string[] = [];
  for (const f of sim.layout.flats) {
    const people = household(sim, f.id);
    if (people.length === 0) continue;
    const s = scoreFor(sim, f.id, people.length);
    if (!s.has.toilet) out.push(`${f.name} has no working toilet`);
    if (!s.has.wash) out.push(`${f.name} has nowhere working to wash`);
    if (!s.has.kitchen) out.push(`${f.name} has no working kitchen`);
    if (!f.enclosed) out.push(`${f.name} is open to the weather`);
    if (itemsIn(sim, f.id, 'smokeAlarm') === 0) out.push(`${f.name} has no smoke alarm`);
    if (tempOf(sim, f.id) < COUNCIL.tooCold) out.push(`${f.name} is too cold to live in (${Math.round(tempOf(sim, f.id))}°)`);
    if (s.perPerson < COUNCIL.overcrowded) out.push(`${f.name} is overcrowded`);
    const longBroken = brokenIn(sim, f.id).filter((b) => sim.day - (b.broken ?? sim.day) >= COUNCIL.brokenDays);
    if (longBroken.length > 0) out.push(`${f.name}: ${furnitureDef(longBroken[0].def).name.toLowerCase()} broken for over a week`);
  }
  if (dirtOf(sim, SHARED) > COUNCIL.filthy) out.push('The stairs and lobby are filthy');
  return out;
}

/** The council will come round in a few days. */
export function bookInspection(sim: Sim, inDays: number, why: string): void {
  const c = sim.state.council;
  if (c.visitDay !== undefined && c.visitDay <= sim.day + inDays) return;
  c.visitDay = sim.day + inDays;
  letter(sim, {
    from: 'Harrowgate City Council, Private Sector Housing',
    title: 'Notice of inspection',
    body: `${why}, an officer will inspect your building on day ${c.visitDay}. Please ensure access. The officer will look at the flats people live in, the stairs and the lobby.`,
  });
}

/** A fine, stiffer for a bigger landlord (they get less sympathy), to the nearest £10. */
function fineFor(sim: Sim, base: number): number {
  return Math.round((base * threat(sim)) / (10 * POUND)) * 10 * POUND;
}

/** Every morning: an inspection, if one's due. */
export function councilMorning(sim: Sim): void {
  const c = sim.state.council;
  if (c.visitDay === undefined || sim.day < c.visitDay) return;
  delete c.visitDay;
  const found = issues(sim);
  const from = 'Harrowgate City Council, Private Sector Housing';
  if (found.length === 0) {
    delete c.notice;
    letter(sim, { from, title: 'Inspection result', body: 'Our officer found nothing requiring action, and has asked us to note that the stairwell is "very brown".' });
    return;
  }
  const list = found.map((i) => `• ${i}`).join('\n');
  if (c.notice) {
    // A second visit, and it's still not done.
    const fine = Math.min(fineFor(sim, COUNCIL_FINE_CAP), fineFor(sim, COUNCIL_FINE) * found.length);
    book(sim, 'Council fine: improvement notice not met', -fine);
    tale(sim, 'councilFine', [], { what: `£${fine / POUND}` });
    c.notice = { issues: found, byDay: sim.day + COUNCIL.revisitDays };
    c.visitDay = sim.day + COUNCIL.revisitDays;
    letter(sim, { from, title: 'Improvement notice not met', body: `On our return visit the following were still not put right:\n${list}\nA fine of £${fine / POUND} has been applied. We will visit again on day ${c.visitDay}.` });
    return;
  }
  c.notice = { issues: found, byDay: sim.day + COUNCIL.revisitDays };
  c.visitDay = sim.day + COUNCIL.revisitDays;
  tale(sim, 'councilNotice', []);
  letter(sim, { from, title: 'Improvement notice', body: `Our officer found the following:\n${list}\nThese must be put right by day ${c.notice.byDay}, when we will visit again. If they are not, you will be fined £${fineFor(sim, COUNCIL_FINE) / POUND} for each (up to £${fineFor(sim, COUNCIL_FINE_CAP) / POUND}).` });
}

/** Answers in the chat about repairs. */
export function upkeepAct(sim: Sim, kind: string, args: string[]): boolean {
  if (kind !== 'mend') return false;
  mend(sim, Number(args[0]));
  return true;
}
