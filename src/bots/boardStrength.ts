/**
 * Hand strength tables for a board: for every combo, the fraction of other combos it beats
 * (ties count half). Plus draw detection to estimate improvement potential.
 */
import type { Card } from '../engine/cards';
import { evaluate, STRAIGHT_HIGH, categoryOf } from '../engine/evaluator';
import { NUM_COMBOS, COMBO_A, COMBO_B } from '../engine/combos';

export interface BoardTable {
  key: string;
  /** hs[combo] in [0,1]; NaN for combos that use a board card. */
  hs: Float32Array;
  /** potential[combo]: probability-like estimate of improving (flop/turn only). */
  ppot: Float32Array;
  wetness: number;
}

const cache = new Map<string, BoardTable>();

export function boardKey(board: readonly Card[]) {
  return board.slice().sort((a, b) => a - b).join(',');
}

export function boardTable(board: readonly Card[]): BoardTable {
  const key = boardKey(board);
  const hit = cache.get(key);
  if (hit) return hit;
  const len = board.length;
  const buf = new Int32Array(7);
  for (let i = 0; i < len; i++) buf[i + 2] = board[i];
  const onBoard = new Uint8Array(52);
  for (const c of board) onBoard[c] = 1;
  const scores = new Float64Array(NUM_COMBOS).fill(-1);
  const valid: number[] = [];
  for (let k = 0; k < NUM_COMBOS; k++) {
    const a = COMBO_A[k], b = COMBO_B[k];
    if (onBoard[a] || onBoard[b]) continue;
    buf[0] = a; buf[1] = b;
    scores[k] = evaluate(buf, len + 2);
    valid.push(k);
  }
  valid.sort((x, y) => scores[x] - scores[y]);
  const hs = new Float32Array(NUM_COMBOS).fill(NaN);
  const m = valid.length;
  let i = 0;
  while (i < m) {
    let j = i;
    while (j + 1 < m && scores[valid[j + 1]] === scores[valid[i]]) j++;
    const eqCount = j - i + 1;
    const val = (i + (eqCount - 1) / 2) / (m - 1);
    for (let q = i; q <= j; q++) hs[valid[q]] = val;
    i = j + 1;
  }
  const ppot = new Float32Array(NUM_COMBOS);
  if (len < 5) {
    for (const k of valid) ppot[k] = drawPotential(COMBO_A[k], COMBO_B[k], board, scores[k]);
  }
  const t: BoardTable = { key, hs, ppot, wetness: boardWetness(board) };
  cache.set(key, t);
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return t;
}

export function drawPotential(a: Card, b: Card, board: readonly Card[], score?: number): number {
  const len = board.length;
  if (len >= 5) return 0;
  const cat = categoryOf(score ?? evaluate([a, b, ...board]));
  if (cat >= 4) return 0; // already a straight or better
  const suitCount = [0, 0, 0, 0];
  const holeSuit = [0, 0, 0, 0];
  let mask = 0, boardMask = 0;
  for (const c of board) { suitCount[c & 3]++; mask |= 1 << (c >> 2); boardMask |= 1 << (c >> 2); }
  for (const c of [a, b]) { suitCount[c & 3]++; holeSuit[c & 3]++; mask |= 1 << (c >> 2); }
  let outs = 0;
  let fd = false;
  for (let su = 0; su < 4; su++) if (suitCount[su] === 4 && holeSuit[su] > 0) { outs += 9; fd = true; }
  let sOuts = 0;
  for (let r = 0; r < 13; r++) {
    if (mask & (1 << r)) continue;
    if (STRAIGHT_HIGH[mask | (1 << r)] >= 0 && STRAIGHT_HIGH[boardMask | (1 << r)] < 0) sOuts++;
  }
  sOuts = Math.min(2, sOuts);
  outs += sOuts * 4;
  if (fd && sOuts) outs -= 2;
  if (cat === 0) {
    let maxBoard = 0;
    for (const c of board) maxBoard = Math.max(maxBoard, c >> 2);
    if ((a >> 2) > maxBoard) outs += 1.5;
    if ((b >> 2) > maxBoard) outs += 1.5;
  }
  const p = len === 3 ? 1 - (1 - outs / 47) * (1 - outs / 46) : outs / 46;
  return Math.min(0.7, p);
}

/** 0 = dry (K72 rainbow) .. 1 = very wet (JT9 two-tone). */
export function boardWetness(board: readonly Card[]): number {
  const suits = [0, 0, 0, 0];
  let mask = 0;
  for (const c of board) { suits[c & 3]++; mask |= 1 << (c >> 2); }
  const maxSuit = Math.max(...suits);
  let w = 0;
  if (maxSuit >= 3) w += 0.45; else if (maxSuit === 2) w += 0.25;
  // connectedness: how many 5-rank windows contain 3+ board ranks
  let conn = 0;
  const ext = (mask << 1) | ((mask >> 12) & 1);
  for (let lo = 0; lo <= 9; lo++) {
    let c = 0;
    for (let k = 0; k < 5; k++) if (ext & (1 << (lo + k))) c++;
    if (c >= 3) conn++;
    else if (c === 2) conn += 0.25;
  }
  w += Math.min(0.55, conn * 0.12);
  // paired boards are drier
  const distinct = board.length - (board.length - popcount(mask));
  if (distinct < board.length) w -= 0.1;
  return Math.max(0, Math.min(1, w));
}

function popcount(m: number) {
  let c = 0;
  while (m) { c += m & 1; m >>= 1; }
  return c;
}
