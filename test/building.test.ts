import { describe, expect, it } from 'vitest';
import { buildRoom, furnitureProblem, placeCell, placeFurniture, placeStairs, removeCell, restore, snapshot, stairsProblem, unsupported } from '../src/sim/build';
import { key } from '../src/sim/state';
import { findPath } from '../src/sim/layout';
import { Sim } from '../src/sim/sim';

describe('the starting building', () => {
  const sim = Sim.create(1);
  const lay = sim.layout;
  const { x0 } = sim.state.plot;

  it('has five flats, numbered from the ground up', () => {
    expect(lay.flats.map((f) => f.name)).toEqual(['Flat 1', 'Flat 2', 'Flat 3', 'Flat 4', 'Flat 5']);
    
    expect(lay.flats.every((f) => f.enclosed)).toBe(true);
    expect(lay.sealed).toEqual([]);
  });

  it('shares the lobby and stairwell', () => {
    const lobby = lay.rooms[lay.roomOf[lay.node(x0 + 2, 1)]];
    expect(lobby.shared).toBe(true);
    // Through a door, the stairwell links all three landings into one shared space.
    const stairs = lay.rooms[lay.roomOf[lay.node(x0 + 9, 1)]];
    expect(stairs.shared).toBe(true);
    expect(lay.roomOf[lay.node(x0 + 10, 9)]).toBe(stairs.id);
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
  it("won't put a wall through furniture or stairs, or outside the plot", () => {
    const sim = Sim.create(1);
    const { x0 } = sim.state.plot;
    expect(placeCell(sim.state, x0 + 1, 1, 'wall')).toBe('Furniture in the way');
    expect(placeCell(sim.state, x0 + 9, 1, 'wall')).toBe('Stairs in the way');
    expect(placeCell(sim.state, x0 - 1, 0, 'wall')).toBe('Outside your plot');
  });

  it('starts with everything held up', () => {
    expect(unsupported(Sim.create(1).state.cells)).toBeNull();
  });

  it('lets a ledge stick out four cells, not five', () => {
    const sim = Sim.create(1);
    const st = sim.state;
    const { x0 } = st.plot;
    // A post on the roof (row 12 is the roof), then a ledge off the top of it.
    // The post stands over a wall (column 7), so it's held up all the way down.
    for (let s = 13; s <= 15; s++) expect(placeCell(st, x0 + 7, s, 'wall')).toBeNull();
    for (let i = 1; i <= 4; i++) expect(placeCell(st, x0 + 7 + i, 15, 'wall'), `cell ${i}`).toBeNull();
    expect(placeCell(st, x0 + 12, 15, 'wall')).toMatch(/holding it up/);
    // And the post can't come out now: the ledge hangs off it.
    expect(removeCell(st, x0 + 7, 14)).toMatch(/holding other bits up/);
  });

  it('counts a ledge from the post it comes off, wherever the post stands', () => {
    const sim = Sim.create(1);
    const st = sim.state;
    const { x0 } = st.plot;
    // A post on the roof, part-way between the walls under it: standing on the roof, it's held.
    for (let s = 13; s <= 15; s++) expect(placeCell(st, x0 + 16, s, 'wall')).toBeNull();
    // Four along from it is fine; the fifth isn't.
    for (let i = 1; i <= 4; i++) expect(placeCell(st, x0 + 16 + i, 15, 'wall'), `cell ${i}`).toBeNull();
    expect(placeCell(st, x0 + 21, 15, 'wall')).toMatch(/holding it up/);
  });

  it('puts doors and windows in gaps and walls, and a door needs a floor', () => {
    const sim = Sim.create(1);
    const st = sim.state;
    const { x0 } = st.plot;
    // A two-cell gap on the top floor's landing: a door goes in it.
    expect(placeCell(st, x0 + 10, 9, 'door')).toBeNull();
    // A window into the side of the lobby wall.
    expect(placeCell(st, x0, 5, 'window')).toBeNull();
    // A door in mid air can't.
    expect(placeCell(st, x0 + 10, 10, 'door')).toBe('A door is in the way: knock it out first');
    expect(placeCell(st, x0 + 5, 2, 'door')).toBe('A door needs something to stand on');
  });

  it('checks where furniture can go', () => {
    const sim = Sim.create(1);
    const st = sim.state;
    const { x0 } = st.plot;
    // The top one-bed is empty: row 9 stands on the floor below.
    expect(furnitureProblem(st, 'sofa', x0 + 21, 9)).toBeNull();
    expect(furnitureProblem(st, 'picture', x0 + 21, 10)).toBeNull();
    expect(furnitureProblem(st, 'sofa', x0 + 21, 10)).toMatch(/floor/);
    expect(furnitureProblem(st, 'sofa', x0 + 26, 9)).toMatch(/wall|plot/i);
    expect(furnitureProblem(st, 'sofa', x0 + 15, 1)).toMatch(/in the way/);
  });

  it('builds a room on the roof and turns it into a flat', () => {
    const sim = Sim.create(1);
    const st = sim.state;
    const { x0 } = st.plot;
    // A box on the roof (whose top row is 12), with stairs up to it from the top landing.
    expect(buildRoom(st, x0 + 7, 12, x0 + 13, 16)).toBeGreaterThan(0);
    sim.changed();
    let lay = sim.layout;
    const inside = lay.roomOf[lay.node(x0 + 10, 13)];
    expect(lay.rooms[inside].outdoor).toBe(false);
    // A flight up from the top landing, through the roof into the box.
    expect(placeStairs(st, x0 + 10, 9)).toBeNull();
    sim.changed();
    lay = sim.layout;
    expect(findPath(lay, lay.node(x0 + 8, 9), lay.node(x0 + 10, 13), { all: true })).not.toBeNull();
  });

  it('puts a flight of stairs up one column, from a floor through the floor above', () => {
    const sim = Sim.create(1);
    const st = sim.state;
    const { x0 } = st.plot;
    // Up from the bottom of the stairwell (row 1) through the first floor (row 4).
    expect(placeStairs(st, x0 + 12, 1)).toBeNull();
    for (let r = 1; r <= 4; r++) expect(st.cells[key(x0 + 12, r)]).toBe('stair');
    // Not from mid-air, not through a wall, not twice.
    expect(stairsProblem(st, x0 + 3, 2)).toMatch(/floor to start from/);
    expect(stairsProblem(st, x0 + 7, 1)).toMatch(/door|wall/i);
    expect(stairsProblem(st, x0 + 12, 1)).toMatch(/already/);
    expect(stairsProblem(st, x0 + 2, 5)).toMatch(/furniture/i);
    sim.changed();
    const lay = sim.layout;
    // Someone can climb it, up the column and off the top onto the landing.
    expect(findPath(lay, lay.node(x0 + 10, 1), lay.node(x0 + 12, 3), { all: true })).not.toBeNull();
    expect(lay.neighbours(lay.node(x0 + 12, 4))).toContain(lay.node(x0 + 12, 5));
    // Knocking down any of it takes the whole flight.
    expect(removeCell(st, x0 + 12, 3)).toBeNull();
    for (let r = 1; r <= 4; r++) expect(st.cells[key(x0 + 12, r)]).toBeUndefined();
  });

  it('undoes', () => {
    const sim = Sim.create(1);
    const st = sim.state;
    const before = snapshot(st);
    removeCell(st, st.plot.x0 + 13, 3);
    placeFurniture(st, 'plant', st.plot.x0 + 12, 1);
    expect(snapshot(st)).not.toBe(before);
    restore(st, before);
    expect(snapshot(st)).toBe(before);
  });
});
