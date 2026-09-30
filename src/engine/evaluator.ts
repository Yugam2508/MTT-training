/**
 * Fast 5-7 card hand evaluator. Returns a score where a higher number is a better hand.
 * score = category * 2^20 + kickers (five 4-bit rank nibbles).
 * Categories: 0 high card, 1 pair, 2 two pair, 3 trips, 4 straight, 5 flush,
 * 6 full house, 7 quads, 8 straight flush.
 */
import { type Card, RANK_NAMES, RANK_PLURALS } from './cards';

export const CATEGORY_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

const CAT = 1 << 20;

/** STRAIGHT_HIGH[mask] = rank index of the straight's top card, or -1. Handles the wheel. */
export const STRAIGHT_HIGH = new Int8Array(8192);
/** TOP5[mask] = the highest five ranks in mask packed as nibbles. */
const TOP5 = new Int32Array(8192);
export const POPCOUNT = new Uint8Array(8192);

(function init() {
  for (let m = 0; m < 8192; m++) {
    let pc = 0;
    for (let b = 0; b < 13; b++) if (m & (1 << b)) pc++;
    POPCOUNT[m] = pc;
    let hi = -1;
    for (let top = 12; top >= 4; top--) {
      const need = 0x1f << (top - 4);
      if ((m & need) === need) { hi = top; break; }
    }
    if (hi < 0 && (m & 0x100f) === 0x100f) hi = 3; // A-2-3-4-5
    STRAIGHT_HIGH[m] = hi;
    let packed = 0;
    let n = 0;
    for (let b = 12; b >= 0 && n < 5; b--) {
      if (m & (1 << b)) { packed |= b << (4 * (4 - n)); n++; }
    }
    TOP5[m] = packed;
  }
})();

const counts = new Uint8Array(13);

/** Evaluate the first `len` cards of `cards` (5 to 7 cards). */
export function evaluate(cards: ArrayLike<Card>, len: number = cards.length): number {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  counts.fill(0);
  for (let i = 0; i < len; i++) {
    const c = cards[i];
    const r = c >> 2;
    counts[r]++;
    switch (c & 3) {
      case 0: s0 |= 1 << r; break;
      case 1: s1 |= 1 << r; break;
      case 2: s2 |= 1 << r; break;
      default: s3 |= 1 << r;
    }
  }
  let flushMask = 0;
  if (POPCOUNT[s0] >= 5) flushMask = s0;
  else if (POPCOUNT[s1] >= 5) flushMask = s1;
  else if (POPCOUNT[s2] >= 5) flushMask = s2;
  else if (POPCOUNT[s3] >= 5) flushMask = s3;
  if (flushMask) {
    const sh = STRAIGHT_HIGH[flushMask];
    if (sh >= 0) return 8 * CAT + (sh << 16);
    return 5 * CAT + TOP5[flushMask];
  }
  const all = s0 | s1 | s2 | s3;
  let quad = -1, trip1 = -1, trip2 = -1, pair1 = -1, pair2 = -1, pair3 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = counts[r];
    if (n === 4) quad = r;
    else if (n === 3) { if (trip1 < 0) trip1 = r; else if (trip2 < 0) trip2 = r; }
    else if (n === 2) { if (pair1 < 0) pair1 = r; else if (pair2 < 0) pair2 = r; else if (pair3 < 0) pair3 = r; }
  }
  if (quad >= 0) {
    const rest = all & ~(1 << quad);
    return 7 * CAT + (quad << 16) + ((TOP5[rest] >> 16) << 12);
  }
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) {
    const second = Math.max(trip2, pair1);
    return 6 * CAT + (trip1 << 16) + (second << 12);
  }
  const sh = STRAIGHT_HIGH[all];
  if (sh >= 0) return 4 * CAT + (sh << 16);
  if (trip1 >= 0) {
    const rest = all & ~(1 << trip1);
    return 3 * CAT + (trip1 << 16) + ((TOP5[rest] >> 12) << 8);
  }
  if (pair1 >= 0 && pair2 >= 0) {
    const rest = all & ~(1 << pair1) & ~(1 << pair2);
    return 2 * CAT + (pair1 << 16) + (pair2 << 12) + ((TOP5[rest] >> 16) << 8);
  }
  if (pair1 >= 0) {
    const rest = all & ~(1 << pair1);
    return 1 * CAT + (pair1 << 16) + ((TOP5[rest] >> 8) << 4);
  }
  void pair3;
  return TOP5[all];
}

export function categoryOf(score: number): number {
  return Math.floor(score / CAT);
}

export function describeScore(score: number): string {
  const cat = categoryOf(score);
  const r1 = (score >> 16) & 15;
  const r2 = (score >> 12) & 15;
  switch (cat) {
    case 8: return r1 === 12 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[r1]} high`;
    case 7: return `Four of a Kind, ${RANK_PLURALS[r1]}`;
    case 6: return `Full House, ${RANK_PLURALS[r1]} full of ${RANK_PLURALS[r2]}`;
    case 5: return `Flush, ${RANK_NAMES[r1]} high`;
    case 4: return `Straight, ${RANK_NAMES[r1]} high`;
    case 3: return `Three of a Kind, ${RANK_PLURALS[r1]}`;
    case 2: return `Two Pair, ${RANK_PLURALS[r1]} and ${RANK_PLURALS[r2]}`;
    case 1: return `Pair of ${RANK_PLURALS[r1]}`;
    default: return `${RANK_NAMES[r1]} high`;
  }
}
