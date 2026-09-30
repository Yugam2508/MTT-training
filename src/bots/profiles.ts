/** Opponent archetypes found in real MTT fields. */
export type ProfileKey = 'pro' | 'tag' | 'lag' | 'nit' | 'station' | 'fish' | 'maniac';

export interface Profile {
  key: ProfileKey;
  label: string;
  short: string;
  description: string;
  exploit: string;
  // preflop
  loose: number; // open range multiplier
  limp: number; // fraction of opens that are limps
  threeBet: number;
  call: number;
  vs3bet: number;
  pushFoldBB: number; // switches to push/fold at or below this stack
  pushLoose: number;
  callBias: number; // equity bias when calling all-ins (+ = calls lighter)
  icm: number; // 0 = ignores ICM, 1 = fully ICM aware
  openSize: number; // in BB (deep)
  // postflop
  valueT: number; // strength needed to bet for value
  raiseT: number; // strength needed to raise for value
  aggr: number; // semi-bluff tendency
  bluff: number; // pure bluff tendency
  cbet: number; // flop c-bet frequency with air as preflop raiser
  callDown: number; // stickiness facing bets
  betSize: [number, number, number, number]; // pot fractions: dry flop, wet flop, turn, river
}

export const PROFILES: Record<ProfileKey, Profile> = {
  pro: {
    key: 'pro', label: 'Winning Reg', short: 'REG',
    description: 'Balanced, solver-aware regular. Opens standard ranges, 3-bets a mix of value and bluffs, adjusts to ICM.',
    exploit: 'Avoid marginal spots against them. Pick on the weaker players at the table instead, and defend correctly vs their steals.',
    loose: 1.0, limp: 0, threeBet: 1.0, call: 1.0, vs3bet: 1.0, pushFoldBB: 12, pushLoose: 1.0, callBias: 0, icm: 1, openSize: 2.2,
    valueT: 0.68, raiseT: 0.88, aggr: 0.6, bluff: 0.35, cbet: 0.62, callDown: 0.1, betSize: [0.33, 0.6, 0.66, 0.72],
  },
  tag: {
    key: 'tag', label: 'Tight-Aggressive', short: 'TAG',
    description: 'Solid but slightly tight. Plays good hands aggressively, folds too often to pressure on later streets.',
    exploit: 'Steal their blinds and 3-bet their late-position opens. Respect their big turn and river bets.',
    loose: 0.9, limp: 0, threeBet: 0.85, call: 0.8, vs3bet: 0.85, pushFoldBB: 11, pushLoose: 0.95, callBias: -0.01, icm: 0.8, openSize: 2.3,
    valueT: 0.7, raiseT: 0.9, aggr: 0.5, bluff: 0.25, cbet: 0.66, callDown: 0.05, betSize: [0.4, 0.66, 0.66, 0.75],
  },
  lag: {
    key: 'lag', label: 'Loose-Aggressive', short: 'LAG',
    description: 'Opens wide, 3-bets light, barrels often. Dangerous with deep stacks, applies heavy bubble pressure.',
    exploit: 'Widen your value range, call down lighter with bluff-catchers, and 4-bet or shove your strong hands against their 3-bets.',
    loose: 1.35, limp: 0, threeBet: 1.6, call: 1.1, vs3bet: 1.2, pushFoldBB: 13, pushLoose: 1.2, callBias: 0.01, icm: 0.6, openSize: 2.3,
    valueT: 0.64, raiseT: 0.84, aggr: 0.8, bluff: 0.5, cbet: 0.78, callDown: 0.15, betSize: [0.5, 0.75, 0.75, 0.85],
  },
  nit: {
    key: 'nit', label: 'Nit', short: 'NIT',
    description: 'Very tight. Only plays premium hands, rarely bluffs, tightens up even more near the money.',
    exploit: 'Steal relentlessly, especially on the bubble. Fold to their raises and 3-bets unless you have a monster.',
    loose: 0.6, limp: 0, threeBet: 0.55, call: 0.6, vs3bet: 0.6, pushFoldBB: 9, pushLoose: 0.7, callBias: -0.04, icm: 1.3, openSize: 2.5,
    valueT: 0.76, raiseT: 0.93, aggr: 0.3, bluff: 0.1, cbet: 0.5, callDown: 0, betSize: [0.5, 0.66, 0.66, 0.66],
  },
  station: {
    key: 'station', label: 'Calling Station', short: 'STA',
    description: 'Limps and calls far too much, rarely raises, will not fold any pair. Ignores ICM.',
    exploit: 'Never bluff them. Value bet thinner and bigger: top pair is often good for three streets.',
    loose: 1.3, limp: 0.65, threeBet: 0.4, call: 2.2, vs3bet: 1.8, pushFoldBB: 6, pushLoose: 1.3, callBias: 0.08, icm: 0, openSize: 3,
    valueT: 0.8, raiseT: 0.95, aggr: 0.2, bluff: 0.08, cbet: 0.35, callDown: 0.9, betSize: [0.5, 0.5, 0.5, 0.5],
  },
  fish: {
    key: 'fish', label: 'Recreational', short: 'REC',
    description: 'Plays too many hands, limps, calls too wide preflop, bets strong hands and gives up with weak ones.',
    exploit: 'Isolate their limps with bigger raises, value bet relentlessly and believe their big bets.',
    loose: 1.5, limp: 0.5, threeBet: 0.5, call: 1.8, vs3bet: 1.3, pushFoldBB: 7, pushLoose: 1.4, callBias: 0.05, icm: 0.1, openSize: 3,
    valueT: 0.72, raiseT: 0.92, aggr: 0.35, bluff: 0.2, cbet: 0.45, callDown: 0.55, betSize: [0.6, 0.6, 0.6, 0.6],
  },
  maniac: {
    key: 'maniac', label: 'Maniac', short: 'MAN',
    description: 'Raises and re-raises constantly, bluffs every street, shoves light.',
    exploit: 'Tighten up and let them hang themselves. Call down with medium-strength hands and trap your big hands.',
    loose: 2.1, limp: 0, threeBet: 2.6, call: 1.3, vs3bet: 1.8, pushFoldBB: 15, pushLoose: 1.7, callBias: 0.06, icm: 0, openSize: 3,
    valueT: 0.58, raiseT: 0.74, aggr: 1.0, bluff: 0.75, cbet: 0.9, callDown: 0.4, betSize: [0.8, 1.0, 1.0, 1.1],
  },
};

export type FieldMix = 'soft' | 'mixed' | 'tough';

export const FIELD_MIXES: Record<FieldMix, { label: string; weights: Partial<Record<ProfileKey, number>> }> = {
  soft: { label: 'Soft (micro stakes)', weights: { fish: 30, station: 20, nit: 15, tag: 15, lag: 8, maniac: 5, pro: 7 } },
  mixed: { label: 'Mixed (low/mid stakes)', weights: { fish: 15, station: 10, nit: 15, tag: 25, lag: 15, maniac: 5, pro: 15 } },
  tough: { label: 'Tough (high stakes)', weights: { fish: 5, station: 5, nit: 10, tag: 25, lag: 25, maniac: 2, pro: 28 } },
};
