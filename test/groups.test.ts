import { describe, expect, it } from 'vitest';
import { POUND, flatInfo } from '../src/sim/economy';
import { running, startFight, startParty } from '../src/sim/events';
import { makePerson } from '../src/sim/leases';
import { Sim } from '../src/sim/sim';
import { opinion, rememberAbout } from '../src/sim/social';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, seconds, type Pawn } from '../src/sim/state';
import { moveIn } from '../src/sim/tenants';
import { noiseThrough } from '../src/sim/environment';
import { homeAndAwake } from './stage';

const tenants = (sim: Sim) => sim.state.pawns.filter((p) => p.life && !p.life.leaving);

function at(sim: Sim, day: number, hour: number): void {
  sim.state.tick = (day - 1) * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
}

function newTenant(sim: Sim, flat: number): Pawn {
  const f = sim.layout.flats[flat];
  flatInfo(sim, f.id).lease = { rent: 80 * POUND, startDay: 1, endDay: 60, deposit: 0, owed: 0, paid: 0, late: 0 };
  return moveIn(sim, f.id, [makePerson(sim.state, undefined, false)])[0];
}

/** Where the flat's front door is, and whether a pawn is out on the shared landing near it. */
function onLanding(sim: Sim, flatId: string, p: Pawn): boolean {
  const lay = sim.layout;
  const [dx, ds] = lay.flat(flatId)!.doors[0].split(',').map(Number);
  const room = lay.roomOf[lay.node(Math.round(p.x), Math.round(p.s))];
  return room !== -1 && lay.rooms[room].shared && Math.round(p.s) === ds && Math.abs(p.x - dx) <= 3;
}

describe('a party as a group', () => {
  it('moves through arriving, full swing, winding down and leaving, and the noise follows', () => {
    const sim = Sim.create(1);
    at(sim, 12, 19);
    const flat = sim.layout.flats[0].id;
    const h = startParty(sim, flat)!;
    expect(h.phase).toBe('arriving');
    const seen: string[] = [];
    const noise: Record<string, number> = {};
    while (sim.state.tick < h.until + 5 * TICKS_PER_MINUTE) {
      sim.run(TICKS_PER_MINUTE);
      const ph = running(sim, 'party', flat)?.phase;
      if (ph && !seen.includes(ph)) seen.push(ph);
      if (ph) noise[ph] = Math.max(noise[ph] ?? 0, sim.noise().get(flat) ?? 0);
    }
    expect(seen).toEqual(['arriving', 'swing', 'winding', 'leaving']);
    expect(noise.swing).toBeGreaterThan(noise.leaving);
    expect(noise.swing).toBeGreaterThan(noise.arriving);
    expect(running(sim, 'party')).toBeUndefined();
  });

  it('has people dancing and out on the landing in full swing, and a smoker out the front', () => {
    const sim = Sim.create(1);
    at(sim, 12, 19);
    const flat = sim.layout.flats[0].id;
    const h = startParty(sim, flat)!;
    h.queue = 6;
    // Everyone turns up at once, so the evening is in full swing straight away and stays so for
    // hours: eight of them, as the walk down to the pavement for a smoke now takes three times the
    // game minutes it did, so each guest gets round to fewer things an hour.
    h.until = sim.state.tick + 9 * TICKS_PER_HOUR;
    let landing = 0;
    let dancing = 0;
    let smoking = 0;
    let hosted = 0;
    for (let i = 0; i < 8 * 60 && running(sim, 'party', flat); i++) {
      h.next = sim.state.tick;
      sim.run(TICKS_PER_MINUTE);
      if (running(sim, 'party', flat)?.phase !== 'swing') continue;
      for (const g of sim.state.pawns.filter((p) => p.kind === 'guest')) {
        if (g.doing === 'Out on the landing' && onLanding(sim, flat, g)) landing++;
        if (g.pose === 'dance') dancing++;
        if (g.doing === 'Having a smoke out the front') smoking++;
      }
      if (tenants(sim).some((p) => p.life!.flat === flat && p.partyAt === flat)) hosted++;
    }
    expect(landing).toBeGreaterThan(0);
    expect(dancing).toBeGreaterThan(0);
    expect(smoking).toBeGreaterThan(0);
    expect(hosted).toBeGreaterThan(0);
  });

  it('has guests leave in a stream rather than all at once', () => {
    const sim = Sim.create(1);
    at(sim, 12, 19);
    const flat = sim.layout.flats[0].id;
    const h = startParty(sim, flat)!;
    h.queue = 6;
    h.next = sim.state.tick;
    while (running(sim, 'party', flat)?.phase !== 'leaving') sim.run(TICKS_PER_MINUTE);
    const guests = () => sim.state.pawns.filter((p) => p.kind === 'guest');
    const leaving = () => guests().filter((g) => g.task === 'leave').length;
    expect(guests().length).toBeGreaterThan(3);
    expect(leaving()).toBe(guests().length);
    expect(guests().filter((g) => g.doing === 'Getting their coat').length).toBeGreaterThan(1);
  });

  it('takes a neighbour who likes the host up to the party, and they like the host more after', () => {
    const sim = Sim.create(1);
    at(sim, 12, 19);
    const flatA = sim.layout.flats[0].id;
    const host = tenants(sim).find((p) => p.life!.flat === flatA)!;
    const guest = tenants(sim).find((p) => p.life!.flat !== flatA)!;
    host.life!.traits = ['partyAnimal'];
    for (let i = 0; i < 3; i++) rememberAbout(sim, guest, 'chat', host);
    const before = opinion(sim, guest, host);
    const h = startParty(sim, flatA)!;
    expect(h.invited).toContain(guest.id);
    let joined = false;
    for (let i = 0; i < 3 * 60 && !joined; i++) {
      sim.run(TICKS_PER_MINUTE);
      joined = !!h.joined?.includes(guest.id);
    }
    expect(joined).toBe(true);
    expect(guest.life!.memories.some((m) => m.id === 'goodParty')).toBe(true);
    expect(opinion(sim, guest, host)).toBeGreaterThan(before);
    // They actually get there, and home again afterwards.
    sim.run(2 * TICKS_PER_HOUR);
    expect(sim.layout.flatAt(Math.round(guest.x), Math.round(guest.s))?.id === flatA || guest.partyAt === flatA).toBe(true);
    sim.run(h.until - sim.state.tick + 3 * TICKS_PER_HOUR);
    expect(guest.partyAt).toBeUndefined();
    expect(sim.layout.flatAt(Math.round(guest.x), Math.round(guest.s))?.id).toBe(guest.life!.flat);
  });

  it('has a neighbour knock on the door late on, and the music can go down', () => {
    let turnedDown = 0;
    let knocked = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const sim = Sim.create(seed);
      at(sim, 12, 20);
      for (const i of [1, 2, 3, 4]) newTenant(sim, i);
      const flat = sim.layout.flats[2].id;
      const h = startParty(sim, flat)!;
      h.volume = 2;
      h.queue = 6;
      h.next = sim.state.tick;
      // Just before eleven, the neighbour who hears it worst is in and still up.
      while (sim.minuteOfDay !== 22 * 60 + 59) sim.run(TICKS_PER_MINUTE);
      const next = tenants(sim).filter((p) => p.life!.flat !== flat).sort((a, b) => noiseThrough(sim, flat, b.life!.flat) - noiseThrough(sim, flat, a.life!.flat))[0];
      homeAndAwake(sim, next);
      sim.run(2 * TICKS_PER_MINUTE);
      // Someone's said something by now, at the door or in the chat.
      expect(h.flag, `seed ${seed}`).toBeDefined();
      if (h.flag === 'knocking') knocked++;
      // Time for the walk to their door, which takes real time, not game time.
      sim.run(seconds(30));
      if (h.volume === 0.5) turnedDown++;
      expect(h.knock).toBeUndefined();
    }
    expect(knocked).toBeGreaterThan(0);
    expect(turnedDown).toBeGreaterThan(0);
  });
});

