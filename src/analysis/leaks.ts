/** Aggregate stats vs MTT targets, and leak detection from graded decisions. */
import { type HandFlags, type StatCounts, emptyCounts, accumulate, pct } from './handFlags';
import type { DecisionRecord } from '../coach/session';
import type { Grade } from '../coach/coach';
import type { Stage } from '../tournament/structure';

export type LessonId =
  | 'mtt-basics' | 'preflop-opening' | 'vs-opens' | 'stack-depth' | 'pushfold' | 'pot-odds' | 'icm' | 'satellites'
  | 'postflop-cbet' | 'value-bluff' | 'final-table' | 'exploits' | 'mental';
export type DrillId = 'pushfold' | 'callshove' | 'icm' | 'rfi' | 'defend' | 'potodds';

export interface StatRow {
  key: string;
  label: string;
  value: number;
  sample: number;
  lo: number;
  hi: number;
  status: 'low' | 'ok' | 'high' | 'few';
  note: string;
  lessons: LessonId[];
}

interface StatDef {
  key: string;
  label: string;
  num: (c: StatCounts) => number;
  den: (c: StatCounts) => number;
  lo: number;
  hi: number;
  min: number;
  low: string;
  high: string;
  lessons: LessonId[];
}

const STATS: StatDef[] = [
  { key: 'vpip', label: 'VPIP', num: (c) => c.vpip, den: (c) => c.hands, lo: 17, hi: 28, min: 60,
    low: 'You play too few hands; the blinds and antes eat you alive. Open wider in late position and defend your big blind.',
    high: 'You play too many hands. Loose calls preflop are the most common leak in MTTs.', lessons: ['preflop-opening', 'vs-opens'] },
  { key: 'pfr', label: 'PFR', num: (c) => c.pfr, den: (c) => c.hands, lo: 13, hi: 23, min: 60,
    low: 'You rarely raise preflop. Raise first in, and 3-bet instead of flatting with your strong hands.',
    high: 'You raise very often; make sure your opens match position.', lessons: ['preflop-opening'] },
  { key: 'gap', label: 'VPIP − PFR gap', num: (c) => c.vpip - c.pfr, den: (c) => c.hands, lo: 0, hi: 7, min: 60,
    low: '', high: 'A big gap means you call a lot preflop. Calling ranges should be narrow outside the big blind.', lessons: ['vs-opens'] },
  { key: 'limp', label: 'Open-limp', num: (c) => c.limp, den: (c) => c.hands, lo: 0, hi: 3, min: 60,
    low: '', high: 'Open-limping loses the initiative and fold equity. Raise or fold when first in.', lessons: ['preflop-opening'] },
  { key: 'steal', label: 'Steal (CO/BTN/SB)', num: (c) => c.steal, den: (c) => c.stealOpp, lo: 30, hi: 55, min: 20,
    low: 'You pass up too many steal chances. Antes make every late-position steal more profitable.',
    high: 'You steal very wide; fine against tight blinds, costly against players who defend.', lessons: ['preflop-opening', 'mtt-basics'] },
  { key: '3bet', label: '3-bet', num: (c) => c.threeBet, den: (c) => c.threeBetOpp, lo: 5, hi: 12, min: 25,
    low: 'You rarely 3-bet. Opponents can open freely against you; add value 3-bets and some suited-ace bluffs.',
    high: 'You 3-bet a lot; make sure your bluffs have blockers and playability.', lessons: ['vs-opens'] },
  { key: 'f3b', label: 'Fold to 3-bet', num: (c) => c.foldTo3Bet, den: (c) => c.foldTo3BetOpp, lo: 38, hi: 62, min: 12,
    low: 'You continue too often against 3-bets.', high: 'You fold too often to 3-bets; aggressive players will exploit this.', lessons: ['vs-opens', 'stack-depth'] },
  { key: 'bbfold', label: 'BB fold vs steal', num: (c) => c.bbFoldToSteal, den: (c) => c.bbVsStealOpp, lo: 25, hi: 55, min: 12,
    low: 'You defend almost every hand from the BB; some of those are unprofitable.', high: 'You over-fold your big blind. With antes, the BB gets a great price: defend wider.', lessons: ['vs-opens'] },
  { key: 'cbet', label: 'Flop c-bet', num: (c) => c.cbet, den: (c) => c.cbetOpp, lo: 45, hi: 78, min: 15,
    low: 'You give up too often as the preflop raiser. C-bet small on boards that favour your range.',
    high: 'You c-bet almost always; check more on wet boards that hit the caller.', lessons: ['postflop-cbet'] },
  { key: 'fcb', label: 'Fold to c-bet', num: (c) => c.foldToCbet, den: (c) => c.foldToCbetOpp, lo: 30, hi: 58, min: 12,
    low: 'You rarely fold to c-bets; you may be calling down too light.', high: 'You fold too often to c-bets; small bets need to be defended more.', lessons: ['postflop-cbet', 'value-bluff'] },
  { key: 'af', label: 'Aggression factor', num: (c) => c.postBets, den: (c) => c.postCalls, lo: 1.5, hi: 4.5, min: 30,
    low: 'Postflop you call much more than you bet or raise. Passive play wins small pots and loses big ones.',
    high: 'Very aggressive postflop; make sure your bluffs target players who can fold.', lessons: ['value-bluff'] },
  { key: 'wtsd', label: 'Went to showdown', num: (c) => c.wtsd, den: (c) => c.sawFlop, lo: 22, hi: 34, min: 30,
    low: 'You rarely reach showdown; you may be folding too much after the flop.', high: 'You go to showdown too often; you call down with too many weak hands.', lessons: ['value-bluff', 'pot-odds'] },
  { key: 'wsd', label: 'Won at showdown', num: (c) => c.wsd, den: (c) => c.wtsd, lo: 48, hi: 100, min: 20,
    low: 'You lose at showdown too often: your calling ranges on the river are too wide.', high: '', lessons: ['value-bluff', 'pot-odds'] },
];

