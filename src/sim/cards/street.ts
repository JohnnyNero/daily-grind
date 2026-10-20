// Street cards (spec 1.4, source S): visitors at the door, vans, the cat, next door, kids.
// At most 25% of cards, and every one still needs a reason to be here.
//
// Cards here: Applicant at the door (1), Parcel for someone out (2), Man in a van (3) and
// what comes of it (vanBreak), Cat on the stairs (4), Meter reader (10) and its follow-up
// (meterAgain), Sofa on the pavement (13), Scaffolding (21), Post for Mr Pritchard (23),
// Fly-tipped mattress (24), Pizza for an empty flat (30).
//
// Each card is a CardDef (types.ts); every one passes the consequence rule (rule.ts,
// test/cards.rule.test.ts). A card never changes the state: `resolve` rolls dice on sim.state
// and hands back effects. Visitors (a courier, the meter man, the van) are the drip's and
// visitors.ts's to put on the map when the card opens; `when` only notices one if it's about.

import { flatInfo } from '../economy';
// POUND from tuning.ts (which imports nothing): CASH below is worked out at load time, maybe before economy.ts has loaded.
import { POUND } from '../tuning';
import { SHARED, itemsIn } from '../environment';
import { gradeOf } from '../grades';
import { scoreFor } from '../impressiveness';
import { household, newApplicant } from '../leases';
import { random } from '../rng';
import type { Sim } from '../sim';
import type { Card, Furniture, Pawn } from '../state';
import { TICKS_PER_DAY } from '../state';
import { tale } from '../tales';
import { repairCost } from '../upkeep';
import { furnitureDef } from '../defs';
import { hasFlag, setFlag } from '../flags';
import { placeFurniture } from '../build';
import { fixtureSim, letFlat, sitting } from './rule';
import type { CardDef, CardSubject, Outcome } from './types';

// ------------------------------------------------------------------ small helpers

const first = (p: Pawn): string => p.name.split(' ')[0];
const folk = (sim: Sim): Pawn[] => sim.state.pawns.filter((p) => p.life && !p.life.leaving);
const byId = (sim: Sim, id: number | undefined): Pawn | undefined => (id === undefined ? undefined : sim.state.pawns.find((p) => p.id === id));
const is = (p: Pawn, trait: string): boolean => p.life!.traits.includes(trait);
const isHome = (p: Pawn): boolean => !p.life!.away && p.pose !== 'sleep';
const flatName = (sim: Sim, id: string | undefined): string => (id ? (sim.layout.flat(id)?.name ?? 'a flat') : 'a flat');
const between = (sim: Sim, from: number, to: number): boolean => sim.minuteOfDay >= from * 60 && sim.minuteOfDay < to * 60;
const remembers = (p: Pawn, id: string): boolean => p.life!.memories.some((m) => m.id === id);
const mem = (p: Pawn, id: string): string => `mem:${p.id}:${id}`;
const out = (effects: string[], notice: string): Outcome => ({ effects, notice });
const chance = (sim: Sim, p: number): boolean => random(sim.state) < p;
/** Retired, so in all day (not just someone without a job: some work from home now). */
const retired = (p: Pawn): boolean => p.life!.schedule === 'retired';
const hidden = (p: Pawn): string[] => p.life!.traits.filter((t) => !p.life!.revealed.includes(t));
const sittingTenant = (sim: Sim, p: Pawn): boolean => !!flatInfo(sim, p.life!.flat).lease?.sitting;
const hasIntercom = (sim: Sim): boolean => itemsIn(sim, SHARED, 'intercom') > 0;

/** Who'd be about to answer: tenants at home, the sort most likely to be in first. */
function homeFolk(sim: Sim): Pawn[] {
  return folk(sim)
    .filter(isHome)
    .sort((a, b) => a.id - b.id);
}

/** Flats nobody lives in, emptiest first. */
function emptyFlats(sim: Sim): string[] {
  const lay = sim.layout;
  const bare = (id: string) => sim.state.furniture.filter((f) => lay.flatAt(f.x, f.s)?.id === id).length;
  return lay.flats
    .filter((f) => !flatInfo(sim, f.id).lease)
    .map((f) => f.id)
    .sort((a, b) => bare(a) - bare(b));
}

/** The flats against next door's wall: the scaffolding goes up outside these. */
function sideFlats(sim: Sim): Set<string> {
  const lay = sim.layout;
  const edge = sim.state.plot.x0 + 1;
  return new Set(lay.flats.filter((f) => lay.flatCells(f).some((n) => lay.xs(n)[0] <= edge)).map((f) => f.id));
}

/** Gives a tenant these traits (and none shown), for a fixture. */
function setTraits(p: Pawn, traits: string[]): void {
  p.life!.traits = traits;
  p.life!.revealed = [];
}

function away(sim: Sim, p: Pawn): void {
  p.life!.away = { until: sim.state.tick + 6 * 60 * 60, why: 'work' };
}

/** A fixture's subject for a pawn. */
const about = (p: Pawn, more: Partial<CardSubject> = {}): CardSubject => ({ pawn: p.id, ...more });

// ------------------------------------------------------------------ 1. Applicant at the door

/** A flat that would put off someone who's been shown it as it is. */
function roughFlat(sim: Sim, flatId: string, people: number): boolean {
  const s = scoreFor(sim, flatId, people);
  const basics = s.has.bed && s.has.toilet && s.has.wash && s.has.kitchen;
  return flatInfo(sim, flatId).style === 'agent' || s.tier === 'Grim' || s.tier === 'Shabby' || !basics;
}

function applicantFixture(flatIndex: number, hostTraits: string[]) {
  return (seed: number) => {
    const sim = fixtureSim(seed);
    const flat = sim.layout.flats[flatIndex];
    flatInfo(sim, flat.id).listed = true;
    const a = newApplicant(sim, flat.id);
    sim.state.applicants.push(a);
    const host = sitting(sim)[0];
    setTraits(host, hostTraits);
    return { sim, subject: { flat: flat.id, data: { applicant: a.id, host: host.id } } as CardSubject };
  };
}

