// Scripted landlords for soak tests: a decent one and a ruthless one. (The absent one is
// either, ignoring every card.) The decent one also sees to the layout systems the way a
// decent landlord would: a radiator in every bedroom, a fan in a bathroom with no window, a
// leak mended when it's found, the roof insulated over a cold top flat, and the bed put in the
// quieter room. The ruthless one does none of it until the council make it.

import { flatInfo, furniturePrice, goingRate, MORTGAGE, overpay, POUND } from '../src/sim/economy';
import { furnitureProblem } from '../src/sim/build';
import { buyFurniture } from '../src/sim/furnish';
import { accept, changeRent, giveNotice, likelyLiking, noticeProblem } from '../src/sim/leases';
import { choose } from '../src/sim/post';
import { answer } from '../src/sim/chat';
import { itemsIn, tempOf, warmthOf } from '../src/sim/environment';
import { exposure } from '../src/sim/acoustics';
import { roomShapes } from '../src/sim/heat';
import { insulate, insulateProblem } from '../src/sim/build';
import { book } from '../src/sim/economy';
import { flatKind } from '../src/sim/rooms';
import { key } from '../src/sim/state';
import { scoreFor } from '../src/sim/impressiveness';
import type { Sim } from '../src/sim/sim';
import { mend } from '../src/sim/upkeep';
import { answerCard, openCards } from '../src/sim/drip';
import type { Card } from '../src/sim/state';
import { INSULATE_PRICE, LAYOUT, NEED_THOUGHTS } from '../src/sim/tuning';

export type Policy = 'decent' | 'ruthless';

/**
 * Money both keep back when fitting out an empty flat: next week's mortgage and a little over.
 * (It was £600, which a tight start never reached: a bare flat could sit empty all game, no
 * rent coming in to fit it out, and the decent landlord go under on luck.)
 */
const FURNISH_CUSHION = MORTGAGE.payment + 100 * POUND;

/** How the drip's cards get answered, if not by the policy's button: left alone, or by a function of the test's. */
export type Cards = 'ignore' | ((sim: Sim, card: Card) => void);

/** What the decent landlord leaves to the test: `roof: false` when the test decides the roof (heat.test.ts). */
export interface Care {
  roof?: boolean;
}