export function aggregate(flags: HandFlags[]): StatCounts {
  const c = emptyCounts();
  for (const f of flags) accumulate(c, f);
  return c;
}

export function statRows(c: StatCounts): StatRow[] {
  return STATS.map((d) => {
    const den = d.den(c);
    const value = d.key === 'af' ? (den > 0 ? d.num(c) / den : NaN) : pct(d.num(c), den);
    const sample = d.key === 'af' ? c.postBets + c.postCalls : den;
    let status: StatRow['status'] = 'ok';
    if (sample < d.min || Number.isNaN(value)) status = 'few';
    else if (value < d.lo) status = 'low';
    else if (value > d.hi) status = 'high';
    return {
      key: d.key, label: d.label, value, sample, lo: d.lo, hi: d.hi, status,
      note: status === 'low' ? d.low : status === 'high' ? d.high : '',
      lessons: d.lessons,
    };
  });
}

/** Opening frequency by position. */
export function rfiByPosition(flags: HandFlags[]): { pos: string; opp: number; open: number }[] {
  const order = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB'];
  const m = new Map<string, { opp: number; open: number }>();
  for (const f of flags) {
    if (!f.rfiOpp) continue;
    const e = m.get(f.pos) ?? { opp: 0, open: 0 };
    e.opp++;
    if (f.rfi) e.open++;
    m.set(f.pos, e);
  }
  return order.filter((p) => m.has(p)).map((p) => ({ pos: p, ...m.get(p)! }));
}

// ---------------- decision-based leaks ----------------

export interface LeakDef {
  title: string;
  detail: string;
  lessons: LessonId[];
  drills: DrillId[];
}

