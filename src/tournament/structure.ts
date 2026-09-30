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
];

export type Stage = 'early' | 'middle' | 'bubble' | 'itm' | 'final';

export const STAGE_LABEL: Record<Stage, string> = {
  early: 'Early', middle: 'Middle', bubble: 'Bubble', itm: 'In the money', final: 'Final table',
};

export function stageOf(playersLeft: number, paid: number, tables: number, tableSize: number, avgStackBB: number): Stage {
  if (tables === 1 && playersLeft <= tableSize) return 'final';
  if (playersLeft <= paid) return 'itm';
  if (playersLeft <= paid + Math.max(2, Math.ceil(paid * 0.2))) return 'bubble';
  if (avgStackBB >= 50) return 'early';
  return 'middle';
}
