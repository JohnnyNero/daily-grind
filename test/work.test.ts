import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { setStation } from '../src/sim/manage';
import { TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../src/sim/state';
import { STATION_HELP_AFTER, findWork, homeWork } from '../src/sim/work';

const workOf = (label: string) => (/^Making/.test(label) ? 'barista' : /Taking an order|Plating/.test(label) ? 'counter' : /Clearing/.test(label) ? 'floor' : /Washing/.test(label) ? 'dishes' : null);

describe('sticky work', () => {
  it('a barista on station makes the drinks and leaves the till to the till person', () => {
    const sim = new Sim(4);
    sim.run(3 * TICKS_PER_HOUR); // mid-morning: everyone in
    const staff = sim.state.pawns.filter((p) => p.staff && p.onMap);
    expect(staff.length).toBeGreaterThanOrEqual(2);
    const [barista, till, ...rest] = staff;
    setStation(sim, barista, 'barista');
    setStation(sim, till, 'counter');
    for (const p of rest) setStation(sim, p, 'floor');
    const seen = new Map<number, Set<string>>();
    let lastLabel = '';
    for (let t = 0; t < 2 * TICKS_PER_HOUR; t++) {
      sim.step();
      const label = barista.job?.label ?? '';
      if (label === lastLabel) continue;
      lastLabel = label;
      const w = workOf(label);
      if (w) (seen.get(barista.id) ?? seen.set(barista.id, new Set()).get(barista.id)!).add(label.includes('helping') ? `${w}*` : w);
    }
    const kinds = seen.get(barista.id)!;
    expect(kinds.has('barista')).toBe(true);
    // Anything else they did was flagged as helping out, never their own work.
    for (const k of kinds) expect(k === 'barista' || k.endsWith('*')).toBe(true);
    expect(homeWork(barista)).toBe('barista');
  });

  it('station staff wait at their post when it is quiet, then help after a while', () => {
    const sim = new Sim(4);
    sim.run(3 * TICKS_PER_HOUR);
    const p = sim.state.pawns.find((x) => x.staff && x.onMap)!;
    setStation(sim, p, 'dishes');
    sim.state.sinkDirty = 0;
    // Some cups on a table, and the floor otherwise covered by nobody else.
    for (const o of sim.state.pawns) if (o !== p && o.staff) setStation(sim, o, 'floor');
    const table = sim.state.objects.find((o) => o.def === 'table2')!;
    sim.state.dirty[table.id] = 2;
    sim.state.rushes = [];
    p.staff!.focus = { work: 'dishes', lastDone: sim.state.tick, since: sim.state.tick };
    expect(findWork(sim, p)).toBeNull();
    sim.state.tick += STATION_HELP_AFTER + TICKS_PER_MINUTE;
    const job = findWork(sim, p);
    expect(job?.label).toMatch(/Clearing a table \(helping out\)/);
  });

  it('staff without a station switch work far less than before', () => {
    const sim = new Sim(9);
    let tasks = 0;
    let switches = 0;
    const last = new Map<number, string>();
    const lastLabel = new Map<number, string>();
    for (let t = 0; t < 24 * TICKS_PER_HOUR; t++) {
      sim.step();
      if (t % 5) continue;
      for (const p of sim.state.pawns) {
        if (!p.staff || !p.job || lastLabel.get(p.id) === p.job.label) continue;
        lastLabel.set(p.id, p.job.label);
        const w = workOf(p.job.label);
        if (!w) continue;
        tasks++;
        if (last.has(p.id) && last.get(p.id) !== w) switches++;
        last.set(p.id, w);
      }
    }
    expect(tasks).toBeGreaterThan(200);
    // Before stickiness about 80% of tasks were a different kind from the last one.
    expect(switches / tasks).toBeLessThan(0.65);
    expect(sim.state.recaps[0].stats.served).toBeGreaterThan(40);
  });
});
