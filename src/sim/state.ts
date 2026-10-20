// Everything that's saved. The building is a grid of cells, each empty or holding one
// thing: a wall, a window, a door, or a stair. There's no separate floor: a wall cell with
// space over it is the floor. Walls can go anywhere you like (as long as they're held up).
//
// Positions are in tiles. x is the column, left to right; s is the row, counted up from
// the ground (row 0 is the first row above it). People are about two rows tall and stand
// in the row above whatever holds them up.

export const TILE = 16;
/** Tallest the building can go, in rows. */
export const MAX_ROWS = 32;

/**
 * The clock. People walk the same number of tiles a tick whatever the clock does, so a walk
 * takes the same real time; the game clock runs at 20 ticks a game minute.
 */
export const TICKS_PER_MINUTE = 20;
export const TICKS_PER_HOUR = 60 * TICKS_PER_MINUTE;
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;

/**
 * Ticks in a real second at 1x (20 ticks a game minute, 0.3 real seconds a game minute).
 * Anything you watch on screen (a bubble, a talk, a pose, a moment) is timed in these, not
 * in game minutes, so it lasts as long whatever speed the clock runs at.
 */
export const TICKS_PER_SECOND = 200 / 3;
/** Real seconds at 1x, in ticks. */
export const seconds = (n: number): number => Math.round(n * TICKS_PER_SECOND);

export const SAVE_VERSION = 11;

/**
 * What a cell holds. Walls hold things up and keep people, heat and noise out; a window is
 * a wall you can see through. Doors are two cells tall and stored at their bottom cell (the
 * one above must be left empty): an inside door, a flat's front door (the flat's boundary)
 * and the building's street door. Stairs go against the back wall, so people walk in front
 * of them; a run of them drawn corner to corner is a flight.
 */
export type CellKind = 'wall' | 'window' | 'door' | 'flatDoor' | 'entrance' | 'stair';

/** Doors are two cells tall. */
export const DOOR_ROWS = 2;

export function isDoor(c: CellKind | undefined): c is 'door' | 'flatDoor' | 'entrance' {
  return c === 'door' || c === 'flatDoor' || c === 'entrance';
}

/** Walls and windows: things you can't walk through. */
export function isSolid(c: CellKind | undefined): c is 'wall' | 'window' {
  return c === 'wall' || c === 'window';
}

export interface Furniture {
  id: number;
  def: string;
  /** Leftmost column. */
  x: number;
  /** Bottom row. */
  s: number;
  /** Facing the other way. */
  flip?: boolean;
  /** How worn out it is, 0 new to 1 worn out. It breaks at 1. */
  wear?: number;
  /** Broken (since this day): nobody can use it until it's mended. */
  broken?: number;
  /** Someone's asked you to mend it. */
  reported?: boolean;
  /** Cheap or posh (standard if missing). Only pieces you use come in grades. */
  grade?: Grade;
}

/** How good a piece of furniture is: dearer is nicer to have and lasts longer. */
export type Grade = 'cheap' | 'standard' | 'posh';

/** `visitor`: someone from outside who comes in, does one thing and goes (visitors.ts). `animal`: the building cat, pets, the fox. */
export type PawnKind = 'agent' | 'passerby' | 'tenant' | 'guest' | 'burglar' | 'visitor' | 'animal';

/** How someone poses: sitting, lying down, dancing, reading, on the phone, carrying something, mopping, waving (standing if missing). */
export type Pose = 'sit' | 'sleep' | 'dance' | 'read' | 'phone' | 'carry' | 'mop' | 'wave';

/**
 * When someone's in (schedules.ts): office hours, an early or a late shift, nights, working
 * from home, a student's odd hours, or retired.
 */
export type Schedule = 'office' | 'early' | 'late' | 'nights' | 'home' | 'student' | 'retired';

export type NeedId = 'sleep' | 'food' | 'hygiene' | 'bladder' | 'fun' | 'comfort' | 'warmth' | 'quiet';

/** A remembered moment that colours how someone feels for a while. */
export interface Memory {
  id: string;
  /** Tick it happened. */
  at: number;
  /** Words for this one ("Kept awake by Flat 3"), instead of the usual label. */
  note?: string;
  /** Heard about rather than lived: who from, and how many tellings away. */
  from?: number;
  hops?: number;
}