describe('a fight with onlookers', () => {
  /** Two fighters and a bystander side by side on a landing. */
  function scene(trait: string, fond = false) {
    const sim = Sim.create(1);
    at(sim, 12, 12);
    const [a, b, w] = [tenants(sim)[0], tenants(sim)[1], newTenant(sim, 2)];
    const lay = sim.layout;
    const room = lay.rooms.find((r) => r.shared && r.nodes.length > 3)!;
    const nodes = room.nodes.map((n) => lay.xs(n)).filter(([, s], _i, all) => s === all[0][1]);
    for (const [p, [x, s]] of [[a, nodes[0]], [b, nodes[1]], [w, nodes[2]]] as [Pawn, [number, number]][]) {
      p.x = x;
      p.s = s;
      p.path = [];
      p.goal = null;
      delete p.pose;
      p.life!.using = null;
    }
    w.life!.traits = [trait];
    if (fond) for (let i = 0; i < 3; i++) rememberAbout(sim, w, 'chat', a);
    return { sim, a, b, w };
  }

  it('is filmed by a busybody, who posts about it', () => {
    let filmed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = scene('busybody');
      s.sim.state.rng = seed * 7919;
      startFight(s.sim, s.a, s.b);
      if (s.w.doing !== 'Filming the fight') continue;
      filmed++;
      expect(s.w.bubble?.text).toContain('REC');
      expect(s.sim.state.chat.some((m) => m.from === s.w.id)).toBe(true);
    }
    expect(filmed).toBeGreaterThan(0);
  });

  it('is broken up by a friend of one of them, who takes the hit and gets thanked', () => {
    let stepped = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = scene('friendly', true);
      s.sim.state.rng = seed * 7919;
      startFight(s.sim, s.a, s.b);
      if (!s.w.doing.startsWith('Breaking up')) continue;
      stepped++;
      expect(s.w.life!.memories.some((m) => m.id === 'brokeItUp')).toBe(true);
      expect(s.a.life!.social.some((m) => m.id === 'favour' && m.about === s.w.id)).toBe(true);
      // Stepping in stops it within a few real seconds (it's timed on screen, not in game minutes).
      s.sim.run(seconds(5));
      expect(running(s.sim, 'fight')).toBeUndefined();
    }
    expect(stepped).toBeGreaterThan(0);
  });

  it('leaves the two fighters unable to stand the sight of each other', () => {
    const { sim, a, b } = scene('friendly');
    startFight(sim, a, b);
    expect(a.life!.memories.some((m) => m.id === 'cantStand')).toBe(true);
    expect(opinion(sim, a, b)).toBeLessThanOrEqual(-30);
  });
});
