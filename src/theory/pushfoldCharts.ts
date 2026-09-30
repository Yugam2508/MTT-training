/** Lookups into the precomputed chip-EV Nash push/fold charts (BB ante 1bb). */
import { PUSHFOLD_B64 } from '../data/pushfoldCharts';
import { NUM_CLASSES } from '../engine/combos';
import { type Range, emptyRange } from '../engine/ranges';

const STEPS = 49;
const BYTES = Math.ceil(NUM_CLASSES / 8);
let bytes: Uint8Array | null = null;
const cache = new Map<number, Range>();

function data(): Uint8Array {
  if (!bytes) {
    const bin = typeof atob === 'function' ? atob(PUSHFOLD_B64) : Buffer.from(PUSHFOLD_B64, 'base64').toString('binary');
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export const CHART_MIN_BB = 1;
export const CHART_MAX_BB = 25;

function lookup(k: number, stackBB: number, which: 0 | 1 | 2): Range {
  const kk = Math.max(1, Math.min(8, Math.round(k)));
  const si = Math.max(0, Math.min(STEPS - 1, Math.round((stackBB - 1) * 2)));
  const key = (kk * STEPS + si) * 3 + which;
  let r = cache.get(key);
  if (!r) {
    const d = data();
    const off = ((kk - 1) * STEPS * 3 + si * 3 + which) * BYTES;
    r = emptyRange();
    for (let h = 0; h < NUM_CLASSES; h++) if (d[off + (h >> 3)] & (1 << (h & 7))) r[h] = 1;
    cache.set(key, r);
  }
  return r;
}

/** Nash open-shove range with `behind` players left to act (1 = SB vs BB). */
export const nashPush = (behind: number, stackBB: number) => lookup(behind, stackBB, 0);
/** Nash call range for the BB facing a shove from a player with `behind` players left to act. */
export const nashCallBB = (behind: number, stackBB: number) => lookup(behind, stackBB, 1);
/** Nash call range for the SB (behind >= 2). */
export const nashCallSB = (behind: number, stackBB: number) => lookup(Math.max(2, behind), stackBB, 2);

/** Largest stack (in BB, 0.5 steps) at which each class is an open-shove, the classic chart format. */
export function pushMaxTable(behind: number): Float64Array {
  const out = new Float64Array(NUM_CLASSES);
  for (let i = 0; i < STEPS; i++) {
    const s = 1 + i * 0.5;
    const r = nashPush(behind, s);
    for (let h = 0; h < NUM_CLASSES; h++) if (r[h] > 0) out[h] = s;
  }
  return out;
}

export function callMaxTable(behind: number, who: 'BB' | 'SB'): Float64Array {
  const out = new Float64Array(NUM_CLASSES);
  for (let i = 0; i < STEPS; i++) {
    const s = 1 + i * 0.5;
    const r = who === 'BB' ? nashCallBB(behind, s) : nashCallSB(behind, s);
    for (let h = 0; h < NUM_CLASSES; h++) if (r[h] > 0) out[h] = s;
  }
  return out;
}
