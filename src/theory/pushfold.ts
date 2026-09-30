/**
 * Push/fold equilibrium solver (fictitious play) over the 169 hand classes.
 *
 * The spot: one player (the pusher) moves all-in; the players behind act in order and may call.
 * At most one caller is modelled (overcalls are rare and ignored). Payoffs are supplied as
 * *values of outcome stack vectors*, so the same solver works for chip EV (value = chips)
 * and ICM (value = $ equity) or a bubble-factor approximation.
 */
import { NUM_CLASSES } from '../engine/combos';
import { eqVsRange, preflopMatrix } from '../engine/preflopMatrix';
import { NONCONFLICT } from '../engine/combos';
import { type Range, emptyRange } from '../engine/ranges';

export interface PFOutcomeValues {
  /** Values for [pusher, caller1..callerK] in each outcome. */
  fold: number[]; // pusher folds
  steal: number[]; // everyone folds to the push
  win: number[][]; // [i]: caller i calls and the pusher wins
  lose: number[][]; // [i]: caller i calls and the pusher loses
}

export interface PFResult {
  push: Range;
  calls: Range[];
  /** EV(push) - EV(fold) per class for the pusher, in the same units as the values. */
  pushGain: Float64Array;
  /** EV(call) - EV(fold) per class for each caller. */
  callGain: Float64Array[];
}

export interface PFPlayer {
  /** Total chips at the start of the hand (including anything already posted). */
  stack: number;
  /** Chips already in the pot (blinds, open raise). Antes go in `dead`. */
  posted: number;
}

export interface PFSpot {
  pusher: PFPlayer;
  callers: PFPlayer[];
  /** Other money in the pot: antes, folded players' blinds. */
  dead: number;
}

/** Chip-EV outcome values. `bf` optionally applies bubble factors to losses (linearized ICM). */
export function chipOutcomes(spot: PFSpot, bf?: number[]): PFOutcomeValues {
  const k = spot.callers.length;
  const players = [spot.pusher, ...spot.callers];
  const pot = spot.dead + players.reduce((a, p) => a + p.posted, 0);
  const val = (idx: number, finalStack: number) => {
    const start = players[idx].stack;
    const d = finalStack - start;
    const f = bf ? bf[idx] ?? 1 : 1;
    return start + (d < 0 ? d * f : d);
  };
  const vec = (fn: (idx: number) => number) => players.map((_, idx) => val(idx, fn(idx)));
  // pusher folds: pusher loses posted, the pot goes to the last player (BB-ish)
  const fold = vec((idx) => {
    const p = players[idx];
    if (idx === 0) return p.stack - p.posted;
    if (idx === k) return p.stack - p.posted + pot;
    return p.stack - p.posted;
  });
  const steal = vec((idx) => {
    const p = players[idx];
    return idx === 0 ? p.stack - p.posted + pot : p.stack - p.posted;
  });
  const win: number[][] = [], lose: number[][] = [];
  for (let i = 1; i <= k; i++) {
    const c = players[i];
    const eff = Math.min(spot.pusher.stack, c.stack);
    const deadHere = pot - spot.pusher.posted - c.posted;
    win.push(vec((idx) => {
      const p = players[idx];
      if (idx === 0) return p.stack + eff + deadHere;
      if (idx === i) return p.stack - eff;
      return p.stack - p.posted;
    }));
    lose.push(vec((idx) => {
      const p = players[idx];
      if (idx === 0) return p.stack - eff;
      if (idx === i) return p.stack + eff + deadHere;
      return p.stack - p.posted;
    }));
  }
  return { fold, steal, win, lose };
}

/**
 * @param priors optional prior range per caller (e.g. an opener can only hold their opening
 * range). The caller's best response is per hand; the prior weights what the pusher faces.
 */
