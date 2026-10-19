import { describe, expect, it } from 'vitest';
import { MISSES_ALLOWED, POUND, flatInfo, goingRate, overpay } from '../src/sim/economy';
import { accept, changeRent, likelyLiking } from '../src/sim/leases';
import { deserialize, serialize } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/state';
import { rollTraits, traitDef, touchiness } from '../src/sim/traits';
import { landlord, type Policy } from './policy';

const played = new Map<string, Sim>();

/** Plays a scripted landlord (each combination once; the tests below share the results). */
function play(seed: number, policy: Policy, days: number): Sim {
  const key = `${seed}|${policy}|${days}`;
  if (!played.has(key)) played.set(key, run(seed, policy, days));
  return played.get(key)!;
}

function run(seed: number, policy: Policy, days: number): Sim {
  let sim = Sim.create(seed);
  for (let h = 0; h < days * 24; h++) {
    sim.run(TICKS_PER_HOUR);
    landlord(sim, policy);
    if (h % (24 * 20) === 0) sim = deserialize(serialize(sim));
  }
  return sim;
}

describe('money', () => {
  it('collects rent every morning and takes the mortgage on Mondays', () => {
    const sim = Sim.create(1);
    const before = sim.state.money;
    sim.run(TICKS_PER_DAY);
    const rent = sim.state.ledger.filter((e) => e.label.startsWith('Rent'));
    expect(rent.length).toBeGreaterThan(0);
    expect(sim.state.money).toBeGreaterThan(before);
    sim.run(7 * TICKS_PER_DAY);
    expect(sim.state.ledger.some((e) => e.label === 'Mortgage')).toBe(true);
  });

  it('repossesses after four missed payments in a row', () => {
    const sim = Sim.create(2);
    sim.state.money = -100000 * POUND;
    sim.run(30 * TICKS_PER_DAY);
    expect(sim.state.mortgage.missed).toBe(MISSES_ALLOWED);
    expect(sim.state.repossessed).toBeDefined();
    expect(sim.state.post.some((l) => l.title === 'Repossession')).toBe(true);
  });

  it('can be paid off, and then it is yours', () => {
    const sim = Sim.create(3);
    sim.state.money = 50000 * POUND;
    expect(overpay(sim, sim.state.mortgage.balance)).toBe(true);
    expect(sim.state.mortgage.paidOffDay).toBe(1);
  });
});

describe('letting', () => {
  it('draws applicants for empty flats, and a fair rent draws more than a steep one', () => {
    const count = (ratio: number) => {
      let n = 0;
      for (const seed of [1, 2, 3, 4]) {
        const sim = Sim.create(seed);
        for (const f of sim.layout.flats) {
          const info = flatInfo(sim, f.id);
          if (!info.lease) info.asking = Math.round(goingRate(sim, f.id) * ratio);
        }
        sim.run(4 * TICKS_PER_DAY);
        n += sim.state.applicants.length;
      }
      return n;
    };
    expect(count(1)).toBeGreaterThan(count(1.4));
  });

  it('moves an applicant in: deposit paid, lease started, people in the flat', () => {
    const sim = Sim.create(5);
    for (let i = 0; i < 6 * 24 && sim.state.applicants.length === 0; i++) sim.run(TICKS_PER_HOUR);
    const a = sim.state.applicants[0];
    expect(a).toBeDefined();
    expect(likelyLiking(sim, a)).toBeGreaterThan(0);
    const money = sim.state.money;
    expect(accept(sim, a.id)).toBeNull();
    const lease = flatInfo(sim, a.flat).lease!;
    expect(lease.rent).toBe(a.offer);
    expect(sim.state.money).toBe(money + lease.deposit);
    expect(sim.state.pawns.filter((p) => p.life?.flat === a.flat)).toHaveLength(a.people.length);
    // They know the one trait you were told about.
    const lead = sim.state.pawns.find((p) => p.name === a.people[0].name)!;
    expect(lead.life!.revealed).toEqual([a.shown]);
  });

  it('a rent rise takes a week, and they think less of you for it', () => {
    const sim = Sim.create(6);
    const flat = sim.layout.flats[0].id;
    const lease = flatInfo(sim, flat).lease!;
    const old = lease.rent;
    changeRent(sim, flat, old * 2);
    sim.run(3 * TICKS_PER_DAY);
    expect(lease.rent).toBe(old);
    sim.run(5 * TICKS_PER_DAY);
    expect(lease.rent).toBe(old * 2);
    const tenant = sim.state.pawns.find((p) => p.life?.flat === flat)!;
    expect(tenant.life!.memories.some((m) => m.id === 'rentRiseBig')).toBe(true);
  });
});

describe('traits', () => {
  it('rolls two or three that never clash or add up to someone always miserable', () => {
    const rng = { rng: 42 };
    for (let i = 0; i < 2000; i++) {
      const t = rollTraits(rng);
      expect(t.length).toBeGreaterThanOrEqual(2);
      expect(new Set(t).size).toBe(t.length);
      for (const a of t) for (const b of t) expect(traitDef(a).conflicts ?? []).not.toContain(b);
      expect(touchiness({ traits: t })).toBeLessThanOrEqual(10);
    }
  });
});

describe('scripted landlords over twelve weeks', () => {
  for (const policy of ['decent', 'ruthless'] as Policy[]) {
    it(`a ${policy} landlord keeps the building`, () => {
      for (const seed of [1, 2, 3]) {
        const sim = play(seed, policy, 84);
        expect(sim.state.repossessed, `seed ${seed}`).toBeUndefined();
        expect(sim.state.mortgage.balance, `seed ${seed}`).toBeLessThan(30000 * POUND);
      }
    });
  }

  it('the ruthless one makes more, and their tenants like it less', () => {
    let decentPaid = 0;
    let ruthlessPaid = 0;
    let decentLiking = 0;
    let ruthlessLiking = 0;
    for (const seed of [1, 2, 3]) {
      const d = play(seed, 'decent', 84);
      const r = play(seed, 'ruthless', 84);
      const liking = (s: Sim) => {
        const t = s.state.pawns.filter((p) => p.life && !p.life.leaving);
        return t.reduce((n, p) => n + p.life!.liking, 0) / Math.max(1, t.length);
      };
      decentPaid += 30000 * POUND - d.state.mortgage.balance + d.state.money;
      ruthlessPaid += 30000 * POUND - r.state.mortgage.balance + r.state.money;
      decentLiking += liking(d);
      ruthlessLiking += liking(r);
    }
    expect(ruthlessPaid).toBeGreaterThan(decentPaid);
    expect(ruthlessLiking).toBeLessThan(decentLiking);
  });
});
