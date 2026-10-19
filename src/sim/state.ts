// Everything that's saved. The building is stored as parts (wall segments, floor slabs,
// stairs, furniture) rather than as tiles, so saves stay small and edits stay simple.
//
// Positions are in tiles. x is the column, left to right. A storey is 4 rows: 3 rows of
// room (people are about 2 rows tall, so there's headroom and space for things on the
// wall) and 1 row of floor slab. Storey 0 stands on the ground; storey s stands on the
// slab at level s. Inside a storey, row 0 is the one people stand in.

export const TILE = 16;
export const ROOM_ROWS = 3;
export const STOREY_ROWS = ROOM_ROWS + 1;
/** Tallest the building can go. */
export const MAX_STOREYS = 8;

export const TICKS_PER_MINUTE = 60;
export const TICKS_PER_HOUR = 60 * TICKS_PER_MINUTE;
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;

export const SAVE_VERSION = 2;

/**
 * What fills one storey-high slot in a column. Doors: an inside door, a flat's front door
 * (the flat's boundary) and the building's street door.
 */
export type Segment = 'wall' | 'window' | 'door' | 'flatDoor' | 'entrance';

export function isDoor(seg: Segment | undefined): seg is 'door' | 'flatDoor' | 'entrance' {
  return seg === 'door' || seg === 'flatDoor' || seg === 'entrance';
}

/**
 * A flight of stairs up one storey, drawn against the back wall. It covers 3 columns of
 * storey s, from its foot on the floor of s to its top on the floor of s + 1. People walk
 * past in front of it, so it doesn't cut the floor above.
 */
export interface Stair {
  id: number;
  /** Leftmost column. */
  x: number;
  s: number;
  /** 1: rises to the right (foot at x, top at x + 2); -1: rises to the left. */
  dir: 1 | -1;
}

export interface Furniture {
  id: number;
  def: string;
  /** Leftmost column. */
  x: number;
  s: number;
  /** Bottom row within the storey (0 = the floor). */
  r: number;
  /** Facing the other way. */
  flip?: boolean;
}

export type PawnKind = 'agent' | 'passerby' | 'tenant';

export type NeedId = 'sleep' | 'food' | 'hygiene' | 'bladder' | 'fun' | 'comfort';

/** A remembered moment that colours how someone feels for a while. */
export interface Memory {
  id: string;
  /** Tick it happened. */
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

/** Everything about a tenant beyond walking about. */
export interface Life {
  /** The flat they live in (its id). */
  flat: string;
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
}

export interface Pawn {
  id: number;
  name: string;
  kind: PawnKind;
  /** Column (fractional while walking) and storey (fractional while on stairs). */
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
  /** How they're posed: sitting or lying down (standing if missing). */
  pose?: 'sit' | 'sleep';
  /** Tenants only. */
  life?: Life;
  /** How they describe themselves: their job, or "Retired". */
  note?: string;
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
  /** Wall segments by "x,s". */
  walls: Record<string, Segment>;
  /** Floor slabs by "x,level"; level L is the floor of storey L (L >= 1) or the roof above the top. */
  slabs: Record<string, true>;
  stairs: Stair[];
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
}

/** Someone moving in: who they are, their job if they have one, and their traits. */
export interface Person {
  name: string;
  job: { title: string; leave: number; back: number } | null;
  /** How they describe themselves (their job, or "Retired"). */
  note: string;
  look: Pawn['look'];
  traits: string[];
}

export interface Applicant {
  id: number;
  flat: string;
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