export function solvePushFold(values: PFOutcomeValues, iterations = 60, initPushPct = 0.3, priors?: (Range | null)[]): PFResult {
  const k = values.win.length;
  const m = preflopMatrix();
  // initial ranges
  const push = emptyRange();
  const eqRandom = new Float64Array(NUM_CLASSES);
  for (let h = 0; h < NUM_CLASSES; h++) {
    let s = 0, n = 0;
    for (let v = 0; v < NUM_CLASSES; v++) { const c = NONCONFLICT[h * NUM_CLASSES + v]; s += c * m[h * NUM_CLASSES + v]; n += c; }
    eqRandom[h] = s / n;
  }
  const sorted = Array.from({ length: NUM_CLASSES }, (_, i) => i).sort((a, b) => eqRandom[b] - eqRandom[a]);
  sorted.slice(0, Math.round(NUM_CLASSES * initPushPct)).forEach((h) => (push[h] = 1));
  const calls: Range[] = Array.from({ length: k }, () => {
    const r = emptyRange();
    sorted.slice(0, 25).forEach((h) => (r[h] = 1));
    return r;
  });
  const pushGain = new Float64Array(NUM_CLASSES);
  const callGain = Array.from({ length: k }, () => new Float64Array(NUM_CLASSES));

  const bestResponses = () => {
    // callers vs current push range
    const brCalls: Range[] = [];
    const eqVsPush = new Float64Array(NUM_CLASSES);
    for (let g = 0; g < NUM_CLASSES; g++) eqVsPush[g] = eqVsRange(g, push);
    for (let i = 0; i < k; i++) {
      const br = emptyRange();
      const vWinCaller = values.lose[i][i + 1]; // pusher loses => caller wins
      const vLoseCaller = values.win[i][i + 1];
      const vFold = values.steal[i + 1];
      for (let g = 0; g < NUM_CLASSES; g++) {
        const eq = eqVsPush[g];
        const gain = eq * vWinCaller + (1 - eq) * vLoseCaller - vFold;
        callGain[i][g] = gain;
        br[g] = gain > 0 ? 1 : 0;
      }
      brCalls.push(br);
    }
    // pusher vs current call ranges
    const brPush = emptyRange();
    for (let h = 0; h < NUM_CLASSES; h++) {
      let pReach = 1; // probability no earlier caller called
      let ev = 0;
      for (let i = 0; i < k; i++) {
        // one pass: fraction of combos in the call range and equity against it
        const base = h * NUM_CLASSES;
        const cr = calls[i];
        const pr = priors?.[i];
        let num = 0, inR = 0, all = 0;
        for (let v = 0; v < NUM_CLASSES; v++) {
          const c = pr ? NONCONFLICT[base + v] * pr[v] : NONCONFLICT[base + v];
          all += c;
          const w = cr[v];
          if (w > 0) { const cw = c * w; inR += cw; num += cw * m[base + v]; }
        }
        const f = all > 0 ? inR / all : 0;
        const pCall = pReach * f;
        if (pCall > 0) {
          const eq = num / inR;
          ev += pCall * (eq * values.win[i][0] + (1 - eq) * values.lose[i][0]);
        }
        pReach *= 1 - f;
      }
      ev += pReach * values.steal[0];
      const gain = ev - values.fold[0];
      pushGain[h] = gain;
      brPush[h] = gain > 0 ? 1 : 0;
    }
    return { brPush, brCalls };
  };

  for (let t = 1; t <= iterations; t++) {
    const { brPush, brCalls } = bestResponses();
    const a = 1 / (t + 1);
    for (let h = 0; h < NUM_CLASSES; h++) push[h] += (brPush[h] - push[h]) * a;
    for (let i = 0; i < k; i++) for (let h = 0; h < NUM_CLASSES; h++) calls[i][h] += (brCalls[i][h] - calls[i][h]) * a;
  }
  // Pure best responses against the averaged (near-equilibrium) strategies give clean charts.
  const { brPush, brCalls } = bestResponses();
  return { push: brPush, calls: brCalls, pushGain, callGain };
}

/**
 * Symmetric "standard chart" spot: pusher `playersBehind` seats from the BB with everyone
 * holding `stackBB` big blinds, blinds 0.5/1 and a BB ante of `anteBB` (dead money).
 * Returns ranges in big-blind units.
 */
export interface ChartSpotOpts {
  stackBB: number;
  /** Number of players left to act behind the pusher (1 = SB vs BB). */
  playersBehind: number;
  anteBB?: number;
  bubbleFactors?: number[];
}

export function standardSpot(o: ChartSpotOpts): PFSpot {
  const s = o.stackBB;
  const ante = o.anteBB ?? 1;
  const k = o.playersBehind;
  // callers in order; last one is BB, the one before (if any) is SB unless the pusher is SB
  const callers: PFPlayer[] = [];
  for (let i = 0; i < k; i++) {
    const isBB = i === k - 1;
    const isSB = i === k - 2;
    // BB-ante format: the BB's ante is dead money that came out of the BB's stack
    const stack = isBB ? Math.max(1, s - ante) : s;
    callers.push({ stack, posted: isBB ? Math.min(1, stack) : isSB ? Math.min(0.5, s) : 0 });
  }
  const pusherIsSB = k === 1;
  return { pusher: { stack: s, posted: pusherIsSB ? 0.5 : 0 }, callers, dead: ante };
}

const chartCache = new Map<string, PFResult>();
export function standardChart(o: ChartSpotOpts): PFResult {
  const key = `${o.stackBB.toFixed(1)}|${o.playersBehind}|${o.anteBB ?? 1}|${(o.bubbleFactors ?? []).map((b) => b.toFixed(1)).join(',')}`;
  let r = chartCache.get(key);
  if (!r) {
    const spot = standardSpot(o);
    r = solvePushFold(chipOutcomes(spot, o.bubbleFactors));
    chartCache.set(key, r);
    if (chartCache.size > 400) chartCache.delete(chartCache.keys().next().value!);
  }
  return r;
}

/** Final chip stacks of [pusher, callers...] in each outcome (same shape as PFOutcomeValues). */
export function outcomeStacks(spot: PFSpot): PFOutcomeValues {
  return chipOutcomes(spot);
}
