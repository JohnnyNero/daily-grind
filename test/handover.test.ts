import { flatNeeds } from '../src/sim/impressiveness';
import { describe, expect, it } from 'vitest';
import { placeFurniture } from '../src/sim/build';
import { flatInfo } from '../src/sim/economy';
import { TOUR, guide, listDone, meet, saying, skipAhead, skipHandover, stopFlat, todo, touring } from '../src/sim/handover';
import { accept, newApplicant } from '../src/sim/leases';
import { choose } from '../src/sim/post';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/state';

/** Runs until a given day and hour. */
function runTo(sim: Sim, day: number, hour: number): void {
  const target = (day - 1) * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
  if (target > sim.state.tick) sim.run(target - sim.state.tick);
}

/** Puts each piece wherever it fits in a flat. */
function furnish(sim: Sim, flatId: string, defs: string[]): void {
  const lay = sim.layout;
  const cells = lay.flatCells(lay.flat(flatId)!).map((n) => lay.xs(n));
  for (const def of defs) {
    const ok = cells.some(([x, s]) => typeof placeFurniture(sim.state, def, x, s) !== 'string');
    expect(ok, def).toBe(true);
  }
  sim.changed();
}

describe('the handover', () => {
  it('starts with Denise in the lobby, two tenants and the last owner\'s notes', () => {
    const sim = Sim.create(1);
    const d = guide(sim)!;
    expect(d.name).toMatch(/Denise/);
    expect(touring(sim)).toBe(true);
    const tenants = sim.state.pawns.filter((p) => p.life);
    expect(tenants).toHaveLength(2);
    const flats = sim.layout.flats;
    const bill = tenants.find((p) => p.life!.flat === flats[3].id)!;
    expect(bill.name).toMatch(/^Bill /);
    expect(tenants.find((p) => p.life!.flat === flats[0].id)!.life!.traits).toContain('paysEarly');
    const notes = sim.state.post.find((l) => l.title === 'Handover notes')!;
    for (const f of flats) expect(notes.body).toContain(`${f.name}:`);
  });

  it('walks round on its own, then leaves a list and a cheeky applicant for the empty flat', () => {
    const sim = Sim.create(2);
    sim.run(3 * TICKS_PER_HOUR);
    expect(touring(sim)).toBe(false);
    expect(sim.state.post.some((l) => l.title === 'Your list')).toBe(true);
    const toLet = sim.state.handover.toLet!;
    const cheeky = sim.state.applicants.find((a) => a.flat === toLet)!;
    expect(cheeky.offer).toBeLessThan(flatInfo(sim, toLet).asking);
    expect(todo(sim).map((t) => t.done)).toEqual([false, false, false, false]);
  });

  it('moves on a stop with every tap, to each flat in turn', () => {
    const sim = Sim.create(3);
    const flats: (string | null)[] = [];
    for (let i = 0; i < TOUR.length; i++) {
      skipAhead(sim);
      expect(sim.state.handover.stop).toBe(i);
      expect(saying(sim)).toBeTruthy();
      flats.push(stopFlat(sim));
    }
    skipAhead(sim);
    expect(touring(sim)).toBe(false);
    expect(new Set(flats.filter(Boolean)).size).toBeGreaterThanOrEqual(4);
  });

  it('starts with one flat ready to let and two bare ones, unlisted', () => {
    const sim = Sim.create(4);
    const [, two, three, , five] = sim.layout.flats;
    expect(sim.state.flats[two.id].listed).toBe(true);
    for (const f of [three, five]) {
      expect(sim.state.flats[f.id].listed, f.name).toBe(false);
      const needs = flatNeeds(sim, f.id);
      expect(needs.filter((n) => n.must && !n.done).map((n) => n.label)).toEqual(['A bed', 'A loo', 'A shower or a bath', 'A cooker or a fridge']);
    }
    // Furnishing ticks the checklist off.
    furnish(sim, three.id, ['bed', 'toilet', 'shower', 'cooker']);
    expect(flatNeeds(sim, three.id).filter((n) => n.must).every((n) => n.done)).toBe(true);
  });

  it('ticks its list off from what you really do', () => {
    const sim = Sim.create(4);
    sim.run(3 * TICKS_PER_HOUR);
    const h = sim.state.handover;
    for (const id of h.cast) meet(sim, id);
    const a = sim.state.applicants.find((x) => x.flat === h.toLet)!;
    expect(accept(sim, a.id)).toBeNull();
    furnish(sim, h.fit!, ['bed', 'toilet', 'shower', 'cooker']);
    expect(todo(sim).map((t) => t.done)).toEqual([true, true, true, false]);
    runTo(sim, 8, 11);
    expect(listDone(sim)).toBe(true);
    expect(sim.state.post.some((l) => l.title === 'All done')).toBe(true);
  });

  it('has Bill ask for the heating on day two, and an idea for the stripped flat in week two', () => {
    const sim = Sim.create(5);
    runTo(sim, 3, 8);
    const ask = sim.state.chat.find((m) => m.text.includes('cardigans'));
    expect(ask?.who).toMatch(/^Bill/);
    expect(ask?.choices?.[0].act).toBe('boilerUp');
    runTo(sim, 10, 12);
    expect(sim.state.post.some((l) => l.title.startsWith('An idea for'))).toBe(true);
  });

  it('offers an advance if you\'re short before the first payment, paid back from the deposit', () => {
    const sim = Sim.create(6);
    runTo(sim, 5, 8);
    sim.state.money = 50 * 100;
    runTo(sim, 5, 10);
    const offer = sim.state.post.find((l) => l.title === 'Monday')!;
    expect(offer).toBeDefined();
    const before = sim.state.money;
    choose(sim, offer.id, 0);
    expect(sim.state.money).toBe(before + 300 * 100);
    const a = newApplicant(sim, sim.state.handover.toLet!);
    sim.state.applicants.push(a);
    expect(accept(sim, a.id)).toBeNull();
    sim.run(2 * TICKS_PER_HOUR);
    expect(sim.state.handover.advance).toBeUndefined();
    expect(sim.state.ledger.some((e) => e.label === 'Advance paid back to the agent')).toBe(true);
  });

  it('can be skipped: no list, no nudges', () => {
    const sim = Sim.create(7);
    skipHandover(sim);
    expect(touring(sim)).toBe(false);
    runTo(sim, 10, 12);
    expect(sim.state.post.some((l) => l.title === 'Your list' || l.title.startsWith('An idea for'))).toBe(false);
    expect(sim.state.chat.some((m) => m.text.includes('cardigans'))).toBe(false);
  });

  it('carries on after saving and loading part way round', () => {
    const sim = Sim.create(8);
    skipAhead(sim);
    skipAhead(sim);
    skipAhead(sim);
    const stop = sim.state.handover.stop;
    const back = deserialize(serialize(sim));
    expect(back.state.handover.stop).toBe(stop);
    back.run(3 * TICKS_PER_HOUR);
    expect(touring(back)).toBe(false);
    expect(back.state.post.some((l) => l.title === 'Your list')).toBe(true);
  });
});
