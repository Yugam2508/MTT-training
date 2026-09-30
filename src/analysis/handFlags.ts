/** Per-hand statistical flags for one player (VPIP, PFR, 3-bet, c-bet, WTSD, ...). */
import type { HandState } from '../engine/hand';
import { positionOf } from '../theory/spot';
import type { ChartPos } from '../theory/positions';

export interface HandFlags {
  pos: ChartPos;
  stackBB: number;
  vpip: boolean;
  pfr: boolean;
  limp: boolean;
  rfiOpp: boolean;
  rfi: boolean;
  stealOpp: boolean;
  steal: boolean;
  threeBetOpp: boolean;
  threeBet: boolean;
  foldTo3BetOpp: boolean;
  foldTo3Bet: boolean;
  bbVsStealOpp: boolean;
  bbFoldToSteal: boolean;
  cbetOpp: boolean;
  cbet: boolean;
  foldToCbetOpp: boolean;
  foldToCbet: boolean;
  sawFlop: boolean;
  wtsd: boolean;
  wsd: boolean;
  won: boolean;
  postBets: number;
  postCalls: number;
  allinPre: boolean;
  net: number;
  netBB: number;
}

export function computeFlags(s: HandState, i: number): HandFlags {
  const bb = s.cfg.bb;
  const pos = positionOf(s, i);
  const me = s.players[i];
  const f: HandFlags = {
    pos, stackBB: me.startStack / bb,
    vpip: false, pfr: false, limp: false, rfiOpp: false, rfi: false, stealOpp: false, steal: false,
    threeBetOpp: false, threeBet: false, foldTo3BetOpp: false, foldTo3Bet: false, bbVsStealOpp: false, bbFoldToSteal: false,
    cbetOpp: false, cbet: false, foldToCbetOpp: false, foldToCbet: false, sawFlop: false, wtsd: false, wsd: false, won: false,
    postBets: 0, postCalls: 0, allinPre: false, net: 0, netBB: 0,
  };
  let raises = 0, limps = 0, callersAfterRaise = 0;
  let firstRaiser = -1;
  let first = true;
  let foldedStreet = -1;
  for (const a of s.actions) {
    if (a.street !== 0) continue;
    if (a.type === 'sb' || a.type === 'bb' || a.type === 'ante') continue;
    if (a.p === i) {
      if (a.type === 'fold') foldedStreet = 0;
      if (a.allIn && (a.type === 'raise' || a.type === 'call' || a.type === 'bet')) f.allinPre = true;
      if (first) {
        first = false;
        if (raises === 0 && limps === 0 && pos !== 'BB') {
          f.rfiOpp = true;
          f.rfi = a.type === 'raise';
          if (pos === 'CO' || pos === 'BTN' || pos === 'SB') { f.stealOpp = true; f.steal = f.rfi; }
        }
        if (raises === 0 && a.type === 'call') f.limp = true;
        if (pos === 'BB' && raises === 1 && limps === 0 && callersAfterRaise === 0 && firstRaiser >= 0) {
          const op = positionOf(s, firstRaiser);
          if (op === 'CO' || op === 'BTN' || op === 'SB') { f.bbVsStealOpp = true; f.bbFoldToSteal = a.type === 'fold'; }
        }
      }
      if (raises === 1 && firstRaiser !== i && !f.threeBetOpp) {
        f.threeBetOpp = true;
        f.threeBet = a.type === 'raise';
      }
      if (raises === 2 && firstRaiser === i && !f.foldTo3BetOpp) {
        f.foldTo3BetOpp = true;
        f.foldTo3Bet = a.type === 'fold';
      }
      if (a.type === 'call' || a.type === 'raise') f.vpip = true;
      if (a.type === 'raise') f.pfr = true;
    }
    if (a.type === 'raise' || a.type === 'bet') {
      raises++;
      callersAfterRaise = 0;
      if (firstRaiser < 0) firstRaiser = a.p;
    } else if (a.type === 'call') {
      if (raises === 0) limps++; else callersAfterRaise++;
    }
  }
  for (const a of s.actions) if (a.p === i && a.type === 'fold') foldedStreet = a.street;
  const flopSeen = s.board.length >= 3 || (s.result?.showdown ?? false);
  f.sawFlop = flopSeen && (foldedStreet < 0 || foldedStreet >= 1) && !(foldedStreet === 0);
  // flop c-bet stats
  const pfa = s.preflopAggressor;
  let flopBetSeen = false, flopFirstBetter = -1;
  let myFirstFlop = true;
  for (const a of s.actions) {
    if (a.street < 1) continue;
    if (a.p === i && a.street >= 1) {
      if (a.type === 'bet' || a.type === 'raise') f.postBets++;
      if (a.type === 'call') f.postCalls++;
    }
    if (a.street !== 1) continue;
    if (a.p === i && myFirstFlop) {
      myFirstFlop = false;
      if (pfa === i && !flopBetSeen) { f.cbetOpp = true; f.cbet = a.type === 'bet'; }
      if (pfa !== i && flopBetSeen && flopFirstBetter === pfa) { f.foldToCbetOpp = true; f.foldToCbet = a.type === 'fold'; }
    }
    if ((a.type === 'bet' || a.type === 'raise') && !flopBetSeen) { flopBetSeen = true; flopFirstBetter = a.p; }
  }
  const res = s.result;
  if (res) {
    f.net = res.net[i];
    f.netBB = res.net[i] / bb;
    f.won = res.won[i] > 0;
    f.wtsd = f.sawFlop && res.showdown && !me.folded;
    f.wsd = f.wtsd && res.won[i] > 0;
  }
  return f;
}

