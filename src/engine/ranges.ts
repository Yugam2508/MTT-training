/**
 * Ranges are Float64Array(169) of weights in [0, 1] indexed by hand class (see combos.ts).
 * Text format follows common tools: "22+, A2s+, KTo+, QJs, A5s-A2s, AKo:0.5".
 */
import { RANK_CHARS } from './cards';
import { NUM_CLASSES, classComboCount, className, classFromName, NONCONFLICT } from './combos';

export type Range = Float64Array;

export const emptyRange = (): Range => new Float64Array(NUM_CLASSES);
export const fullRange = (): Range => new Float64Array(NUM_CLASSES).fill(1);

const gridIdx = (rankA: number, rankB: number, suited: boolean | null): number => {
  // rank indices 0..12 with 12 = ace
  const hi = 12 - Math.max(rankA, rankB), lo = 12 - Math.min(rankA, rankB);
  if (rankA === rankB) return hi * 13 + hi;
  return suited ? hi * 13 + lo : lo * 13 + hi;
};

function addToken(r: Range, token: string) {
  let body = token.trim();
  if (!body) return;
  let w = 1;
  const colon = body.indexOf(':');
  if (colon >= 0) {
    w = Math.max(0, Math.min(1, parseFloat(body.slice(colon + 1))));
    body = body.slice(0, colon);
  }
  const lower = body.toLowerCase();
  if (lower === 'any' || lower === 'random' || lower === '100%') {
    for (let i = 0; i < NUM_CLASSES; i++) r[i] = Math.max(r[i], w);
    return;
  }
  const set = (i: number) => { r[i] = Math.max(r[i], w); };
  const R = (ch: string) => {
    const x = RANK_CHARS.indexOf(ch.toUpperCase());
    if (x < 0) throw new Error(`Bad rank in "${token}"`);
    return x;
  };
  // Dash ranges: 22-55, A2s-A5s
  if (body.includes('-')) {
    const [a, b] = body.split('-');
    const a1 = R(a[0]), a2 = R(a[1]), b1 = R(b[0]), b2 = R(b[1]);
    if (a1 === a2 && b1 === b2) {
      for (let x = Math.min(a1, b1); x <= Math.max(a1, b1); x++) set(gridIdx(x, x, null));
      return;
    }
    if (a1 !== b1) throw new Error(`Bad dash range "${token}"`);
    const suf = a[2]?.toLowerCase();
    for (let k = Math.min(a2, b2); k <= Math.max(a2, b2); k++) {
      if (suf !== 'o') set(gridIdx(a1, k, true));
      if (suf !== 's') set(gridIdx(a1, k, false));
    }
    return;
  }
  const plus = body.endsWith('+');
  if (plus) body = body.slice(0, -1);
  const r1 = R(body[0]), r2 = R(body[1]);
  const suf = body[2]?.toLowerCase();
  if (r1 === r2) {
    if (plus) for (let x = r1; x <= 12; x++) set(gridIdx(x, x, null));
    else set(gridIdx(r1, r1, null));
    return;
  }
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  const kickers = plus ? Array.from({ length: hi - lo }, (_, i) => lo + i) : [lo];
  for (const k of kickers) {
    if (suf !== 'o') set(gridIdx(hi, k, true));
    if (suf !== 's') set(gridIdx(hi, k, false));
  }
}

export function parseRange(text: string): Range {
  const r = emptyRange();
  for (const tok of text.split(/[,\s]+/)) if (tok) addToken(r, tok);
  return r;
}

/** Compact text form of a range. */
export function formatRange(r: Range): string {
  const parts: string[] = [];
  const groups = new Map<number, number[]>();
  for (let i = 0; i < NUM_CLASSES; i++) {
    if (r[i] <= 0.0001) continue;
    const key = Math.round(r[i] * 100);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }
  const keys = [...groups.keys()].sort((a, b) => b - a);
  for (const key of keys) {
    const set = new Set(groups.get(key)!);
    const suffix = key === 100 ? '' : `:${(key / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
    const has = (i: number) => set.has(i);
    // pairs
    let run: number[] = [];
    const flushPairs = () => {
      if (!run.length) return;
      const top = run[0], bot = run[run.length - 1];
      const name = (x: number) => RANK_CHARS[x] + RANK_CHARS[x];
      if (run.length === 1) parts.push(name(top) + suffix);
      else if (top === 12) parts.push(name(bot) + '+' + suffix);
      else parts.push(`${name(top)}-${name(bot)}${suffix}`);
      run = [];
    };
    for (let x = 12; x >= 0; x--) {
      if (has(gridIdx(x, x, null))) run.push(x); else flushPairs();
    }
    flushPairs();
    for (const suited of [true, false]) {
      for (let hi = 12; hi >= 1; hi--) {
        let krun: number[] = [];
        const flushK = () => {
          if (!krun.length) return;
          const top = krun[0], bot = krun[krun.length - 1];
          const s = suited ? 's' : 'o';
          const nm = (k: number) => RANK_CHARS[hi] + RANK_CHARS[k] + s;
          if (krun.length === 1) parts.push(nm(top) + suffix);
          else if (top === hi - 1) parts.push(nm(bot) + '+' + suffix);
          else parts.push(`${nm(top)}-${nm(bot)}${suffix}`);
          krun = [];
        };
        for (let k = hi - 1; k >= 0; k--) {
          if (has(gridIdx(hi, k, suited))) krun.push(k); else flushK();
        }
        flushK();
      }
    }
  }
  return parts.join(', ');
}

/** Weighted number of combos in a range. */
export function rangeCombos(r: Range): number {
  let s = 0;
  for (let i = 0; i < NUM_CLASSES; i++) s += r[i] * classComboCount(i);
  return s;
}

export function rangePercent(r: Range): number {
  return (rangeCombos(r) / 1326) * 100;
}

/** Combos of range `r` that don't conflict with a representative hand of class `h`. */
export function rangeCombosGiven(r: Range, h: number): number {
  let s = 0;
  const base = h * NUM_CLASSES;
  for (let i = 0; i < NUM_CLASSES; i++) if (r[i] > 0) s += r[i] * NONCONFLICT[base + i];
  return s;
}

/**
 * Take the best `pct` percent of hands according to `order` (class indices, best first).
 * The boundary class gets a fractional weight so the range size is exact.
 */
export function topPercentRange(pct: number, order: readonly number[]): Range {
  const r = emptyRange();
  let remaining = (Math.max(0, Math.min(100, pct)) / 100) * 1326;
  for (const cls of order) {
    if (remaining <= 0) break;
    const n = classComboCount(cls);
    const w = Math.min(1, remaining / n);
    r[cls] = w;
    remaining -= w * n;
  }
  return r;
}

export function unionRange(a: Range, b: Range): Range {
  const r = emptyRange();
  for (let i = 0; i < NUM_CLASSES; i++) r[i] = Math.max(a[i], b[i]);
  return r;
}

export function subtractRange(a: Range, b: Range): Range {
  const r = emptyRange();
  for (let i = 0; i < NUM_CLASSES; i++) r[i] = Math.max(0, a[i] - b[i]);
  return r;
}

export function inRange(r: Range, handName: string): number {
  return r[classFromName(handName)];
}

export function rangeClassNames(r: Range): string[] {
  const out: string[] = [];
  for (let i = 0; i < NUM_CLASSES; i++) if (r[i] > 0) out.push(className(i));
  return out;
}
