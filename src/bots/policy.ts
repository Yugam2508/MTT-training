/**
 * Bot decision policies, expressed as probability distributions over action buckets.
 * Preflop: per-class probabilities for the current spot. Postflop: a function of the
 * hand's strength on the board. Because they are distributions, the coach can compute
 * P(observed action | hand) and filter an opponent's range with Bayes' rule.
 */
import { type HandState, legalActions, potSize } from '../engine/hand';
import { NUM_CLASSES, classComboCount } from '../engine/combos';
import { type Range, emptyRange, topPercentRange, parseRange } from '../engine/ranges';
import { classesByRawEquity, eqVsRange, preflopMatrix } from '../engine/preflopMatrix';
import { NONCONFLICT } from '../engine/combos';
import { classifyPreflop, isInPosition, preflopOrder, type PreflopSpot } from '../theory/spot';
import { posGroup, type ChartPos } from '../theory/positions';
import { rfiRange, vsOpenRanges, vs3betRanges, jamVs3betRange, vs4betRange, scaleRange, classesByPlayability } from '../theory/charts';
import { nashPush } from '../theory/pushfoldCharts';
import { requiredEquity } from '../theory/icm';
import type { Profile } from './profiles';

export type Bucket = 'fold' | 'passive' | 'raise' | 'allin';
export interface Buckets { fold: number; passive: number; raise: number; allin: number }

export interface BotCtx {
  /** Bubble factor for this player (1 = chip EV). Already scaled by ICM awareness. */
  bf: number;
}

export interface PreflopPlan {
  spot: PreflopSpot;
  raise: Float64Array;
  allin: Float64Array;
  passive: Float64Array;
  raiseTo: number;
  /** Human-readable description of the plan (used in explanations). */
  label: string;
}

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

let topClasses: Set<number> | null = null;
/** Roughly the best 8% of hands: prefer raising (to get action) over jamming. */
function premium(h: number): boolean {
  if (!topClasses) {
    topClasses = new Set();
    let combos = 0;
    for (const c of classesByPlayability()) {
      if (combos > 1326 * 0.08) break;
      topClasses.add(c);
      combos += classComboCount(c);
    }
  }
  return topClasses.has(h);
}

/**
 * Re-shove (3-bet jam) range over a single open, one-pass EV estimate:
 * the opener continues with the top `contFrac` of their opening range; players behind fold.
 * EV(jam) = P(fold)*pot + P(call)*(eq*(2*eff + dead) - eff), losses scaled by the bubble factor.
 */
const restealCache = new Map<string, Range>();
export function restealRange(effBB: number, openerPos: ChartPos, openBB: number, postedBB: number, deadBB: number, bf: number, contFrac = 0.4): Range {
  const key = `${Math.round(effBB)}|${openerPos}|${roundHalf(openBB)}|${postedBB}|${roundHalf(deadBB)}|${bf.toFixed(1)}|${contFrac}`;
  const hit = restealCache.get(key);
  if (hit) return hit;
  const openRange = rfiRange(openerPos === 'BB' ? 'SB' : openerPos);
  const order = classesByRawEquity();
  const openCombos = rangeCombosOf(openRange);
  const cont = emptyRange();
  let need = openCombos * contFrac;
  for (const h of order) {
    if (need <= 0) break;
    if (openRange[h] <= 0) continue;
    const n = openRange[h] * classComboCount(h);
    const w = Math.min(1, need / n) * openRange[h];
    cont[h] = w;
    need -= w * classComboCount(h);
  }
  const m = preflopMatrix();
  const out = emptyRange();
  const eff = Math.max(effBB, openBB);
  const pot = openBB + postedBB + deadBB;
  for (let h = 0; h < NUM_CLASSES; h++) {
    const base = h * NUM_CLASSES;
    let inOpen = 0, inCont = 0, num = 0;
    for (let v = 0; v < NUM_CLASSES; v++) {
      const c = NONCONFLICT[base + v];
      inOpen += openRange[v] * c;
      if (cont[v] > 0) { const cw = cont[v] * c; inCont += cw; num += cw * m[base + v]; }
    }
    if (inOpen <= 0) continue;
    const pCall = inCont / inOpen;
    const eq = inCont > 0 ? num / inCont : 0.5;
    const risk = eff - postedBB;
    const winCalled = eq * (2 * eff + deadBB) - eff + postedBB; // relative to folding (posted is sunk)
    const evCalled = winCalled >= 0 ? winCalled : winCalled * bf;
    const ev = (1 - pCall) * pot + pCall * evCalled;
    void risk;
    if (ev > 0) out[h] = 1;
  }
  restealCache.set(key, out);
  if (restealCache.size > 500) restealCache.delete(restealCache.keys().next().value!);
  return out;
}

