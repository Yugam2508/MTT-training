/**
 * The coach: analyses the hero's decision point (hint) and grades the chosen action.
 * - Preflop all-in spots (open-shove, re-shove, calling all-ins) are solved with real stacks,
 *   in chip EV or ICM $EV, against Nash or Bayesian-estimated opponent ranges.
 * - Other preflop spots are compared against baseline charts.
 * - Postflop calls/folds are graded with equity vs the estimated range and pot odds.
 */
import { type HandState, type PlayerAction, legalActions, potSize, STREET_NAMES } from '../engine/hand';
import { classOfCards, className, classComboCount, NUM_CLASSES } from '../engine/combos';
import { cardsToString } from '../engine/cards';
import { type Range, emptyRange, formatRange, rangePercent, parseRange } from '../engine/ranges';
import { calcEquity } from '../engine/equity';
import { eqVsRange } from '../engine/preflopMatrix';
import { makeRng } from '../engine/rng';
import { classifyPreflop, isInPosition, type PreflopSpot } from '../theory/spot';
import { POS_LABEL, posGroup } from '../theory/positions';
import { rfiRange, vsOpenRanges, vs3betRanges, jamVs3betRange, vs4betRange, scaleRange, classesByPlayability } from '../theory/charts';
import { solvePushFold, outcomeStacks, type PFSpot, type PFOutcomeValues } from '../theory/pushfold';
import { icmBatch } from '../theory/icm';
import type { BotCtx } from '../bots/policy';
import type { Profile } from '../bots/profiles';
import type { Stage } from '../tournament/structure';
import { estimateRanges, comboRangePercent, type RangeEstimate } from './rangeEstimator';

export type ActionCat = 'fold' | 'check' | 'call' | 'raise' | 'allin';
export type Grade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'unscored';
export type DecisionKind =
  | 'pushfold' | 'callAllIn' | 'resteal' | 'rfi' | 'vsLimp' | 'bbOption' | 'vsOpen' | 'vs3bet' | 'vs4bet'
  | 'facingBet' | 'firstToAct';

export const KIND_LABEL: Record<DecisionKind, string> = {
  pushfold: 'Push or fold', callAllIn: 'Facing an all-in', resteal: 'Re-shove spot', rfi: 'Open raise',
  vsLimp: 'Facing limpers', bbOption: 'Big blind option', vsOpen: 'Facing an open', vs3bet: 'Facing a 3-bet',
  vs4bet: 'Facing a 4-bet', facingBet: 'Facing a bet', firstToAct: 'Bet or check',
};

export const GRADE_LABEL: Record<Grade, string> = {
  best: 'Best', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', unscored: 'Not scored',
};

export interface CoachContext {
  profileOf(i: number): Profile | null;
  botCtxOf(i: number): BotCtx;
  icm: { fieldStacks: number[]; payouts: number[]; fieldIndex: number[] } | null;
  stage: Stage;
  playersLeft: number;
  paid: number;
}

export interface VillainRangeInfo {
  name: string;
  profile: string;
  pct: number;
  classes: Range;
  text: string;
}

export interface Advice {
  kind: DecisionKind;
  street: number;
  title: string;
  best: ActionCat[];
  /** EV of each option relative to folding, in big blinds (ICM: big-blind equivalents). */
  ev: Partial<Record<ActionCat, number>>;
  evApprox: boolean;
  /** Chart frequencies for the hero's hand class. */
  freq: Partial<Record<ActionCat, number>>;
  equity?: number;
  required?: number;
  villains: VillainRangeInfo[];
  chart?: { label: string; range: Range; second?: Range; secondLabel?: string };
  lines: string[];
  scored: boolean;
  icm: boolean;
  handClass: string;
  /** Playability percentile of the hand (0 = best). */
  handPct: number;
  /** Fraction of hands (0..1) that take a non-fold action in the chart. */
  playPct?: number;
  tagBase: string;
}

export interface Verdict {
  cat: ActionCat;
  grade: Grade;
  evLossBB: number | null;
  tags: string[];
  summary: string;
}