const applicantAtTheDoor: CardDef = {
  id: 'applicantDoor',
  source: 'street',
  kind: 'door',
  cooldownDays: 2,
  turnsOn: ['flat against its listing', 'whoIsHome', 'trait:complainer'],
  icon: 'door',
  when(sim) {
    if (!between(sim, 9, 18)) return [];
    const host = homeFolk(sim).find((p) => sittingTenant(sim, p)) ?? homeFolk(sim)[0];
    if (!host) return [];
    const st = sim.state;
    return st.applicants
      .filter((a) => a.until > st.tick && !flatInfo(sim, a.flat).lease && flatInfo(sim, a.flat).listed)
      .map((a) => ({ flat: a.flat, data: { applicant: a.id, host: host.id } }));
  },
  hook: (sim, card) => `${leadOf(sim, card)} is on the step.`,
  text: (sim, card) => `${leadOf(sim, card)} is on the step about ${flatName(sim, card.flat)}. They've brought a cake.`,
  name: (sim, card) => `${leadOf(sim, card)} · ${flatName(sim, card.flat)}`,
  choices(sim, card) {
    const host = byId(sim, Number(card.data?.host));
    return [
      { label: 'Show them round', note: '' },
      { label: host ? `Ask ${first(host)}` : 'Ask a tenant', note: '' },
    ];
  },
  resolve(sim, card, answer) {
    const a = sim.state.applicants.find((x) => x.id === Number(card.data?.applicant));
    const flat = card.flat ?? a?.flat ?? '';
    const host = byId(sim, Number(card.data?.host));
    const rough = roughFlat(sim, flat, a?.people.length ?? 1);
    const gone = a ? [`lose:${a.id}`] : [];
    const word = (): string[] => (rough ? [...gone, `flag:slowLet:${flat}:3`] : [`flag:goodWord:${flat}:6`]);
    if (answer === 0) {
      return out(word(), rough ? 'You showed them round. They saw it as it is, and said so on the way out.' : 'You showed them round. They liked what they saw, and it got round.');
    }
    if (answer === 1) {
      if (!host) return out(word(), 'Nobody was in to ask.');
      const moaner = is(host, 'complainer') || is(host, 'knowsRights');
      const e = [mem(host, 'askedToHelp'), ...(rough ? word() : moaner ? gone : word())];
      return out(e, rough ? `${first(host)} showed them round. The flat did the rest.` : moaner ? `${first(host)} showed them round and mentioned the boiler. They left.` : `${first(host)} showed them round. They got on.`);
    }
    // Nobody came: she waits, then goes, and says so.
    const e = [...gone, `flag:slowLet:${flat}:3`];
    if (host) e.push(mem(host, 'leftToIt'));
    return out(e, 'Nobody answered. They went off with the cake.');
  },
  fixtures: [
    { name: 'decent flat, friendly host', build: applicantFixture(1, ['friendly', 'easyGoing']) },
    { name: 'grim flat, complainer host', build: applicantFixture(2, ['complainer', 'knowsRights']) },
    { name: 'decent flat, complainer host', build: applicantFixture(1, ['complainer', 'houseProud']) },
  ],
};

function leadOf(sim: Sim, card: Card): string {
  const a = sim.state.applicants.find((x) => x.id === Number(card.data?.applicant));
  return a ? first({ name: a.people[0].name } as Pawn) : 'Someone';
}

// ------------------------------------------------------------------ 2. Parcel for someone out

function parcelFixture(setup: (sim: Sim) => void) {
  return (seed: number) => {
    const sim = fixtureSim(seed);
    setup(sim);
    const p = sitting(sim)[0];
    away(sim, p);
    return { sim, subject: about(p) };
  };
}

/** Puts an intercom on the lobby wall, if there's room. */
function fitIntercom(sim: Sim): void {
  const lay = sim.layout;
  for (const r of lay.rooms.filter((x) => x.shared)) {
    for (const n of r.cells) {
      const [x, s] = lay.xs(n);
      if (typeof placeFurniture(sim.state, 'intercom', x, s) !== 'string') {
        sim.changed();
        return;
      }
    }
  }
}

const parcel: CardDef = {
  id: 'parcel',
  source: 'street',
  kind: 'door',
  cooldownDays: 6,
  turnsOn: ['locks', 'intercom', 'hidden traits'],
  icon: 'van',
  when(sim) {
    if (!between(sim, 9, 20)) return [];
    const courier = sim.state.pawns.find((p) => p.kind === 'visitor' && p.role === 'courier');
    return folk(sim)
      .filter((p) => p.life!.away)
      .map((p) => ({ pawn: p.id, ...(courier ? { visitor: courier.id, weight: 3 } : {}) }));
  },
  hook: (sim, card) => `Parcel for ${first(byId(sim, card.pawn)!)}.`,
  text: (sim, card) => `Parcel for ${first(byId(sim, card.pawn)!)}, who's out. The courier wants it taken.`,
  choices() {
    return [
      { label: 'Take it in', note: '' },
      { label: 'Lobby will do', note: '' },
    ];
  },
  resolve(sim, card, answer) {
    const p = byId(sim, card.pawn)!;
    const n = first(p);
    const locks = sim.state.security.locks;
    const walks = (odds: number) => chance(sim, odds);
    const gone = (): string[] => [mem(p, 'parcelNicked'), `tale:parcelNicked:${p.id}`, 'risk:burglary:1:3'];
    if (answer === 0) {
      const peek = chance(sim, 0.2);
      const left = hidden(p);
      const e = [mem(p, 'tookParcel')];
      if (peek && left.length > 0) e.push(`reveal:${p.id}:${left[0]}`);
      return out(e, peek && left.length > 0 ? `You took ${n}'s parcel in. The box gave a bit away.` : `You took ${n}'s parcel in.`);
    }
    if (answer === 1) {
      const odds = hasIntercom(sim) ? 0 : locks ? 0.1 : 0.25;
      if (walks(odds)) return out(gone(), `${n}'s parcel sat in the lobby. Then it didn't.`);
      // With the intercom the courier buzzed an empty flat first, and that is what they hear about.
      if (hasIntercom(sim)) return out([mem(p, 'keptWaiting')], `${n}'s parcel sat in the lobby. The intercom buzzed an empty flat first.`);
      return out([mem(p, 'missedParcel')], `${n}'s parcel sat in the lobby. It was still there.`);
    }
    // Left on the step: it says nobody's in.
    if (walks(0.5)) return out([mem(p, 'leftToIt'), ...gone()], `${n}'s parcel was left on the step. It walked.`);
    return out([mem(p, 'leftToIt'), mem(p, 'missedParcel'), 'risk:burglary:1:3'], `${n}'s parcel was left on the step. It's still there, and so is the message that nobody's in.`);
  },
  fixtures: [
    { name: 'no locks', build: parcelFixture(() => {}) },
    { name: 'locks', build: parcelFixture((sim) => (sim.state.security.locks = true)) },
    { name: 'intercom', build: parcelFixture((sim) => fitIntercom(sim)) },
  ],
};