function rangeCombosOf(r: Range) {
  let t = 0;
  for (let h = 0; h < NUM_CLASSES; h++) t += r[h] * classComboCount(h);
  return t;
}

function roundHalf(x: number) { return Math.round(x * 2) / 2; }

export function preflopPlan(s: HandState, i: number, prof: Profile, ctx: BotCtx): PreflopPlan {
  const spot = classifyPreflop(s, i);
  const me = s.players[i];
  const L = legalActions(s);
  const bb = s.cfg.bb;
  const myTotal = me.stack + me.bet;
  const raise = new Float64Array(NUM_CLASSES);
  const allin = new Float64Array(NUM_CLASSES);
  const passive = new Float64Array(NUM_CLASSES);
  let raiseTo = 0;
  let label = '';
  const eff = spot.effBB;
  const anteBB = Math.min(2, spot.anteBB);
  const bfR = Math.round(clamp(ctx.bf, 1, 10) * 10) / 10; // the tournament caps bf (3, or 10 in satellites)
  const commitToAllin = (frac: number) => {
    if (raiseTo >= myTotal * frac || raiseTo >= L.maxRaiseTo) {
      for (let h = 0; h < NUM_CLASSES; h++) { allin[h] = Math.min(1, allin[h] + raise[h]); raise[h] = 0; }
    }
  };

  if (spot.kind === 'unopened' || spot.kind === 'limped') {
    const bbOption = L.canCheck;
    if (eff <= prof.pushFoldBB) {
      // ICM pressure approximated by pushing as if deeper
      const pushStack = clamp(eff * (1 + 0.6 * (bfR - 1)), 1, 25);
      const push = scaleRange(nashPush(Math.max(1, spot.behind), pushStack), prof.pushLoose * (spot.limpers ? 0.8 : 1));
      const limpRange = prof.limp > 0 ? scaleRange(rfiRange(spot.pos === 'BB' ? 'SB' : spot.pos), prof.loose) : null;
      for (let h = 0; h < NUM_CLASSES; h++) {
        allin[h] = push[h];
        if (bbOption) passive[h] = 1 - push[h];
        else if (limpRange) passive[h] = Math.min(1 - push[h], limpRange[h] * prof.limp);
      }
      label = `push/fold at ${eff.toFixed(1)}bb`;
      return { spot, raise, allin, passive, raiseTo, label };
    }
    if (bbOption) {
      const iso = topPercentRange(12 * prof.loose, classesByPlayability());
      for (let h = 0; h < NUM_CLASSES; h++) { raise[h] = iso[h]; passive[h] = 1 - iso[h]; }
      raiseTo = bb * (3 + spot.limpers);
      commitToAllin(0.4);
      label = 'BB vs limpers: raise or check';
      return { spot, raise, allin, passive, raiseTo, label };
    }
    const base = rfiRange(spot.pos);
    const open = scaleRange(base, prof.loose * (spot.limpers ? 0.7 : 1));
    const overlimp = spot.limpers && prof.limp > 0 ? scaleRange(base, prof.loose * 1.3) : null;
    for (let h = 0; h < NUM_CLASSES; h++) {
      const w = open[h];
      const limpShare = prof.limp * (premium(h) ? 0.3 : 1);
      raise[h] = w * (1 - limpShare);
      passive[h] = w - raise[h];
      if (overlimp) passive[h] = Math.max(passive[h], Math.min(1 - raise[h], overlimp[h] * prof.limp));
    }
    if (eff <= 20 && prof.limp === 0) {
      const push = scaleRange(nashPush(Math.max(1, spot.behind), clamp(eff * (1 + 0.6 * (bfR - 1)), 1, 25)), prof.pushLoose);
      for (let h = 0; h < NUM_CLASSES; h++) {
        if (push[h] > 0 && !premium(h)) { allin[h] = push[h]; raise[h] = Math.max(0, raise[h] - push[h]); passive[h] = Math.min(passive[h], 1 - allin[h] - raise[h]); }
      }
    }
    let openBB = eff <= 20 ? 2 : eff <= 40 ? 2.2 : prof.openSize;
    if (spot.pos === 'SB' && eff > 20) openBB = Math.max(openBB, 3);
    raiseTo = Math.round(bb * (openBB + spot.limpers));
    commitToAllin(0.45);
    label = spot.limpers ? 'isolate limpers' : `open from ${spot.pos}`;
    return { spot, raise, allin, passive, raiseTo, label };
  }

  if (spot.kind === 'vsAllIn') {
    const range = estimateShoveRange(s, spot.lastRaiserIdx);
    const risk = L.callAmount;
    const myMax = me.total + risk;
    let winnable = 0;
    for (const p of s.players) winnable += (p === me ? myMax : Math.min(p.total, myMax)) + p.ante;
    const req = requiredEquity(risk, Math.max(1, winnable - risk), bfR) + 0.015 * spot.behind;
    for (let h = 0; h < NUM_CLASSES; h++) {
      const eq = eqVsRange(h, range);
      passive[h] = sig((eq - req + prof.callBias) / 0.02);
    }
    label = `call an all-in needing ${(req * 100).toFixed(0)}% equity`;
    return { spot, raise, allin, passive, raiseTo, label };
  }

  if (spot.kind === 'vsOpen') {
    const og = posGroup(spot.openerPos!);
    const { threeBet, call } = vsOpenRanges(spot.pos, og);
    const sizeAdj = clamp(2.5 / Math.max(2, spot.openToBB), 0.5, 1.2);
    const tb = scaleRange(threeBet, prof.threeBet * (spot.callers || spot.limpers ? 0.7 : 1));
    const cl = scaleRange(call, prof.call * (spot.callers ? 0.75 : 1) * sizeAdj);
    if (eff <= 25) {
      const postedBB = me.total / bb;
      const deadBB = anteBB + (spot.callers + spot.limpers) * Math.min(spot.openToBB, 1.5);
      const rs = restealRange(eff, spot.openerPos!, spot.openToBB, postedBB, deadBB, bfR);
      const jam = scaleRange(rs, prof.pushLoose);
      const callScale = eff > 15 ? 0.5 : spot.pos === 'BB' ? 0.35 : 0;
      for (let h = 0; h < NUM_CLASSES; h++) {
        allin[h] = jam[h];
        passive[h] = Math.min(cl[h] * callScale, 1 - jam[h]);
      }
      label = `re-shove or fold at ${eff.toFixed(0)}bb`;
      return { spot, raise, allin, passive, raiseTo, label };
    }
    for (let h = 0; h < NUM_CLASSES; h++) {
      raise[h] = tb[h];
      passive[h] = Math.min(cl[h], 1 - tb[h]);
    }
    const ip = isInPosition(s, i);
    const lastTo = spot.lastRaiseToBB * bb;
    raiseTo = Math.round(lastTo * (ip ? 3 : 3.8) + spot.callers * lastTo);
    commitToAllin(0.4);
    label = `vs ${spot.openerPos} open`;
    return { spot, raise, allin, passive, raiseTo, label };
  }

  if (spot.kind === 'vs3bet') {
    const lastTo = spot.lastRaiseToBB * bb;
    if (!spot.heroRaised) {
      // cold facing a 3-bet: continue only with premiums
      const r = scaleRange(vs4betRange(), prof.vs3bet);
      const c = scaleRange(parseRange('JJ-TT:0.5, AQs:0.4'), prof.vs3bet);
      for (let h = 0; h < NUM_CLASSES; h++) { raise[h] = r[h]; passive[h] = Math.min(c[h], 1 - r[h]); }
      raiseTo = Math.round(lastTo * 2.3);
      commitToAllin(0.33);
      label = 'cold vs 3-bet';
      return { spot, raise, allin, passive, raiseTo, label };
    }
    if (eff <= 35) {
      const j = scaleRange(jamVs3betRange(), prof.vs3bet);
      for (let h = 0; h < NUM_CLASSES; h++) allin[h] = j[h];
      label = 'jam or fold vs 3-bet';
      return { spot, raise, allin, passive, raiseTo, label };
    }
    const threeBettorIP = !isInPosition(s, i);
    const { fourBet, call } = vs3betRanges(!threeBettorIP);
    const fb = scaleRange(fourBet, prof.vs3bet);
    const cl = scaleRange(call, prof.vs3bet);
    for (let h = 0; h < NUM_CLASSES; h++) { raise[h] = fb[h]; passive[h] = Math.min(cl[h], 1 - fb[h]); }
    raiseTo = Math.round(lastTo * 2.3);
    commitToAllin(0.35);
    label = 'vs 3-bet';
    return { spot, raise, allin, passive, raiseTo, label };
  }

  // vs4bet+
  const c = scaleRange(vs4betRange(), prof.vs3bet);
  for (let h = 0; h < NUM_CLASSES; h++) allin[h] = c[h];
  label = 'vs 4-bet';
  return { spot, raise, allin, passive, raiseTo, label };
}