/** Called once a game hour: sets rents, picks applicants, answers letters and cards. */
export function landlord(sim: Sim, policy: Policy, cards?: Cards, care: Care = {}): void {
  const st = sim.state;
  for (const f of sim.layout.flats) {
    const info = flatInfo(sim, f.id);
    const going = goingRate(sim, f.id);
    const target = Math.round((policy === 'decent' ? going : going * 1.25) / (5 * POUND)) * 5 * POUND;
    if (!info.lease) {
      // A decent landlord doesn't let a flat without the basics.
      const s = scoreFor(sim, f.id, 1).has;
      info.listed = policy === 'ruthless' || (s.bed && s.toilet && s.wash && s.kitchen);
      info.asking = target;
      const waiting = st.applicants.filter((a) => a.flat === f.id);
      if (waiting.length > 0) {
        const best = policy === 'decent' ? [...waiting].sort((a, b) => likelyLiking(sim, b) - likelyLiking(sim, a))[0] : [...waiting].sort((a, b) => b.offer - a.offer)[0];
        accept(sim, best.id);
      }
    } else if (policy === 'ruthless' && !info.lease.sitting && !info.lease.rise && info.lease.rent < target) {
      changeRent(sim, f.id, target);
    } else if (policy === 'ruthless' && info.lease.sitting && !info.lease.rise && info.lease.rent < going) {
      changeRent(sim, f.id, Math.round((info.lease.rent * 1.1) / (5 * POUND)) * 5 * POUND);
    }
    if (info.lease && !noticeProblem(sim, f.id)) giveNotice(sim, f.id);
  }
  // The decent one heats the building and pays a cleaner; the ruthless one doesn't.
  st.boiler = policy === 'decent' ? Math.max(st.boiler, 2) : 1;
  st.cleaner = policy === 'decent';
  for (const m of st.chat) {
    if (!m.choices || m.chosen !== undefined) continue;
    answer(sim, m.id, policy === 'decent' ? 0 : m.choices.length - 1);
  }
  for (const l of st.post) {
    if (!l.choices || l.chosen !== undefined) continue;
    choose(sim, l.id, policy === 'decent' ? 0 : l.choices.length - 1);
  }
  // The drip's cards: the decent one takes the first button, the ruthless one the second.
  for (const c of [...openCards(sim)]) {
    if (cards === 'ignore') continue;
    if (cards) cards(sim, c);
    else answerCard(sim, c.id, policy === 'decent' ? 0 : 1);
  }
  // Both furnish a bare flat with the basics once they can afford it (cheapest first), as a
  // player would: the bed on its own in a room big enough to be a bedroom (a double if it
  // fits), the rest anywhere but there. A flat of one room gets it all in the one room.
  for (const f of sim.layout.flats) {
    if (flatInfo(sim, f.id).lease) continue;
    const has = scoreFor(sim, f.id, 1).has;
    const want = [!has.bed && 'bed', !has.toilet && 'toilet', !has.wash && 'shower', !has.kitchen && 'cooker'].filter(Boolean) as string[];
    const lay = sim.layout;
    const rooms = f.rooms.map((r) => lay.rooms[r]).filter((r) => r.nodes.length > 0);
    // The decent one puts the bed in the quietest room that's big enough (away from the stairs and the street), the ruthless one in the smallest.
    const quiet = (r: (typeof rooms)[number]) => (policy === 'decent' ? exposure(sim, r.id) : 0);
    const bedRoom = [...rooms].filter((r) => r.nodes.length >= LAYOUT.bedroomTiles).sort((a, b) => quiet(a) - quiet(b) || a.nodes.length - b.nodes.length)[0];
    const hasBed = (r: (typeof rooms)[number]) => st.furniture.some((x) => (x.def === 'bed' || x.def === 'doubleBed') && r.cells.includes(lay.node(x.x, x.s)));
    for (const def of want) {
      if (st.money < furniturePrice(def) + FURNISH_CUSHION) break;
      const isBed = def === 'bed';
      const order = isBed ? [bedRoom, ...rooms.filter((r) => r !== bedRoom)] : [...rooms.filter((r) => !hasBed(r)), ...rooms.filter((r) => hasBed(r))];
      // A double whenever the single would have been affordable: it sleeps a couple, for £120 more.
      const tries = isBed && st.money >= furniturePrice('doubleBed') + FURNISH_CUSHION ? ['doubleBed', 'bed'] : [def];
      let done = false;
      for (const room of order) {
        if (!room || done) continue;
        for (const piece of tries) {
          if (done) break;
          for (const n of room.cells) {
            const [x, s] = lay.xs(n);
            if (typeof furnitureProblem(st, piece, x, s) === 'string') continue;
            buyFurniture(sim, piece, x, s, false);
            done = true;
            break;
          }
        }
      }
    }
  }
  // The council wants a smoke alarm in every flat people live in: both fit one when they're let (cheapest thing there is).
  for (const f of sim.layout.flats) {
    if (!flatInfo(sim, f.id).lease || itemsIn(sim, f.id, 'smokeAlarm') > 0) continue;
    const cells = sim.layout.flatCells(f).map((n) => sim.layout.xs(n));
    for (const [x, s] of cells) {
      if (typeof furnitureProblem(st, 'smokeAlarm', x, s) === 'string') continue;
      buyFurniture(sim, 'smokeAlarm', x, s, false);
      break;
    }
  }
  // Even the ruthless one mends what the council has told them to.
  if (st.council.notice) for (const f of st.furniture) if (f.broken !== undefined) mend(sim, f.id);
  // Heating: the decent one puts a radiator in any flat that has none, let or about to be (a boiler
  // with nothing to heat is no heating at all); the ruthless one only once the council says it's too cold.
  for (const f of sim.layout.flats) {
    if (itemsIn(sim, f.id, 'radiator') > 0) continue;
    if (policy === 'ruthless' && !st.council.notice?.issues.some((i) => i.startsWith(`${f.name} is too cold`))) continue;
    if (st.money < furniturePrice('radiator') + 200 * POUND) continue;
    const cells = sim.layout.flatCells(f).map((n) => sim.layout.xs(n));
    for (const [x, s] of cells) {
      if (typeof furnitureProblem(st, 'radiator', x, s) === 'string') continue;
      buyFurniture(sim, 'radiator', x, s, false);
      break;
    }
  }
  if (policy === 'decent') layoutCare(sim, care);
  // Keep a cushion, overpay the rest. The cushion is a quarter's mortgage: with every flat let,
  // the rent barely covers the bills, so a tenant or two leaving runs the cash down for weeks.
  // (It was £1,500, and a landlord who'd overpaid went under after two flats emptied.)
  const cushion = 12 * MORTGAGE.payment;
  if (st.money > cushion + 1000 * POUND) overpay(sim, st.money - cushion);
}