/** Aggregated counts; ratio helpers compute percentages with sample sizes. */
export interface StatCounts {
  hands: number;
  vpip: number; pfr: number; limp: number;
  rfiOpp: number; rfi: number; stealOpp: number; steal: number;
  threeBetOpp: number; threeBet: number; foldTo3BetOpp: number; foldTo3Bet: number;
  bbVsStealOpp: number; bbFoldToSteal: number;
  cbetOpp: number; cbet: number; foldToCbetOpp: number; foldToCbet: number;
  sawFlop: number; wtsd: number; wsd: number; won: number;
  postBets: number; postCalls: number; netBB: number;
}

export const emptyCounts = (): StatCounts => ({
  hands: 0, vpip: 0, pfr: 0, limp: 0, rfiOpp: 0, rfi: 0, stealOpp: 0, steal: 0, threeBetOpp: 0, threeBet: 0,
  foldTo3BetOpp: 0, foldTo3Bet: 0, bbVsStealOpp: 0, bbFoldToSteal: 0, cbetOpp: 0, cbet: 0, foldToCbetOpp: 0, foldToCbet: 0,
  sawFlop: 0, wtsd: 0, wsd: 0, won: 0, postBets: 0, postCalls: 0, netBB: 0,
});

export function accumulate(c: StatCounts, f: HandFlags) {
  c.hands++;
  const keys: (keyof HandFlags & keyof StatCounts)[] = ['vpip', 'pfr', 'limp', 'rfiOpp', 'rfi', 'stealOpp', 'steal', 'threeBetOpp', 'threeBet',
    'foldTo3BetOpp', 'foldTo3Bet', 'bbVsStealOpp', 'bbFoldToSteal', 'cbetOpp', 'cbet', 'foldToCbetOpp', 'foldToCbet', 'sawFlop', 'wtsd', 'wsd', 'won'];
  for (const k of keys) if (f[k]) (c[k] as number)++;
  c.postBets += f.postBets;
  c.postCalls += f.postCalls;
  c.netBB += f.netBB;
}

export const pct = (num: number, den: number) => (den > 0 ? (100 * num) / den : NaN);
