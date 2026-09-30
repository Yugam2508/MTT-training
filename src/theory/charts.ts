/**
 * Baseline preflop charts for 9-max MTTs with a big-blind ante, stacks of 25bb+.
 * These are simplified, solver-inspired ranges meant as a sound default, not exact GTO.
 * Mixed hands use weights (e.g. "A5s:0.5" = play it half the time).
 */
import { parseRange, type Range, emptyRange } from '../engine/ranges';
import { NUM_CLASSES } from '../engine/combos';
import { equityVsRandom } from '../engine/preflopMatrix';
import type { ChartPos, PosGroup } from './positions';

const R = (s: string) => parseRange(s);

/** Raise-first-in (open) ranges by position. */
export const RFI_TEXT: Record<Exclude<ChartPos, 'BB'>, string> = {
  UTG: '77+, A9s+, A5s:0.5, KTs+, QTs+, JTs, T9s:0.5, AJo+, KQo',
  UTG1: '66+, A8s+, A5s-A4s, KTs+, QTs+, JTs, T9s, AJo+, KQo',
  UTG2: '55+, A7s+, A5s-A3s, K9s+, Q9s+, J9s+, T9s, 98s, ATo+, KJo+',
  LJ: '44+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s:0.5, ATo+, KJo+, QJo',
  HJ: '33+, A2s+, K7s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, A9o+, KTo+, QTo+, JTo',
  CO: '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A7o+, A5o, KTo+, QTo+, JTo, T9o:0.5',
  BTN: '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K8o+, Q9o+, J9o+, T8o+, 98o, 87o:0.5',
  SB: '22+, A2s+, K3s+, Q5s+, J7s+, T7s+, 97s+, 86s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o:0.5',
};

export interface VsOpenChart {
  threeBet: string;
  call: string;
}

/** Hero (non-BB) facing a single open from a position group. */
const VS_OPEN_TEXT: Record<'IP' | 'SB' | 'BB', Record<Exclude<PosGroup, 'BB'>, VsOpenChart>> = {
  IP: {
    EP: { threeBet: 'QQ+, AKs, AKo, A5s:0.4', call: 'JJ-66, AQs-AJs, KQs, KJs:0.5, QJs:0.5, JTs:0.5, AQo:0.5' },
    MP: { threeBet: 'QQ+, AKs, AKo, AQs:0.5, A5s-A4s:0.5, KQs:0.3', call: 'JJ-55, AQs:0.5, AJs-ATs, KQs:0.7, KJs, QJs, JTs, T9s, AQo' },
    LP: {
      threeBet: 'TT+, AQs+, AKo, AJs:0.6, KQs:0.6, A5s-A2s:0.5, K9s:0.3, QTs:0.3, 76s:0.3, AQo:0.6, AJo:0.3',
      call: '99-22, AJs:0.4, ATs-A6s, KQs:0.4, KJs-K9s, QTs+, J9s+, T9s, 98s, 87s, 76s:0.5, AJo:0.5, KQo, AQo:0.4',
    },
    SB: {
      threeBet: '99+, AJs+, KQs, AQo+, A5s-A2s:0.6, K9s:0.4, Q9s:0.3, J9s:0.3, 65s:0.3, ATo:0.4, KJo:0.4',
      call: '88-22, ATs-A6s, KJs-KTs, QTs+, JTs, T9s, 98s, AJo, KQo',
    },
  },
  SB: {
    EP: { threeBet: 'QQ+, AKs, AKo, AQs:0.5, A5s:0.3', call: 'JJ-99:0.5, AQs:0.5, KQs:0.3' },
    MP: { threeBet: 'JJ+, AQs+, AKo, KQs:0.5, A5s-A4s:0.5', call: 'TT-77:0.5, AJs:0.5, KQs:0.3' },
    LP: { threeBet: '99+, ATs+, KJs+, QJs, AJo+, KQo, A5s-A2s:0.7, K9s:0.4, 76s:0.3, 65s:0.3', call: '88-22:0.4, A9s-A6s:0.3, KTs:0.3, JTs:0.4, T9s:0.3' },
    SB: { threeBet: '', call: '' },
  },
  BB: {
    EP: {
      threeBet: 'QQ+, AKs, AKo:0.7, A5s:0.5',
      call: 'JJ-22, AQs-A2s, K9s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, 54s, AKo:0.3, AQo-ATo, KJo+, QJo',
    },
    MP: {
      threeBet: 'JJ+, AKs, AQs:0.5, AKo, A5s-A4s:0.6, K9s:0.2',
      call: 'TT-22, AQs:0.5, AJs-A2s, K6s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 64s+, 54s, AQo-A9o, KTo+, QTo+, JTo',
    },
    LP: {
      threeBet: 'TT+, AJs+, KQs, AQo+, A5s-A2s:0.5, K9s:0.4, Q9s:0.3, J9s:0.3, T8s:0.3, 76s:0.3, 65s:0.3, A9o:0.2, KJo:0.3',
      call: '99-22, ATs-A6s, A5s-A2s:0.5, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 63s+, 53s+, 43s, AJo-A2o, KQo-K7o, Q8o+, J8o+, T8o+, 97o+, 87o, 76o',
    },
    SB: {
      threeBet: '99+, ATs+, KTs+, QJs, AJo+, KQo, A5s-A2s:0.5, K9s:0.5, Q9s:0.5, J9s:0.5, T9s:0.4, 87s:0.3, 76s:0.3',
      call: '88-22, A9s-A6s, K2s+, Q2s+, J4s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 42s+, ATo-A2o, K5o+, Q7o+, J7o+, T7o+, 97o+, 86o+, 76o, 65o',
    },
  },
};