/** A memory about another person, which is what an opinion is made of. */
export interface SocialMemory {
  id: string;
  /** Who it's about. */
  about: number;
  at: number;
}

/** What a tenant is doing with a piece of furniture. */
export interface Using {
  furniture: number;
  /** Which of its spots (a sofa has three). */
  spot: number;
  /** The offer being used (index into its list). */
  offer: number;
  until: number;
}

/** Who moved in together: someone on their own, a couple, sharers (a bedroom each), or a family (two bedrooms at least). */
export type HouseholdKind = 'single' | 'couple' | 'sharers' | 'family';

/** Everything about a tenant beyond walking about. */
export interface Life {
  /** The flat they live in (its id). */
  flat: string;
  /** Who they moved in as (version 11; older saves get one from who they live with). */
  household: HouseholdKind;
  needs: Record<NeedId, number>;
  memories: Memory[];
  /** How much they like living here, as shown; it eases towards the total of their thoughts. */
  liking: number;
  /** Working hours in minutes of the day, Monday to Friday; null for no job. */
  job: { leave: number; back: number; title: string } | null;
  /** Off the map (at work, out) until this tick. */
  away: { until: number; why: string } | null;
  /** Heading out: where to, and when they'll be back. */
  outing?: { why: string; until: number };
  using: Using | null;
  /** Carrying a meal they've just cooked, to eat somewhere. */
  meal?: boolean;
  /** The day they last went to work, so they go once a day. */
  workedDay?: number;
  /** How they slept last: in a bed, on the sofa or the floor (for the morning's memory). */
  sleptOn?: 'bed' | 'sofa' | 'floor';
  /** Personality: two or three traits. */
  traits: string[];
  /** The traits you know about. */
  revealed: string[];
  /** Ticks spent below each unhappiness line, and when they can next kick off. */
  under: { minor: number; major: number; extreme: number };
  calmUntil: number;
  /** Day they moved in. */
  since: number;
  /** Moving out: heading off for good. */
  leaving?: boolean;
  /** Took any flat going; there's a catch. */
  desperate?: boolean;
  /** Memories about other people. */
  social: SocialMemory[];
  /** Their partner (a pawn id) and their exes. */
  partner?: number;
  exes?: number[];
  /** Tick of their last chat with anyone, so they don't talk non-stop. */
  lastTalk?: number;
  /** A pet, if you said yes. */
  pet?: string;
  /** The day they last did the washing, last went out to the garden, and last thought about cycling. */
  washedDay?: number;
  gardenDay?: number;
  cycleDay?: number;
  /** Bike out of the rack, about to set off; and off to work on it. */
  cycling?: boolean;
  cycled?: boolean;
  /** The day they last stopped for the post on the way in. */
  postDay?: number;
  /** Seeing someone behind their partner's back (a pawn id). */
  affair?: number;
  /** A break (kicking off where you can see it) or an inspiration (a good turn): see breaks.ts. */
  breakState?: BreakState;
  /** When they're in (schedules.ts). Old saves get one from their job. */
  schedule: Schedule;
  /** One or two habits (schedules.ts), by id; empty until the first morning. */
  habits: string[];
  /** An ambient moment they're in (moments.ts): what, until when (a tick), how far through, with whom (and whether they lead it), and where. */
  moment?: { kind: string; until: number; step: number; with?: number; at?: [number, number]; lead?: boolean };
  /** Layout L5: what about their lives the layout matters to (a baby, bad knees, a dog), beyond traits and hours (fit.ts). Missing on old saves: none. */
  circs?: Circ[];
}

/** Layout L5: circumstances that read off the layout (fit.ts). */
export type Circ = 'baby' | 'wontClimb' | 'dog';

export type BreakKind = 'sulk' | 'slam' | 'bins' | 'bed' | 'tantrum' | 'music' | 'boxes' | 'tidy' | 'bbq' | 'mend' | 'paint' | 'plant';

export interface BreakState {
  kind: BreakKind;
  /** When it runs out. */
  until: number;
  /** The last straw, for a break. */
  straw?: string;
  /** Where they're doing it, and how far through. */
  at?: [number, number];
  step?: number;
  /** A furniture id (to mend), or the host's pawn id for a guest at a barbecue. */
  target?: number;
}

