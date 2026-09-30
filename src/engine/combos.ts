/**
 * The 1326 two-card combos and the 169 starting-hand classes.
 * Class grid: row/col index 0 = Ace .. 12 = Deuce. Pairs on the diagonal, suited above it
 * (row < col), offsuit below it (row > col). This matches the usual 13x13 range chart.
 */
import { type Card, RANK_CHARS, rankOf, suitOf, makeCard } from './cards';

export const NUM_COMBOS = 1326;
export const NUM_CLASSES = 169;

export const COMBO_A = new Uint8Array(NUM_COMBOS); // higher card index
export const COMBO_B = new Uint8Array(NUM_COMBOS);
export const COMBO_CLASS = new Uint8Array(NUM_COMBOS);
const COMBO_INDEX = new Int16Array(52 * 52).fill(-1);
export const CLASS_COMBOS: number[][] = Array.from({ length: NUM_CLASSES }, () => []);

export function classOfCards(a: Card, b: Card): number {
  let r1 = rankOf(a), r2 = rankOf(b);
  if (r1 < r2) { const t = r1; r1 = r2; r2 = t; }
  const hi = 12 - r1, lo = 12 - r2;
  if (r1 === r2) return hi * 13 + hi;
  if (suitOf(a) === suitOf(b)) return hi * 13 + lo;
  return lo * 13 + hi;
}

(function init() {
  let k = 0;
  for (let a = 1; a < 52; a++) {
    for (let b = 0; b < a; b++) {
      COMBO_A[k] = a;
      COMBO_B[k] = b;
      COMBO_INDEX[a * 52 + b] = k;
      COMBO_INDEX[b * 52 + a] = k;
      const cls = classOfCards(a, b);
      COMBO_CLASS[k] = cls;
      CLASS_COMBOS[cls].push(k);
      k++;
    }
  }
})();

export const comboIndex = (a: Card, b: Card) => COMBO_INDEX[a * 52 + b];

export function classIsPair(cls: number) { return Math.floor(cls / 13) === cls % 13; }
export function classIsSuited(cls: number) { return Math.floor(cls / 13) < cls % 13; }

export function classComboCount(cls: number): number {
  return classIsPair(cls) ? 6 : classIsSuited(cls) ? 4 : 12;
}

/** High rank (0..12, 12 = ace) and low rank of a class. */
export function classRanks(cls: number): [number, number] {
  const row = Math.floor(cls / 13), col = cls % 13;
  const a = 12 - Math.min(row, col), b = 12 - Math.max(row, col);
  return [a, b];
}

export function className(cls: number): string {
  const row = Math.floor(cls / 13), col = cls % 13;
  const [hi, lo] = classRanks(cls);
  if (row === col) return RANK_CHARS[hi] + RANK_CHARS[hi];
  return RANK_CHARS[hi] + RANK_CHARS[lo] + (row < col ? 's' : 'o');
}

export function classFromName(name: string): number {
  const r1 = RANK_CHARS.indexOf(name[0].toUpperCase());
  const r2 = RANK_CHARS.indexOf(name[1].toUpperCase());
  if (r1 < 0 || r2 < 0) throw new Error(`Bad hand class ${name}`);
  const hi = 12 - Math.max(r1, r2), lo = 12 - Math.min(r1, r2);
  if (r1 === r2) return hi * 13 + hi;
  const suited = name[2]?.toLowerCase() === 's';
  return suited ? hi * 13 + lo : lo * 13 + hi;
}

/** A canonical concrete combo for a class (used when a specific pair of cards is needed). */
export function representativeCards(cls: number): [Card, Card] {
  const [hi, lo] = classRanks(cls);
  if (hi === lo) return [makeCard(hi, 3), makeCard(hi, 2)];
  if (classIsSuited(cls)) return [makeCard(hi, 3), makeCard(lo, 3)];
  return [makeCard(hi, 3), makeCard(lo, 2)];
}

export function cardsConflict(a1: Card, a2: Card, b1: Card, b2: Card) {
  return a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2;
}

/**
 * NONCONFLICT[h * 169 + v] = number of combos of class v that do not share a card with
 * the representative combo of class h. Used for card-removal-aware range math.
 */
export const NONCONFLICT = new Uint8Array(NUM_CLASSES * NUM_CLASSES);
(function initNonConflict() {
  for (let h = 0; h < NUM_CLASSES; h++) {
    const [x, y] = representativeCards(h);
    for (let v = 0; v < NUM_CLASSES; v++) {
      let n = 0;
      for (const k of CLASS_COMBOS[v]) {
        const a = COMBO_A[k], b = COMBO_B[k];
        if (a !== x && a !== y && b !== x && b !== y) n++;
      }
      NONCONFLICT[h * NUM_CLASSES + v] = n;
    }
  }
})();
