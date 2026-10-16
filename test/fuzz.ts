// A random "chaos manager": does all the things a player can do, at random, through
// the same functions the UI calls. Returns a description for failure reports.

import { HAIR_STYLES, OBJECT_DEFS, TRAITS, WORK_TYPES } from '../src/sim/defs';
import {
  buyObject, editStaff, fire, hire, moveObject, orderBreak, sellObject, sendHomeEarly, setEnabled, setPrice, setShift,
} from '../src/sim/manage';
import type { Sim } from '../src/sim/sim';
import { fireEvent } from '../src/sim/storyteller';

/** A separate RNG so fuzzing doesn't disturb the sim's own random stream more than the actions do. */
export class FuzzRng {
  constructor(private s: number) {}
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)];
  }
}

const EVENTS = ['coachParty', 'machineBroken', 'lateDelivery', 'sickCall', 'inspector', 'critic', 'heatwave', 'busker', 'freePastries', 'shoutOut', 'quietSpell', 'birthday'];

export function chaosAction(sim: Sim, r: FuzzRng): string {
  const s = sim.state;
  const staff = s.pawns.filter((p) => p.staff && !p.staff.quit);
  const roll = r.int(0, 15);
  switch (roll) {
    case 0: {
      const o = r.pick(s.objects);
      const x = r.int(0, s.w - 1);
      const y = r.int(0, s.h - 1);
      return `move ${o.def} to ${x},${y}: ${moveObject(sim, o.id, x, y) ?? 'ok'}`;
    }
    case 1: {
      const def = r.pick(Object.values(OBJECT_DEFS).filter((d) => d.price !== undefined)).id;
      const x = r.int(0, s.w - 1);
      const y = r.int(0, s.h - 1);
      return `buy ${def} at ${x},${y}: ${buyObject(sim, def, x, y) ?? 'ok'}`;
    }
    case 2: {
      const o = r.pick(s.objects);
      return `sell ${o.def}: ${sellObject(sim, o.id) ?? 'ok'}`;
    }
    case 3: {
      if (staff.length === 0) return 'no staff to reprioritise';
      const p = r.pick(staff);
      const w = r.pick(WORK_TYPES).id;
      p.staff!.priorities[w] = r.int(0, 4);
      return `priority ${p.name} ${w}`;
    }
    case 4: {
      const m = r.pick(s.menu);
      return `price ${m.name}: ${setPrice(sim, m.name, r.int(0, 2000)) ?? 'ok'}`;
    }
    case 5: {
      const m = r.pick(s.menu);
      return `toggle ${m.name}: ${setEnabled(sim, m.name, !m.enabled) ?? 'ok'}`;
    }
    case 6: {
      if (staff.length === 0) return 'no staff for shifts';
      const p = r.pick(staff);
      return `shift ${p.name}: ${setShift(sim, p, r.int(0, 24 * 60), r.int(0, 24 * 60)) ?? 'ok'}`;
    }
    case 7:
      return s.applicants.length > 0 ? `hire: ${typeof hire(sim, r.int(0, s.applicants.length - 1)) === 'string' ? 'refused' : 'ok'}` : 'no applicants';
    case 8:
      if (staff.length <= 1 || r.next() < 0.7) return 'spared';
      return `fire: ${fire(sim, r.pick(staff)) ?? 'ok'}`;
    case 9:
      return staff.length > 0 ? `break: ${orderBreak(sim, r.pick(staff)) ?? 'ok'}` : 'no staff';
    case 10:
      return staff.length > 0 ? `home: ${sendHomeEarly(sim, r.pick(staff)) ?? 'ok'}` : 'no staff';
    case 11: {
      if (staff.length === 0) return 'no staff';
      const p = r.pick(staff);
      const traits = [r.pick(TRAITS).id, r.pick(TRAITS).id];
      return `edit ${p.name}: ${editStaff(p, { name: r.next() < 0.1 ? '' : `${p.name}`, hairStyle: r.pick(HAIR_STYLES), traits }) ?? 'ok'}`;
    }
    case 12: {
      const id = r.pick(EVENTS);
      fireEvent(sim, id);
      return `event ${id}`;
    }
    case 13:
      s.money += r.int(-200000, 50000);
      return 'money shock';
    default:
      return 'nothing';
  }
}