// ------------------------------------------------------------------ 3. Man in a van

const CASH = 40 * POUND;
const WORN_PAST = 0.7;
/** How worn a bodged thing is afterwards: it works, but it's a step down. */
const BODGED: Record<string, number> = { cheap: 0.45, standard: 0.6, posh: 0.75 };

function thingIn(sim: Sim, card: Card): Furniture | undefined {
  return sim.state.furniture.find((f) => f.id === card.furniture);
}

function vanFixture(traits: string[], def: string) {
  return (seed: number) => {
    const sim = fixtureSim(seed);
    const p = sitting(sim)[0];
    setTraits(p, traits);
    const lay = sim.layout;
    const f = sim.state.furniture.find((x) => x.def === def && lay.flatAt(x.x, x.s)?.id === p.life!.flat)!;
    f.wear = 0.85;
    return { sim, subject: about(p, { flat: p.life!.flat, furniture: f.id }) };
  };
}

const manInAVan: CardDef = {
  id: 'manInAVan',
  opens: [0, 1],
  source: 'street',
  kind: 'door',
  cooldownDays: 7,
  turnsOn: ['trait:complainer', 'trait:haggler', 'trait:knowsRights', 'furniture grade'],
  icon: 'van',
  when(sim) {
    const st = sim.state;
    if (st.money < 200 * POUND || !between(sim, 9, 18)) return [];
    const lay = sim.layout;
    const found: CardSubject[] = [];
    for (const f of st.furniture) {
      const d = furnitureDef(f.def);
      if (!d.offers || !['kitchen', 'bathroom'].includes(d.group)) continue;
      if (f.broken === undefined && (f.wear ?? 0) <= WORN_PAST) continue;
      const flat = lay.flatAt(f.x, f.s);
      const who = flat ? household(sim, flat.id).sort((a, b) => a.id - b.id)[0] : undefined;
      if (!flat || !who) continue;
      found.push({ pawn: who.id, flat: flat.id, furniture: f.id, weight: f.broken !== undefined ? 2 : 1 + (f.wear ?? 0) });
    }
    return found;
  },
  hook: () => 'Man in a van: £40 cash',
  text(sim, card) {
    const f = thingIn(sim, card);
    return `Bloke in a van says he'll do ${flatName(sim, card.flat)}'s ${f ? furnitureDef(f.def).name.toLowerCase() : 'cooker'} for £40 cash. Today.`;
  },
  choices: () => [
    { label: 'Go on then', note: '£40 cash' },
    { label: 'Get someone proper', note: 'A couple of days' },
  ],
  resolve(sim, card, answer) {
    const f = thingIn(sim, card);
    const p = byId(sim, card.pawn)!;
    if (!f) return out([mem(p, 'leftToIt')], 'The thing had gone before anyone got to it.');
    const home = household(sim, card.flat ?? p.life!.flat);
    const name = furnitureDef(f.def).name.toLowerCase();
    if (answer === 0) {
      // Mended at the going rate, then the cash price is taken off it, and the bodge wears on.
      const e = [`mend:${f.id}`, `pay:${repairCost(f) - CASH}:Van man, cash`, `wear:${f.id}:${BODGED[gradeOf(f)]}`];
      if (chance(sim, 0.3)) e.push('thread:vanBreak:72');
      if (f.def === 'cooker' && home.some((t) => is(t, 'knowsRights'))) e.push('inspect:5:A tenant has written to us');
      return out(e, `The van man did the ${name} for £40. It works. It looks like it was done in a van.`);
    }
    if (answer === 1) {
      const e = [`promise:mend:${f.id}:2`, ...home.filter((t) => is(t, 'complainer')).map((t) => mem(t, 'waitedForRepair'))];
      return out(e, `You told him no. Someone proper will do the ${name} within two days.`);
    }
    // Nobody answered: a tenant who can't wait hires him, or the thing wears on.
    const hirer = home.find((t) => is(t, 'haggler') || is(t, 'messy') || is(t, 'handy'));
    if (hirer) {
      return out([`mend:${f.id}`, `wear:${f.id}:${BODGED[gradeOf(f)]}`, 'inspect:5:Work done without a say-so', mem(hirer, 'leftToIt'), mem(hirer, 'keptWaiting')], `${first(hirer)} hired the van man to do the ${name} anyway. Cash, no questions.`);
    }
    return out([`wear:${f.id}:1`, mem(p, 'leftToIt'), mem(p, 'keptWaiting')], `The ${name} wore on and nobody did anything. ${first(p)} noticed.`);
  },
  fixtures: [
    { name: 'complainer, cooker', build: vanFixture(['complainer', 'knowsRights'], 'cooker') },
    { name: 'easy-going, shower', build: vanFixture(['easyGoing', 'friendly'], 'shower') },
    { name: 'haggler hires him', build: vanFixture(['haggler', 'paysEarly'], 'cooker') },
  ],
};

