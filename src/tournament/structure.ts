/** Blind structures, presets and tournament stages. */
import type { FieldMix } from '../bots/profiles';

export interface Level { sb: number; bb: number; ante: number }

const BASE: [number, number][] = [
  [50, 100], [60, 120], [75, 150], [100, 200], [125, 250], [150, 300], [200, 400], [250, 500],
  [300, 600], [400, 800], [500, 1000], [600, 1200], [800, 1600], [1000, 2000], [1250, 2500],
  [1500, 3000], [2000, 4000], [2500, 5000], [3000, 6000], [4000, 8000], [5000, 10000],
  [6000, 12000], [8000, 16000], [10000, 20000], [12500, 25000], [15000, 30000], [20000, 40000],
  [25000, 50000], [30000, 60000], [40000, 80000], [50000, 100000],
];

export function blindLevel(index: number): Level {
  let sb: number, bb: number;
  if (index < BASE.length) [sb, bb] = BASE[index];
  else {
    const extra = index - BASE.length + 1;
    bb = Math.round((100000 * Math.pow(1.25, extra)) / 1000) * 1000;
    sb = bb / 2;
  }
  return { sb, bb, ante: bb };
}

/** First level whose big blind makes `avgStack` about `targetBB` big blinds. */
export function levelForDepth(avgStack: number, targetBB: number): number {
  let best = 0, bestDiff = Infinity;
  for (let i = 0; i < 40; i++) {
    const d = Math.abs(avgStack / blindLevel(i).bb - targetBB);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

export type StartPoint = 'beginning' | 'middle' | 'bubble' | 'final';
export type HeroStackOption = 'random' | 'short' | 'average' | 'big';

export interface TournamentConfig {
  name: string;
  entrants: number;
  tableSize: 6 | 8 | 9;
  /** Starting stack in chips (level 1 big blind is 100). */
  startingStack: number;
  handsPerLevel: number;
  buyIn: number;
  /** Part of the buy-in that is a fee and not in the prize pool (live events: S$600 = S$530 + S$70). */
  fee?: number;
  /** Places paid, when the event fixes it. Defaults to about 15% of the field. */
  paid?: number;
  /** Money prefix for display, e.g. 'S$'. Defaults to '$'. */
  currency?: string;
  /** Satellite: the prizes are equal seats, and play stops once every remaining player has one. */
  satellite?: { seatValue: number; guaranteedSeats: number; /** The event the seats are for. */ target: string };
  field: FieldMix;
  start: StartPoint;
  heroStack: HeroStackOption;
  seed: number;
}

export interface Preset {
  key: string;
  label: string;
  blurb: string;
  config: Omit<TournamentConfig, 'seed'>;
}

/**
 * The SPC Main Event satellite as advertised (S$60, no fee, 10 seats guaranteed, seat = the S$530+70
 * Main Event entry). Field size and structure are assumptions: 100 entries is exactly the guarantee.
 */
const SPC_SATELLITE: Omit<TournamentConfig, 'seed' | 'start' | 'heroStack'> = {
  name: 'SPC Main Event Satellite', entrants: 100, tableSize: 9, startingStack: 5000, handsPerLevel: 8,
  buyIn: 60, currency: 'S$', satellite: { seatValue: 600, guaranteedSeats: 10, target: 'SPC Main Event' }, field: 'soft',
};

/**
 * SPC Main Event (Natural8): S$530 + S$70, 7,000 chips plus the 5,000 add-on, 30-minute levels
 * (about 13 live hands), roughly 27 places paid. Recent fields were 203-398 entries across four flights;
 * 250 is a typical one. Starting blinds are not published: 12,000 chips is 120bb at this engine's 50/100.
 */
const SPC_MAIN: Omit<TournamentConfig, 'seed' | 'start' | 'heroStack'> = {
  name: 'SPC Main Event', entrants: 250, tableSize: 9, startingStack: 12000, handsPerLevel: 13,
  buyIn: 600, fee: 70, paid: 27, currency: 'S$', field: 'mixed',
};

export const PRESETS: Preset[] = [
  {
    key: 'quick27', label: 'Quick 27',
    blurb: '27 players, 3 tables, 60bb starting stacks, fast levels. A full tournament in well under an hour.',
    config: { name: 'Quick 27', entrants: 27, tableSize: 9, startingStack: 6000, handsPerLevel: 6, buyIn: 11, field: 'mixed', start: 'beginning', heroStack: 'average' },
  },
  {
    key: 'turbo90', label: 'Turbo 90',
    blurb: '90 players, 10 tables, 100bb stacks, turbo levels. Every stage: deep, antes, bubble, final table.',
    config: { name: 'Turbo 90', entrants: 90, tableSize: 9, startingStack: 10000, handsPerLevel: 8, buyIn: 22, field: 'mixed', start: 'beginning', heroStack: 'average' },
  },
  {
    key: 'major180', label: 'Sunday 180',
    blurb: '180 players, 20 tables, 100bb stacks, regular levels. The closest to a real online MTT.',
    config: { name: 'Sunday 180', entrants: 180, tableSize: 9, startingStack: 10000, handsPerLevel: 11, buyIn: 55, field: 'mixed', start: 'beginning', heroStack: 'average' },
  },
  {
    key: 'midstage', label: 'Mid-Stage Grind',
    blurb: 'Jump into a 180-player field with about half the players left and ~35bb stacks. Practise accumulating chips before the bubble.',
    config: { name: 'Mid-Stage Grind', entrants: 180, tableSize: 9, startingStack: 10000, handsPerLevel: 9, buyIn: 55, field: 'mixed', start: 'middle', heroStack: 'random' },
  },
  {
    key: 'bubble', label: 'Bubble Trainer',
    blurb: 'Start a few eliminations before the money with ~25bb stacks. Learn when ICM says fold and when to attack.',
    config: { name: 'Bubble Trainer', entrants: 90, tableSize: 9, startingStack: 10000, handsPerLevel: 8, buyIn: 22, field: 'mixed', start: 'bubble', heroStack: 'random' },
  },
  {
    key: 'final', label: 'Final Table Trainer',
    blurb: 'The last nine of a 180-player field. Big pay jumps, short-handed play and heads-up for the title.',
    config: { name: 'Final Table Trainer', entrants: 180, tableSize: 9, startingStack: 10000, handsPerLevel: 8, buyIn: 55, field: 'mixed', start: 'final', heroStack: 'random' },
  },
  {
    key: 'spcmain', label: 'SPC Main Event',
    blurb: 'The S$600 Singapore Poker Championships Main Event: 250 entries, 120bb with the add-on, 30-minute levels, 27 paid and about S$30,000 for 1st.',
    config: { ...SPC_MAIN, start: 'beginning', heroStack: 'average' },
  },
  {
    key: 'spcday2', label: 'SPC Main Event Day 2',
    blurb: 'Skip the flights: start Day 2 of the SPC Main Event with about 110 players left and ~35bb stacks, then play through the bubble to the final table.',
    config: { ...SPC_MAIN, name: 'SPC Main Event Day 2', start: 'middle', heroStack: 'random' },
  },
  {
    key: 'spcsat', label: 'SPC Satellite',
    blurb: 'Live S$60 satellite to the S$600 Singapore Poker Championships Main Event: 100 players, 10 seats, 50bb stacks, fast levels. Every seat is worth the same, so surviving beats chips.',
    config: { ...SPC_SATELLITE, start: 'beginning', heroStack: 'average' },
  },
  {
    key: 'spcsatbubble', label: 'SPC Satellite Bubble',
    blurb: '15 players left for the 10 SPC Main Event seats, about 14bb on average. Learn when to fold your way into a seat and when a short stack has to shove.',
    config: { ...SPC_SATELLITE, name: 'SPC Satellite Bubble', start: 'bubble', heroStack: 'random' },
  },
];

export type Stage = 'early' | 'middle' | 'bubble' | 'itm' | 'final';

export const STAGE_LABEL: Record<Stage, string> = {
  early: 'Early', middle: 'Middle', bubble: 'Bubble', itm: 'In the money', final: 'Final table',
};

export function stageOf(playersLeft: number, paid: number, tables: number, tableSize: number, avgStackBB: number, satellite = false): Stage {
  if (tables === 1 && playersLeft <= tableSize) return 'final';
  if (playersLeft <= paid) return 'itm';
  // with flat seat prizes the pressure starts much earlier (about 15 left for 10 seats)
  const zone = satellite ? Math.max(3, Math.ceil(paid * 0.5)) : Math.max(2, Math.ceil(paid * 0.2));
  if (playersLeft <= paid + zone) return 'bubble';
  if (avgStackBB >= 50) return 'early';
  return 'middle';
}