export interface Pawn {
  id: number;
  name: string;
  kind: PawnKind;
  /** Column and row (both fractional while walking or climbing). */
  x: number;
  s: number;
  /** Nodes still to walk to, as [x, s] pairs; the first is the next step. */
  path: [number, number][];
  /** Where they're walking to. */
  goal: [number, number] | null;
  /** go: heading for the flat; look: looking round it; leave: off down the street. */
  task: 'go' | 'look' | 'leave';
  /** The street end they leave by: 0 left, 1 right. */
  exit: 0 | 1;
  /** What they're doing, in words, for the info panel. */
  doing: string;
  /** Tick until which they stand still. */
  waitUntil: number;
  /** The flat they're heading to or in (its id), if any. */
  flat: string | null;
  /** Looks, as seeds for the placeholder art. */
  look: { skin: number; hair: number; top: number; legs: number };
  facing: 1 | -1;
  /** Walking along the pavement in front of the building. */
  front?: boolean;
  /** The column at the far end of the pavement walk. */
  frontTo?: number;
  /** How they're posed (standing if missing). */
  pose?: Pose;
  /** Stopped to talk until this tick. */
  talkUntil?: number;
  /**
   * A speech bubble over their head, and when it goes (a tick: the renderer holds it at
   * least BUDGET.bubbleSeconds). `icon` draws a pixel icon instead of the text (art.ts), and
   * `kind` is its place in the bubble budget: card markers, then talk, then moments, then
   * habits (talk if missing).
   */
  bubble?: { text: string; until: number; icon?: string; kind?: 'talk' | 'moment' | 'habit' };
  /** A visitor's job (visitors.ts: 'postie', 'courier', 'cleaner', 'cat', ...). */
  role?: string;
  /** Something in their hand, one at most: 'parcel', 'bucket', 'toolbox', 'ladder', 'paper', 'box', 'mop'. */
  prop?: string;
  /** At a party in this flat (its id): the door's open to them, and they mingle rather than go about their day. */
  partyAt?: string;
  /** What they're off to do at the party (dance, mingle, landing, smoke, greet), done on arrival. */
  act?: string;
  /** Tenants only. */
  life?: Life;
  /** How they describe themselves: their job, or "Retired". */
  note?: string;
  /** A burglar's night: how far they've got, and how they're getting in. */
  burgle?: { stage: 'case' | 'try' | 'in' | 'out'; entry: 'door' | 'window'; until: number; at?: [number, number]; inside?: [number, number]; take?: number; more?: number };
}

