/** Classify the current preflop decision from the hand state (public information only). */
import type { HandState } from '../engine/hand';
import { type ChartPos, chartPosition } from './positions';

export type PreflopKind = 'unopened' | 'limped' | 'vsOpen' | 'vs3bet' | 'vs4bet' | 'vsAllIn';

export interface PreflopSpot {
  kind: PreflopKind;
  pos: ChartPos;
  n: number;
  /** Players still to act after this player (not folded), in preflop order. */
  behind: number;
  limpers: number;
  raises: number;
  /** Index of the first raiser (opener) and the last raiser. */
  openerIdx: number;
  openerPos: ChartPos | null;
  lastRaiserIdx: number;
  lastRaiserPos: ChartPos | null;
  /** Players who called the last raise. */
  callers: number;
  openToBB: number;
  lastRaiseToBB: number;
  toCallBB: number;
  potBB: number;
  /** Effective stack in BB: own total chips vs the biggest other live stack. */
  effBB: number;
  /** Own chips (stack + already committed) in BB. */
  stackBB: number;
  heroWasOpener: boolean;
  heroRaised: boolean;
  facingAllIn: boolean;
  anteBB: number;
}

export function preflopOrder(s: HandState, i: number): number {
  const n = s.players.length;
  return (i - (s.bbI + 1) + n * 2) % n;
}

export function positionOf(s: HandState, i: number): ChartPos {
  return chartPosition(s.players.length, s.players[i].offset);
}

export function classifyPreflop(s: HandState, i: number): PreflopSpot {
  const bb = s.cfg.bb;
  const n = s.players.length;
  const me = s.players[i];
  let raises = 0, limpers = 0, callers = 0;
  let openerIdx = -1, lastRaiserIdx = -1, openTo = 0, lastRaiseTo = 0;
  let heroRaised = false;
  for (const a of s.actions) {
    if (a.street !== 0) continue;
    if (a.type === 'raise' || a.type === 'bet') {
      raises++;
      if (openerIdx < 0) { openerIdx = a.p; openTo = a.to; }
      lastRaiserIdx = a.p;
      lastRaiseTo = a.to;
      callers = 0;
      if (a.p === i) heroRaised = true;
    } else if (a.type === 'call') {
      if (raises === 0) limpers++; else callers++;
    }
  }
  const toCall = Math.max(0, s.currentBet - me.bet);
  const myTotal = me.stack + me.bet;
  let maxOther = 0;
  for (let j = 0; j < n; j++) {
    if (j === i || s.players[j].folded) continue;
    maxOther = Math.max(maxOther, s.players[j].stack + s.players[j].bet);
  }
  const eff = Math.min(myTotal, maxOther);
  const lastRaiser = lastRaiserIdx >= 0 ? s.players[lastRaiserIdx] : null;
  const facingAllIn = raises > 0 && lastRaiserIdx !== i && (!!lastRaiser?.allIn || toCall >= me.stack * 0.6);
  let kind: PreflopKind;
  if (raises === 0) kind = limpers > 0 ? 'limped' : 'unopened';
  else if (facingAllIn) kind = 'vsAllIn';
  else if (raises === 1) kind = 'vsOpen';
  else if (raises === 2) kind = 'vs3bet';
  else kind = 'vs4bet';
  const myOrd = preflopOrder(s, i);
  let behind = 0;
  for (let j = 0; j < n; j++) {
    if (j === i || s.players[j].folded) continue;
    if (preflopOrder(s, j) > myOrd) behind++;
  }
  let anteTotal = 0;
  for (const p of s.players) anteTotal += p.ante;
  const pot = s.players.reduce((a, p) => a + p.total + p.ante, 0);
  return {
    kind,
    pos: positionOf(s, i),
    n,
    behind,
    limpers,
    raises,
    openerIdx,
    openerPos: openerIdx >= 0 ? positionOf(s, openerIdx) : null,
    lastRaiserIdx,
    lastRaiserPos: lastRaiserIdx >= 0 ? positionOf(s, lastRaiserIdx) : null,
    callers,
    openToBB: openTo / bb,
    lastRaiseToBB: lastRaiseTo / bb,
    toCallBB: toCall / bb,
    potBB: pot / bb,
    effBB: eff / bb,
    stackBB: myTotal / bb,
    heroWasOpener: openerIdx === i,
    heroRaised,
    facingAllIn,
    anteBB: anteTotal / bb,
  };
}

/** Position relative to the other live players postflop (true if acting last). */
export function isInPosition(s: HandState, i: number): boolean {
  const n = s.players.length;
  const me = s.players[i];
  // postflop order starts left of the button; the button (offset 0) acts last
  const rank = (off: number) => (off + n - 1) % n;
  for (let j = 0; j < n; j++) {
    if (j === i || s.players[j].folded) continue;
    if (rank(s.players[j].offset) > rank(me.offset)) return false;
  }
  return true;
}
