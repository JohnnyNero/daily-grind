// The overlay bar's room-by-room reading (src/sim/lens.ts): every room in a flat gets a
// reading, the stairs and street don't, and the Rent lens shows what the layout earns.

import { describe, expect, it } from 'vitest';
import { goingRate } from '../src/sim/economy';
import { LENSES, readRoom, roomNoise, roomNoiseWhy, type Lens } from '../src/sim/lens';
import { noiseReasons, roomNoise as noiseInRoom } from '../src/sim/acoustics';
import { Sim } from '../src/sim/sim';

describe('overlay lenses', () => {
  it('reads every room of every flat under every lens, and nothing else', () => {
    const sim = Sim.create(1);
    const lay = sim.layout;
    for (const lens of LENSES) {
      for (const room of lay.rooms) {
        const r = readRoom(sim, lens, room.id);
        if (lens === 'none' || room.flat === null) {
          expect(r).toBeNull();
          continue;
        }
        expect(r).not.toBeNull();
        expect(r!.good).toBeGreaterThanOrEqual(0);
        expect(r!.good).toBeLessThanOrEqual(1);
        expect(r!.why.length).toBeLessThanOrEqual(3);
        expect(r!.word.length).toBeGreaterThan(0);
      }
    }
  });

  it('reads noise room by room, from acoustics.ts', () => {
    const sim = Sim.create(1);
    const made = sim.noise();
    for (const room of sim.layout.flats[0].rooms) {
      expect(roomNoise(sim, made, room)).toBe(noiseInRoom(sim, room));
      expect(roomNoiseWhy(sim, made, room)).toEqual(noiseReasons(sim, room));
    }
  });

  it('the Rent lens shows the going rate, and says which room is the bedroom', () => {
    const sim = Sim.create(1);
    const f = sim.layout.flats[0];
    const readings = f.rooms.map((r) => readRoom(sim, 'rent' as Lens, r)!);
    expect(readings.every((r) => r.word.includes('a week'))).toBe(true);
    expect(goingRate(sim, f.id)).toBeGreaterThan(0);
    expect(readings.some((r) => r.room === 'Bedroom' && r.why[0].startsWith('A bedroom'))).toBe(true);
  });
});