export interface State {
  version: number;
  seed: number;
  rng: number;
  tick: number;
  nextId: number;
  /** World width in columns, street included. */
  w: number;
  /** The plot the building can use: columns x0 to x1 inclusive. */
  plot: { x0: number; x1: number };
  /** The building, by "x,s". Empty cells aren't stored. */
  cells: Record<string, CellKind>;
  furniture: Furniture[];
  pawns: Pawn[];
  /** The next time someone walks past on the street, and when the agent next calls round. */
  timers: { passerby: number; agent: number };
  /** In pence. */
  money: number;
  mortgage: Mortgage;
  flats: Record<string, FlatInfo>;
  applicants: Applicant[];
  post: Letter[];
  ledger: LedgerEntry[];
  /** The day the bank took the building, if it has. */
  repossessed?: number;
  /** Short news for the player, newest last. */
  notices: { tick: number; text: string }[];
  /** Insulated wall cells, by "x,s". Quieter and warmer. */
  insulated: Record<string, true>;
  /** The central boiler: 0 off to 3 high. */
  boiler: number;
  /** A cleaner does the stairs and lobby every morning. */
  cleaner: boolean;
  /** How dirty each flat is (by id) and the shared parts ("shared"), 0 to 1. */
  dirt: Record<string, number>;
  /** Each flat's temperature, in degrees. */
  temps: Record<string, number>;
  /** Layout L3: each room's temperature and damp (0 to 1), by the room's first cell "x,s" (heat.ts, damp.ts). */
  roomTemps?: Record<string, number>;
  damp?: Record<string, number>;
  /** How noisy each flat has been lately (0 to about 10), for its impressiveness. */
  noiseAvg: Record<string, number>;
  /** The building group chat. */
  chat: ChatMessage[];
  /** Building work: your plans, and the job the builders are on. */
  works: Works;
  /** What's going on: the storyteller's mood, its cooldowns and the happenings under way. */
  story: Story;
  /** Locks on the street door and ground-floor windows, and a burglar alarm. */
  security: { locks: boolean; alarm: boolean };
  /** What tenants said about you when they left, newest last. */
  reviews: Review[];
  /** How high you're allowed to build (the top row), and an application waiting on the council. */
  planning: { top: number; applied?: { top: number; decideDay: number } };
  /** The council: a visit booked, and an improvement notice to put right by a day. */
  council: { visitDay?: number; notice?: { issues: string[]; byDay: number } };
  /** What tenants expect of the building (0 to 100), and the days it has been going well. */
  expect: { level: number; good: number };
  /** The first week: Denise's walk round, her to-do list, and the beats that teach the game. */
  handover: Handover;
  /** Tales: what's happened worth talking about, newest last, and the next tale's number. */
  chronicle: { next: number; tales: Tale[] };
  /** The day posh furniture opened up (it stays open). */
  poshFrom?: number;
  /** The drip: the little decisions (drip.ts). */
  drip: Drip;
  /** The building cat, once you've let it stay: its pawn, the tenant it likes best, and the day it moved in. */
  cat?: { pawn: number; favourite?: number; since: number };
  /** Visitors (visitors.ts): the next time each kind is due, by role. */
  visitors: { next: Record<string, number> };
  /** Ambient moments (moments.ts): the tick the next is due, when each kind last started, and its own dice (so it never moves the rest of the game's). Missing until the first. */
  moments?: { next: number; last: Record<string, number>; rng: number };
  /** The next thing to save for (project.ts): one you've pinned, by id, and whether Denise has said her piece. */
  project: { pinned?: string; praised?: boolean };
  /** The wet stack (risers.ts): the risers, building control, the risers' own dice. Missing: the one riser the building came with. */
  wet?: Wet;
}

/** The risers, by column, and building control's say on new ones. */
export interface Wet {
  /** Columns with a riser in, up every floor. */
  risers: number[];
  /** Columns building control have said yes to (it lasts). */
  approved: number[];
  /** An application waiting on building control: which columns, and the day they decide. */
  applied?: { cols: number[]; decideDay: number };
  /** The last time a riser leaked: where, how far up, and the day (for the damp). */
  leak?: { x: number; storey: number; day: number };
  /** The risers' own dice, so they never move the rest of the game's. */
  rng: number;
}

/**
 * A little decision in the tray (drip.ts). `def` is the card's id in the catalogue
 * (cards/). Who and what it's about is copied from the subject its `when` found.
 */
export interface Card {
  id: number;
  def: string;
  /** Tick it appeared, and when it resolves by itself (its worst, 1.6). */
  tick: number;
  until: number;
  /** The tick the UI says 10 real seconds have passed: it never resolves before this (1.1). */
  seenBy?: number;
  /** A tenant's ask, which waits and sours: how many times they've got more fed up (0 to 3). */
  waits?: boolean;
  step?: number;
  pawn?: number;
  flat?: string;
  furniture?: number;
  visitor?: number;
  data?: Record<string, string | number>;
}

/** A fact about the building a card left behind (flags.ts): for good, or until a tick. */
export interface Flag {
  id: string;
  subject?: string;
  until?: number;
}

export interface Drip {
  /** Open cards, newest last; at most DRIP.maxOpen. */
  open: Card[];
  /** Cards left today (set at 07:00), and the day it's for. */
  budget: number;
  day: number;
  /** Tick the last card appeared (for DRIP.minGap). */
  lastCard: number;
  /** Resolved by being ignored, in a row. */
  ignoredRun: number;
  /** Not again until this tick: by card id, and by "pawn:<id>". */
  cooldowns: Record<string, number>;
  /** Follow-ups on their way: the card, when it's due (a tick), and who and what it's about. */
  threads: { card: string; due: number; data: Record<string, string | number> }[];
  /** Things you said you'd do: what (a kind), its argument, the day, and who you promised. */
  promises: { what: string; arg: string; byDay: number; pawn: number }[];
  /** At most DRIP.maxFlags; the oldest timed one goes first. */
  flags: Flag[];
  /** The last 50 resolved, for tests and the recap. */
  log: { tick: number; card: string; chose: number | 'ignored' }[];
  /** Money from cards in the first week, in pence. */
  income: number;
  /** The tick a thread or a promise was last opened (DRIP.tailDays); the start if missing. */
  lastOpened?: number;
  /** The drip's own dice (drip.ts); from the seed if missing (older saves). */
  rng?: number;
}