export const LEAKS: Record<string, LeakDef> = {
  'pushfold-too-tight': { title: 'Folding profitable shoves', detail: 'With a short stack you folded hands that are +EV shoves. Blinds and antes are worth fighting for: waiting for premiums lets your stack bleed away.', lessons: ['pushfold', 'stack-depth'], drills: ['pushfold'] },
  'pushfold-too-loose': { title: 'Shoving too wide', detail: 'You open-shoved hands that lose money against sensible calling ranges, especially from early position.', lessons: ['pushfold'], drills: ['pushfold'] },
  'icm-push-too-loose': { title: 'Shoving too wide under ICM', detail: 'Near the money, the chips you can lose are worth more than the chips you can win. Tighten your shoving range when stacks behind can call.', lessons: ['icm'], drills: ['icm', 'pushfold'] },
  'short-raise': { title: 'Raise-folding a short stack', detail: 'With about 12bb or less, a small raise that can’t call a shove wastes chips. Use shove-or-fold.', lessons: ['stack-depth', 'pushfold'], drills: ['pushfold'] },
  'callallin-too-loose': { title: 'Calling all-ins too light', detail: 'You called shoves without the equity the pot odds require against the shover’s range.', lessons: ['pot-odds', 'pushfold'], drills: ['callshove'] },
  'callallin-too-tight': { title: 'Folding too much against shoves', detail: 'You folded hands that had enough equity against the shover’s range. Short stacks shove wide: call them down lighter.', lessons: ['pushfold', 'pot-odds'], drills: ['callshove'] },
  'icm-call-too-loose': { title: 'Ignoring ICM when calling', detail: 'Chip-EV calls can be clear folds on the bubble or at the final table. Your risk premium is highest with a medium stack facing a bigger stack.', lessons: ['icm'], drills: ['icm'] },
  'resteal-too-loose': { title: 'Re-shoving too wide', detail: 'Your 3-bet shoves included hands that do badly when the opener calls.', lessons: ['stack-depth'], drills: ['pushfold'] },
  'resteal-too-tight': { title: 'Missing re-shove spots', detail: 'With 10–25bb, re-shoving over late-position opens is one of the most profitable plays in MTTs. You folded hands that should jam.', lessons: ['stack-depth'], drills: ['pushfold'] },
  'resteal-passive': { title: 'Flatting instead of re-shoving', detail: 'At short stacks, flat-calling opens with hands that play well as shoves gives up the dead money.', lessons: ['stack-depth'], drills: ['defend'] },
  'open-too-loose': { title: 'Opening too wide', detail: 'You raised first in with hands below the opening range for your position.', lessons: ['preflop-opening'], drills: ['rfi'] },
  'open-too-tight': { title: 'Opening too tight', detail: 'You folded hands that are standard opens, especially in late position.', lessons: ['preflop-opening'], drills: ['rfi'] },
  'open-limp': { title: 'Open-limping', detail: 'Limping first in gives the blinds a cheap flop and loses fold equity. Raise or fold.', lessons: ['preflop-opening'], drills: ['rfi'] },
  'open-size': { title: 'Oversized opens', detail: 'With antes in play, 2–2.5bb opens risk less for the same fold equity. Big opens bloat pots out of position.', lessons: ['preflop-opening'], drills: ['rfi'] },
  'overshove': { title: 'Shoving too deep', detail: 'Shoving 30bb+ to win the blinds risks a lot to win a little. Raise small instead.', lessons: ['stack-depth'], drills: ['rfi'] },
  'vsopen-too-loose': { title: 'Calling opens too wide', detail: 'You flatted or 3-bet opens with hands that are dominated by the opener’s range.', lessons: ['vs-opens'], drills: ['defend'] },
  'vsopen-too-tight': { title: 'Folding too much vs opens', detail: 'You folded hands that should 3-bet or call against this opening position.', lessons: ['vs-opens'], drills: ['defend'] },
  'vsopen-too-passive': { title: 'Flatting hands that should 3-bet', detail: 'Strong hands (and good 3-bet bluffs) make more money by 3-betting than by flatting.', lessons: ['vs-opens'], drills: ['defend'] },
  'vsopen-too-aggressive': { title: '3-betting hands that prefer calling', detail: 'Some hands play better as calls; 3-betting them isolates you against better hands.', lessons: ['vs-opens'], drills: ['defend'] },
  'bbdefend-too-tight': { title: 'Over-folding the big blind', detail: 'The BB closes the action with a posted blind and ante in the pot, so it needs little equity to call.', lessons: ['vs-opens'], drills: ['defend'] },
  'bbdefend-too-loose': { title: 'Defending the big blind too wide', detail: 'Even in the BB, the weakest offsuit hands lose money against early-position opens.', lessons: ['vs-opens'], drills: ['defend'] },
  'bbdefend-too-passive': { title: 'Not 3-betting from the big blind', detail: 'Against late-position steals, the BB should 3-bet its strongest hands and some bluffs.', lessons: ['vs-opens'], drills: ['defend'] },
  'vs3bet-too-loose': { title: 'Continuing too often vs 3-bets', detail: 'You called or 4-bet 3-bets with hands that don’t hold up.', lessons: ['vs-opens', 'stack-depth'], drills: ['defend'] },
  'vs3bet-too-tight': { title: 'Folding too often vs 3-bets', detail: 'You folded hands that should continue against 3-bets, which invites more 3-bets.', lessons: ['vs-opens'], drills: ['defend'] },
  'vs4bet-too-loose': { title: 'Continuing too often vs 4-bets', detail: '4-bet ranges are strong: only the top of your range continues.', lessons: ['vs-opens'], drills: ['defend'] },
  'vs4bet-too-tight': { title: 'Folding premiums vs 4-bets', detail: 'You folded hands strong enough to get it in against a 4-bet.', lessons: ['vs-opens'], drills: ['defend'] },
  'vslimp-too-loose': { title: 'Playing too loose vs limpers', detail: 'Isolate limpers with good hands; don’t over-limp weak ones.', lessons: ['exploits'], drills: ['rfi'] },
  'vslimp-too-tight': { title: 'Not punishing limpers', detail: 'Limpers are usually weak. Isolate them with a raise more often.', lessons: ['exploits'], drills: ['rfi'] },
  'bboption-too-loose': { title: 'Raising the BB option too wide', detail: 'Raise strong hands against limpers; check the rest and see a free flop.', lessons: ['exploits'], drills: ['rfi'] },
  'bboption-too-tight': { title: 'Not raising strong hands in limped pots', detail: 'Punish limpers by raising your strong hands from the big blind.', lessons: ['exploits'], drills: ['rfi'] },
  'fold-free': { title: 'Folding when you could check', detail: 'Never fold when checking is free.', lessons: ['mtt-basics'], drills: [] },
  'postflop-overcall': { title: 'Calling bets without the odds', detail: 'You called flop/turn bets with too little equity against the bettor’s range.', lessons: ['pot-odds', 'value-bluff'], drills: ['potodds'] },
  'postflop-overfold': { title: 'Folding with the right price', detail: 'You folded flop/turn hands that had enough equity for the price offered.', lessons: ['pot-odds'], drills: ['potodds'] },
  'river-overcall': { title: 'Paying off on the river', detail: 'River calls need your equity to beat the pot odds against the hands that bet. Most players’ river bets are value-heavy.', lessons: ['value-bluff', 'exploits'], drills: ['potodds'] },
  'river-overfold': { title: 'Over-folding the river', detail: 'You folded rivers with enough equity against the bettor’s range.', lessons: ['value-bluff'], drills: ['potodds'] },
  'missed-value': { title: 'Missing river value', detail: 'You checked strong hands on the river against players who would have called.', lessons: ['value-bluff', 'exploits'], drills: [] },
  'bluff-station': { title: 'Bluffing calling stations', detail: 'Players who rarely fold are not bluffing targets. Value bet them instead.', lessons: ['exploits'], drills: [] },
};

