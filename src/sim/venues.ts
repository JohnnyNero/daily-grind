// Venue definitions. Every venue runs on the same systems; a venue is just data:
// a map, starting furniture, where service happens, a menu, opening hours, how busy
// each hour is, default shifts, what the staff wear and how its stories are told.
//
// Map legend:
//   #  wall          K  kitchen / cellar   S  staff room
//   B  behind-counter tile                F  wooden floor   C  pub carpet
//   T  toilet tile   P  pavement (outside)
//   d  inside door   D  front door

import type { ItemKind, WorkType } from './defs';
import type { ConditionId } from './state';

export interface PlacedObject {
  def: string;
  x: number;
  y: number;
}

type Tile = readonly [number, number];

export interface ServicePositions {
  entry: readonly Tile[];
  tillStaff: Tile;
  queue: readonly Tile[];
  foodStaff: Tile;
  pickupStaff: Tile;
  pickupGuest: Tile;
  wait: readonly Tile[];
}

export interface VenueText {
  /** "café", "pub": used in sentences. */
  noun: string;
  rush: (n: number) => string;
  /** Advance notice of a rush, so the manager can get ready. */
  rushWarning: (n: number, minutes: number) => string;
  stationBroken: string;
  stationFixed: (name: string) => string;
  repairJob: string;
  noFood: string;
  heatwave: string;
  critic: (name: string) => string;
  busker: string;
  freebies: string;
  shoutOut: string;
  quietSpell: string;
  conditions: Record<ConditionId, string>;
  rudeLines: readonly string[];
}

export interface VenueDef {
  id: string;
  name: string;
  tagline: string;
  map: readonly string[];
  objects: readonly PlacedObject[];
  /** The object that makes drinks (espresso machine, beer taps). */
  drinkStation: string;
  /** Minutes to make one drink at skill 5. */
  drinkMinutes: number;
  /** The service counter (counter, bar): the till, the queue and pickup are worked out from where it stands. */
  counter: string;
  /** Where things happen during service, with the counter at its usual spot (COUNTER_HOME). */
  positions: ServicePositions;
  guestSeating: readonly string[];
  /** Floor kinds that count as front of house (for looks). */
  frontFloors: readonly string[];
  menu: readonly { name: string; kind: ItemKind; price: number }[];
  /** Menu items that unlock at a star rating. */
  unlocks: readonly { stars: number; name: string; kind: ItemKind; price: number }[];
  hours: { open: number; close: number; lastArrival: number };
  /** Expected arrivals per hour at a minute of the day, before reputation. */
  arrivals: (minute: number) => number;
  shifts: readonly { start: number; end: number }[];
  /** Daily rent, pence, before business rates. */
  rentPerDay: number;
  uniform: { shirt: string; apron: string | null };
  workLabels: Partial<Record<WorkType, string>>;
  text: VenueText;
}

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

// Both starter venues share one floor plan shape, so service positions line up.
const ENTRY: readonly Tile[] = [[6, 23], [7, 23], [8, 23], [9, 23]];
const SERVICE = {
  entry: ENTRY,
  tillStaff: [8, 8] as Tile,
  queue: [[8, 10], [9, 10], [10, 10], [11, 10], [12, 10], [13, 10], [13, 11]] as readonly Tile[],
  foodStaff: [1, 8] as Tile,
  pickupStaff: [5, 8] as Tile,
  pickupGuest: [5, 10] as Tile,
  wait: [[3, 10], [4, 10], [6, 10], [2, 10], [4, 11], [5, 11], [8, 11], [9, 11]] as readonly Tile[],
};

/** Where the counter stands in the standard layouts; the service spots above are drawn around it. */
export const COUNTER_HOME: Tile = [1, 9];

const shifted = new Map<string, ServicePositions>();

/** The service spots for a counter standing at (x, y). The front door doesn't move. */
export function servicePositions(venue: VenueDef, x: number, y: number): ServicePositions {
  const dx = x - COUNTER_HOME[0];
  const dy = y - COUNTER_HOME[1];
  const p = venue.positions;
  if (dx === 0 && dy === 0) return p;
  const key = `${venue.id}:${x}:${y}`;
  let out = shifted.get(key);
  if (!out) {
    const at = ([tx, ty]: Tile): Tile => [tx + dx, ty + dy];
    out = {
      entry: p.entry, tillStaff: at(p.tillStaff), queue: p.queue.map(at), foodStaff: at(p.foodStaff),
      pickupStaff: at(p.pickupStaff), pickupGuest: at(p.pickupGuest), wait: p.wait.map(at),
    };
    shifted.set(key, out);
  }
  return out;
}

