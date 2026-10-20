import { describe, expect, it } from 'vitest';
import { furnitureProblem, placeFurniture } from '../src/sim/build';
import { burglaryRisk, pickings, startBurglary } from '../src/sim/crime';
import { isGraded } from '../src/sim/defs';
import { POUND, furniturePrice } from '../src/sim/economy';
import { buyFurniture, resaleOf } from '../src/sim/furnish';
import { furnitureValue, gradesMorning, poshUnlocked, upgradeCost, upgradeFurniture } from '../src/sim/grades';
import { skipHandover } from '../src/sim/handover';
import { scoreFor } from '../src/sim/impressiveness';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, type Furniture, type Grade } from '../src/sim/state';
import { BASELINE, likingTarget, thoughtsOf } from '../src/sim/thoughts';
import { GRADES, MEMORIES, POSH_UNLOCK } from '../src/sim/tuning';
import { repairCost, useUp } from '../src/sim/upkeep';

const tenants = (sim: Sim) => sim.state.pawns.filter((p) => p.life && !p.life.leaving);

/** Sets the clock to a time on a day (day 1 is a Monday). */
function at(sim: Sim, day: number, hour: number): void {
  sim.state.tick = (day - 1) * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
}

/** Somewhere a piece fits in a flat. */
function spot(sim: Sim, flat: number, def: string): [number, number] {
  for (const n of sim.layout.flatCells(sim.layout.flats[flat])) {
    const [x, s] = sim.layout.xs(n);
    if (furnitureProblem(sim.state, def, x, s) === null) return [x, s];
  }
  throw new Error(`No room for a ${def}`);
}

/** Puts a piece in a flat, free. */
function put(sim: Sim, flat: number, def: string, grade: Grade = 'standard'): Furniture {
  const out = placeFurniture(sim.state, def, ...spot(sim, flat, def), false, grade);
  if (typeof out === 'string') throw new Error(out);
  sim.changed();
  return out;
}

/** Opens up posh, as a good rating would. */
function unlock(sim: Sim): void {
  sim.state.poshFrom = sim.day;
}