/** The bodge lets go. Only comes from the van, three days on. */
const vanBreak: CardDef = {
  id: 'vanBreak',
  source: 'street',
  kind: 'moment',
  followUp: true,
  cooldownDays: 7,
  turnsOn: ['furniture grade', 'trait:complainer'],
  icon: 'van',
  when: (sim, from) => (from && sim.state.furniture.some((f) => f.id === from.furniture) && byId(sim, from.pawn) ? [from] : []),
  hook: (sim, card) => `${first(byId(sim, card.pawn)!)}'s ${nameOf(sim, card)} has packed up.`,
  text: (sim, card) => `The ${nameOf(sim, card)} the van man did has packed up. He's not answering his phone.`,
  choices: () => [
    { label: 'Pay properly', note: 'The going rate' },
    { label: 'Chalk it up', note: '' },
  ],
  resolve(sim, card, answer) {
    const p = byId(sim, card.pawn)!;
    const f = thingIn(sim, card);
    if (!f) return out([mem(p, 'leftToIt')], 'It had already gone.');
    if (answer === 0) return out([`mend:${f.id}`, mem(p, 'landlordListened')], 'You got someone proper in. It cost what it should have in the first place.');
    // Doing without suits an easy-going tenant better than a complainer, who writes it down.
    const moans = is(p, 'complainer');
    if (answer === 1) return out([`wear:${f.id}:1`, ...(moans ? [mem(p, 'waitedForRepair')] : [])], `You chalked it up. ${first(p)} will be doing without.`);
    return out([`wear:${f.id}:1`, mem(p, 'leftToIt'), mem(p, 'keptWaiting'), ...(moans && is(p, 'knowsRights') ? ['inspect:5:A tenant has written to us'] : [])], `Nobody rang the van man, or anyone else. ${first(p)} is doing without.`);
  },
  fixtures: [
    { name: 'complainer', build: followFixture(['complainer', 'knowsRights']) },
    { name: 'easy-going', build: followFixture(['easyGoing', 'friendly']) },
  ],
};

function nameOf(sim: Sim, card: Card): string {
  const f = thingIn(sim, card);
  return f ? furnitureDef(f.def).name.toLowerCase() : 'cooker';
}

function followFixture(traits: string[]) {
  return (seed: number) => {
    const { sim, subject } = vanFixture(traits, 'cooker')(seed);
    return { sim, subject };
  };
}

// ------------------------------------------------------------------ 4. Cat on the stairs

function catFixture(setup: (sim: Sim, a: Pawn, b: Pawn) => void) {
  return (seed: number) => {
    const sim = fixtureSim(seed);
    const [a, b] = sitting(sim);
    setup(sim, a, b);
    return { sim, subject: about(a) };
  };
}

const catOnTheStairs: CardDef = {
  id: 'cat',
  source: 'street',
  kind: 'moment',
  cooldownDays: 21,
  turnsOn: ['trait:petOwner', 'trait:houseProud', 'refused a pet'],
  icon: 'cat',
  when(sim) {
    if (sim.state.cat || hasFlag(sim, 'buildingCat') || hasFlag(sim, 'nextDoorCat') || !between(sim, 8, 20)) return [];
    const liker = (p: Pawn) => (is(p, 'petOwner') ? 3 : is(p, 'friendly') ? 2 : 1);
    return homeFolk(sim).map((p) => ({ pawn: p.id, weight: liker(p) }));
  },
  hook: () => 'A ginger cat on the stairs.',
  text: () => 'A ginger cat has walked in and sat on the stairs like it pays rent.',
  name: () => 'The stairs',
  choices: () => [
    { label: 'Let it stay', note: '' },
    { label: 'Shoo it out', note: '' },
  ],
  resolve(sim, _card, answer) {
    const all = folk(sim);
    const fond = (p: Pawn) => is(p, 'petOwner') || is(p, 'friendly');
    // Staying: those who like cats are pleased, the house-proud mind, and anyone who was
    // told no to a pet of their own has noticed.
    const stays = (): string[] => [
      ...all.filter(fond).map((p) => mem(p, 'buildingCat')),
      ...all.filter((p) => is(p, 'houseProud')).map((p) => mem(p, 'catHair')),
      ...all.filter((p) => remembers(p, 'noPet')).map((p) => mem(p, 'noPetButCat')),
      'flag:buildingCat',
      'flag:petPrecedent',
    ];
    if (answer === 0) return out(stays(), 'The cat\'s staying. It has already chosen a doormat.');
    if (answer === 1) return out([...all.filter((p) => is(p, 'petOwner')).map((p) => mem(p, 'shooedCat')), 'flag:nextDoorCat'], 'You shooed it out. It went next door, and sat on their wall to look at you.');
    // Ignored: it's back every day, and by the third it's yours, with nobody's say.
    const e = [...stays().filter((s) => !s.includes(':buildingCat:')), ...all.map((p) => mem(p, 'leftToIt'))];
    if (chance(sim, 1 / 3)) e.push(mem(all.find(fond) ?? all[0], 'itchy'));
    return out(e, 'The cat kept coming back. By the third day it was yours, and nobody thanked you.');
  },
  fixtures: [
    {
      name: 'pet owner, house-proud',
      build: catFixture((_sim, a, b) => {
        setTraits(a, ['petOwner', 'easyGoing']);
        setTraits(b, ['houseProud', 'complainer']);
      }),
    },
    {
      name: 'nobody minds',
      build: catFixture((_sim, a, b) => {
        setTraits(a, ['messy', 'easyGoing']);
        setTraits(b, ['nightOwl', 'haggler']);
      }),
    },
    {
      name: 'refused a pet',
      build: catFixture((sim, a, b) => {
        setTraits(a, ['friendly', 'keenCook']);
        setTraits(b, ['houseProud', 'paysEarly']);
        b.life!.memories.push({ id: 'noPet', at: sim.state.tick });
      }),
    },
  ],
};