/** Approximate shoving range for player j, based on stack depth, position and prior raises. */
export function estimateShoveRange(s: HandState, j: number): Range {
  if (j < 0) return topPercentRange(20, classesByRawEquity());
  const bb = s.cfg.bb;
  const p = s.players[j];
  let maxOther = 0;
  for (const q of s.players) if (q !== p) maxOther = Math.max(maxOther, q.startStack);
  const eff = Math.min(p.startStack, maxOther) / bb;
  // raises before j's last raise
  let lastIdx = -1;
  s.actions.forEach((a, k) => { if (a.p === j && a.street === 0 && (a.type === 'raise' || a.type === 'bet')) lastIdx = k; });
  let raisesBefore = 0;
  for (let k = 0; k < lastIdx; k++) {
    const a = s.actions[k];
    if (a.street === 0 && (a.type === 'raise' || a.type === 'bet')) raisesBefore++;
  }
  const table: [number, number][] = [[5, 60], [8, 45], [10, 35], [13, 28], [16, 22], [20, 17], [30, 12], [50, 8], [1e9, 5]];
  let pct = table.find(([lim]) => eff <= lim)![1];
  if (raisesBefore === 0) {
    const ord = preflopOrder(s, j);
    const behind = s.players.length - 1 - ord;
    pct *= clamp(1.8 - 0.15 * behind, 0.7, 1.6);
  } else if (raisesBefore === 1) pct *= 0.65;
  else pct = 5;
  return topPercentRange(clamp(pct, 3, 90), classesByRawEquity());
}

