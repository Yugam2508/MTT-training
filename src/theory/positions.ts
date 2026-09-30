/**
 * Positions. Charts are keyed by distance to the button so they work at any table size:
 * a 6-handed first-to-act seat plays the 9-max LJ chart, etc.
 */
export type ChartPos = 'UTG' | 'UTG1' | 'UTG2' | 'LJ' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

export const CHART_POSITIONS: ChartPos[] = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

export const POS_LABEL: Record<ChartPos, string> = {
  UTG: 'UTG', UTG1: 'UTG+1', UTG2: 'UTG+2', LJ: 'LJ', HJ: 'HJ', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB',
};

const NON_BLIND_BY_DIST: ChartPos[] = ['BTN', 'CO', 'HJ', 'LJ', 'UTG2', 'UTG1', 'UTG'];

/**
 * @param n number of players dealt in
 * @param offset seats clockwise from the button among dealt-in players (0 = button)
 */
export function chartPosition(n: number, offset: number): ChartPos {
  if (n === 2) return offset === 0 ? 'SB' : 'BB';
  if (offset === 1) return 'SB';
  if (offset === 2) return 'BB';
  if (offset === 0) return 'BTN';
  // offset 3 = first to act preflop; distance to button = n - offset
  const dist = n - offset;
  return NON_BLIND_BY_DIST[Math.min(dist, NON_BLIND_BY_DIST.length - 1)];
}

/** Display label: the earliest seat at a short table reads as UTG. */
export function positionLabel(n: number, offset: number): string {
  if (n === 2) return offset === 0 ? 'BTN/SB' : 'BB';
  const pos = chartPosition(n, offset);
  return POS_LABEL[pos];
}

/** Rough position groups for vs-open charts. */
export type PosGroup = 'EP' | 'MP' | 'LP' | 'SB' | 'BB';
export function posGroup(p: ChartPos): PosGroup {
  if (p === 'UTG' || p === 'UTG1' || p === 'UTG2') return 'EP';
  if (p === 'LJ' || p === 'HJ') return 'MP';
  if (p === 'CO' || p === 'BTN') return 'LP';
  return p;
}

export const isLatePosition = (p: ChartPos) => p === 'CO' || p === 'BTN' || p === 'SB';