/** Puts one of `def` in a room, wherever it goes first. */
function fitInRoom(sim: Sim, def: string, cells: readonly number[]): boolean {
  for (const n of cells) {
    const [x, s] = sim.layout.xs(n);
    if (typeof furnitureProblem(sim.state, def, x, s) === 'string') continue;
    return typeof buyFurniture(sim, def, x, s, false) !== 'string';
  }
  return false;
}

/** Pieces that leak when they break (damp.ts). */
const LEAKY = new Set(['shower', 'bath', 'washer', 'dishwasher']);

/** The decent landlord and the layout systems: warm bedrooms, dry bathrooms, no leaks, a lagged roof over a cold top flat. */
function layoutCare(sim: Sim, care: Care): void {
  const st = sim.state;
  const lay = sim.layout;
  // The same cushion as for furnishing: the basics, and the mortgage, come first.
  const spare = (n: number) => st.money >= n + 600 * POUND;
  // A leak gets mended when it's found, not when the council say so.
  for (const f of st.furniture) if (f.broken !== undefined && LEAKY.has(f.def) && spare(0)) mend(sim, f.id);
  // Getting every flat fitted with the basics and let comes first; the rest waits for that.
  if (lay.flats.some((f) => !flatInfo(sim, f.id).lease && !Object.values(scoreFor(sim, f.id, 1).has).every(Boolean))) return;
  const shapes = roomShapes(sim);
  const roomHas = (cells: readonly number[], def: string) => st.furniture.some((x) => x.def === def && cells.includes(lay.node(x.x, x.s)));
  for (const f of lay.flats) {
    // Once someone lives there: getting an empty flat let comes first.
    const info = flatInfo(sim, f.id);
    if (!info.lease) continue;
    for (const r of flatKind(sim, f.id).rooms) {
      const cells = lay.rooms[r.room].cells;
      // A radiator in every room someone sleeps in.
      if (r.uses.includes('sleep') && !roomHas(cells, 'radiator') && spare(furniturePrice('radiator'))) fitInRoom(sim, 'radiator', cells);
      // A fan in a bathroom with no window.
      if (r.uses.includes('wash') && !shapes.get(r.room)?.window && !roomHas(cells, 'extractorFan') && spare(furniturePrice('extractorFan'))) fitInRoom(sim, 'extractorFan', cells);
    }
    // A cold flat under a bare roof: the roof gets insulated (the ceiling cells over it).
    if (care.roof === false || warmthOf(tempOf(sim, f.id)) >= NEED_THOUGHTS.warmth[1].under) continue;
    const roof: string[] = [];
    for (const r of f.rooms) {
      if (!shapes.get(r) || shapes.get(r)!.roof <= shapes.get(r)!.roofInsulated) continue;
      for (const n of lay.rooms[r].cells) {
        const [x, s] = lay.xs(n);
        if (lay.air(x, s + 1)) continue;
        const k = key(x, s + 1);
        let up = s + 1;
        while (up < lay.rows && !lay.air(x, up)) up++;
        const outside = up >= lay.rows || lay.roomOf[lay.node(x, up)] === -1 || lay.rooms[lay.roomOf[lay.node(x, up)]].outdoor;
        if (outside && !roof.includes(k) && insulateProblem(st, k) === null) roof.push(k);
      }
    }
    if (roof.length === 0 || !spare(roof.length * INSULATE_PRICE)) continue;
    for (const k of roof) insulate(st, k);
    book(sim, 'Roof insulation', -roof.length * INSULATE_PRICE);
    sim.changed();
  }
}