// ------------------------------------------------------------------ 10. Meter reader

function meterFixture(traits: [string[], string[]], locks: boolean, estimated = false, bOut = false) {
  return (seed: number) => {
    const sim = fixtureSim(seed);
    if (estimated) setFlag(sim, 'estimated', undefined, sim.state.tick + 14 * TICKS_PER_DAY);
    sim.state.security.locks = locks;
    const [a, b] = sitting(sim);
    setTraits(a, traits[0]);
    setTraits(b, traits[1]);
    // Bill's retired, so he's in to keep an eye unless he's out.
    if (bOut) away(sim, b);
    return { sim, subject: about(a) };
  };
}

const meterReader: CardDef = {
  id: 'meterReader',
  opens: [1],
  source: 'street',
  kind: 'door',
  cooldownDays: 14,
  turnsOn: ['locks', 'whoIsHome', 'trait:busybody', 'retired'],
  icon: 'van',
  when(sim) {
    if (!between(sim, 9, 17)) return [];
    const keen = (p: Pawn) => (is(p, 'busybody') ? 3 : retired(p) ? 2 : 1);
    return homeFolk(sim).map((p) => ({ pawn: p.id, weight: keen(p) }));
  },
  hook: () => 'Gas man at the door.',
  text: () => 'Man from the gas wants to read the meter. He has a lanyard.',
  name: (sim, card) => `${first(byId(sim, card.pawn)!)} · At the door`,
  choices: () => [
    { label: 'Let him in', note: '' },
    { label: 'Not without a letter', note: '' },
  ],
  resolve(sim, card, answer) {
    const p = byId(sim, card.pawn)!;
    const locks = sim.state.security.locks;
    const watcher = homeFolk(sim).find((t) => is(t, 'busybody') || retired(t));
    if (answer === 0) {
      const fake = !locks && chance(sim, 1 / 6);
      if (watcher) {
        const e = [mem(watcher, 'keptAnEye'), ...(fake ? [`tale:fakeMeterMan:${watcher.id}`] : ['flag:meterRead::14'])];
        return out(e, fake ? `${first(watcher)} followed him round and saw him off. He wasn't from the gas.` : `${first(watcher)} followed him round the meter. He was from the gas.`);
      }
      if (fake) return out(['risk:burglary:2:3', `tale:fakeMeterMan:${p.id}`], 'He wasn\'t from the gas. He had a good look round, though.');
      return out(['flag:meterRead::14'], 'He read the meter and went. The gas bill will be right.');
    }
    if (answer === 1) return out(['flag:estimated::14', 'thread:meterAgain:168'], 'You asked for a letter. The gas people will estimate until someone lets him in.');
    // Someone buzzes him in with nobody watching.
    const fake = !locks && chance(sim, 0.25);
    if (fake) return out([mem(p, 'leftToIt'), 'risk:burglary:2:3', `tale:fakeMeterMan:${p.id}`, 'flag:estimated::14'], `${first(p)} buzzed him in. He wasn't from the gas. The bill's still estimated.`);
    return out([mem(p, 'leftToIt'), 'risk:burglary:1:3', 'flag:meterRead::14'], `${first(p)} buzzed him in and watched him alone. He was from the gas, as it turned out.`);
  },
  fixtures: [
    { name: 'busybody home, locks', build: meterFixture([['friendly', 'handy'], ['busybody', 'easyGoing']], true) },
    { name: 'no locks, nobody watching', build: meterFixture([['paysEarly', 'handy'], ['keenCook', 'partyAnimal']], false, false, true) },
    { name: 'no locks, busybody home', build: meterFixture([['busybody', 'complainer'], ['keenCook', 'partyAnimal']], false) },
  ],
};

const meterAgain: CardDef = {
  id: 'meterAgain',
  source: 'street',
  kind: 'moment',
  followUp: true,
  cooldownDays: 14,
  turnsOn: ['trait:complainer', 'whoIsHome'],
  icon: 'van',
  when(sim) {
    if (!hasFlag(sim, 'estimated')) return [];
    const p = homeFolk(sim).find((t) => !is(t, 'complainer')) ?? homeFolk(sim)[0];
    return p ? [{ pawn: p.id }] : [];
  },
  hook: () => 'Gas man\'s back next week.',
  text: (sim, card) => `The gas man's back next week. Ask ${first(byId(sim, card.pawn)!)} to let him in?`,
  choices: () => [
    { label: 'Ask them', note: '' },
    { label: 'Leave it', note: '' },
  ],
  resolve(sim, card, answer) {
    const p = byId(sim, card.pawn)!;
    if (answer === 0) return out(['flag:meterRead::14', mem(p, is(p, 'complainer') ? 'brushedOff' : 'askedToHelp')], is(p, 'complainer') ? `${first(p)} will let him in. They'd like it noted that it isn't their job.` : `${first(p)} will let him in. They don't mind.`);
    if (answer === 1) return out(['flag:estimated::28'], 'You left it. The estimate stands another month.');
    return out(['flag:estimated::28', mem(p, 'leftToIt')], `Nobody answered and ${first(p)} had to deal with the gas man alone.`);
  },
  fixtures: [
    { name: 'easy-going home', build: meterFixture([['easyGoing', 'friendly'], ['keenCook', 'nightOwl']], true, true) },
    { name: 'complainer home', build: meterFixture([['complainer', 'knowsRights'], ['keenCook', 'nightOwl']], true, true) },
  ],
};

// ------------------------------------------------------------------ 13. Sofa on the pavement

