/**
 * Adaptive opponents: what the bots at your table have noticed about how you play, and how
 * strongly each one acts on it. Reads come from your stats in this tournament, shrunk towards
 * typical play until there is enough of a sample, then scaled by how observant the bot is
 * (regulars adjust a lot, recreational players and calling stations hardly at all).
 */
import type { StatCounts } from '../analysis/handFlags';

/** Deviations in [-1, 1]: positive means you do it more than a typical solid player. */
export interface HeroRead {
  /** Your seat index in the current hand. */
  idx: number;
  /** You fold your blinds to steals often → they steal from you more. */
  foldsToSteals: number;
  /** You open and steal wide → they 3-bet, re-shove and call wider against your raises. */
  steals: number;
  /** You fold to 3-bets often → they 3-bet you lighter. */
  foldsTo3bet: number;
  /** You 3-bet often → they continue wider against your 3-bets. */
  threeBets: number;
  /** You fold to c-bets often → they c-bet and bluff you more. */
  foldsToCbet: number;
  /** You go to showdown often → they bluff you less and value-bet thinner. */
  callsDown: number;
  /** You bet and raise a lot after the flop → they call you lighter. */
  aggression: number;
}

type Trait = Exclude<keyof HeroRead, 'idx'>;

interface Measure {
  trait: Trait;
  num: (c: StatCounts) => number;
  den: (c: StatCounts) => number;
  /** A typical solid player's rate, and how far from it counts as a full-strength read. */
  base: number;
  scale: number;
  /** What the table has noticed and what it does about it, for "more" and "less" than typical. */
  more: string;
  less: string;
}

const MEASURES: Measure[] = [
  { trait: 'foldsToSteals', num: (c) => c.bbFoldToSteal, den: (c) => c.bbVsStealOpp, base: 0.55, scale: 0.25,
    more: 'You fold your big blind to steals a lot: they steal from you more.',
    less: 'You defend your big blind a lot: they steal from you less.' },
  { trait: 'steals', num: (c) => c.steal, den: (c) => c.stealOpp, base: 0.4, scale: 0.25,
    more: 'You steal a lot from late position: they 3-bet and re-shove against your opens more.',
    less: 'You rarely steal: they give your opens more respect.' },
  { trait: 'foldsTo3bet', num: (c) => c.foldTo3Bet, den: (c) => c.foldTo3BetOpp, base: 0.55, scale: 0.25,
    more: 'You fold to 3-bets a lot: they 3-bet you lighter.',
    less: 'You rarely fold to 3-bets: they 3-bet you only for value.' },
  { trait: 'threeBets', num: (c) => c.threeBet, den: (c) => c.threeBetOpp, base: 0.07, scale: 0.06,
    more: 'You 3-bet a lot: they continue wider against your 3-bets.',
    less: 'You rarely 3-bet: they fold more to your 3-bets.' },
  { trait: 'foldsToCbet', num: (c) => c.foldToCbet, den: (c) => c.foldToCbetOpp, base: 0.45, scale: 0.25,
    more: 'You fold to c-bets a lot: they c-bet and bluff you more.',
    less: 'You rarely fold to c-bets: they bluff you less.' },
  { trait: 'callsDown', num: (c) => c.wtsd, den: (c) => c.sawFlop, base: 0.3, scale: 0.15,
    more: 'You go to showdown a lot: they bluff you less and value-bet thinner.',
    less: 'You rarely go to showdown: they bluff you more.' },
  { trait: 'aggression', num: (c) => c.postBets, den: (c) => c.postBets + c.postCalls, base: 0.6, scale: 0.2,
    more: 'You bet and raise a lot after the flop: they call you down lighter.',
    less: 'You mostly call after the flop: they respect your bets more.' },
];

/** Opportunities needed before a read is half-trusted. */
const HALF_TRUST = 15;
const clamp = (x: number) => Math.max(-1, Math.min(1, x));

function measure(m: Measure, c: StatCounts): { dev: number; rate: number; n: number } {
  const n = m.den(c);
  if (n <= 0) return { dev: 0, rate: NaN, n: 0 };
  const rate = m.num(c) / n;
  return { dev: clamp((rate - m.base) / m.scale) * (n / (n + HALF_TRUST)), rate, n };
}

/** What a bot with this much `adapt` skill (0-1) has picked up from your stats. Null when nothing yet. */
export function heroRead(c: StatCounts | undefined, adapt: number, idx: number): HeroRead | null {
  if (!c || adapt <= 0 || c.hands < 6) return null;
  const r: HeroRead = { idx, foldsToSteals: 0, steals: 0, foldsTo3bet: 0, threeBets: 0, foldsToCbet: 0, callsDown: 0, aggression: 0 };
  for (const m of MEASURES) r[m.trait] = measure(m, c).dev * adapt;
  return r;
}

export interface ReadNote { trait: Trait; text: string; rate: number; n: number; strength: number }

/** The reads strong enough for an observant player to act on, strongest first, for the table panel. */
export function readNotes(c: StatCounts | undefined, min = 0.3): ReadNote[] {
  if (!c || c.hands < 6) return [];
  return MEASURES.map((m) => {
    const { dev, rate, n } = measure(m, c);
    return { trait: m.trait, text: dev > 0 ? m.more : m.less, rate, n, strength: dev };
  }).filter((x) => Math.abs(x.strength) >= min).sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength));
}

const lim = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Range multipliers a bot applies against you, from its read. All 1 without a read. */
export const vsHero = {
  /** Opening (stealing) when you are in the blinds. */
  steal: (r: HeroRead | null | undefined) => (r ? lim(1 + 0.45 * r.foldsToSteals, 0.65, 1.5) : 1),
  /** 3-betting your open. */
  threeBet: (r: HeroRead | null | undefined) => (r ? lim(1 + 0.5 * r.steals + 0.45 * r.foldsTo3bet, 0.6, 1.8) : 1),
  /** Flatting your open. */
  call: (r: HeroRead | null | undefined) => (r ? lim(1 + 0.35 * r.steals, 0.7, 1.4) : 1),
  /** Re-shoving over your open. */
  reshove: (r: HeroRead | null | undefined) => (r ? lim(1 + 0.4 * r.steals + 0.3 * r.foldsTo3bet, 0.65, 1.6) : 1),
  /** Continuing against your 3-bet. */
  vs3bet: (r: HeroRead | null | undefined) => (r ? lim(1 + 0.5 * r.threeBets, 0.7, 1.5) : 1),
  /** How wide they think your shoves are. */
  shoveRange: (r: HeroRead | null | undefined) => (r ? lim(1 + 0.45 * r.steals, 0.7, 1.5) : 1),
  /** C-bets and bluffs against you. */
  bluff: (r: HeroRead | null | undefined) => (r ? lim(1 + 0.6 * r.foldsToCbet - 0.6 * r.callsDown, 0.3, 1.8) : 1),
  /** Change in the strength they need to value-bet you (negative = thinner). */
  valueShift: (r: HeroRead | null | undefined) => (r ? lim(-0.06 * r.callsDown, -0.06, 0.06) : 0),
  /** Change in the strength they need to call your bets (negative = lighter). */
  callShift: (r: HeroRead | null | undefined) => (r ? lim(-0.06 * r.aggression, -0.06, 0.06) : 0),
};
