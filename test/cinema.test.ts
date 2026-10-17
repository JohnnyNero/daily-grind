import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { booked, screens, showingsToday, ticketFor } from '../src/sim/cinema';
import { buildAt } from '../src/sim/structure';
import { buyObject, deserialize, serialize } from '../src/sim/manage';
import { paintZone } from '../src/sim/service';
import { TICKS_PER_DAY, TICKS_PER_MINUTE, type Pawn } from '../src/sim/state';

const runTo = (sim: Sim, minuteOfDay: number) => {
  while (sim.minuteOfDay !== minuteOfDay) sim.run(TICKS_PER_MINUTE);
};
const holding = (sim: Sim, start: number): Pawn[] => sim.state.pawns.filter((p) => p.visit?.film?.start === start);

describe('the cinema', () => {
  it('has two screens and a timetable that fits the day', () => {
    const sim = new Sim(1, undefined, 'cinema');
    const sc = screens(sim);
    expect(sc.map((x) => [x.name, x.capacity])).toEqual([['Screen 1', 16], ['Screen 2', 16]]);
    const list = showingsToday(sim);
    expect(list.length).toBeGreaterThan(6);
    for (const x of sc) {
      const mine = list.filter((sh) => sh.screen === x.key);
      for (let i = 1; i < mine.length; i++) expect(mine[i].start).toBeGreaterThanOrEqual(mine[i - 1].end + 20);
    }
    expect(Math.max(...list.map((sh) => sh.end))).toBeLessThan(sim.venue.hours.close);
  });

  it('fills up before a film, watches it together and empties at the end', () => {
    const sim = new Sim(2, undefined, 'cinema');
    const sh = showingsToday(sim)[2];
    const t = ticketFor(sim, sh);
    // Arrivals swell towards the start.
    const arrivedBy = (m: number) => { runTo(sim, m); return booked(sim, t); };
    const early = arrivedBy(sh.start - 35);
    const late = arrivedBy(sh.start);
    expect(late).toBeGreaterThan(early + 3);
    runTo(sim, sh.start + 15);
    const audience = holding(sim, t.start);
    expect(audience.length).toBeGreaterThan(4);
    expect(audience.filter((p) => p.visit!.state === 'eating').length).toBeGreaterThanOrEqual(audience.length * 0.5);
    // Everyone in the audience is sat in that film's screen.
    const room = screens(sim).find((x) => x.key === sh.screen)!;
    for (const p of audience.filter((x) => x.visit!.state === 'eating')) expect(room.seats.some((o) => o.id === p.visit!.seatObject)).toBe(true);
    // A save mid-film keeps the tickets.
    expect(holding(deserialize(serialize(sim)), t.start).length).toBe(audience.length);
    runTo(sim, sh.end + 1);
    expect(holding(sim, t.start).every((p) => p.visit!.state === 'leaving')).toBe(true);
    runTo(sim, sh.end + 10);
    expect(holding(sim, t.start)).toEqual([]);
  });

  it('serves the lounge too, sells tickets and snacks, and leaves the seats to clear', () => {
    const sim = new Sim(3, undefined, 'cinema');
    let lounge = 0;
    let ticketOnly = 0;
    let dirtySeats = false;
    const seen = new Set<number>();
    for (let t = 0; t < TICKS_PER_DAY; t += TICKS_PER_MINUTE) {
      sim.run(TICKS_PER_MINUTE);
      for (const p of sim.state.pawns) {
        if (!p.visit || seen.has(p.id)) continue;
        seen.add(p.id);
        if (!p.visit.film) lounge++;
        else if (p.visit.items.length === 1) ticketOnly++;
      }
      const seatIds = new Set(screens(sim).flatMap((x) => x.seats.map((o) => o.id)));
      if (Object.keys(sim.state.dirty).some((id) => seatIds.has(Number(id)))) dirtySeats = true;
    }
    expect(lounge).toBeGreaterThan(10);
    expect(ticketOnly).toBeGreaterThan(5);
    expect(dirtySeats).toBe(true);
    const day = sim.state.yesterday!;
    expect(day.served).toBeGreaterThan(80);
    expect(day.ingredients).toBeGreaterThan(0);
  });

  it('only shows films on a screen: a room of Screen floor with a screen and seats', () => {
    const sim = new Sim(4, undefined, 'cinema', 'empty');
    expect(screens(sim)).toEqual([]);
    expect(showingsToday(sim)).toEqual([]);
    for (let y = 2; y <= 8; y++) for (let x = 2; x <= 9; x++) expect(buildAt(sim, x, y, { floor: 'X' })).toBeNull();
    expect(buyObject(sim, 'screen', 3, 2)).toBeNull();
    expect(screens(sim)).toHaveLength(1);
    expect(screens(sim)[0].capacity).toBe(0);
    expect(buyObject(sim, 'cinemaSeats', 4, 5)).toBeNull();
    expect(buyObject(sim, 'cinemaSeats', 4, 7)).toBeNull();
    expect(screens(sim)[0].capacity).toBe(8);
    expect(showingsToday(sim).length).toBeGreaterThan(3);
    // Seats on ordinary floor aren't anyone's audience.
    expect(buyObject(sim, 'cinemaSeats', 10, 15)).toMatch(/don't go there/);
    // Fit out the rest and films sell.
    for (let x = 2; x <= 8; x++) if (x !== 5) buyObject(sim, 'counter', x, 13);
    expect(buyObject(sim, 'pickup', 5, 13)).toBeNull();
    expect(buyObject(sim, 'till', 9, 13)).toBeNull();
    for (const [x, y] of [[3, 11], [4, 11]] as const) buildAt(sim, x, y, { floor: 'B' });
    expect(buyObject(sim, 'fountain', 3, 11)).toBeNull();
    for (let y = 15; y <= 19; y++) paintZone(sim, 9, y, 'queue');
    sim.run(TICKS_PER_DAY);
    expect(sim.state.yesterday!.served).toBeGreaterThan(20);
  });
});
