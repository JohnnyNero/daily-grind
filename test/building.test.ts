import { describe, expect, it } from 'vitest';
import { buildRoom, furnitureProblem, placeFurniture, placeSegment, placeStair, removeSegment, restore, snapshot } from '../src/sim/build';
import { findPath } from '../src/sim/layout';
import { Sim } from '../src/sim/sim';
import { key } from '../src/sim/state';

describe('the starting building', () => {
  const sim = Sim.create(1);
  const lay = sim.layout;
  const { x0 } = sim.state.plot;

  it('has five flats, numbered from the ground up', () => {
    expect(lay.flats.map((f) => f.name)).toEqual(['Flat 1', 'Flat 2', 'Flat 3', 'Flat 4', 'Flat 5']);
    expect(lay.flats.map((f) => f.storeys[0])).toEqual([0, 1, 1, 2, 2]);
    expect(lay.flats.every((f) => f.enclosed)).toBe(true);
    expect(lay.sealed).toEqual([]);
  });

  it('shares the lobby and stairwell', () => {
    const lobby = lay.rooms[lay.roomOf[lay.node(x0 + 2, 0)]];
    expect(lobby.shared).toBe(true);
    // The stairwell links all three landings into one shared space.
    expect(lay.roomOf[lay.node(x0 + 9, 2)]).toBe(lobby.id);
  });

  it('lets the agent into every flat and back out', () => {
    for (const f of lay.flats) {
      const inside = lay.rooms[f.rooms[0]].nodes[0];
      const there = findPath(lay, lay.node(0, 0), inside, { all: true });
      expect(there, f.name).not.toBeNull();
      expect(findPath(lay, inside, lay.node(sim.state.w - 1, 0), { all: true }), f.name).not.toBeNull();
    }
  });

  it('keeps strangers out, and lets tenants into only their own flat', () => {
    const [one, two] = lay.flats;
    const inOne = lay.rooms[one.rooms[0]].nodes[0];
    const inTwo = lay.rooms[two.rooms[0]].nodes[0];
    const street = lay.node(0, 0);
    expect(findPath(lay, street, inOne, {})).toBeNull();
    expect(findPath(lay, street, inOne, { flats: [one.id] })).not.toBeNull();
    expect(findPath(lay, street, inTwo, { flats: [one.id] })).toBeNull();
  });
});

describe('building', () => {
  it("won't put a wall through furniture or stairs", () => {
    const sim = Sim.create(1);
    const { x0 } = sim.state.plot;
    expect(placeSegment(sim.state, x0 + 1, 0, 'wall')).toBe('Furniture in the way');
    expect(placeSegment(sim.state, x0 + 9, 0, 'wall')).toBe('Stairs in the way');
    expect(placeSegment(sim.state, x0 - 1, 0, 'wall')).toBe('Outside your plot');
  });

  it('puts doors and windows in a slot in a wall, not on their own', () => {
    const sim = Sim.create(1);
    const st = sim.state;
    const { x0 } = st.plot;
    // Column 3 of the lobby is open floor.
    expect(placeSegment(st, x0 + 3, 2, 'door')).toBe('Goes in a wall: put a wall up first');
    expect(placeSegment(st, x0 + 7, 0, 'window')).toBe('Goes in a wall: put a wall up first');
    // The studio's front door sits in its wall: it can be swapped for a window.
    expect(placeSegment(st, x0 + 7, 1, 'window')).toBeNull();
  });

  it('checks where furniture can go', () => {
    const sim = Sim.create(1);
    const st = sim.state;
    const { x0 } = st.plot;
    expect(furnitureProblem(st, 'sofa', x0 + 21, 2, 0)).toBeNull();
    expect(furnitureProblem(st, 'picture', x0 + 21, 2, 0)).toMatch(/wall/);
    expect(furnitureProblem(st, 'sofa', x0 + 21, 2, 1)).toMatch(/floor/);
    expect(furnitureProblem(st, 'fridge', x0 + 21, 2, 0)).toBeNull();
    expect(furnitureProblem(st, 'sofa', x0 + 26, 2, 0)).toMatch(/wall|plot/i);
    expect(furnitureProblem(st, 'sofa', x0 + 15, 1, 0)).toMatch(/in the way/);
  });

  it('builds a room upward and turns it into a new flat', () => {
    const sim = Sim.create(1);
    const st = sim.state;
    const { x0 } = st.plot;
    // A new storey over the stairwell's flats, reached by stairs from the top landing.
    expect(buildRoom(st, x0 + 7, 3, x0 + 13, 3)).toBeGreaterThan(0);
    for (let x = x0 + 8; x <= x0 + 12; x++) expect(st.slabs[key(x, 4)]).toBe(true);
    expect(placeStair(st, x0 + 9, 2, 1)).toBeNull();
    expect(placeSegment(st, x0 + 7, 3, 'flatDoor')).toBeNull();
    // ...but its door opens onto nothing, so the room is reached only by the stairs: shared.
    sim.changed();
    const lay = sim.layout;
    expect(lay.rooms[lay.roomOf[lay.node(x0 + 10, 3)]].shared).toBe(true);
  });

  it('undoes', () => {
    const sim = Sim.create(1);
    const st = sim.state;
    const before = snapshot(st);
    removeSegment(st, st.plot.x0 + 13, 0);
    placeFurniture(st, 'plant', st.plot.x0 + 12, 0, 0);
    expect(snapshot(st)).not.toBe(before);
    restore(st, before);
    expect(snapshot(st)).toBe(before);
  });
});
