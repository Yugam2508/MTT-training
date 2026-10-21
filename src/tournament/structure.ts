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

/**
 * An event's own blind sheet: levels in order, with breaks (minutes) and day ends between them.
 * Big-blind antes equal to the big blind, as in the SPC structures.
 */
export type ScheduleItem = Level | { breakMin: number; label: string };

export const isLevel = (x: ScheduleItem): x is Level => 'bb' in x;

/** Compact sheet: [sb, bb] levels (ante = bb), 'B<min>' breaks, 'B<min>c' colour-ups, 'D<n>' day ends. */
export function sheet(items: ([number, number] | string)[]): ScheduleItem[] {
  return items.map((x) => {
    if (Array.isArray(x)) return { sb: x[0], bb: x[1], ante: x[1] };
    if (x[0] === 'D') return { breakMin: 0, label: `End of Day ${x.slice(1)}` };
    const min = parseInt(x.slice(1), 10);
    return { breakMin: min, label: `Break: ${min} minutes${x.endsWith('c') ? ' (colour-up)' : ''}` };
  });
}

function scheduleLevels(schedule: ScheduleItem[]): Level[] {
  return schedule.filter(isLevel);
}

/** Level at a 0-based index: the event's sheet, carried on by ~25% a level past its end, else the default. */
export function levelAt(cfg: Pick<TournamentConfig, 'schedule'> | undefined, index: number): Level {
  if (!cfg?.schedule) return blindLevel(index);
  const levels = scheduleLevels(cfg.schedule);
  if (index < levels.length) return levels[index];
  let bb = levels[levels.length - 1].bb;
  for (let k = levels.length; k <= index; k++) bb = niceRound(bb * 1.25);
  return { sb: bb / 2, bb, ante: bb };
}

function niceRound(x: number): number {
  const step = Math.pow(10, Math.floor(Math.log10(x)) - 1) * 2;
  return Math.round(x / step) * step;
}

