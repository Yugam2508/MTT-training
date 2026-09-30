/** Monte Carlo and exact equity calculations. */
import type { Card } from './cards';
import { evaluate } from './evaluator';
import { type Rng, makeRng } from './rng';
import { NUM_COMBOS, COMBO_A, COMBO_B, COMBO_CLASS } from './combos';
import type { Range } from './ranges';

export interface EquitySpec {
  /** Known hole cards. */
  cards?: [Card, Card];
  /** Class-level range (169 weights). */
  range?: Range;
  /** Combo-level weights (1326), e.g. a Bayesian-filtered range. */
  comboWeights?: Float64Array;
}

export interface EquityResult {
  equity: number[]; // win + tie share
  win: number[];
  tie: number[];
  samples: number;
  exact: boolean;
}

interface Sampler {
  combos: Int32Array;
  cum: Float64Array;
  total: number;
}

function buildSampler(spec: EquitySpec, dead: Set<number>): Sampler {
  const combos: number[] = [];
  const cum: number[] = [];
  let total = 0;
  for (let k = 0; k < NUM_COMBOS; k++) {
    const w = spec.comboWeights ? spec.comboWeights[k] : spec.range ? spec.range[COMBO_CLASS[k]] : 1;
    if (w <= 0) continue;
    if (dead.has(COMBO_A[k]) || dead.has(COMBO_B[k])) continue;
    total += w;
    combos.push(k);
    cum.push(total);
  }
  return { combos: Int32Array.from(combos), cum: Float64Array.from(cum), total };
}

function sampleCombo(s: Sampler, rng: Rng): number {
  const x = rng.next() * s.total;
  let lo = 0, hi = s.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.cum[mid] > x) hi = mid; else lo = mid + 1;
  }
  return s.combos[lo];
}

/**
 * Equity for 2+ players, each given as known cards, a range, or combo weights.
 * Uses exact enumeration when all hands are known and at most 2 board cards remain.
 */
export function calcEquity(players: EquitySpec[], board: Card[] = [], iterations = 20000, rng: Rng = makeRng()): EquityResult {
  const n = players.length;
  const win = new Array(n).fill(0);
  const tie = new Array(n).fill(0);
  const dead = new Set<number>(board);
  for (const p of players) if (p.cards) { dead.add(p.cards[0]); dead.add(p.cards[1]); }
  const allKnown = players.every((p) => p.cards);
  const toCome = 5 - board.length;
  const buf = new Int32Array(7);
  const scores = new Array(n).fill(0);

  const score = (hole: [number, number], full: ArrayLike<number>) => {
    buf[0] = hole[0]; buf[1] = hole[1];
    for (let i = 0; i < 5; i++) buf[i + 2] = full[i];
    return evaluate(buf, 7);
  };
  const tally = (holes: [number, number][], full: ArrayLike<number>, weight = 1) => {
    let best = -1, nBest = 0;
    for (let i = 0; i < n; i++) {
      const s = score(holes[i], full);
      scores[i] = s;
      if (s > best) { best = s; nBest = 1; } else if (s === best) nBest++;
    }
    for (let i = 0; i < n; i++) {
      if (scores[i] === best) {
        if (nBest === 1) win[i] += weight; else tie[i] += weight / nBest;
      }
    }
  };

  if (allKnown && toCome <= 2) {
    const holes = players.map((p) => p.cards!) as [number, number][];
    const rest: number[] = [];
    for (let c = 0; c < 52; c++) if (!dead.has(c)) rest.push(c);
    const full = new Int32Array(5);
    board.forEach((c, i) => (full[i] = c));
    let count = 0;
    if (toCome === 0) { tally(holes, full); count = 1; }
    else if (toCome === 1) {
      for (const c of rest) { full[4] = c; tally(holes, full); count++; }
    } else {
      for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
        full[3] = rest[i]; full[4] = rest[j]; tally(holes, full); count++;
      }
    }
    return finish(win, tie, count, true);
  }

  const samplers = players.map((p) => (p.cards ? null : buildSampler(p, dead)));
  const used = new Uint8Array(52);
  const full = new Int32Array(5);
  const holes: [number, number][] = players.map(() => [0, 0]);
  let done = 0;
  const deckRest: number[] = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) deckRest.push(c);
  for (let it = 0; it < iterations; it++) {
    used.fill(0);
    for (const c of dead) used[c] = 1;
    let ok = true;
    for (let i = 0; i < n; i++) {
      const p = players[i];
      if (p.cards) { holes[i] = p.cards; continue; }
      const s = samplers[i]!;
      if (s.total <= 0) { ok = false; break; }
      let tries = 0, k = -1;
      do {
        k = sampleCombo(s, rng);
        tries++;
      } while ((used[COMBO_A[k]] || used[COMBO_B[k]]) && tries < 50);
      if (used[COMBO_A[k]] || used[COMBO_B[k]]) { ok = false; break; }
      used[COMBO_A[k]] = 1; used[COMBO_B[k]] = 1;
      holes[i] = [COMBO_A[k], COMBO_B[k]];
    }
    if (!ok) continue;
    for (let i = 0; i < board.length; i++) full[i] = board[i];
    for (let i = board.length; i < 5; i++) {
      let c: number;
      do { c = deckRest[rng.int(deckRest.length)]; } while (used[c]);
      used[c] = 1;
      full[i] = c;
    }
    tally(holes, full);
    done++;
  }
  return finish(win, tie, done, false);
}

function finish(win: number[], tie: number[], count: number, exact: boolean): EquityResult {
  const c = Math.max(1, count);
  return {
    win: win.map((w) => w / c),
    tie: tie.map((t) => t / c),
    equity: win.map((w, i) => (w + tie[i]) / c),
    samples: count,
    exact,
  };
}