const GRADE_WEIGHT: Record<Grade, number> = { best: 0, good: 0, inaccuracy: 1, mistake: 3, blunder: 6, unscored: 0 };

export interface LeakReport {
  tag: string;
  def: LeakDef;
  count: number;
  weight: number;
  evLoss: number;
  examples: DecisionRecord[];
}

export function decisionLeaks(decisions: DecisionRecord[]): LeakReport[] {
  const m = new Map<string, LeakReport>();
  for (const d of decisions) {
    for (const tag of d.tags) {
      const def = LEAKS[tag];
      if (!def) continue;
      const r = m.get(tag) ?? { tag, def, count: 0, weight: 0, evLoss: 0, examples: [] };
      r.count++;
      r.weight += GRADE_WEIGHT[d.grade] + (d.evLossBB ?? 0);
      r.evLoss += d.evLossBB ?? 0;
      r.examples.push(d);
      m.set(tag, r);
    }
  }
  return [...m.values()].sort((a, b) => b.weight - a.weight).map((r) => ({ ...r, examples: r.examples.slice(-6).reverse() }));
}

export interface AccuracyRow { key: string; label: string; scored: number; good: number; mistakes: number; evLoss: number }

export function accuracyBy(decisions: DecisionRecord[], keyOf: (d: DecisionRecord) => string, labelOf: (k: string) => string): AccuracyRow[] {
  const m = new Map<string, AccuracyRow>();
  for (const d of decisions) {
    if (d.grade === 'unscored') continue;
    const k = keyOf(d);
    const r = m.get(k) ?? { key: k, label: labelOf(k), scored: 0, good: 0, mistakes: 0, evLoss: 0 };
    r.scored++;
    if (d.grade === 'best' || d.grade === 'good') r.good++;
    if (d.grade === 'mistake' || d.grade === 'blunder') r.mistakes++;
    r.evLoss += d.evLossBB ?? 0;
    m.set(k, r);
  }
  return [...m.values()];
}

export function overallAccuracy(decisions: DecisionRecord[]): { scored: number; good: number; pct: number } {
  const s = decisions.filter((d) => d.grade !== 'unscored');
  const g = s.filter((d) => d.grade === 'best' || d.grade === 'good').length;
  return { scored: s.length, good: g, pct: s.length ? (100 * g) / s.length : NaN };
}

export const STAGE_ORDER: Stage[] = ['early', 'middle', 'bubble', 'itm', 'final'];