/** Every service spot that has to be open floor, front door aside. */
export function serviceTiles(p: ServicePositions): Tile[] {
  return [p.tillStaff, p.foodStaff, p.pickupStaff, p.pickupGuest, ...p.queue, ...p.wait];
}

/**
 * The same building with nothing in it: the outside walls and the front door stay,
 * every inside wall and door comes out, and it's bare floor throughout.
 */
export function emptyShell(rows: readonly string[], floor: string): string[] {
  const outside = (x: number, y: number) => y < 0 || y >= rows.length || x < 0 || x >= rows[y].length || rows[y][x] === 'P';
  return rows.map((row, y) => [...row].map((c, x) => {
    if (c === 'P' || c === 'D') return c;
    if (c === '#') {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (outside(x + dx, y + dy)) return '#';
    }
    return floor;
  }).join(''));
}

const CAFE: VenueDef = {
  id: 'cafe',
  name: 'The café',
  tagline: 'Flat whites, cake and the morning rush.',
  map: [
    '################',
    '#KKKKKKKK#SSSSS#',
    '#KKKKKKKK#SSSSS#',
    '#KKKKKKKK#SSSSS#',
    '#KKKKKKKKdSSSSS#',
    '#KKKKKKKK#SSSSS#',
    '####d#######d###',
    '#BBBBBBBBBBBBBB#',
    '#BBBBBBBBBBBBBB#',
    '#BBBBBBBBBBBBBB#',
    '#FFFFFFFFFFFFFF#',
    '#FFFFFFFFFFFFFF#',
    '#FFFFFFFFFFFFFF#',
    '#FFFFFFFFFFFFFF#',
    '#FFFFFFFFFFFFFF#',
    '#FFFFFFFFFFFFFF#',
    '#FFFFFFFFFFF####',
    '#FFFFFFFFFFF#TT#',
    '#FFFFFFFFFFFdTT#',
    '#FFFFFFFFFFF#TT#',
    '#FFFFFFFFFFF####',
    '#######DD#######',
    'PPPPPPPPPPPPPPPP',
    'PPPPPPPPPPPPPPPP',
  ],
  objects: [
    { def: 'fridge', x: 1, y: 1 },
    { def: 'oven', x: 2, y: 1 },
    { def: 'prep', x: 4, y: 1 },
    { def: 'sink', x: 7, y: 1 },
    { def: 'staffSofa', x: 11, y: 1 },
    { def: 'lockers', x: 14, y: 1 },
    { def: 'staffTable', x: 11, y: 3 },
    { def: 'espresso', x: 2, y: 7 },
    { def: 'counter', x: 1, y: 9 },
    { def: 'plant', x: 1, y: 10 },
    { def: 'plant', x: 14, y: 10 },
    { def: 'table4', x: 2, y: 12 },
    { def: 'table4', x: 6, y: 12 },
    { def: 'armchair', x: 11, y: 12 },
    { def: 'armchair', x: 13, y: 12 },
    { def: 'table2', x: 2, y: 17 },
    { def: 'table2', x: 5, y: 17 },
    { def: 'table2', x: 8, y: 17 },
    { def: 'plant', x: 1, y: 20 },
    { def: 'toilet', x: 14, y: 17 },
  ],
  drinkStation: 'espresso',
  counter: 'counter',
  drinkMinutes: 1.1,
  positions: SERVICE,
  guestSeating: ['table4', 'table2', 'armchair'],
  frontFloors: ['F'],
  menu: [
    { name: 'flat white', kind: 'drink', price: 340 },
    { name: 'latte', kind: 'drink', price: 330 },
    { name: 'cappuccino', kind: 'drink', price: 330 },
    { name: 'americano', kind: 'drink', price: 290 },
    { name: 'oat latte', kind: 'drink', price: 360 },
    { name: 'mocha', kind: 'drink', price: 370 },
    { name: 'slice of carrot cake', kind: 'food', price: 350 },
    { name: 'brownie', kind: 'food', price: 300 },
  ],
  unlocks: [
    { stars: 2, name: 'iced latte', kind: 'drink', price: 380 },
    { stars: 3, name: 'chai latte', kind: 'drink', price: 370 },
    { stars: 3, name: 'cinnamon bun', kind: 'food', price: 340 },
    { stars: 4, name: 'pour-over', kind: 'drink', price: 460 },
    { stars: 5, name: 'house banana bread', kind: 'food', price: 380 },
  ],
  hours: { open: h(7), close: h(17), lastArrival: h(16, 45) },
  arrivals: (m) => {
    if (m < h(7) || m >= h(16, 45)) return 0;
    if (m < h(7, 30)) return 8;
    if (m < h(9, 30)) return 20;
    if (m < h(12)) return 8;
    if (m < h(14)) return 15;
    return 6;
  },
  rentPerDay: 3000,
  shifts: [
    { start: h(6, 30), end: h(14, 30) },
    { start: h(7), end: h(15) },
    { start: h(7, 30), end: h(12, 30) },
    { start: h(10, 30), end: h(17, 30) },
  ],
  uniform: { shirt: '#2b2e35', apron: '#c8955f' },
  workLabels: {},
  text: {
    noun: 'café',
    rush: (n) => `A coach party of ${n} has just pulled up outside.`,
    rushWarning: (n, minutes) => `Heads up: a coach party of about ${n} is due in ${minutes} minutes.`,
    stationBroken: 'The espresso machine has died. Coffee orders are piling up.',
    stationFixed: (name) => `${name} got the espresso machine going again. With a teaspoon.`,
    repairJob: 'Fixing the espresso machine',
    noFood: "The cake delivery is late. No cake until it turns up, and people aren't happy about it.",
    heatwave: 'Heatwave. Everyone wants iced drinks and nobody wants to stand by the oven.',
    critic: (name) => `${name} from the local paper is in the queue. Act natural.`,
    busker: 'A busker has set up outside and is drawing a crowd. Mostly good songs.',
    freebies: 'The supplier dropped off free pastries for the staff. Morale: restored.',
    shoutOut: 'A local food blog gave the café a shout-out: "the flat whites slap".',
    quietSpell: 'A lovely quiet spell. Someone put the good playlist on.',
    conditions: {
      stationBroken: 'Espresso machine broken',
      noFood: 'Out of cake',
      heatwave: 'Heatwave',
      busker: 'Busker outside',
      quietSpell: 'Quiet spell',
    },
    rudeLines: [
      'asked if the oat milk was "real milk".',
      'clicked their fingers to get attention.',
      'ordered a "small large latte".',
      'paid in 5p coins.',
      'asked for the Wi-Fi password before saying hello.',
      'said "you\'ve got one job".',
      'asked to speak to the manager about the foam.',
    ],
  },
};