export type TaleKind =
  | 'affair' | 'repossessed' | 'fight' | 'burglary' | 'councilFine' | 'missedMortgage' | 'breakup' | 'partyShutDown' | 'burglaryFoiled'
  | 'couple' | 'gaveNotice' | 'councilNotice' | 'partyDamage' | 'party' | 'moveIn' | 'moveOut' | 'grant' | 'broken'
  // From the drip's cards (1.4).
  | 'parcelNicked' | 'lockout' | 'cowboy' | 'leak' | 'cat' | 'kittens' | 'brokePromise' | 'pritchard' | 'fakeMeterMan' | 'deposit' | 'squatter' | 'badTurn'
  // From the everyday cards (chunk b2).
  | 'praise' | 'lobbyDo' | 'stairTrip' | 'washerFlood';

/** Something that happened, as people will tell it. */
export interface Tale {
  id: number;
  tick: number;
  kind: TaleKind;
  text: string;
  /** Who it's about, with their names as they were. */
  pawns: { id: number; name: string }[];
  flat?: string;
  /** How much people talk about it; it drops each time it's told. */
  interest: number;
  /** Times it's been in a recap. */
  told?: number;
  /** Moving out: the stars they left. */
  stars?: number;
}

export interface Handover {
  /** Where Denise is on her walk round; -1 once it's over. */
  stop: number;
  /** She's got to this stop and is talking. */
  at?: boolean;
  /** Denise's pawn, while she's showing you round. */
  guide?: number;
  /** The tenants the building came with, and the ones you've looked at. */
  cast: number[];
  met: number[];
  /** The flats her list is about: the one to let, the bare one to furnish, and the stripped one (week two). */
  toLet?: string;
  fit?: string;
  gutted?: string;
  /** Beats already played, by name. */
  done: string[];
  /** Turned off from the menu (or an old save). */
  skipped?: boolean;
  /** An advance on a deposit, still to be paid back out of it. */
  advance?: number;
}

/**
 * The storyteller deals out happenings. It runs busy and quiet in turns, never has more than
 * a couple going at once, won't repeat a kind of thing for a while (its tags cool down), and
 * goes easier on you when you're struggling.
 */
export interface Story {
  busy: boolean;
  /** When the mood changes. */
  until: number;
  /** By tag: not again until this tick. */
  cooldowns: Record<string, number>;
  running: Happening[];
}

export interface Happening {
  id: number;
  kind: 'party' | 'fight' | 'affair' | 'burglary';
  until: number;
  /** The flat it's in, and who's in it. */
  flat?: string;
  pawns: number[];
  /** Guests still to turn up, and when the next one does. */
  queue?: number;
  next?: number;
  /** Something that's happened along the way (a complaint made, an alarm going off). */
  flag?: string;
  /** A party's mood: arriving, in full swing, winding down, or seeing people off. */
  phase?: 'arriving' | 'swing' | 'winding' | 'leaving';
  /** How loud the music is: 0.5 turned down, 1 as usual (if missing), 2 turned up. */
  volume?: number;
  /** A party's host, the neighbours asked along, those who came, and the one knocking to complain. */
  host?: number;
  invited?: number[];
  joined?: number[];
  knock?: number;
  /** Arrivals the host has still to greet. */
  greet?: number;
}

export interface Review {
  day: number;
  who: string;
  flat: string;
  stars: number;
  text: string;
}

/**
 * Plans and jobs are the building as it will be (its parts); what's left to do is the
 * difference from the building as it is.
 */