function sofaFixture(setup: (sim: Sim) => void) {
  return (seed: number) => {
    const sim = fixtureSim(seed);
    setup(sim);
    const p = homeFolk(sim)[0];
    return { sim, subject: about(p, { flat: emptyFlats(sim)[0] }) };
  };
}

const sofaOnThePavement: CardDef = {
  id: 'sofa',
  opens: ['ignored'],
  source: 'street',
  kind: 'moment',
  cooldownDays: 14,
  turnsOn: ['empty flat', 'who is home all day', 'trait:houseProud'],
  icon: 'sofa',
  when(sim) {
    if (hasFlag(sim, 'lobbySofa') || !between(sim, 8, 19)) return [];
    const flat = emptyFlats(sim)[0];
    if (!flat) return [];
    // The one who spots it: whoever's in all day, if anyone.
    return homeFolk(sim).map((p) => ({ pawn: p.id, flat, weight: retired(p) || is(p, 'busybody') ? 2 : 1 }));
  },
  hook: () => 'A sofa on the pavement.',
  text: () => 'Someone\'s left a decent sofa outside. "Free to good home."',
  name: () => 'The pavement',
  choices: () => [
    { label: 'Into the empty flat', note: '' },
    { label: 'In the lobby', note: '' },
  ],
  resolve(sim, card, answer) {
    const flat = card.flat ?? emptyFlats(sim)[0];
    const all = folk(sim);
    const sitter = all.find((p) => retired(p) || is(p, 'busybody')) ?? byId(sim, card.pawn) ?? all[0];
    if (answer === 0) return out([`flag:goodWord:${flat}:7`], `The sofa went up to ${flatName(sim, flat)}. It looks lived in already, which is the point.`);
    if (answer === 1) {
      const e = ['flag:lobbySofa'];
      const fleas = chance(sim, 0.15);
      if (fleas) e.push(mem(sitter, 'itchy'));
      return out(e, fleas ? `The sofa's in the lobby. ${first(sitter)} sat first, and has regrets.` : 'The sofa\'s in the lobby. People will sit on it and talk.');
    }
    // It rains. By morning it's a soggy mess by the bins, and somebody has to look at it.
    const upset = new Set<Pawn>(all.filter((p) => is(p, 'houseProud')));
    if (card.pawn !== undefined) upset.add(byId(sim, card.pawn)!);
    const e = ['flag:dumpingSpot::30', 'thread:mattress:24', ...[...upset].flatMap((p) => [mem(p, 'leftToIt'), mem(p, 'keptWaiting')])];
    return out(e, 'It rained on the sofa. By morning it was a soggy mess by the bins.');
  },
  fixtures: [
    { name: 'house-proud home', build: sofaFixture((sim) => setTraits(sitting(sim)[1], ['houseProud', 'complainer'])) },
    {
      name: 'busybody home, flat 2 empty',
      build: sofaFixture((sim) => {
        setTraits(sitting(sim)[0], ['busybody', 'easyGoing']);
        letFlat(sim, 2, [['friendly']]);
        letFlat(sim, 4, [['keenCook']]);
      }),
    },
  ],
};

// ------------------------------------------------------------------ 21. Scaffolding

const scaffoldFixture = (setup: (sim: Sim) => void) => (seed: number) => {
  const sim = fixtureSim(seed, 6);
  setup(sim);
  return { sim, subject: {} as CardSubject };
};

const scaffolding: CardDef = {
  id: 'scaffolding',
  source: 'street',
  kind: 'moment',
  cooldownDays: 60,
  turnsOn: ['side flats', 'trait:lightSleeper', 'planning'],
  icon: 'scaffold',
  when(sim) {
    if (sim.day < 4 || hasFlag(sim, 'scaffolding')) return [];
    const side = sideFlats(sim);
    return folk(sim).some((p) => side.has(p.life!.flat)) ? [{}] : [];
  },
  hook: () => 'Scaffolding offer: £80',
  text: () => 'Next door\'s builders want to scaffold your wall for a fortnight. £80.',
  name: () => 'Next door · Scaffolding',
  choices: () => [
    { label: 'Take the money', note: '£80' },
    { label: 'No', note: '' },
  ],
  resolve(sim, _card, answer) {
    const side = sideFlats(sim);
    const near = folk(sim).filter((p) => side.has(p.life!.flat));
    if (answer === 0) return out(['pay:8000:Scaffolding rent', 'flag:scaffolding::14', 'flag:nextDoorFriendly::90', ...near.map((p) => mem(p, 'scaffolding'))], 'You took the £80. The scaffolding goes up tomorrow, and next door are pleased.');
    if (answer === 1) {
      const woken = near.filter((p) => is(p, 'lightSleeper') || is(p, 'nightOwl'));
      return out(['flag:nextDoorSore::60', ...woken.map((p) => mem(p, 'scaffolding'))], 'You said no. Next door were put out, and their builders start at seven anyway.');
    }
    // Silence is yes: up it goes, with no £80.
    return out(['flag:scaffolding::14', ...near.flatMap((p) => [mem(p, 'scaffolding'), mem(p, 'leftToIt')])], 'You didn\'t say. They took silence for yes, and up it went. No £80, either.');
  },
  fixtures: [
    { name: 'light sleeper at the side', build: scaffoldFixture((sim) => setTraits(sitting(sim)[1], ['lightSleeper', 'nightOwl'])) },
    {
      name: 'side flats easy-going',
      build: scaffoldFixture((sim) => {
        setTraits(sitting(sim)[1], ['easyGoing', 'friendly']);
        letFlat(sim, 1, [['nightOwl', 'haggler']]);
      }),
    },
  ],
};

// ------------------------------------------------------------------ 23. Post for Mr Pritchard

function pritchardFixture(setup: (sim: Sim, knower: Pawn) => void) {
  return (seed: number) => {
    const sim = fixtureSim(seed, 9);
    const p = sitting(sim)[1];
    setup(sim, p);
    return { sim, subject: about(p) };
  };
}