// ---------------- postflop ----------------

export interface PostflopCtx {
  street: number;
  pot: number;
  toCall: number;
  nOpp: number;
  wetness: number;
  ip: boolean;
  wasPFA: boolean;
  canRaise: boolean;
  betTo: number;
  raiseTo: number;
  maxTo: number;
  raisesThisStreet: number;
  potOdds: number;
}

export function postflopCtx(s: HandState, i: number, prof: Profile, wetness: number): PostflopCtx {
  const L = legalActions(s);
  const pot = potSize(s);
  const nOpp = s.players.filter((p, j) => j !== i && !p.folded).length;
  const idx = s.street === 1 ? (wetness > 0.45 ? 1 : 0) : s.street === 2 ? 2 : 3;
  const frac = prof.betSize[idx];
  let betTo = Math.max(s.cfg.bb, Math.round(pot * frac));
  betTo = Math.min(betTo, L.maxRaiseTo);
  let raiseTo = Math.max(L.minRaiseTo, Math.round(s.currentBet * 3 + (pot - s.currentBet) * 0.2));
  raiseTo = Math.min(raiseTo, L.maxRaiseTo);
  if (raiseTo >= L.maxRaiseTo * 0.55) raiseTo = L.maxRaiseTo;
  if (betTo >= L.maxRaiseTo * 0.8) betTo = L.maxRaiseTo;
  return {
    street: s.street,
    pot,
    toCall: L.toCall,
    nOpp,
    wetness,
    ip: isInPosition(s, i),
    wasPFA: s.preflopAggressor === i,
    canRaise: L.canRaise,
    betTo,
    raiseTo,
    maxTo: L.maxRaiseTo,
    raisesThisStreet: s.raisesThisStreet,
    potOdds: L.toCall > 0 ? L.callAmount / (pot + L.callAmount) : 0,
  };
}

