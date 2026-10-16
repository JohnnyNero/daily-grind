// Things that must always be true about a running sim. Used by the stress tests and the
// soak script: any message returned is a bug.

import { objectDef } from '../src/sim/defs';
import type { Sim } from '../src/sim/sim';
import { TICKS_PER_HOUR } from '../src/sim/state';

const finite = (v: number) => Number.isFinite(v);

export function checkInvariants(sim: Sim): string[] {
  const s = sim.state;
  const problems: string[] = [];
  const bad = (msg: string) => problems.push(`day ${sim.day} ${sim.clock()}: ${msg}`);
  const ids = new Set(s.pawns.map((p) => p.id));
  if (ids.size !== s.pawns.length) bad('duplicate pawn ids');
  const objIds = new Set(s.objects.map((o) => o.id));
  if (objIds.size !== s.objects.length) bad('duplicate object ids');

  if (!finite(s.money)) bad(`money is ${s.money}`);
  if (!finite(s.reputation) || s.reputation < 0 || s.reputation > 100) bad(`reputation ${s.reputation}`);
  if (s.log.length > 120) bad(`log grew to ${s.log.length}`);
  if (s.recaps.length > 60) bad(`recaps grew to ${s.recaps.length}`);
  if (s.hallOfFame.length > 50) bad(`hall of fame grew to ${s.hallOfFame.length}`);
  if (s.regulars.length > 20) bad(`regulars grew to ${s.regulars.length}`);
  if (s.applicants.length > 3) bad(`applicants grew to ${s.applicants.length}`);
  if (s.pawns.filter((p) => p.kind === 'guest').length > 40) bad('guest count runaway');
  if (s.sinkDirty < 0) bad('negative washing-up pile');

  for (const p of s.pawns) {
    for (const [k, v] of Object.entries(p.needs)) if (!finite(v) || v < 0 || v > 1) bad(`${p.name} need ${k}=${v}`);
    if (!finite(p.x) || !finite(p.y)) bad(`${p.name} position NaN`);
    if (p.onMap) {
      const tx = Math.round(p.x);
      const ty = Math.round(p.y);
      if (!sim.world.inBounds(tx, ty)) bad(`${p.name} out of bounds at ${p.x},${p.y}`);
      else if (sim.world.tile(tx, ty).wall) bad(`${p.name} inside a wall at ${tx},${ty}`);
    }
    if (p.staff) {
      if (!finite(p.staff.mood) || p.staff.mood < 0 || p.staff.mood > 100) bad(`${p.name} mood ${p.staff.mood}`);
      if (p.staff.memories.length > 200) bad(`${p.name} has ${p.staff.memories.length} memories`);
      if (p.staff.wants.length > 2) bad(`${p.name} has ${p.staff.wants.length} wants`);
      for (const w of Object.values(p.staff.skills)) if (!finite(w) || w < 0 || w > 10) bad(`${p.name} skill ${w}`);
    }
    if (p.visit) {
      const v = p.visit;
      if (!finite(v.patience) || v.patience < 0 || v.patience > 1) bad(`${p.name} patience ${v.patience}`);
      if (v.state === 'queuing' && !s.queue.includes(p.id)) bad(`${p.name} queuing but not in queue`);
      if (v.orderId !== null && !s.orders.some((o) => o.id === v.orderId) && v.state !== 'leaving') bad(`${p.name} has a missing order`);
    }
    if (p.job && p.job.index >= p.job.steps.length) bad(`${p.name} job index past end`);
  }
  for (const id of s.queue) {
    const g = s.pawns.find((p) => p.id === id);
    if (!g) bad(`queue holds missing pawn ${id}`);
    else if (g.visit?.state !== 'queuing' && g.visit?.state !== 'ordering') bad(`queue holds ${g.name} in state ${g.visit?.state}`);
  }
  if (new Set(s.queue).size !== s.queue.length) bad('duplicate in queue');
  for (const o of s.orders) {
    const g = s.pawns.find((p) => p.id === o.guestId);
    if (!g) bad(`order ${o.id} for a guest who left`);
  }
  for (const [key, holder] of Object.entries(s.reservations)) {
    const p = s.pawns.find((x) => x.id === holder);
    if (!p) bad(`reservation ${key} held by missing pawn ${holder}`);
  }
  for (const [id, n] of Object.entries(s.dirty)) {
    if (!objIds.has(Number(id))) bad(`dirty cups on missing object ${id}`);
    if (!(n > 0)) bad(`dirty count ${n} on ${id}`);
  }
  for (const o of s.objects) {
    const d = objectDef(o.def);
    for (let dy = 0; dy < d.h; dy++) for (let dx = 0; dx < d.w; dx++) {
      if (!sim.world.inBounds(o.x + dx, o.y + dy) || sim.world.tile(o.x + dx, o.y + dy).wall) bad(`${o.def} ${o.id} overlaps a wall`);
    }
  }
  for (const sp of s.spills) if (sim.world.tile(sp.x, sp.y).wall) bad('spill in a wall');
  return problems;
}

/** Tracks each on-map pawn's last progress; reports anyone wedged for too long. */
export class StuckWatch {
  private last = new Map<number, { x: number; y: number; label: string; tick: number }>();

  constructor(private readonly limitTicks = 2 * TICKS_PER_HOUR) {}

  check(sim: Sim): string[] {
    const out: string[] = [];
    for (const p of sim.state.pawns) {
      // Off shift, deliberately waiting at their post, or at home in the flat (asleep, say): not stuck.
      if (!p.onMap || p.job?.idle || p.job?.home) {
        this.last.delete(p.id);
        continue;
      }
      const label = sim.activity(p);
      const prev = this.last.get(p.id);
      if (!prev || prev.label !== label || Math.hypot(prev.x - p.x, prev.y - p.y) > 0.5) {
        this.last.set(p.id, { x: p.x, y: p.y, label, tick: sim.state.tick });
      } else if (sim.state.tick - prev.tick > this.limitTicks) {
        out.push(`day ${sim.day} ${sim.clock()}: ${p.name} (${p.kind}) stuck "${label}" at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
        this.last.set(p.id, { x: p.x, y: p.y, label, tick: sim.state.tick });
      }
    }
    return out;
  }
}
