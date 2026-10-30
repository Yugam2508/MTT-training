/** HUD stats the research bot uses to tell opponent styles apart: each is a count out of a number of chances. */
import type { StatCounts } from '../analysis/handFlags';

export interface RateStat { key: string; num: (c: StatCounts) => number; den: (c: StatCounts) => number }

export const RATE_STATS: RateStat[] = [
  { key: 'vpip', num: (c) => c.vpip, den: (c) => c.hands },
  { key: 'pfr', num: (c) => c.pfr, den: (c) => c.hands },
  { key: 'limp', num: (c) => c.limp, den: (c) => c.hands },
  { key: 'rfi', num: (c) => c.rfi, den: (c) => c.rfiOpp },
  { key: 'threeBet', num: (c) => c.threeBet, den: (c) => c.threeBetOpp },
  { key: 'bbFoldToSteal', num: (c) => c.bbFoldToSteal, den: (c) => c.bbVsStealOpp },
];