export interface Works {
  /** Drawn in build mode, not yet signed off. */
  plan: BuildPartsData | null;
  /** Signed off: what the builders are working towards. */
  job: BuildPartsData | null;
  /** Minutes into the piece they're on. */
  progress: number;
  /** Stopped until you can pay for the next piece. */
  waiting: boolean;
  /** Flats they've worked in on this job (the tenants get a nice surprise at the end). */
  flats: string[];
}

export interface BuildPartsData {
  cells: Record<string, CellKind>;
  furniture: Furniture[];
  insulated: Record<string, true>;
  /** Riser columns (missing: as the building has them). */
  risers?: number[];
}

export interface ChatMessage {
  id: number;
  tick: number;
  /** A tenant's pawn id, or 0 for you. */
  from: number;
  /** Their name and flat at the time, as shown. */
  who: string;
  text: string;
  /** A request you can answer. */
  choices?: { label: string; note: string; act: string }[];
  chosen?: number;
  /** You didn't answer in time. */
  ignored?: boolean;
}

/** A tenancy: who rents a flat, for how much, and how it's going. Money is in pence. */
export interface Lease {
  /** Weekly rent, in pence. */
  rent: number;
  /** A rent change waiting out its notice: the new weekly rent and when it starts. */
  rise?: { rent: number; from: number };
  startDay: number;
  /** Last day of the fixed term; null for an old rolling tenancy. */
  endDay: number | null;
  deposit: number;
  /** Rent owed and unpaid, in pence. */
  owed: number;
  /** Days paid on time, late, and held back. */
  paid: number;
  late: number;
  /** Notice given: by whom, why, and the day they go. */
  notice?: { by: 'tenant' | 'landlord'; why: string; day: number };
  /** A sitting tenant on an old, cheap tenancy. */
  sitting?: boolean;
  /** Held back on purpose until this tick. */
  withholdUntil?: number;
  /** Days already paid for in advance. */
  prepaid?: number;
}

export interface FlatInfo {
  /** Asking rent for an empty flat, weekly, in pence. */
  asking: number;
  listed: boolean;
  /** The tier its going rate is set by; it only drops after a few days below. */
  tier: string;
  belowSince?: number;
  lease: Lease | null;
  nextApplicant: number;
  /** How the listing's written, which changes who applies and what they expect. */
  style?: ListingStyle;
}

export type ListingStyle = 'plain' | 'agent' | 'honest' | 'professionals' | 'pets';

/** Someone moving in: who they are, their job if they have one, and their traits. */
export interface Person {
  name: string;
  job: { title: string; leave: number; back: number } | null;
  /** When they're in (schedules.ts); from the job if missing. */
  schedule?: Schedule;
  /** How they describe themselves (their job, or "Retired"). */
  note: string;
  look: Pawn['look'];
  traits: string[];
}

export interface Applicant {
  id: number;
  flat: string;
  /** Who they are together: on their own, a couple, sharers or a family. */
  household: HouseholdKind;
  people: Person[];
  traits: string[];
  /** The one you know about. */
  shown: string;
  /** What their references say, hinting at the rest. */
  hints: string[];
  /** Weekly rent they'll pay, in pence. */
  offer: number;
  /** Gone if you don't decide by this tick. */
  until: number;
  /** Comes with a catch you find out later. */
  desperate?: boolean;
  /** Layout L5: a baby, bad knees, a dog (fit.ts). Missing: none. */
  circs?: Circ[];
}

export interface Letter {
  id: number;
  day: number;
  from: string;
  title: string;
  body: string;
  read: boolean;
  /** For a decision: the choices, the day it's due and what happens if you don't choose. */
  choices?: { label: string; note: string; act: string }[];
  dueDay?: number;
  fallback?: number;
  chosen?: number;
  /** The flat or person it's about. */
  flat?: string;
  pawn?: number;
}

export interface LedgerEntry {
  tick: number;
  label: string;
  /** Pence: positive in, negative out. */
  amount: number;
}

export interface Mortgage {
  /** Still owed, in pence. */
  balance: number;
  /** Due every Monday, in pence. */
  payment: number;
  /** Yearly interest, as a fraction. */
  rate: number;
  /** Payments missed in a row. */
  missed: number;
  arrears: number;
  /** The day it was paid off. */
  paidOffDay?: number;
}

export const key = (x: number, s: number): string => `${x},${s}`;
