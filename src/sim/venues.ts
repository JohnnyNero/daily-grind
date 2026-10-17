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
import type { CinemaDef } from './cinema';

export interface PlacedObject {
  def: string;
  x: number;
  y: number;
  rot?: number;
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
  /** Plain counter sections this venue sells (counter, bar). */
  counter: string;
  /** Pavement tiles where people arrive and leave. */
  entry: readonly Tile[];
  /** The standard layout's queue and pickup areas. */
  zones: { queue: readonly Tile[]; pickup: readonly Tile[] };
  guestSeating: readonly string[];
  /** The floor an empty lot starts with (floors are only for looks). */
  frontFloors: readonly string[];
  menu: readonly { name: string; kind: ItemKind; price: number }[];
  /** Menu items that unlock at a star rating. */
  unlocks: readonly { stars: number; name: string; kind: ItemKind; price: number }[];
  hours: { open: number; close: number; lastArrival: number };
  /** Expected arrivals per hour at a minute of the day, before reputation. */
  arrivals: (minute: number) => number;
  /** The opening team's shifts; a station makes that starter a specialist (the café's cook). */
  shifts: readonly { start: number; end: number; station?: WorkType }[];
  /** Daily rent, pence, before business rates. */
  rentPerDay: number;
  uniform: { shirt: string; apron: string | null };
  workLabels: Partial<Record<WorkType, string>>;
  text: VenueText;
  /** Cinemas only: the films and their timetable. */
  cinema?: CinemaDef;
}

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

// Both starter venues share one floor plan shape, so the counter and zones line up.
const ENTRY: readonly Tile[] = [[6, 23], [7, 23], [8, 23], [9, 23]];

/**
 * The standard counter along row 9: food counter, sections, pickup, sections, till, section.
 * Staff work it from row 8; customers queue and collect along row 10.
 */
function standardCounter(section: string): PlacedObject[] {
  const pieces = ['foodCounter', section, section, section, 'pickup', section, section, 'till', section];
  return pieces.map((def, i) => ({ def, x: 1 + i, y: 9 }));
}

const STANDARD_ZONES = {
  queue: [[9, 10], [10, 10], [11, 10], [12, 10], [13, 10], [13, 11]] as readonly Tile[],
  pickup: [[3, 10], [4, 10], [6, 10], [2, 10], [4, 11], [5, 11], [8, 11], [9, 11]] as readonly Tile[],
};

/** Before the counter came in pieces it was one 9-wide object at x, y; older saves still have it. */
export const LEGACY_COUNTER_W = 9;
export { standardCounter as counterPieces };

/**
 * An empty lot: the pavement out front and bare ground everywhere else, the back plot
 * included. No walls, no doors: where the building goes is up to the player.
 */