/** Breaks and day ends that follow the level at `index` on the event's sheet. */
export function stopsAfter(cfg: Pick<TournamentConfig, 'schedule'>, index: number): { breakMin: number; label: string }[] {
  if (!cfg.schedule) return [];
  const out: { breakMin: number; label: string }[] = [];
  let n = -1;
  for (const x of cfg.schedule) {
    if (isLevel(x)) { if (n === index) break; n++; continue; }
    if (n === index) out.push(x);
  }
  return out;
}

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
export function levelForDepth(avgStack: number, targetBB: number, cfg?: Pick<TournamentConfig, 'schedule'>): number {
  let best = 0, bestDiff = Infinity;
  for (let i = 0; i < 40; i++) {
    const d = Math.abs(avgStack / levelAt(cfg, i).bb - targetBB);
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
  /** Live pace: blinds go up by the clock and hands take as long as at a real table. */
  pace?: 'fast' | 'live';
  /** Level length in minutes at live pace (the event's structure); otherwise derived from handsPerLevel. */
  levelMinutes?: number;
  buyIn: number;
  /** Part of the buy-in that is a fee and not in the prize pool (live events: S$600 = S$530 + S$70). */
  fee?: number;
  /** Share of the prize pool kept for costs (SPC: 4% for staffing). */
  poolCut?: number;
  /** The event's own blind sheet and breaks; otherwise the default levels and a break every 4 levels. */
  schedule?: ScheduleItem[];
  /** Mystery bounty: this much of each buy-in goes to random bounties won for eliminations in the money. */
  mysteryBounty?: { perEntry: number };
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
 * Main Event entry). Field size and structure are assumptions: 100 entries is exactly the guarantee,
 * with 20-minute levels.
 */
const SPC_SATELLITE: Omit<TournamentConfig, 'seed' | 'start' | 'heroStack'> = {
  name: 'SPC Main Event Satellite', entrants: 100, tableSize: 9, startingStack: 5000, handsPerLevel: 8, levelMinutes: 20,
  buyIn: 60, currency: 'S$', satellite: { seatValue: 600, guaranteedSeats: 10, target: 'SPC Main Event' }, field: 'soft',
};

/** SPC blind sheets, from sgpokerchamps.com/event-structures (October 2026). */
export const SPC_MAIN_SHEET = sheet([
  [100, 100], [100, 200], [200, 300], [200, 400], 'B15', [300, 600], [400, 800], [600, 1200], [800, 1600], 'B15c',
  [1000, 2000], [1500, 3000], [2000, 4000], [2500, 5000], 'D1', [2500, 5000], [3000, 6000], [4000, 8000], [5000, 10000], 'B10',
  [6000, 12000], [8000, 16000], [10000, 20000], [12000, 24000], 'B10c', [16000, 32000], [20000, 40000], [30000, 60000], [40000, 80000], 'B10',
  [60000, 120000], [80000, 160000], [120000, 240000], [160000, 320000], 'B10', [200000, 400000], [250000, 500000], [300000, 600000],
]);

export const SPC_ROLLER_SHEET = sheet([
  [100, 100], [100, 200], [200, 300], 'B10', [200, 400], [300, 500], [300, 600], 'B10', [400, 800], [500, 1000], [600, 1200], 'D1',
  [800, 1600], [1000, 2000], [1200, 2400], 'B10', [1500, 3000], [2000, 4000], [2500, 5000], 'B10', [3000, 6000], [4000, 8000], [5000, 10000], 'B10',
  [7500, 15000], [10000, 20000], [15000, 30000], 'B10c', [20000, 40000], [25000, 50000], [30000, 60000], 'B10', [40000, 80000], [50000, 100000], [60000, 120000],
]);

export const SPC_BOUNTY_SHEET = sheet([
  [100, 100], [100, 200], [200, 300], [200, 400], [300, 600], [400, 800], 'B10', [600, 1200], [800, 1600], [1200, 2400], [1600, 3200], [2000, 4000], [3000, 6000], 'B10',
  [4000, 8000], [6000, 12000], [8000, 16000], [12000, 24000], [16000, 32000], [20000, 40000],
]);

/**
 * SPC Main Event (Natural8): S$530 + S$70, 15,000 chips plus a 10,000 add-on (S$40, assumed to go to
 * the prize pool and bought by everyone), the published blind sheet, 4% of the pool to staffing, 13% paid.
 * Flight 1B's 30-minute levels (about 13 live hands). Recent fields were 203-398 entries; 250 is typical.
 */
const SPC_MAIN: Omit<TournamentConfig, 'seed' | 'start' | 'heroStack'> = {
  name: 'SPC Main Event', entrants: 250, tableSize: 9, startingStack: 25000, handsPerLevel: 13, levelMinutes: 30,
  buyIn: 640, fee: 70, poolCut: 0.04, paid: 33, currency: 'S$', field: 'mixed', schedule: SPC_MAIN_SHEET,
};

/**
 * SPC Mini-Roller: S$1,000, 30,000 chips, 40-minute levels (about 17 live hands), the shared Mini/High-Roller
 * sheet. Recent fields: 51, 60 and 40 entries with 6, 7 and 5 paid; the payouts match about S$100 of each
 * buy-in going to the fee before the 4% cut.
 */
const SPC_MINI: Omit<TournamentConfig, 'seed' | 'start' | 'heroStack'> = {
  name: 'SPC Mini-Roller', entrants: 50, tableSize: 9, startingStack: 30000, handsPerLevel: 17, levelMinutes: 40,
  buyIn: 1000, fee: 100, poolCut: 0.04, paid: 6, currency: 'S$', field: 'tough', schedule: SPC_ROLLER_SHEET,
};

/**
 * SPC Mystery Bounty: S$400, 15,000 chips, 20-minute levels (about 9 live hands), S$90 of each buy-in to
 * mystery bounties that start on the bubble. Recent fields: 29 and 30 entries, 4 paid (S$3,200-3,300 for 1st,
 * S$800-900 for 4th); the payouts match about S$50 of each buy-in going to the fee before the 4% cut.
 */
const SPC_BOUNTY: Omit<TournamentConfig, 'seed' | 'start' | 'heroStack'> = {
  name: 'SPC Mystery Bounty', entrants: 30, tableSize: 9, startingStack: 15000, handsPerLevel: 9, levelMinutes: 20,
  buyIn: 400, fee: 50, poolCut: 0.04, paid: 4, currency: 'S$', field: 'mixed', schedule: SPC_BOUNTY_SHEET, mysteryBounty: { perEntry: 90 },
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
    blurb: 'The S$600 Singapore Poker Championships Main Event on the real blind sheet: 250 entries, 25,000 chips with the add-on (250bb), 30-minute levels, 13% paid.',
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
  {
    key: 'spcmini', label: 'SPC Mini-Roller',
    blurb: 'S$1,000 Mini-Roller on the shared Mini/High-Roller sheet: about 50 entries, 6 paid, 30,000 chips (300bb), 40-minute levels and a tougher field.',
    config: { ...SPC_MINI, start: 'beginning', heroStack: 'average' },
  },
  {
    key: 'spcbounty', label: 'SPC Mystery Bounty',
    blurb: 'S$400 Mystery Bounty: about 30 entries, 4 paid, 15,000 chips, fast 20-minute levels. From the bubble on, every knockout wins a random bounty from a S$90-per-entry pool.',
    config: { ...SPC_BOUNTY, start: 'beginning', heroStack: 'average' },
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