const PUB: VenueDef = {
  id: 'pub',
  name: 'The pub',
  tagline: 'Pints, crisps, quiz night and the after-work crowd.',
  map: [
    '################',
    '#KKKKKKKK#SSSSS#',
    '#KKKKKKKK#SSSSS#',
    '#KKKKKKKK#SSSSS#',
    '#KKKKKKKKdSSSSS#',
    '#KKKKKKKK#SSSSS#',
    '####d#######d###',
    '#BBBBBBBBBBBBBB#',
    '#BBBBBBBBBBBBBB#',
    '#BBBBBBBBBBBBBB#',
    '#CCCCCCCCCCCCCC#',
    '#CCCCCCCCCCCCCC#',
    '#CCCCCCCCCCCCCC#',
    '#CCCCCCCCCCCCCC#',
    '#CCCCCCCCCCCCCC#',
    '#CCCCCCCCCCCCCC#',
    '#CCCCCCCCCCC####',
    '#CCCCCCCCCCC#TT#',
    '#CCCCCCCCCCCdTT#',
    '#CCCCCCCCCCC#TT#',
    '#CCCCCCCCCCC####',
    '#######DD#######',
    'PPPPPPPPPPPPPPPP',
    'PPPPPPPPPPPPPPPP',
  ],
  objects: [
    { def: 'kegs', x: 1, y: 1 },
    { def: 'kegs', x: 3, y: 1 },
    { def: 'fridge', x: 5, y: 1 },
    { def: 'sink', x: 7, y: 1 },
    { def: 'staffSofa', x: 11, y: 1 },
    { def: 'lockers', x: 14, y: 1 },
    { def: 'staffTable', x: 11, y: 3 },
    { def: 'taps', x: 2, y: 7 },
    { def: 'bar', x: 1, y: 9 },
    { def: 'table4', x: 2, y: 12 },
    { def: 'poolTable', x: 7, y: 13 },
    { def: 'armchair', x: 13, y: 12 },
    { def: 'table2', x: 2, y: 17 },
    { def: 'table2', x: 5, y: 17 },
    { def: 'table2', x: 8, y: 17 },
    { def: 'dartboard', x: 14, y: 14 },
    { def: 'plant', x: 1, y: 20 },
    { def: 'toilet', x: 14, y: 17 },
  ],
  drinkStation: 'taps',
  counter: 'bar',
  drinkMinutes: 1,
  positions: SERVICE,
  guestSeating: ['table4', 'table2', 'armchair'],
  frontFloors: ['C'],
  menu: [
    { name: 'pint of lager', kind: 'drink', price: 520 },
    { name: 'pint of bitter', kind: 'drink', price: 480 },
    { name: 'pint of cider', kind: 'drink', price: 500 },
    { name: 'glass of wine', kind: 'drink', price: 600 },
    { name: 'lemonade', kind: 'drink', price: 250 },
    { name: 'packet of crisps', kind: 'food', price: 150 },
    { name: 'bag of pork scratchings', kind: 'food', price: 180 },
    { name: 'cheese toastie', kind: 'food', price: 550 },
  ],
  unlocks: [
    { stars: 2, name: 'craft IPA', kind: 'drink', price: 580 },
    { stars: 3, name: 'gin and tonic', kind: 'drink', price: 700 },
    { stars: 3, name: 'scotch egg', kind: 'food', price: 450 },
    { stars: 4, name: 'negroni', kind: 'drink', price: 900 },
    { stars: 5, name: 'sharing platter', kind: 'food', price: 1200 },
  ],
  hours: { open: h(12), close: h(23), lastArrival: h(22, 30) },
  arrivals: (m) => {
    if (m < h(12) || m >= h(22, 30)) return 0;
    if (m < h(14)) return 9;
    if (m < h(17)) return 4;
    if (m < h(19)) return 15;
    if (m < h(22)) return 17;
    return 7;
  },
  rentPerDay: 13000,
  shifts: [
    { start: h(11, 30), end: h(17, 30) },
    { start: h(12), end: h(20) },
    { start: h(16, 30), end: h(23, 30) },
    { start: h(17), end: h(23, 30) },
    { start: h(18), end: h(23, 30) },
  ],
  uniform: { shirt: '#1d1d1f', apron: null },
  workLabels: { barista: 'Bar', counter: 'Till' },
  text: {
    noun: 'pub',
    rush: (n) => `A stag do of ${n} has just piled in. One of them is dressed as a banana.`,
    rushWarning: (n, minutes) => `Heads up: a stag do of about ${n} is heading this way. ETA ${minutes} minutes, and a banana.`,
    stationBroken: "The lager's run dry. Someone needs to change the barrel.",
    stationFixed: (name) => `${name} changed the barrel. Only slightly soaked.`,
    repairJob: 'Changing the barrel',
    noFood: "The crisp delivery hasn't come. People are not taking it well.",
    heatwave: 'Beer garden weather. Everyone wants a cold one.',
    critic: (name) => `${name} from the pub guide is at the bar. Act natural.`,
    busker: "It's quiz night. The place is buzzing and someone is already arguing about the answers.",
    freebies: 'The brewery rep dropped off free snacks for the staff. Morale: restored.',
    shoutOut: 'A local blog called it "the least sticky carpet in town". High praise.',
    quietSpell: 'A quiet spell. Someone put the good songs on the jukebox.',
    conditions: {
      stationBroken: 'Barrel needs changing',
      noFood: 'Out of crisps',
      heatwave: 'Beer garden weather',
      busker: 'Quiz night',
      quietSpell: 'Quiet spell',
    },
    rudeLines: [
      'asked for "whatever\'s cheapest, but nice".',
      'tried to start a tab with no card.',
      'clicked their fingers for "another one".',
      'asked if the cider was "like, alcoholic".',
      'wanted the football on during the quiz.',
      'asked for "a pint of the usual" on their first ever visit.',
      'tried to pay with a voucher for a different pub.',
    ],
  },
};

export const VENUES: Readonly<Record<string, VenueDef>> = { cafe: CAFE, pub: PUB };

export function venueDef(id: string | undefined): VenueDef {
  return VENUES[id ?? 'cafe'] ?? CAFE;
}