const postForPritchard: CardDef = {
  id: 'pritchardPost',
  source: 'street',
  kind: 'moment',
  cooldownDays: 8,
  turnsOn: ['whoIsHome', 'sitting tenants', 'times ignored'],
  icon: 'post',
  when(sim) {
    if (sim.day < 2 || sim.day > 30 || !between(sim, 9, 19)) return [];
    // Whoever knew him: a sitting tenant, if one's left.
    return folk(sim).map((p) => ({ pawn: p.id, weight: sittingTenant(sim, p) ? 3 : 0.5 }));
  },
  hook: () => 'More post for Mr Pritchard.',
  text: () => 'More post for Mr Pritchard. One looks like a cheque.',
  name: (sim, card) => `${first(byId(sim, card.pawn)!)} · The post`,
  choices: () => [
    { label: 'Send it on', note: '' },
    { label: 'Open it', note: '' },
  ],
  resolve(sim, card, answer) {
    const k = byId(sim, card.pawn)!;
    if (answer === 0) {
      const left = hidden(k);
      const thanks = chance(sim, 0.5) && left.length > 0;
      const e = [mem(k, 'landlordListened'), ...(thanks ? [`reveal:${k.id}:${left[0]}`] : [])];
      return out(e, thanks ? `${first(k)} sent it on, and wrote back to thank you. It said a bit about them too.` : `${first(k)} sent it on to Mr Pritchard. He\'ll be grateful.`);
    }
    if (answer === 1) {
      const e = ['pay:4000:Cheque for Pritchard', mem(k, 'openedPost')];
      if (chance(sim, 1 / 3)) {
        e.push('pay:-6000:Solicitor\'s letter', `tale:pritchard:${k.id}`);
        return out(e, 'It was a cheque. The next one was a stiff letter from his solicitor. £40 back and £20 costs.');
      }
      return out(e, `You opened it. £40. ${first(k)} heard about it before lunch.`);
    }
    // In the drawer. The third time, his nephew comes for it at night with his old key.
    const times = sim.state.drip.log.filter((l) => l.card === 'pritchardPost' && l.chose === 'ignored').length;
    const e = [mem(k, 'leftToIt'), mem(k, 'keptWaiting'), mem(k, 'brushedOff')];
    if (times >= 2) {
      e.push('flag:strayKey', `tale:pritchard:${k.id}`, 'risk:burglary:1:3');
      return out(e, `The post went in the drawer, again. His nephew came for it at night, with a key you didn\'t know about.`);
    }
    return out(e, `The post went in the drawer. ${first(k)} noticed.`);
  },
  fixtures: [
    { name: 'sitting tenant home, first time', build: pritchardFixture(() => {}) },
    {
      name: 'third time, key about',
      build: pritchardFixture((sim, k) => {
        setTraits(k, ['busybody', 'keenCook']);
        for (let i = 0; i < 2; i++) sim.state.drip.log.push({ tick: sim.state.tick - (i + 1) * 4000, card: 'pritchardPost', chose: 'ignored' });
      }),
    },
  ],
};

// ------------------------------------------------------------------ 24. Fly-tipped mattress

const JUST_NOW = 2 * TICKS_PER_DAY;

/** Who might have dumped it: a tenant who's just moved in (a new bed), if there is one. */
function newcomer(sim: Sim): Pawn | undefined {
  return folk(sim).find((p) => p.life!.since >= sim.day - 2 && sim.day > 3);
}

/** A tenant a busybody would name: the messy first, else the lowest id who isn't the busybody. */
function suspect(sim: Sim): Pawn | undefined {
  const busybody = folk(sim).find((p) => is(p, 'busybody'));
  const rest = folk(sim).filter((p) => p !== busybody);
  return rest.find((p) => is(p, 'messy')) ?? rest.find((p) => is(p, 'partyAnimal')) ?? rest[0];
}

const mattress: CardDef = {
  id: 'mattress',
  source: 'street',
  kind: 'moment',
  cooldownDays: 14,
  turnsOn: ['who had a delivery', 'trait:messy', 'trait:busybody'],
  icon: 'bins',
  when(sim, from) {
    const st = sim.state;
    const mover = newcomer(sim);
    if (mover && !from) return [{ pawn: mover.id, flat: mover.life!.flat }];
    const busybody = folk(sim).some((p) => is(p, 'busybody'));
    const movedOut = st.chronicle.tales.some((t) => t.kind === 'moveOut' && st.tick - t.tick <= JUST_NOW);
    // A soggy sofa left to rot, or someone moved out, and a busybody to name a name.
    if ((from?.data?.soggy || movedOut) && busybody) {
      const s = suspect(sim);
      return s ? [{ pawn: s.id, flat: s.life!.flat, data: { named: 1, ...(from?.data?.soggy ? { soggy: 1 } : {}) } }] : [];
    }
    return [];
  },
  hook: () => 'A mattress by the bins.',
  text(sim, card) {
    const p = byId(sim, card.pawn);
    if (card.data?.named) return `There\'s a mattress by the bins. ${card.data?.soggy ? 'Where the soggy sofa was. ' : ''}Someone says ${flatName(sim, card.flat)}.`;
    return `There's a mattress by the bins. ${p ? flatName(sim, p.life!.flat) : 'Someone'} had a new bed delivered yesterday.`;
  },
  name: () => 'By the bins',
  choices: (sim, card) => [
    { label: `Word with ${flatName(sim, card.flat)}`, note: '' },
    { label: 'Pay the council', note: '£30' },
  ],
  resolve(sim, card, answer) {
    const c = byId(sim, card.pawn)!;
    const all = folk(sim);
    if (answer === 0) {
      const theirs = chance(sim, card.data?.named ? 2 / 3 : 3 / 4);
      if (theirs) return out([mem(c, 'caughtOut')], `${first(c)} owned up and paid the council's £30. It was theirs.`);
      return out([mem(c, 'accused'), 'pay:-3000:Council fly-tip charge'], `It wasn't ${first(c)}'s. You paid the £30 and they\'ll be telling people.`);
    }
    if (answer === 1) return out(['pay:-3000:Council fly-tip charge', 'flag:dumpingSpot::14'], 'You paid the council £30 and said nothing. It was gone by morning. Whoever did it knows.');
    return out(['flag:dumpingSpot::30', 'inspect:9:Rubbish left outside the building', ...all.flatMap((p) => [mem(p, 'leftToIt'), mem(p, 'keptWaiting')])], 'The mattress stayed three days. Kids bounced on it. The council might have views.');
  },
  fixtures: [
    {
      name: 'new tenant, delivery',
      build: (seed) => {
        const sim = fixtureSim(seed, 8);
        const [p] = letFlat(sim, 2, [['messy', 'friendly']]);
        sim.state.flats[p.life!.flat].lease!.sitting = false;
        return { sim, subject: about(p, { flat: p.life!.flat }) };
      },
    },
    {
      name: 'moved out, busybody names someone',
      build: (seed) => {
        const sim = fixtureSim(seed, 8);
        const [a, b] = sitting(sim);
        setTraits(a, ['busybody', 'easyGoing']);
        setTraits(b, ['messy', 'haggler']);
        tale(sim, 'moveOut', [], { flat: sim.layout.flats[2].id });
        return { sim, subject: about(b, { flat: b.life!.flat, data: { named: 1 } }) };
      },
    },
  ],
};

