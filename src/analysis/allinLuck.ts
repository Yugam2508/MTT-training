/**
 * All-in luck: for every hand you played to a showdown with cards still to come (an all-in run-out),
 * compare the chips you actually won with the chips your equity at the moment the money went in
 * was worth. Positive luck means the run-outs paid you more than your share.
 */
import { replay } from '../engine/hand';
import { calcEquity } from '../engine/equity';
import { makeRng } from '../engine/rng';
import { cardsToString } from '../engine/cards';
import type { HandRecord } from '../tournament/tournament';

export interface AllIn {
  id: string;
  tid: string;
  ts: number;
  cards: string;
  /** Street the money went in on (0 = preflop). */
  street: number;
  /** Your equity in the main pot when the money went in. */
  equity: number;
  /** Whether you won (or split) the main pot. */
  won: boolean;
  /** Chips won, chips your equity was worth, and the difference, all in big blinds. */
  actualBB: number;
  expectedBB: number;
  luckBB: number;
  /** Size of the pots you could win, in big blinds. */
  potBB: number;
  /** You'd have been knocked out by losing it. */
  forStack: boolean;
}

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The all-in run-out in a stored hand, or null if there wasn't one. */
export function allInOf(h: HandRecord, iterations = 3000): AllIn | null {
  if (!h.moves.length) return null;
  const end = replay(h);
  const hi = h.heroIndex;
  const res = end.result;
  if (!res?.showdown || end.players[hi].folded) return null;
  // the board as it stood when the last decision was made; the rest was dealt with no more betting
  const before = replay(h, h.moves.length - 1);
  const board = before.board.slice();
  if (board.length >= 5) return null;
  const rng = makeRng(seedOf(h.id));
  const cache = new Map<string, number>();
  const equityIn = (eligible: number[]) => {
    const key = eligible.join(',');
    if (!cache.has(key)) {
      const r = calcEquity(eligible.map((i) => ({ cards: end.players[i].cards })), board, iterations, rng);
      cache.set(key, r.equity[eligible.indexOf(hi)]);
    }
    return cache.get(key)!;
  };
  let expected = 0, pot = 0;
  for (const p of res.pots) if (p.eligible.includes(hi)) { expected += p.amount * equityIn(p.eligible); pot += p.amount; }
  const main = res.pots.find((p) => p.eligible.includes(hi));
  if (!main) return null;
  const bb = h.cfg.bb;
  const actual = res.won[hi];
  return {
    id: h.id,
    tid: h.tid,
    ts: h.ts,
    cards: cardsToString(end.players[hi].cards),
    street: before.street,
    equity: equityIn(main.eligible),
    won: main.winners.includes(hi),
    actualBB: actual / bb,
    expectedBB: expected / bb,
    luckBB: (actual - expected) / bb,
    potBB: pot / bb,
    forStack: end.players[hi].startStack <= Math.max(...end.players.filter((_, i) => i !== hi && !end.players[i].folded).map((p) => p.startStack)),
  };
}

export interface AllInLuck {
  list: AllIn[];
  count: number;
  won: number;
  /** All-ins you'd expect to have won, from your equity. */
  expectedWins: number;
  luckBB: number;
  /** Typical size of luck over this many all-ins (one standard deviation), in big blinds. */
  spreadBB: number;
  /** Ones where losing meant busting. */
  forStack: { count: number; won: number; expectedWins: number };
}

export function summarize(list: AllIn[]): AllInLuck {
  const fs = list.filter((a) => a.forStack);
  return {
    list,
    count: list.length,
    won: list.filter((a) => a.won).length,
    expectedWins: list.reduce((s, a) => s + a.equity, 0),
    luckBB: list.reduce((s, a) => s + a.luckBB, 0),
    spreadBB: Math.sqrt(list.reduce((s, a) => s + a.potBB * a.potBB * a.equity * (1 - a.equity), 0)),
    forStack: { count: fs.length, won: fs.filter((a) => a.won).length, expectedWins: fs.reduce((s, a) => s + a.equity, 0) },
  };
}

export function allInLuck(hands: HandRecord[]): AllInLuck {
  const list: AllIn[] = [];
  for (const h of hands) {
    try {
      const a = allInOf(h);
      if (a) list.push(a);
    } catch { /* an unreadable old record: skip it */ }
  }
  return summarize(list);
}