/** Hero opened and faces a 3-bet: 4-bet and call ranges (deep, 40bb+). */
export const VS_3BET_TEXT = {
  IP: { fourBet: 'QQ+, AKs, AKo, A5s:0.3', call: 'JJ-88, AQs-ATs, KQs, KJs:0.5, QJs:0.5, JTs:0.5, AQo:0.5, 77:0.5' },
  OOP: { fourBet: 'QQ+, AKs, AKo, A5s:0.2', call: 'JJ-99, AQs-AJs, KQs:0.6, AQo:0.3' },
};

/** Short-stack (≤ 30bb) jam over a 3-bet. */
export const JAM_VS_3BET_TEXT = 'TT+, AQs+, AKo, 99:0.5, AJs:0.5, KQs:0.3, AQo:0.5';

/** Continue ranges facing a 4-bet (call or jam). */
export const VS_4BET_TEXT = 'KK+, AKs, QQ:0.6, AKo:0.6';

const cache = new Map<string, Range>();
const cached = (key: string, text: string) => {
  let r = cache.get(key);
  if (!r) { r = text ? R(text) : emptyRange(); cache.set(key, r); }
  return r;
};

export function rfiRange(pos: ChartPos): Range {
  if (pos === 'BB') return emptyRange();
  return cached(`rfi:${pos}`, RFI_TEXT[pos]);
}

export function vsOpenRanges(hero: ChartPos, openerGroup: PosGroup): { threeBet: Range; call: Range } {
  const heroKey = hero === 'SB' ? 'SB' : hero === 'BB' ? 'BB' : 'IP';
  const og = (openerGroup === 'BB' ? 'SB' : openerGroup) as Exclude<PosGroup, 'BB'>;
  const chart = VS_OPEN_TEXT[heroKey][og];
  return {
    threeBet: cached(`3b:${heroKey}:${og}`, chart.threeBet),
    call: cached(`call:${heroKey}:${og}`, chart.call),
  };
}

export function vs3betRanges(inPosition: boolean): { fourBet: Range; call: Range } {
  const c = VS_3BET_TEXT[inPosition ? 'IP' : 'OOP'];
  return { fourBet: cached(`4b:${inPosition}`, c.fourBet), call: cached(`c3b:${inPosition}`, c.call) };
}

export const jamVs3betRange = () => cached('jam3b', JAM_VS_3BET_TEXT);
export const vs4betRange = () => cached('vs4b', VS_4BET_TEXT);

/**
 * A playability-aware ordering of hand classes (best first), used to widen or tighten
 * ranges for looser/tighter players and to measure how far a hand is from a range edge.
 * Built from the RFI charts: hands in tighter ranges rank higher; ties broken by raw equity.
 */
let playOrder: number[] | null = null;
let playScore: Float64Array | null = null;
export function playabilityScore(): Float64Array {
  if (playScore) return playScore;
  const order: ChartPos[] = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN'];
  const eq = equityVsRandom();
  const s = new Float64Array(NUM_CLASSES);
  for (let h = 0; h < NUM_CLASSES; h++) {
    let tier = order.length + 1;
    for (let i = 0; i < order.length; i++) {
      const w = rfiRange(order[i])[h];
      if (w >= 0.99) { tier = i; break; }
      if (w > 0) { tier = i + 0.5; break; }
    }
    s[h] = (order.length + 1 - tier) + eq[h];
  }
  playScore = s;
  return s;
}

export function classesByPlayability(): number[] {
  if (playOrder) return playOrder;
  const s = playabilityScore();
  playOrder = Array.from({ length: NUM_CLASSES }, (_, i) => i).sort((a, b) => s[b] - s[a]);
  return playOrder;
}

/**
 * Scale a range to `factor` times its size, adding the next-best hands (by playability)
 * or trimming the worst ones.
 */
const scaleCache = new WeakMap<Range, Map<number, Range>>();
export function scaleRange(base: Range, factor: number): Range {
  if (Math.abs(factor - 1) < 1e-6) return base;
  const f = Math.round(factor * 100) / 100;
  let m = scaleCache.get(base);
  if (!m) { m = new Map(); scaleCache.set(base, m); }
  const hit = m.get(f);
  if (hit) return hit;
  const r = scaleRangeUncached(base, f);
  m.set(f, r);
  return r;
}

function scaleRangeUncached(base: Range, factor: number): Range {
  const order = classesByPlayability();
  let total = 0;
  const combosOf = (h: number) => (Math.floor(h / 13) === h % 13 ? 6 : Math.floor(h / 13) < h % 13 ? 4 : 12);
  for (let h = 0; h < NUM_CLASSES; h++) total += base[h] * combosOf(h);
  let target = Math.min(1326, total * factor);
  const out = emptyRange();
  // hands in the base range first (ordered by playability), then the rest
  const inBase = order.filter((h) => base[h] > 0);
  const outBase = order.filter((h) => base[h] <= 0);
  for (const h of [...inBase, ...outBase]) {
    if (target <= 0) break;
    const cap = base[h] > 0 ? (factor >= 1 ? 1 : base[h]) : 1;
    const n = combosOf(h);
    const w = Math.min(cap, target / n);
    out[h] = w;
    target -= w * n;
  }
  return out;
}
