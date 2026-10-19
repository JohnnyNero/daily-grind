// Standing alerts: things wrong right now. Unlike letters they're never stored; they're
// worked out from the state and vanish as soon as the problem is fixed.

import { DEBT_LIMIT, machineWear } from './business';
import { openingShortfall } from './fitout';
import { hotOnMenu } from './kitchen';
import { showingsToday, ticketFor } from './cinema';
import type { Sim } from './sim';
import { STRESS_BURNT_OUT } from './stakes';
import { TICKS_PER_MINUTE, type Pawn } from './state';

export interface Alert {
  id: string;
  text: string;
  level: 'critical' | 'high' | 'medium';
  /** Tapping it selects this person. */
  pawn?: number;
  /** Or opens this panel. */
  panel?: 'staff' | 'cafe' | 'build';
}

const LEVEL_ORDER = { critical: 0, high: 1, medium: 2 } as const;

function canDo(p: Pawn, work: 'counter' | 'barista' | 'kitchen'): boolean {
  const staff = p.staff!;
  return !staff.mentalBreak && (staff.station === work || staff.rushStation === work || staff.priorities[work] > 0);
}

export function computeAlerts(sim: Sim): Alert[] {
  const s = sim.state;
  const out: Alert[] = [];
  const staffIn = s.pawns.filter((p) => p.staff && p.onMap && !p.staff.quit && sim.onShift(p));
  const open = sim.isOpen();

  if (!sim.canTrade) out.push({ id: 'fitout', text: openingShortfall(sim) ?? 'Not ready to open', level: 'critical', panel: 'build' });
  if (open && staffIn.length > 0) {
    if (!staffIn.some((p) => canDo(p, 'counter'))) out.push({ id: 'noTill', text: 'Nobody can work the till', level: 'critical', panel: 'staff' });
    if (hotOnMenu(sim) && !staffIn.some((p) => canDo(p, 'kitchen'))) out.push({ id: 'noCook', text: 'Nobody can cook', level: 'high', panel: 'staff' });
    if (!staffIn.some((p) => canDo(p, 'barista'))) out.push({ id: 'noBarista', text: `Nobody can work the ${sim.venue.text.noun === 'pub' ? 'bar' : 'machine'}`, level: 'critical', panel: 'staff' });
  }
  if (open && staffIn.length === 0 && sim.canTrade) out.push({ id: 'nobody', text: 'Open with nobody in', level: 'critical', panel: 'staff' });
  if (sim.hasCondition('stationBroken')) out.push({ id: 'broken', text: 'Machine broken', level: 'critical', panel: 'cafe' });
  if (s.story.incoming) {
    const mins = Math.max(1, Math.round((s.story.incoming.at - s.tick) / TICKS_PER_MINUTE));
    out.push({ id: 'incoming', text: `${s.story.incoming.n} arriving in ${mins} min`, level: 'high' });
  }
  if (s.queue.length >= 5) out.push({ id: 'queue', text: `${s.queue.length} queuing`, level: 'high' });
  // A film about to start with people still stuck in the queue: they'll miss it.
  if (sim.venue.cinema && open) {
    const m = sim.minuteOfDay;
    const soon = showingsToday(sim).find((sh) => sh.start >= m && sh.start - m <= 10);
    const late = soon ? s.pawns.filter((p) => p.visit?.film && p.visit.film.start === ticketFor(sim, soon).start && (p.visit.state === 'queuing' || p.visit.state === 'waiting')).length : 0;
    if (soon && late >= 3) out.push({ id: 'filmSoon', text: `${soon.title} starts in ${soon.start - m} min, ${late} not served`, level: 'high' });
  }
  for (const p of s.pawns) {
    const staff = p.staff;
    if (!staff || staff.quit) continue;
    if (staff.mentalBreak) continue;
    if (staff.belowSince.minor !== null && p.onMap) out.push({ id: `breaking:${p.id}`, text: `${p.name} close to breaking`, level: 'high', pawn: p.id });
    else if (staff.stress >= STRESS_BURNT_OUT) out.push({ id: `burnt:${p.id}`, text: `${p.name} burnt out`, level: 'high', pawn: p.onMap ? p.id : undefined, panel: p.onMap ? undefined : 'staff' });
  }
  if (s.money < DEBT_LIMIT) out.push({ id: 'broke', text: "The bank won't lend", level: 'critical', panel: 'cafe' });
  else if (s.money < 0) out.push({ id: 'debt', text: 'In the red', level: 'high', panel: 'cafe' });
  if (s.sinkDirty >= 10) out.push({ id: 'dishes', text: 'Washing up piling up', level: 'medium', panel: 'staff' });
  const dirtyTables = Object.values(s.dirty).filter((n) => n > 0).length;
  if (dirtyTables >= 4) out.push({ id: 'tables', text: `${dirtyTables} tables need clearing`, level: 'medium', panel: 'staff' });
  if (s.spills.length >= 2) out.push({ id: 'spills', text: 'Spills on the floor', level: 'medium', panel: 'staff' });
  for (const o of s.objects) {
    if (o.def === sim.venue.drinkStation && machineWear(sim, o.id) >= 70) {
      out.push({ id: `wear:${o.id}`, text: 'Machine needs a service', level: 'medium', panel: 'cafe' });
      break;
    }
  }
  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