export function postflopDist(c: PostflopCtx, prof: Profile, hs: number, ppot: number): Buckets {
  const ehs = hs + (1 - hs) * ppot;
  const s = Math.pow(ehs, 1 + 0.7 * (c.nOpp - 1));
  const drawiness = clamp(ppot / 0.3, 0, 1);
  if (c.toCall === 0) {
    const vT = prof.valueT + (c.street === 3 ? 0.04 : 0);
    const pValue = sig((s - vT) / 0.035);
    const pSemi = c.street < 3 ? prof.aggr * 0.7 * drawiness : 0;
    const headsUp = c.nOpp === 1 ? 1 : 0.4;
    const cbet = c.street === 1 && c.wasPFA ? prof.cbet * (c.wetness < 0.4 ? 1.05 : 0.75) * headsUp : 0;
    const bluff = prof.bluff * (c.street === 3 ? 0.55 : 0.75) * headsUp * (c.wasPFA ? 1.2 : 0.8) * (c.ip ? 1.15 : 0.85);
    let other: number;
    if (s < 0.4) other = Math.max(cbet, bluff * 0.7);
    else other = Math.max(cbet * 0.85, prof.aggr * 0.22);
    const pBet = clamp(pValue + (1 - pValue) * (pSemi + (1 - pSemi) * other), 0, 1);
    const allinBet = c.betTo >= c.maxTo;
    return { fold: 0, passive: 1 - pBet, raise: allinBet ? 0 : pBet, allin: allinBet ? pBet : 0 };
  }
  let callT = 0.42 + 0.95 * c.potOdds + (c.street === 3 ? 0.04 : c.street === 1 ? -0.03 : 0) + 0.05 * (c.nOpp - 1) - prof.callDown * 0.22;
  if (c.raisesThisStreet >= 2) callT += 0.08;
  const pCont = sig((s - callT) / 0.035);
  let pRaise = 0;
  if (c.canRaise) {
    const rT = prof.raiseT + (c.raisesThisStreet >= 2 ? 0.05 : 0);
    const pv = sig((s - rT) / 0.025);
    const semi = c.street < 3 ? prof.aggr * 0.22 * drawiness : 0;
    const bl = prof.bluff * 0.06;
    pRaise = clamp(pv + (1 - pv) * (semi + bl), 0, 1);
  }
  const passive = Math.max(0, pCont - pRaise);
  const fold = Math.max(0, 1 - passive - pRaise);
  const allinRaise = c.raiseTo >= c.maxTo;
  return { fold, passive, raise: allinRaise ? 0 : pRaise, allin: allinRaise ? pRaise : 0 };
}

export function normalize(b: Buckets): Buckets {
  const t = b.fold + b.passive + b.raise + b.allin;
  if (t <= 0) return { fold: 1, passive: 0, raise: 0, allin: 0 };
  if (t > 1) return { fold: b.fold / t, passive: b.passive / t, raise: b.raise / t, allin: b.allin / t };
  return { ...b, fold: b.fold + (1 - t) };
}

export function preflopBuckets(plan: PreflopPlan, h: number): Buckets {
  return normalize({ fold: 0, passive: plan.passive[h], raise: plan.raise[h], allin: plan.allin[h] });
}

export { emptyRange };