describe('furniture grades', () => {
  it('cost, count and wear by grade; ornaments come in one grade only', () => {
    expect(isGraded('sofa')).toBe(true);
    expect(isGraded('cooker')).toBe(true);
    expect(isGraded('picture')).toBe(false);
    expect(isGraded('wardrobe')).toBe(false);
    const std = furniturePrice('sofa');
    expect(furniturePrice('sofa', 'cheap')).toBe(Math.round((std / POUND) * GRADES.price.cheap) * POUND);
    expect(furniturePrice('sofa', 'posh')).toBe(Math.round((std / POUND) * GRADES.price.posh) * POUND);
    expect(furniturePrice('sofa', 'cheap')).toBeLessThan(std);
    expect(furniturePrice('sofa', 'posh')).toBeGreaterThan(2 * std);
    // A picture is a picture.
    expect(furniturePrice('picture', 'posh')).toBe(furniturePrice('picture'));
    expect(furnitureValue({ def: 'sofa', grade: 'posh' })).toBeCloseTo(40 * GRADES.value.posh);
    expect(furnitureValue({ def: 'sofa', grade: 'cheap' })).toBeCloseTo(40 * GRADES.value.cheap);
    expect(furnitureValue({ def: 'sofa' })).toBe(40);
    expect(furnitureValue({ def: 'picture', grade: 'posh' })).toBe(12);
    // Repairs and resale follow the price.
    const at = (grade: Grade): Furniture => ({ id: 1, def: 'sofa', x: 0, s: 0, ...(grade === 'standard' ? {} : { grade }) });
    expect(repairCost(at('posh'))).toBeGreaterThan(repairCost(at('standard')));
    expect(repairCost(at('cheap'))).toBeLessThanOrEqual(repairCost(at('standard')));
    expect(resaleOf('sofa', 'posh')).toBeGreaterThan(resaleOf('sofa'));
    expect(resaleOf('sofa', 'cheap')).toBeLessThan(resaleOf('sofa'));
  });

  it('wear out faster cheap and slower posh', () => {
    const sim = Sim.create(1);
    const [p] = tenants(sim);
    p.life!.traits = [];
    const wearOf = (grade: Grade) => {
      const f: Furniture = { id: 999, def: 'toilet', x: 0, s: 0, ...(grade === 'standard' ? {} : { grade }) };
      useUp(sim, f, p);
      return f.wear!;
    };
    const std = wearOf('standard');
    expect(wearOf('cheap')).toBeCloseTo(std * GRADES.wear.cheap, 9);
    expect(wearOf('posh')).toBeCloseTo(std * GRADES.wear.posh, 9);
  });

  it('make a flat look better or worse furnished', () => {
    const sim = Sim.create(2);
    skipHandover(sim);
    const flat = sim.layout.flats[2].id;
    const sofa = put(sim, 2, 'sofa', 'cheap');
    const cheap = scoreFor(sim, flat, 1).factors.furnishing;
    sofa.grade = 'posh';
    sim.changed();
    expect(scoreFor(sim, flat, 1).factors.furnishing).toBeGreaterThan(cheap);
  });

  it('keep posh locked until a good rating, a smart flat or day 30, and it stays open', () => {
    const sim = Sim.create(3);
    skipHandover(sim);
    expect(poshUnlocked(sim)).toBe(false);
    const [x, s] = spot(sim, 2, 'sofa');
    const money = sim.state.money;
    expect(buyFurniture(sim, 'sofa', x, s, false, undefined, 'posh')).toMatch(/posh suppliers/);
    expect(sim.state.money).toBe(money);
    // Cheap is always there.
    const cheap = buyFurniture(sim, 'sofa', x, s, false, undefined, 'cheap');
    expect(typeof cheap).not.toBe('string');
    expect((cheap as Furniture).grade).toBe('cheap');
    expect(sim.state.money).toBe(money - furniturePrice('sofa', 'cheap'));
    // Good reviews open it up; the morning says so, and it stays open after.
    sim.state.reviews = [4, 4, 3].map((stars) => ({ day: 2, who: 'Someone', flat: 'x', stars, text: '' }));
    expect(poshUnlocked(sim)).toBe(true);
    gradesMorning(sim);
    expect(sim.state.poshFrom).toBe(sim.day);
    expect(sim.state.notices.some((n) => /posh furniture/.test(n.text))).toBe(true);
    sim.state.reviews = [{ day: 3, who: 'Someone', flat: 'x', stars: 1, text: '' }];
    expect(poshUnlocked(sim)).toBe(true);
    // Or just keeping at it.
    const late = Sim.create(3);
    skipHandover(late);
    at(late, POSH_UNLOCK.day, 8);
    expect(poshUnlocked(late)).toBe(true);
  });

  it('upgrade from the card where they stand, for the difference, as good as new', () => {
    const sim = Sim.create(4);
    skipHandover(sim);
    const bed = put(sim, 2, 'bed', 'cheap');
    bed.wear = 0.7;
    bed.broken = 3;
    const { id, x, s } = bed;
    const count = sim.state.furniture.length;
    // Posh is locked to start with.
    expect(upgradeFurniture(sim, id, 'posh')).toMatch(/posh suppliers/);
    const money = sim.state.money;
    const toStandard = furniturePrice('bed') - furniturePrice('bed', 'cheap');
    expect(upgradeCost(bed, 'standard')).toBe(toStandard);
    expect(upgradeFurniture(sim, id, 'standard')).toBeNull();
    expect(sim.state.money).toBe(money - toStandard);
    expect(bed.grade).toBeUndefined();
    expect([bed.id, bed.x, bed.s]).toEqual([id, x, s]);
    expect(bed.wear).toBeUndefined();
    expect(bed.broken).toBeUndefined();
    expect(sim.state.furniture.length).toBe(count);
    unlock(sim);
    const toPosh = furniturePrice('bed', 'posh') - furniturePrice('bed');
    expect(upgradeFurniture(sim, id, 'posh')).toBeNull();
    expect(sim.state.money).toBe(money - toStandard - toPosh);
    expect(bed.grade).toBe('posh');
    expect([bed.x, bed.s]).toEqual([x, s]);
    // Nothing above posh, and nothing for a picture.
    expect(upgradeFurniture(sim, id, 'posh')).not.toBeNull();
    const pic = put(sim, 2, 'picture');
    expect(upgradeFurniture(sim, pic.id, 'posh')).not.toBeNull();
    // Too dear: nothing changes.
    const sofa = put(sim, 2, 'sofa');
    sim.state.money = 10 * POUND;
    expect(upgradeFurniture(sim, sofa.id, 'posh')).toMatch(/afford/);
    expect(sofa.grade).toBeUndefined();
  });

  it('draw burglars to posh things, which they take first', () => {
    const sim = Sim.create(5);
    skipHandover(sim);
    const lay = sim.layout;
    // A posh telly in one empty flat, an ordinary one in the other.
    put(sim, 2, 'tv');
    const plainRisk = burglaryRisk(sim);
    put(sim, 4, 'tv', 'posh');
    // Two ordinary tellies would be less of a draw than an ordinary one and a posh one.
    const withPosh = burglaryRisk(sim);
    const other = Sim.create(5);
    skipHandover(other);
    put(other, 2, 'tv');
    put(other, 4, 'tv');
    expect(withPosh).toBeGreaterThan(burglaryRisk(other));
    expect(withPosh).toBeGreaterThan(plainRisk);
    // The flat with the posh telly is the one they head for.
    at(sim, 12, 2);
    sim.state.story.running = [];
    expect(startBurglary(sim)).toBe(true);
    expect(sim.state.pawns.find((p) => p.kind === 'burglar')!.flat).toBe(lay.flats[4].id);
    // In one flat, a posh desk goes before an ordinary telly (which is dearer, both standard).
    const desk = put(sim, 2, 'desk', 'posh');
    expect(furniturePrice('desk')).toBeLessThan(furniturePrice('tv'));
    expect(pickings(sim, lay.flats[2])[0]).toBe(desk);
    delete desk.grade;
    expect(pickings(sim, lay.flats[2])[0].def).toBe('tv');
  });

  it('give labelled thoughts: a posh bed, a lumpy mattress, a house-proud kitchen', () => {
    const sim = Sim.create(6);
    skipHandover(sim);
    const flatOf = (id: string) => new Set(sim.layout.flatCells(sim.layout.flat(id)!));
    const [p] = tenants(sim);
    const mine = flatOf(p.life!.flat);
    const inMine = (f: Furniture) => mine.has(sim.layout.node(f.x, f.s));
    // House-proud, with a posh cooker: a thought that says so, and nothing hidden.
    p.life!.traits = ['houseProud'];
    for (const f of sim.state.furniture) if (inMine(f) && f.def === 'cooker') f.grade = 'posh';
    sim.changed();
    let thoughts = thoughtsOf(sim, p);
    expect(thoughts.some((t) => t.label === 'Posh kitchen' && t.value > 0)).toBe(true);
    expect(likingTarget(thoughts)).toBeCloseTo(Math.max(0, Math.min(100, BASELINE + thoughts.reduce((n, t) => n + t.value, 0))), 6);
    // Not if they aren't house-proud.
    p.life!.traits = [];
    expect(thoughtsOf(sim, p).some((t) => t.label.startsWith('Posh kitchen'))).toBe(false);
    // Every bed in the building posh: a night in one is a memory with a name.
    const night = (grade: Grade) => {
      for (const f of sim.state.furniture) if (f.def === 'bed' || f.def === 'doubleBed') f.grade = grade;
      sim.changed();
      const seen = new Set<string>();
      for (let t = 0; t < 2 * TICKS_PER_DAY; t += 10 * TICKS_PER_MINUTE) {
        sim.run(10 * TICKS_PER_MINUTE);
        for (const q of tenants(sim)) {
          for (const m of q.life!.memories) seen.add(m.id);
          thoughts = thoughtsOf(sim, q);
          expect(likingTarget(thoughts)).toBeCloseTo(Math.max(0, Math.min(100, BASELINE + thoughts.reduce((n, t) => n + t.value, 0))), 6);
        }
      }
      return seen;
    };
    const posh = night('posh');
    expect(posh.has('sleptPosh')).toBe(true);
    expect(MEMORIES.sleptPosh.value).toBeGreaterThan(MEMORIES.sleptWell.value);
    const cheap = night('cheap');
    expect(cheap.has('lumpyMattress')).toBe(true);
    expect(MEMORIES.lumpyMattress.label).toBe('Lumpy mattress');
  });

  it('save and load; old pieces with no grade are standard, and the building has a few cheap things', () => {
    const sim = Sim.create(7);
    expect(sim.state.furniture.filter((f) => f.grade === 'cheap').map((f) => f.def).sort()).toEqual(['sofa']);
    expect(sim.state.furniture.some((f) => f.grade === 'posh')).toBe(false);
    const raw = JSON.parse(serialize(sim));
    raw.furniture[0].grade = 'gold-plated';
    const pic = raw.furniture.find((f: Furniture) => f.def === 'picture');
    pic.grade = 'posh';
    const back = deserialize(JSON.stringify(raw)).state;
    expect(back.furniture[0].grade).toBeUndefined();
    expect(back.furniture.find((f) => f.id === pic.id)!.grade).toBeUndefined();
    expect(back.furniture.filter((f) => f.grade === 'cheap')).toHaveLength(1);
    expect(back.poshFrom).toBeUndefined();
  });
});