// ------------------------------------------------------------------ 30. Pizza for an empty flat

function pizzaFixture(day: number, setup: (sim: Sim, who: Pawn, bill: Pawn) => void) {
  return (seed: number) => {
    const sim = fixtureSim(seed, day, 21);
    const [who, bill] = sitting(sim);
    setup(sim, who, bill);
    const flat = emptyFlats(sim)[0];
    return { sim, subject: about(who, { flat, data: { bill: bill.id } }) };
  };
}

const pizza: CardDef = {
  id: 'pizza',
  source: 'street',
  kind: 'door',
  night: true,
  cooldownDays: 21,
  turnsOn: ['week one', 'a partner with nowhere to go', 'empty flat'],
  icon: 'pizza',
  when(sim) {
    if (!(sim.minuteOfDay >= 18 * 60 || sim.minuteOfDay < 7 * 60)) return [];
    const flat = emptyFlats(sim)[0];
    const all = homeFolk(sim);
    if (!flat || all.length < 2) return [];
    // Whose mate it is: someone with a partner or the sort who has mates over; Bill is whoever else is in.
    const likely = (p: Pawn) => (p.life!.partner !== undefined ? 3 : is(p, 'partyAnimal') || is(p, 'friendly') ? 2 : 1);
    const who = [...all].sort((a, b) => likely(b) - likely(a) || a.id - b.id)[0];
    const bill = all.find((p) => p !== who && sittingTenant(sim, p)) ?? all.find((p) => p !== who)!;
    return [{ pawn: who.id, flat, data: { bill: bill.id }, weight: likely(who) }];
  },
  hook: (sim, card) => `A pizza for ${flatName(sim, card.flat)}.`,
  text: (sim, card) => `A pizza for ${flatName(sim, card.flat)}. ${flatName(sim, card.flat)}'s empty. Isn't it?`,
  name: (sim, card) => `${flatName(sim, card.flat)} · The step`,
  choices: (sim, card) => [
    { label: 'Have a look', note: '' },
    { label: `Give it to ${first(byId(sim, Number(card.data?.bill)) ?? ({ name: 'a tenant' } as Pawn))}`, note: '' },
  ],
  resolve(sim, card, answer) {
    const who = byId(sim, card.pawn)!;
    const bill = byId(sim, Number(card.data?.bill)) ?? who;
    const flat = card.flat ?? '';
    const weekOne = sim.day <= 7;
    if (answer === 0) {
      // In week one, with Pritchard's keys about, it's a sleeping bag and his nephew.
      if (weekOne) return out(['flag:strayKey', `tale:pritchard:${bill.id}`], 'There was a sleeping bag in the corner. Pritchard\'s nephew, with a key you didn\'t know about.');
      return out([mem(who, 'caughtOut'), `tale:squatter:${who.id}`], `Someone had been sleeping there. ${first(who)}'s mate, as it turned out. ${first(who)} went red.`);
    }
    if (answer === 1) return out([mem(bill, 'freePizza'), `flag:squatter:${flat}`], `${first(bill)} had the pizza. Whoever ordered it is still in ${flatName(sim, flat)}, hungry.`);
    const waiting = sim.state.applicants.find((a) => a.flat === flat);
    const e = [mem(bill, 'leftToIt'), mem(bill, 'keptWaiting'), `flag:squatter:${flat}`, 'risk:burglary:1:3'];
    if (waiting) e.push(`lose:${waiting.id}`);
    return out(e, 'The pizza went cold on the step. At midnight someone came down and took it. They went back up.');
  },
  fixtures: [
    { name: 'week one', build: pizzaFixture(3, () => {}) },
    {
      name: 'later, a partner with nowhere to go',
      build: pizzaFixture(12, (_sim, who, bill) => {
        setTraits(who, ['friendly', 'partyAnimal']);
        setTraits(bill, ['keenCook', 'easyGoing']);
        who.life!.partner = bill.id;
      }),
    },
  ],
};

// ------------------------------------------------------------------ the lot

export const STREET_CARDS: CardDef[] = [
  applicantAtTheDoor,
  parcel,
  manInAVan,
  vanBreak,
  catOnTheStairs,
  meterReader,
  meterAgain,
  sofaOnThePavement,
  scaffolding,
  postForPritchard,
  mattress,
  pizza,
];