const fmtBB = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}bb`;
const pctS = (x: number) => `${(x * 100).toFixed(0)}%`;

let pctTable: Float64Array | null = null;
/** Playability percentile of each class (0 = best, 1 = worst), combo-weighted. */
export function handPercentile(h: number): number {
  if (!pctTable) {
    pctTable = new Float64Array(NUM_CLASSES);
    let acc = 0;
    for (const c of classesByPlayability()) {
      const n = classComboCount(c);
      pctTable[c] = (acc + n / 2) / 1326;
      acc += n;
    }
  }
  return pctTable[h];
}

function rangeFrac(r: Range) { return rangePercent(r) / 100; }

export function actionCategory(s: HandState, a: PlayerAction): ActionCat {
  const L = legalActions(s);
  const p = s.players[s.toAct];
  if (a.type === 'fold') return L.canCheck ? 'check' : 'fold';
  if (a.type === 'check') return L.canCheck ? 'check' : 'fold';
  if (a.type === 'call') return L.canCheck ? 'check' : 'call';
  const to = Math.min(a.to, L.maxRaiseTo);
  if (!L.canRaise) return L.canCheck ? 'check' : 'call';
  if (to >= p.bet + p.stack) return 'allin';
  return 'raise';
}

export function describeAction(s: HandState, a: PlayerAction): string {
  const bb = s.cfg.bb;
  const cat = actionCategory(s, a);
  const L = legalActions(s);
  switch (cat) {
    case 'fold': return 'Fold';
    case 'check': return 'Check';
    case 'call': return `Call ${(L.callAmount / bb).toFixed(1)}bb`;
    case 'allin': return `All-in ${(L.maxRaiseTo / bb).toFixed(1)}bb`;
    case 'raise': return `${s.currentBet === 0 ? 'Bet' : 'Raise to'} ${((a as { to: number }).to / bb).toFixed(1)}bb`;
  }
}

// ---------------------------------------------------------------------------

export function adviseHero(s: HandState, heroIdx: number, ctx: CoachContext): Advice {
  return s.street === 0 ? advisePreflop(s, heroIdx, ctx) : advisePostflop(s, heroIdx, ctx);
}

function villainsToEstimate(s: HandState, heroIdx: number) {
  return s.players.map((p, i) => (i !== heroIdx && !p.folded ? i : -1)).filter((i) => i >= 0);
}

function rangeInfo(s: HandState, ctx: CoachContext, est: Map<number, RangeEstimate>, idxs: number[]): VillainRangeInfo[] {
  return idxs.filter((i) => est.has(i)).map((i) => {
    const e = est.get(i)!;
    const prof = ctx.profileOf(i);
    const top = emptyRange();
    for (let c = 0; c < NUM_CLASSES; c++) top[c] = e.classes[c] >= 0.35 ? 1 : 0;
    return {
      name: s.players[i].name,
      profile: prof?.label ?? 'Unknown',
      pct: comboRangePercent(e.combos),
      classes: e.classes,
      text: formatRange(top) || '(very narrow)',
    };
  });
}

/** Map chip-outcome stacks (in chips) of the spot players to ICM values. */
function spotValues(
  s: HandState, spotIdx: number[], chips: PFOutcomeValues, ctx: CoachContext, heroIdx: number,
): { values: PFOutcomeValues; icm: boolean; dollarPerBB: number } {
  const bb = s.cfg.bb;
  if (!ctx.icm) {
    const toBB = (v: number[]) => v.map((x) => x / bb);
    return {
      values: { fold: toBB(chips.fold), steal: toBB(chips.steal), win: chips.win.map(toBB), lose: chips.lose.map(toBB) },
      icm: false, dollarPerBB: 0,
    };
  }
  const { fieldStacks, payouts, fieldIndex } = ctx.icm;
  const base = fieldStacks.slice();
  s.players.forEach((p, i) => { base[fieldIndex[i]] = p.startStack - p.ante - p.total; });
  const vecs: number[][] = [];
  const addVec = (finals: number[]) => {
    const v = base.slice();
    spotIdx.forEach((pi, k) => { v[fieldIndex[pi]] = Math.max(0, Math.round(finals[k])); });
    vecs.push(v);
  };
  addVec(chips.fold); addVec(chips.steal);
  chips.win.forEach(addVec); chips.lose.forEach(addVec);
  const eqs = icmBatch(vecs, payouts, 6000, 11);
  const pick = (vi: number) => spotIdx.map((pi) => eqs[vi][fieldIndex[pi]]);
  const k = chips.win.length;
  const values: PFOutcomeValues = {
    fold: pick(0), steal: pick(1),
    win: Array.from({ length: k }, (_, i) => pick(2 + i)),
    lose: Array.from({ length: k }, (_, i) => pick(2 + k + i)),
  };
  // $ per big blind for the hero: average value of a chip in the fold outcome
  const heroK = spotIdx.indexOf(heroIdx);
  const heroChips = chips.fold[heroK] / bb;
  const dollarPerBB = heroChips > 0 ? values.fold[heroK] / heroChips : 1;
  // express values in BB-equivalents so thresholds are comparable
  const scale = (v: number[]) => v.map((x) => x / dollarPerBB);
  return {
    values: { fold: scale(values.fold), steal: scale(values.steal), win: values.win.map(scale), lose: values.lose.map(scale) },
    icm: true, dollarPerBB,
  };
}

function buildShoveSpot(s: HandState, heroIdx: number): { spot: PFSpot; order: number[] } {
  const n = s.players.length;
  const order: number[] = [];
  for (let k = 1; k < n; k++) {
    const i = (heroIdx + k) % n;
    if (!s.players[i].folded && !s.players[i].allIn) order.push(i);
  }
  const pl = (i: number) => ({ stack: s.players[i].startStack - s.players[i].ante, posted: s.players[i].total });
  let dead = 0;
  s.players.forEach((p, i) => { dead += p.ante; if (i !== heroIdx && (p.folded || p.allIn)) dead += p.total; });
  return { spot: { pusher: pl(heroIdx), callers: order.map(pl), dead }, order };
}

function chartFreqGrade(adv: Advice) {
  const fr = adv.freq;
  const cats = Object.keys(fr) as ActionCat[];
  const best = cats.filter((c) => (fr[c] ?? 0) >= 0.35).sort((a, b) => (fr[b] ?? 0) - (fr[a] ?? 0));
  adv.best = best.length ? best : [cats.sort((a, b) => (fr[b] ?? 0) - (fr[a] ?? 0))[0]];
}

function advisePreflop(s: HandState, heroIdx: number, ctx: CoachContext): Advice {
  const spot = classifyPreflop(s, heroIdx);
  const hero = s.players[heroIdx];
  const h = classOfCards(hero.cards[0], hero.cards[1]);
  const L = legalActions(s);
  const posL = POS_LABEL[spot.pos];
  const adv: Advice = {
    kind: 'rfi', street: 0, title: '', best: [], ev: {}, evApprox: false, freq: {}, villains: [], lines: [],
    scored: true, icm: false, handClass: className(h), handPct: handPercentile(h), tagBase: 'rfi',
  };
  const stackLine = `${className(h)} in the ${posL} with ${spot.stackBB.toFixed(1)}bb (effective ${spot.effBB.toFixed(1)}bb).`;
  const acted = s.players.map((p, i) => (i !== heroIdx && !p.folded ? i : -1)).filter((i) => i >= 0);
  const needRanges = spot.kind !== 'unopened';
  const est = needRanges ? estimateRanges(s, heroIdx, acted, ctx.profileOf, ctx.botCtxOf) : new Map<number, RangeEstimate>();
  const actedVoluntarily = new Set(s.actions.filter((a) => a.street === 0 && ['call', 'raise', 'bet', 'check'].includes(a.type)).map((a) => a.p));

  // ---- facing all-in ----
  if (spot.kind === 'vsAllIn') return adviseCallAllIn(s, heroIdx, ctx, spot, est, adv, stackLine);

  // ---- push/fold and re-shove spots (real-stack solve) ----
  const unopened = spot.kind === 'unopened' || spot.kind === 'limped';
  const pushSpot = unopened && !L.canCheck && spot.effBB <= 20;
  const restealSpot = spot.kind === 'vsOpen' && spot.effBB <= 25;
  if (pushSpot || restealSpot) {
    const { spot: pf, order } = buildShoveSpot(s, heroIdx);
    const spotIdx = [heroIdx, ...order];
    const chips = outcomeStacks(pf);
    const { values, icm } = spotValues(s, spotIdx, chips, ctx, heroIdx);
    const priors = order.map((i) => (actedVoluntarily.has(i) && est.has(i) ? est.get(i)!.classes : null));
    const res = solvePushFold(values, 50, 0.3, priors);
    const gain = res.pushGain[h];
    adv.icm = icm;
    adv.ev = { fold: 0, allin: gain };
    const pushPct = rangePercent(res.push);
    adv.chart = { label: `Shove range here (${pushPct.toFixed(0)}%)`, range: res.push };
    if (pushSpot) {
      adv.kind = 'pushfold';
      adv.tagBase = 'pushfold';
      adv.title = `Push or fold: ${spot.effBB.toFixed(1)}bb in the ${posL}`;
      adv.lines.push(stackLine, `${order.length} player${order.length === 1 ? '' : 's'} left to act${spot.limpers ? `, ${spot.limpers} limper${spot.limpers > 1 ? 's' : ''} in the pot` : ''}.`);
      adv.lines.push(`Equilibrium shove range in this exact spot: ${pushPct.toFixed(0)}% of hands.`);
      adv.lines.push(`Shoving ${className(h)}: ${fmtBB(gain)} compared with folding.`);
      const rfiW = spot.effBB > 12 ? rfiRange(spot.pos)[h] : 0;
      if (rfiW > 0) {
        adv.freq.raise = rfiW;
        adv.lines.push(`At ${spot.effBB.toFixed(0)}bb a small open-raise is also fine with hands from the ${posL} opening range.`);
      }
      adv.best = bestByEV(adv.ev);
      if (rfiW >= 0.5) adv.best = gain > 0.05 ? ['allin', 'raise'] : ['raise'];
    } else {
      adv.kind = 'resteal';
      adv.tagBase = 'resteal';
      const opener = spot.openerIdx >= 0 ? s.players[spot.openerIdx].name : 'opener';
      adv.title = `Re-shove spot: ${spot.effBB.toFixed(1)}bb vs ${POS_LABEL[spot.openerPos!]} open`;
      adv.lines.push(stackLine, `${opener} opened to ${spot.openToBB.toFixed(1)}bb.`);
      adv.lines.push(`Best re-shove range vs their estimated opening range: ${pushPct.toFixed(0)}% of hands.`);
      adv.lines.push(`Shoving ${className(h)}: ${fmtBB(gain)} compared with folding.`);
      const { call } = vsOpenRanges(spot.pos, posGroup(spot.openerPos!));
      const callW = spot.pos === 'BB' || spot.effBB > 18 ? call[h] * (spot.pos === 'BB' ? 1 : 0.6) : 0;
      if (callW > 0) { adv.freq.call = callW; adv.lines.push(`Flatting is also reasonable ${spot.pos === 'BB' ? 'from the big blind with good pot odds' : 'at this depth'}.`); }
      adv.best = bestByEV(adv.ev);
      if (callW >= 0.5) adv.best = gain > 0.05 ? ['allin', 'call'] : ['call'];
      adv.villains = rangeInfo(s, ctx, est, [spot.openerIdx].filter((i) => i >= 0));
    }
    if (icm) adv.lines.push(`ICM is on (${ctx.playersLeft} left, ${ctx.paid} paid): values are tournament $ equity, shown in big-blind equivalents.`);
    return adv;
  }

  // ---- chart spots ----
  const deep = spot.effBB;
  if (spot.kind === 'unopened') {
    const r = rfiRange(spot.pos);
    adv.kind = 'rfi'; adv.tagBase = 'open';
    adv.title = `Open or fold from the ${posL}`;
    adv.freq = { raise: r[h], fold: 1 - r[h] };
    adv.chart = { label: `${posL} opening range (${rangePercent(r).toFixed(0)}%)`, range: r };
    adv.playPct = rangeFrac(r);
    adv.lines.push(stackLine, `Folded to you. Baseline ${posL} open: ${rangePercent(r).toFixed(0)}% of hands.`);
    const size = spot.pos === 'SB' ? '2.5–3bb' : deep < 40 ? '2–2.2bb' : '2.2–2.5bb';
    adv.lines.push(r[h] > 0 ? `${className(h)} is ${r[h] < 1 ? 'a mixed open' : 'a standard open'}. Size: ${size}.` : `${className(h)} is below the ${posL} opening range: fold.`);
    if (spot.pos === 'SB') adv.lines.push('From the SB, raise or fold keeps it simple; open-limping is a leak for most players.');
    chartFreqGrade(adv);
    return adv;
  }
  if (spot.kind === 'limped') {
    if (L.canCheck) {
      const iso = scaleRange(rfiRange('CO'), 0.5);
      adv.kind = 'bbOption'; adv.tagBase = 'bboption';
      adv.title = 'Big blind vs limpers';
      adv.freq = { raise: iso[h], check: 1 - iso[h] };
      adv.chart = { label: `Raise range vs limps (${rangePercent(iso).toFixed(0)}%)`, range: iso };
      adv.playPct = 1;
      adv.lines.push(stackLine, `${spot.limpers} limper${spot.limpers > 1 ? 's' : ''}. Raise strong hands to ~${(3 + spot.limpers).toFixed(0)}bb, check the rest (never fold for free).`);
      chartFreqGrade(adv);
      return adv;
    }
    const base = rfiRange(spot.pos);
    const iso = scaleRange(base, 0.7);
    const overlimp = new Float64Array(NUM_CLASSES);
    const latePos = spot.pos === 'CO' || spot.pos === 'BTN' || spot.pos === 'SB';
    for (let c = 0; c < NUM_CLASSES; c++) overlimp[c] = latePos ? Math.max(0, Math.min(base[c], 1) - iso[c]) : 0;
    adv.kind = 'vsLimp'; adv.tagBase = 'vslimp';
    adv.title = `Facing ${spot.limpers} limper${spot.limpers > 1 ? 's' : ''} in the ${posL}`;
    adv.freq = { raise: iso[h], call: overlimp[h], fold: Math.max(0, 1 - iso[h] - overlimp[h]) };
    adv.chart = { label: `Isolation raise range (${rangePercent(iso).toFixed(0)}%)`, range: iso, second: overlimp, secondLabel: 'Over-limp' };
    adv.playPct = rangeFrac(iso) + rangeFrac(overlimp);
    adv.lines.push(stackLine, `Isolate limpers with a raise to about ${(3 + spot.limpers).toFixed(0)}–${(4 + spot.limpers).toFixed(0)}bb; limpers are usually weak and play badly postflop.`);
    if (latePos) adv.lines.push('In late position, over-limping speculative hands (small pairs, suited connectors) is fine.');
    adv.villains = rangeInfo(s, ctx, est, acted);
    chartFreqGrade(adv);
    return adv;
  }
  if (spot.kind === 'vsOpen') {
    const og = posGroup(spot.openerPos!);
    const { threeBet, call } = vsOpenRanges(spot.pos, og);
    const squeeze = spot.callers > 0;
    const tb = squeeze ? scaleRange(threeBet, 0.8) : threeBet;
    const sizeAdj = Math.max(0.5, Math.min(1.2, 2.5 / Math.max(2, spot.openToBB)));
    const cl = scaleRange(call, (squeeze ? 0.8 : 1) * sizeAdj);
    adv.kind = 'vsOpen'; adv.tagBase = spot.pos === 'BB' ? 'bbdefend' : 'vsopen';
    adv.title = `${posL} vs ${POS_LABEL[spot.openerPos!]} open to ${spot.openToBB.toFixed(1)}bb`;
    const call3 = Math.min(cl[h], 1 - tb[h]);
    adv.freq = { raise: tb[h], call: call3, fold: Math.max(0, 1 - tb[h] - call3) };
    adv.chart = { label: `3-bet (${rangePercent(tb).toFixed(0)}%)`, range: tb, second: cl, secondLabel: `Call (${rangePercent(cl).toFixed(0)}%)` };
    adv.playPct = Math.min(1, rangeFrac(tb) + rangeFrac(cl));
    adv.lines.push(stackLine);
    if (squeeze) adv.lines.push(`${spot.callers} caller${spot.callers > 1 ? 's' : ''} already: this is a squeeze spot, so 3-bet bigger and flat tighter.`);
    if (spot.pos === 'BB') adv.lines.push(`The big blind closes the action with a discount: defend wide against late-position opens (you need roughly ${pctS(spot.toCallBB / (spot.potBB + spot.toCallBB))} equity).`);
    adv.lines.push(`Baseline: 3-bet ${rangePercent(tb).toFixed(0)}%, call ${rangePercent(cl).toFixed(0)}% vs a ${posGroup(spot.openerPos!)} open.`);
    adv.villains = rangeInfo(s, ctx, est, [spot.openerIdx]);
    chartFreqGrade(adv);
    return adv;
  }
  if (spot.kind === 'vs3bet') {
    adv.kind = 'vs3bet'; adv.tagBase = 'vs3bet';
    adv.title = `Facing a 3-bet to ${spot.lastRaiseToBB.toFixed(1)}bb`;
    adv.lines.push(stackLine);
    if (!spot.heroRaised) {
      const r = vs4betRange();
      const c = parseRange('JJ-TT:0.5, AQs:0.4');
      adv.freq = { raise: r[h], call: Math.min(c[h], 1 - r[h]), fold: Math.max(0, 1 - r[h] - Math.min(c[h], 1 - r[h])) };
      adv.chart = { label: 'Cold 4-bet', range: r, second: c, secondLabel: 'Cold call' };
      adv.playPct = rangeFrac(r) + rangeFrac(c);
      adv.lines.push('Cold facing an open and a 3-bet: continue only with premium hands.');
    } else if (spot.effBB <= 35) {
      const j = jamVs3betRange();
      adv.freq = { allin: j[h], fold: 1 - j[h] };
      adv.chart = { label: `Jam vs 3-bet (${rangePercent(j).toFixed(0)}%)`, range: j };
      adv.playPct = rangeFrac(j);
      adv.lines.push(`At ${spot.effBB.toFixed(0)}bb, calling a 3-bet leaves awkward stacks: jam or fold.`);
    } else {
      const ip = !isInPosition(s, spot.lastRaiserIdx);
      const { fourBet, call } = vs3betRanges(ip);
      const c3 = Math.min(call[h], 1 - fourBet[h]);
      adv.freq = { raise: fourBet[h], call: c3, fold: Math.max(0, 1 - fourBet[h] - c3) };
      adv.chart = { label: '4-bet', range: fourBet, second: call, secondLabel: 'Call' };
      adv.playPct = rangeFrac(fourBet) + rangeFrac(call);
      adv.lines.push(`Deep vs a 3-bet ${ip ? 'in position' : 'out of position'}: 4-bet your best hands, call with strong playable hands, fold the rest.`);
    }
    adv.villains = rangeInfo(s, ctx, est, [spot.lastRaiserIdx]);
    chartFreqGrade(adv);
    return adv;
  }
  // vs 4-bet or more
  const r = vs4betRange();
  adv.kind = 'vs4bet'; adv.tagBase = 'vs4bet';
  adv.title = 'Facing a 4-bet';
  adv.freq = { allin: r[h], call: r[h] * 0.5, fold: 1 - r[h] };
  adv.chart = { label: 'Continue vs 4-bet', range: r };
  adv.playPct = rangeFrac(r);
  adv.lines.push(stackLine, 'Against a 4-bet, only the very top of your range continues.');
  adv.villains = rangeInfo(s, ctx, est, [spot.lastRaiserIdx]);
  chartFreqGrade(adv);
  return adv;
}

function adviseCallAllIn(
  s: HandState, heroIdx: number, ctx: CoachContext, spot: PreflopSpot, est: Map<number, RangeEstimate>, adv: Advice, stackLine: string,
): Advice {
  const hero = s.players[heroIdx];
  const bb = s.cfg.bb;
  const L = legalActions(s);
  const h = classOfCards(hero.cards[0], hero.cards[1]);
  const risk = L.callAmount;
  const heroMax = hero.total + risk;
  // opponents who have put in chips voluntarily and are still in
  const opps = s.players.map((p, i) => (i !== heroIdx && !p.folded && p.total > 0 && (p.total > hero.total || p.allIn) ? i : -1)).filter((i) => i >= 0);
  const main = spot.lastRaiserIdx >= 0 ? spot.lastRaiserIdx : opps[0];
  let eq: number;
  if (opps.length <= 1) eq = eqVsRange(h, est.get(main)!.classes);
  else {
    const r = calcEquity([{ cards: hero.cards }, ...opps.map((i) => ({ comboWeights: est.get(i)!.combos }))], [], 6000, makeRng(3));
    eq = r.equity[0];
  }
  let winnable = 0;
  for (const p of s.players) winnable += (p === hero ? heroMax : Math.min(p.total, heroMax)) + p.ante;
  const chipEV = (eq * winnable - risk) / bb;
  const chipReq = risk / winnable;
  adv.kind = 'callAllIn'; adv.tagBase = 'callallin';
  adv.title = `Call an all-in for ${(risk / bb).toFixed(1)}bb?`;
  adv.equity = eq;
  adv.required = chipReq;
  adv.ev = { fold: 0, call: chipEV };
  adv.villains = rangeInfo(s, ctx, est, opps);
  adv.lines.push(stackLine);
  adv.lines.push(`To call ${(risk / bb).toFixed(1)}bb to win a pot of ${(winnable / bb).toFixed(1)}bb you need ${pctS(chipReq)} equity (pot odds).`);
  adv.lines.push(`Your equity vs the estimated range${opps.length > 1 ? 's' : ''}: ${pctS(eq)}.`);
  if (ctx.icm) {
    const v = s.players[main];
    const { fieldStacks, payouts, fieldIndex } = ctx.icm;
    const base = fieldStacks.slice();
    s.players.forEach((p, i) => { base[fieldIndex[i]] = p.startStack - p.ante - p.total; });
    const matched = Math.min(v.total, heroMax);
    let dead = 0;
    s.players.forEach((p, i) => { dead += p.ante; if (i !== heroIdx && i !== main) dead += p.total; });
    const pot = heroMax + matched + dead;
    const heroBase = hero.startStack - hero.ante;
    const vBase = v.startStack - v.ante;
    const fold = base.slice();
    fold[fieldIndex[heroIdx]] = heroBase - hero.total;
    fold[fieldIndex[main]] = vBase - v.total + (hero.total + v.total + dead);
    const win = base.slice();
    win[fieldIndex[heroIdx]] = heroBase - heroMax + pot;
    win[fieldIndex[main]] = vBase - matched;
    const lose = base.slice();
    lose[fieldIndex[heroIdx]] = heroBase - heroMax;
    lose[fieldIndex[main]] = vBase - matched + pot;
    const [vf, vw, vl] = icmBatch([fold, win, lose], payouts, 8000, 5).map((e) => e[fieldIndex[heroIdx]]);
    const dollarPerBB = vf / Math.max(0.5, (heroBase - hero.total) / bb) || 1;
    const icmReq = vw - vl > 1e-9 ? (vf - vl) / (vw - vl) : 1;
    const icmEV = (eq * vw + (1 - eq) * vl - vf) / dollarPerBB;
    adv.icm = true;
    adv.required = icmReq;
    adv.ev = { fold: 0, call: icmEV };
    adv.lines.push(icmReq > chipReq + 0.005
      ? `ICM: busting costs more than doubling up gains. Required equity rises from ${pctS(chipReq)} (chips) to ${pctS(icmReq)} ($EV), a risk premium of ${((icmReq - chipReq) * 100).toFixed(1)} points.`
      : `ICM barely changes this spot: required equity ${pctS(icmReq)} in $EV terms.`);
    if (chipEV > 0 && icmEV < 0) adv.lines.push('This is a chip-EV call but an ICM fold: survival is worth more than the chips.');
  }
  if (spot.behind > 0) adv.lines.push(`${spot.behind} player${spot.behind > 1 ? 's' : ''} still to act behind you; that makes calling slightly worse than shown.`);
  const ev = adv.ev.call!;
  adv.best = bestByEV(adv.ev);
  adv.lines.push(`Calling: ${fmtBB(ev)}${adv.icm ? ' (ICM, in bb-equivalents)' : ''} compared with folding.`);
  return adv;
}

// ---------------------------------------------------------------------------

function advisePostflop(s: HandState, heroIdx: number, ctx: CoachContext): Advice {
  const hero = s.players[heroIdx];
  const L = legalActions(s);
  const bb = s.cfg.bb;
  const h = classOfCards(hero.cards[0], hero.cards[1]);
  const opps = villainsToEstimate(s, heroIdx);
  const est = estimateRanges(s, heroIdx, opps, ctx.profileOf, ctx.botCtxOf);
  const r = calcEquity([{ cards: hero.cards }, ...opps.map((i) => ({ comboWeights: est.get(i)!.combos }))], s.board, 5000, makeRng(17));
  const eq = r.equity[0];
  const pot = potSize(s);
  const street = STREET_NAMES[s.street];
  const adv: Advice = {
    kind: L.toCall > 0 ? 'facingBet' : 'firstToAct', street: s.street, title: '', best: [], ev: {}, evApprox: s.street < 3,
    freq: {}, villains: rangeInfo(s, ctx, est, opps), lines: [], scored: false, icm: !!ctx.icm, handClass: className(h),
    handPct: handPercentile(h), tagBase: 'postflop', equity: eq,
  };
  adv.lines.push(`${cardsToString(hero.cards)} on ${cardsToString(s.board)} (${street}). Pot ${(pot / bb).toFixed(1)}bb.`);
  adv.lines.push(`Your equity vs the estimated range${opps.length > 1 ? 's' : ''}: ${pctS(eq)}${opps.length > 1 ? ` (${opps.length} opponents)` : ''}.`);
  const ip = isInPosition(s, heroIdx);
  if (L.toCall > 0) {
    const risk = L.callAmount;
    let req = risk / (pot + risk);
    const allInNow = s.players.some((p, i) => i !== heroIdx && !p.folded && p.allIn) || risk >= hero.stack;
    const exact = s.street === 3 || allInNow;
    // ICM: approximate risk premium with the bubble factor of the hero's stack
    let bf = 1;
    if (ctx.icm && risk > 0.2 * (hero.stack + hero.bet)) bf = heroBubbleFactor(s, heroIdx, ctx);
    if (bf > 1.02) req = (risk * bf) / (risk * bf + pot);
    const realize = exact ? 1 : ip ? 1 : 0.9;
    const effEq = eq * realize;
    const evCall = (effEq * (pot + risk) - risk * (bf > 1.02 ? bf : 1)) / bb;
    adv.title = `${street}: facing a ${(Math.max(0, s.currentBet) / bb).toFixed(1)}bb bet`;
    adv.required = req;
    adv.ev = { fold: 0, call: evCall };
    adv.lines.push(`Pot odds: call ${(risk / bb).toFixed(1)}bb to win ${((pot + risk) / bb).toFixed(1)}bb, so you need ${pctS(req)} equity${bf > 1.02 ? ` (includes an ICM risk premium, bubble factor ${bf.toFixed(2)})` : ''}.`);
    if (!exact) adv.lines.push(`With cards to come this is approximate: ${ip ? 'in position you realise your equity well' : 'out of position you realise less of your equity'}, and draws can win more on later streets (implied odds).`);
    const margin = exact ? 0.04 : 0.1;
    if (effEq >= req + margin) adv.best = eq > 0.62 ? ['raise', 'call'] : ['call'];
    else if (effEq <= req - margin) adv.best = ['fold'];
    else adv.best = ['call', 'fold'];
    if (eq > 0.62 && L.canRaise) adv.lines.push('You are well ahead of this range: raising for value is also good.');
    adv.scored = true;
    adv.tagBase = exact ? 'river' : 'postflop';
    return adv;
  }
  adv.title = `${street}: bet or check`;
  const headsUp = opps.length === 1;
  const vProf = headsUp ? ctx.profileOf(opps[0]) : null;
  if (eq >= 0.7) {
    adv.best = ['raise'];
    adv.lines.push(`You are ahead of this range most of the time: bet for value${vProf && vProf.callDown >= 0.5 ? ' and size up, this player calls too much' : ''}.`);
  } else if (eq <= 0.3) {
    adv.best = ['check', 'raise'];
    adv.lines.push(vProf && vProf.callDown >= 0.5
      ? 'You are behind and this opponent rarely folds: do not bluff, check.'
      : 'You are behind: either give up or bluff when the board favours your range and your opponent can fold.');
  } else {
    adv.best = ['check', 'raise'];
    adv.lines.push('Medium strength: checking to control the pot is fine; a small bet can protect against draws.');
  }
  if (s.street === 3 && headsUp) {
    adv.scored = true;
    adv.tagBase = 'river';
    if (eq >= 0.72) adv.best = ['raise'];
  }
  return adv;
}

function heroBubbleFactor(s: HandState, heroIdx: number, ctx: CoachContext): number {
  if (!ctx.icm) return 1;
  const { fieldStacks, payouts, fieldIndex } = ctx.icm;
  const base = fieldStacks.slice();
  s.players.forEach((p, i) => { base[fieldIndex[i]] = p.startStack; });
  const hi = fieldIndex[heroIdx];
  const opp = s.players.map((p, i) => (i !== heroIdx && !p.folded ? i : -1)).filter((i) => i >= 0)[0];
  if (opp === undefined) return 1;
  const oi = fieldIndex[opp];
  const risk = Math.min(base[hi], base[oi]);
  const win = base.slice(); win[hi] += risk; win[oi] -= risk;
  const lose = base.slice(); lose[hi] -= risk; lose[oi] += risk;
  const [b, w, l] = icmBatch([base, win, lose], payouts, 4000, 9).map((e) => e[hi]);
  const gain = w - b, loss = b - l;
  return gain > 1e-9 ? Math.max(1, Math.min(3, loss / gain)) : 1;
}

// ---------------------------------------------------------------------------

export function gradeAction(adv: Advice, cat: ActionCat, s: HandState, action: PlayerAction, ctx: CoachContext): Verdict {
  const tags: string[] = [];
  const bb = s.cfg.bb;
  const base = adv.tagBase;
  const verdict = (grade: Grade, evLossBB: number | null, summary: string): Verdict => ({ cat, grade, evLossBB, tags, summary });
  const bestText = adv.best.map(catLabel).join(' / ');

  // EV-based preflop all-in spots
  if (adv.kind === 'pushfold' || adv.kind === 'resteal' || adv.kind === 'callAllIn') {
    const evs = adv.ev;
    let mine: number | undefined;
    if (cat === 'allin') mine = evs.allin ?? evs.call;
    else if (cat === 'call') mine = evs.call;
    else if (cat === 'fold' || cat === 'check') mine = 0;
    const known = Object.values(evs).filter((x): x is number => x !== undefined);
    const bestEV = Math.max(...known);
    if (mine === undefined) {
      // an option the solver doesn't cover (e.g. min-raise with a short stack, or flat)
      const f = adv.freq[cat] ?? 0;
      if (f >= 0.35) return verdict('good', null, `${cap(cat)} is a reasonable alternative here.`);
      if (cat === 'raise' && adv.kind === 'pushfold') {
        tags.push('short-raise');
        return (evs.allin ?? 0) > 0
          ? verdict('inaccuracy', null, 'With this stack a raise that can’t call a shove wastes chips; shove instead.')
          : verdict('mistake', null, 'This hand is not strong enough to play for your stack here, and a small raise commits you anyway.');
      }
      if (cat === 'call' && adv.kind === 'pushfold') {
        tags.push('open-limp');
        return verdict('mistake', null, (evs.allin ?? 0) > 0
          ? 'Open-limping a short stack gives up fold equity. This hand is a shove.'
          : 'Open-limping a short stack gives up fold equity, and this hand is not strong enough to shove either: fold.');
      }
      if (cat === 'call' && adv.kind === 'resteal') {
        if ((evs.allin ?? 0) > 0.3) { tags.push('resteal-passive'); return verdict('inaccuracy', null, 'Shoving is clearly better than flatting here: it wins the dead money now.'); }
        tags.push(`${base}-too-loose`);
        return verdict('mistake', null, 'Flatting with this hand at this stack depth is too loose.');
      }
      if (cat === 'raise' && adv.kind === 'resteal') {
        tags.push('short-raise');
        return verdict((evs.allin ?? 0) > 0 ? 'inaccuracy' : 'mistake', null, 'At this depth a non-all-in 3-bet usually commits you anyway. Shove or fold.');
      }
      return verdict('unscored', null, '');
    }
    const loss = Math.max(0, bestEV - mine);
    const g = evGrade(loss);
    const bestText = bestByEV(evs).map(catLabel).join(' / ');
    if (g !== 'best' && g !== 'good') {
      const aggressive = cat !== 'fold' && cat !== 'check';
      tags.push(`${base}-${aggressive ? 'too-loose' : 'too-tight'}`);
      if (adv.icm && adv.kind === 'callAllIn' && aggressive) tags.push('icm-call-too-loose');
      if (adv.icm && adv.kind === 'pushfold' && aggressive) tags.push('icm-push-too-loose');
    }
    const unit = adv.icm ? 'bb-eq (ICM)' : 'bb';
    const summary = loss < 0.005 ? `Best play (${bestText}).` : `${cap(cat)} costs about ${loss.toFixed(2)} ${unit} vs ${bestText}.`;
    return verdict(g, loss, summary);
  }

  // Chart-based preflop spots
  if (adv.street === 0) {
    let key = cat;
    if (cat === 'allin' && adv.freq.allin === undefined) key = 'raise';
    if (cat === 'check' && adv.freq.check === undefined) key = 'fold';
    const f = adv.freq[key] ?? 0;
    if (adv.kind === 'bbOption' && cat === 'fold') { tags.push('fold-free'); return verdict('blunder', null, 'Never fold when you can check for free.'); }
    // sizing checks
    if (cat === 'raise' && adv.kind === 'rfi') {
      const toBB = (action as { to: number }).to / bb;
      const maxOk = classifyPreflop(s, s.toAct).pos === 'SB' ? 4 : 3.2;
      if (toBB > maxOk) tags.push('open-size');
    }
    if (cat === 'allin' && key === 'raise' && classifyPreflop(s, s.toAct).effBB > 30) tags.push('overshove');
    if (f >= 0.5) return verdict(tags.length ? 'good' : 'best', null, tags.includes('open-size') ? 'Right decision, but your raise size is too big: with antes, 2–2.5bb is enough.' : tags.includes('overshove') ? 'Playing the hand is right, but shoving this deep risks too much to win too little. Raise instead.' : `Matches the baseline (${bestText}).`);
    if (f >= 0.2) return verdict('good', null, `Reasonable: the baseline mixes this hand (${bestText} preferred).`);
    if (f > 0.02) return verdict('inaccuracy', null, `Low-frequency play; the baseline prefers ${bestText}.`);
    const playPct = adv.playPct ?? 0.2;
    if (key !== 'fold') {
      // playing a hand outside the range
      const inOther = (Object.entries(adv.freq) as [ActionCat, number][]).some(([c, w]) => c !== 'fold' && c !== key && w > 0.3);
      if (inOther) {
        tags.push(key === 'call' ? `${base}-too-passive` : `${base}-too-aggressive`);
        return verdict('inaccuracy', null, `This hand plays, but ${bestText} is the better way to play it.`);
      }
      tags.push(key === 'call' && adv.kind === 'rfi' ? 'open-limp' : `${base}-too-loose`);
      const d = adv.handPct - playPct;
      const g: Grade = d <= 0.05 ? 'inaccuracy' : d <= 0.2 ? 'mistake' : 'blunder';
      return verdict(g, null, `${adv.handClass} is ${d <= 0.05 ? 'just outside' : 'well outside'} the baseline range here (${bestText}).`);
    }
    // folding a hand that should play
    tags.push(`${base}-too-tight`);
    const depth = playPct > 0 ? (playPct - adv.handPct) / playPct : 0;
    const g: Grade = adv.handPct < 0.03 ? 'blunder' : depth > 0.5 ? 'mistake' : 'inaccuracy';
    return verdict(g, null, `Too tight: ${adv.handClass} should ${bestText.replace('raise', 'raise').replace('allin', 'go all-in')} here.`);
  }

  // Postflop
  if (!adv.scored) return verdict('unscored', null, '');
  if (adv.kind === 'facingBet') {
    const evCall = adv.ev.call ?? 0;
    const potBB = potSize(s) / bb;
    if (cat === 'raise' || cat === 'allin') {
      if ((adv.equity ?? 0) >= 0.55) return verdict('best', null, 'Raising for value with a strong hand.');
      const vProf = ctx.profileOf(s.players.findIndex((p, i) => i !== s.toAct && !p.folded));
      if (s.street === 3 && vProf && vProf.callDown >= 0.5) { tags.push('bluff-station'); return verdict('mistake', null, 'Bluff-raising a player who rarely folds.'); }
      return verdict('unscored', null, 'A bluff or semi-bluff raise: judged by results, not graded.');
    }
    const mine = cat === 'call' ? evCall : 0;
    const best = Math.max(evCall, 0);
    const loss = best - mine;
    const tol = adv.evApprox ? Math.max(0.5, potBB * 0.12) : 0.1;
    if (loss <= tol) return verdict(loss < 0.05 ? 'best' : 'good', adv.evApprox ? null : loss, cat === 'call' ? 'The price is right to continue.' : 'Folding is fine at this price.');
    tags.push(cat === 'call' ? `${adv.tagBase}-overcall` : `${adv.tagBase}-overfold`);
    const g = evGrade(adv.evApprox ? loss * 0.6 : loss);
    return verdict(g === 'best' || g === 'good' ? 'inaccuracy' : g, loss,
      cat === 'call' ? `Calling needs ${pctS(adv.required ?? 0)} equity; you have about ${pctS(adv.equity ?? 0)} vs this range.` : `You folded with ${pctS(adv.equity ?? 0)} equity when you needed only ${pctS(adv.required ?? 0)}.`);
  }
  // river first to act / checked to
  const eq = adv.equity ?? 0;
  const idx = s.players.findIndex((p, i) => i !== s.toAct && !p.folded);
  const vProf = ctx.profileOf(idx);
  if (cat === 'check' && eq >= 0.72) {
    const passiveOpp = vProf && (vProf.key === 'station' || vProf.key === 'fish' || vProf.key === 'nit');
    const ip = isInPosition(s, s.toAct);
    if (ip || passiveOpp) {
      tags.push('missed-value');
      return verdict(eq >= 0.85 ? 'mistake' : 'inaccuracy', null, `Missed value: you win ${pctS(eq)} of the time against the hands that call. Bet.`);
    }
  }
  if ((cat === 'raise' || cat === 'allin') && eq < 0.2 && vProf && vProf.callDown >= 0.5) {
    tags.push('bluff-station');
    return verdict('mistake', null, `${vProf.label}s rarely fold: bluffing them burns chips.`);
  }
  return verdict(cat === 'raise' && eq >= 0.6 ? 'best' : 'good', null, cat === 'raise' && eq >= 0.6 ? 'Value bet.' : 'Reasonable.');
}

export const catLabel = (c: ActionCat) => (c === 'allin' ? 'all-in' : c === 'raise' ? 'raise' : c);

/** Options within 0.05bb of the best EV. */
export function bestByEV(ev: Partial<Record<ActionCat, number>>): ActionCat[] {
  const entries = (Object.entries(ev) as [ActionCat, number][]).filter(([, v]) => v !== undefined);
  const mx = Math.max(...entries.map(([, v]) => v));
  return entries.filter(([, v]) => v >= mx - 0.05).sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

function evGrade(loss: number): Grade {
  if (loss <= 0.05) return 'best';
  if (loss <= 0.25) return 'good';
  if (loss <= 0.75) return 'inaccuracy';
  if (loss <= 2.5) return 'mistake';
  return 'blunder';
}

const cap = (c: string) => (c === 'allin' ? 'Going all-in' : c[0].toUpperCase() + c.slice(1));
