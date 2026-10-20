// Scripted landlords for soak tests: a decent one and a ruthless one.

import { flatInfo, furniturePrice, goingRate, overpay, POUND } from '../src/sim/economy';
import { furnitureProblem } from '../src/sim/build';
import { buyFurniture } from '../src/sim/furnish';
import { accept, changeRent, giveNotice, likelyLiking, noticeProblem } from '../src/sim/leases';
import { choose } from '../src/sim/post';
import { answer } from '../src/sim/chat';
import { itemsIn } from '../src/sim/environment';
import { scoreFor } from '../src/sim/impressiveness';
import type { Sim } from '../src/sim/sim';
import { mend } from '../src/sim/upkeep';
import { answerCard, openCards } from '../src/sim/drip';
import type { Card } from '../src/sim/state';
import { LAYOUT } from '../src/sim/tuning';

export type Policy = 'decent' | 'ruthless';

/** How the drip's cards get answered, if not by the policy's button: left alone, or by a function of the test's. */
export type Cards = 'ignore' | ((sim: Sim, card: Card) => void);

/** Called once a game hour: sets rents, picks applicants, answers letters and cards. */
export function landlord(sim: Sim, policy: Policy, cards?: Cards): void {
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
    const bedRoom = [...rooms].filter((r) => r.nodes.length >= LAYOUT.bedroomTiles).sort((a, b) => a.nodes.length - b.nodes.length)[0];
    const hasBed = (r: (typeof rooms)[number]) => st.furniture.some((x) => (x.def === 'bed' || x.def === 'doubleBed') && r.cells.includes(lay.node(x.x, x.s)));
    for (const def of want) {
      if (st.money < furniturePrice(def) + 600 * POUND) break;
      const isBed = def === 'bed';
      const order = isBed ? [bedRoom, ...rooms.filter((r) => r !== bedRoom)] : [...rooms.filter((r) => !hasBed(r)), ...rooms.filter((r) => hasBed(r))];
      // A double whenever the single would have been affordable: it sleeps a couple, for £120 more.
      const tries = isBed && st.money >= furniturePrice('bed') + 600 * POUND ? ['doubleBed', 'bed'] : [def];
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
  // Keep a cushion, overpay the rest.
  const cushion = 1500 * POUND;
  if (st.money > cushion + 1000 * POUND) overpay(sim, st.money - cushion);
}
