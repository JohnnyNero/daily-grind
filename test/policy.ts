// Scripted landlords for soak tests: a decent one and a ruthless one.

import { flatInfo, goingRate, overpay, POUND } from '../src/sim/economy';
import { accept, changeRent, giveNotice, likelyLiking, noticeProblem } from '../src/sim/leases';
import { choose } from '../src/sim/post';
import { scoreFor } from '../src/sim/impressiveness';
import type { Sim } from '../src/sim/sim';

export type Policy = 'decent' | 'ruthless';

/** Called once a game hour: sets rents, picks applicants, answers letters. */
export function landlord(sim: Sim, policy: Policy): void {
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
  for (const l of st.post) {
    if (!l.choices || l.chosen !== undefined) continue;
    choose(sim, l.id, policy === 'decent' ? 0 : l.choices.length - 1);
  }
  // Keep a cushion, overpay the rest.
  const cushion = 1500 * POUND;
  if (st.money > cushion + 1000 * POUND) overpay(sim, st.money - cushion);
}