export function bareLot(rows: readonly string[], floor: string, plotWidth: number, extraRows = 0): string[] {
  const ground = floor.repeat(rows[0].length) + 'Y'.repeat(plotWidth);
  const out = rows.map((row) => (row[0] === 'P' ? 'P'.repeat(row.length + plotWidth) : ground));
  // More room at the back too: nothing on an empty lot is fixed but the pavement.
  return [...Array.from({ length: extraRows }, () => ground), ...out];
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
    ...standardCounter('counter'),
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
  entry: ENTRY,
  zones: STANDARD_ZONES,
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
    // Cooked to order in the kitchen.
    { name: 'bacon roll', kind: 'hot', price: 450 },
    { name: 'cheese toastie', kind: 'hot', price: 520 },
  ],
  unlocks: [
    { stars: 2, name: 'iced latte', kind: 'drink', price: 380 },
    { stars: 2, name: 'eggs on toast', kind: 'hot', price: 550 },
    { stars: 3, name: 'chai latte', kind: 'drink', price: 370 },
    { stars: 3, name: 'cinnamon bun', kind: 'food', price: 340 },
    { stars: 4, name: 'pour-over', kind: 'drink', price: 460 },
    { stars: 4, name: 'full breakfast', kind: 'hot', price: 950 },
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
    // The cook: breakfast and lunch in the kitchen.
    { start: h(7, 30), end: h(14, 30), station: 'kitchen' },
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
    ...standardCounter('bar'),
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
  entry: ENTRY,
  zones: STANDARD_ZONES,
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


// The cinema: a lobby with the box office and snacks, a lounge, and two screens.
// The counter faces the lobby; staff work it from the strip behind.
const CINEMA: VenueDef = {
  id: 'cinema',
  name: 'The cinema',
  tagline: 'Tickets, popcorn and the rush before the trailers.',
  map: [
    '################',
    '#KKKK#SS#XXXXXX#',
    '#KKKKdSS#XXXXXX#',
    '##d####d#XXXXXX#',
    '#BBBBBBB#XXXXXX#',
    '#BBBBBBB#XXXXXX#',
    '#BBBBBBB#XXXXXX#',
    '#FFFFFFF#XXXXXX#',
    '#FFFFFFF#XXXXXX#',
    '#FFFFFFFdXXXXXX#',
    '#FFFFFFF########',
    '#FFFFFFF#XXXXXX#',
    '#FFFFFFF#XXXXXX#',
    '#FFFFFFF#XXXXXX#',
    '#FFFFFFF#XXXXXX#',
    '#FFFFFFF#XXXXXX#',
    '#FFFFFFF#XXXXXX#',
    '###FFFFF#XXXXXX#',
    '#TT#FFFFdXXXXXX#',
    '#TTdFFFF#XXXXXX#',
    '#TT#FFFF########',
    '######DD########',
    'PPPPPPPPPPPPPPPP',
    'PPPPPPPPPPPPPPPP',
  ],
  objects: [
    { def: 'sink', x: 1, y: 1 },
    { def: 'fridge', x: 3, y: 1 },
    { def: 'staffSofa', x: 6, y: 1 },
    { def: 'fountain', x: 1, y: 4 },
    // A gap at the end of the counter lets staff through to the back.
    ...['counter', 'foodCounter', 'pickup', 'counter', 'till', 'counter'].map((def, i) => ({ def, x: 1 + i, y: 6 })),
    { def: 'armchair', x: 1, y: 11 },
    { def: 'armchair', x: 1, y: 13 },
    { def: 'armchair', x: 1, y: 15 },
    { def: 'table2', x: 3, y: 12 },
    { def: 'table2', x: 3, y: 15 },
    { def: 'toilet', x: 1, y: 18 },
    { def: 'toilet', x: 1, y: 20 },
    { def: 'screen', x: 9, y: 1 },
    { def: 'bin', x: 14, y: 2 },
    ...[3, 5, 7, 9].map((y) => ({ def: 'cinemaSeats', x: 10, y })),
    { def: 'screen', x: 9, y: 11 },
    { def: 'bin', x: 14, y: 12 },
    ...[13, 15, 17, 19].map((y) => ({ def: 'cinemaSeats', x: 10, y })),
  ],
  drinkStation: 'fountain',
  counter: 'counter',
  drinkMinutes: 0.5,
  entry: ENTRY,
  zones: {
    queue: [[5, 8], [5, 9], [5, 10], [5, 11], [5, 12], [5, 13], [5, 14], [5, 15], [5, 16]],
    pickup: [[4, 7], [2, 7], [1, 7], [4, 8], [3, 8], [2, 8], [1, 8]],
  },
  guestSeating: ['table4', 'table2', 'armchair'],
  frontFloors: ['F'],
  menu: [
    { name: 'film ticket', kind: 'ticket', price: 950 },
    { name: 'popcorn', kind: 'food', price: 550 },
    { name: 'nachos', kind: 'food', price: 500 },
    { name: 'cola', kind: 'drink', price: 380 },
    { name: 'fizzy orange', kind: 'drink', price: 360 },
    { name: 'bottle of water', kind: 'drink', price: 220 },
  ],
  unlocks: [
    { stars: 2, name: 'pick and mix', kind: 'food', price: 450 },
    { stars: 3, name: 'slushie', kind: 'drink', price: 400 },
    { stars: 4, name: 'hot dog', kind: 'hot', price: 600 },
    { stars: 5, name: 'posh popcorn', kind: 'food', price: 750 },
  ],
  hours: { open: h(11), close: h(23, 30), lastArrival: h(22) },
  // Lounge visitors only: film-goers come on the timetable (see cinema.ts).
  arrivals: (m) => {
    if (m < h(11) || m >= h(22)) return 0;
    if (m < h(17)) return 4;
    return 6;
  },
  cinema: {
    ticket: 'film ticket',
    films: [
      { title: 'Space Badgers 3', minutes: 95, draw: 1.3 },
      { title: 'The Long Quiet', minutes: 120, draw: 1 },
      { title: 'Murder at the Allotment', minutes: 110, draw: 1 },
      { title: 'Robot Uprising: Reloaded', minutes: 135, draw: 1.2 },
      { title: 'The Haunting of Flat 4B', minutes: 100, draw: 1.1 },
      { title: 'Love, Probably', minutes: 105, draw: 0.9 },
      { title: 'Pigeon Detective', minutes: 90, draw: 0.8 },
      { title: 'Ninety Minutes in Leeds', minutes: 90, draw: 0.7 },
    ],
    turnaround: 20,
    firstShow: h(11, 30),
    stagger: 40,
    doorsOpen: 12,
    hireShare: 0.6,
  },
  // Screens are big rooms: the rent reflects it, and tickets carry it.
  rentPerDay: 22000,
  shifts: [
    // Someone on the box office all day, and on drinks for the evening crowd.
    { start: h(10, 30), end: h(17, 30), station: 'counter' },
    { start: h(11), end: h(19) },
    { start: h(14, 30), end: h(22, 30), station: 'counter' },
    { start: h(17), end: h(23, 45), station: 'barista' },
    { start: h(18), end: h(23, 45) },
  ],
  uniform: { shirt: '#7a1f2b', apron: null },
  workLabels: { counter: 'Box office', barista: 'Drinks', floor: 'Ushers' },
  text: {
    noun: 'cinema',
    rush: (n) => `A school trip of ${n} has arrived for the matinee. The teacher looks exhausted already.`,
    rushWarning: (n, minutes) => `Heads up: a school trip of about ${n} is on its way, ${minutes} minutes out.`,
    stationBroken: 'The drinks fountain is spitting foam. Somebody needs to sort the syrup lines.',
    stationFixed: (name) => `${name} got the fountain going again. Sticky, but working.`,
    repairJob: 'Fixing the drinks fountain',
    noFood: "The popcorn delivery hasn't turned up. The kernels are gone.",
    heatwave: "Heatwave. Everyone wants the air conditioning and a slushie.",
    critic: (name) => `${name} from the film blog is here, and they've opinions about popcorn.`,
    busker: 'A film club has taken over the lounge to argue about endings.',
    freebies: 'The distributor sent posters and free snacks for the staff. Morale: restored.',
    shoutOut: 'A local paper called it "the comfiest seats in town". Word gets round.',
    quietSpell: 'A quiet spell between films. Someone is quietly eating the broken popcorn.',
    conditions: {
      stationBroken: 'Fountain broken',
      noFood: 'Out of popcorn',
      heatwave: 'Heatwave',
      busker: 'Film club in',
      quietSpell: 'Quiet spell',
    },
    rudeLines: [
      'asked for the seat "with the best view, obviously".',
      'tried to bring in a full Sunday roast.',
      'asked if the film had "a good bit".',
      'wanted a refund for the trailers.',
      'asked for popcorn "with nothing on it, but nice".',
      'demanded to know how the film ends before buying.',
    ],
  },
};

export const VENUES: Readonly<Record<string, VenueDef>> = { cafe: CAFE, pub: PUB, cinema: CINEMA };

export function venueDef(id: string | undefined): VenueDef {
  return VENUES[id ?? 'cafe'] ?? CAFE;
}
