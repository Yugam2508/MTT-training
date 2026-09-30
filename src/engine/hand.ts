/**
 * No-limit hold'em hand state machine (mutable for speed; replay by re-applying actions).
 * Rules: blinds + optional antes (BB ante or per-player), min-raise = last full raise,
 * an all-in for less than a full raise does not reopen betting for players who already acted,
 * uncalled bets are returned, side pots, odd chips to the first winner left of the button.
 */
import type { Card } from './cards';
import { evaluate, describeScore } from './evaluator';

export type Street = 0 | 1 | 2 | 3;
export const STREET_NAMES = ['Preflop', 'Flop', 'Turn', 'River'] as const;

export interface HandConfig {
  sb: number;
  bb: number;
  ante: number;
  anteMode: 'bb' | 'all' | 'none';
}

export interface SeatInput {
  id: string;
  name: string;
  seat: number;
  stack: number;
  isHero?: boolean;
}

export type ActionType = 'ante' | 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface ActionRecord {
  p: number;
  street: Street;
  type: ActionType;
  /** Chips put in by this action. */
  add: number;
  /** Player's total commitment on this street after the action. */
  to: number;
  allIn: boolean;
  /** Pot size before this action (all chips committed so far, including antes). */
  pot: number;
  /** Amount the player had to call before acting. */
  toCall: number;
  /** For raises: true if it was a full raise (reopens betting). */
  full?: boolean;
}

export interface HandPlayer {
  id: string;
  name: string;
  seat: number;
  isHero: boolean;
  startStack: number;
  stack: number;
  cards: [Card, Card];
  bet: number;
  total: number;
  ante: number;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  actedSinceFullRaise: boolean;
  /** Seats clockwise from the button among dealt-in players (0 = button). */
  offset: number;
}

export interface PotResult {
  amount: number;
  eligible: number[];
  winners: number[];
}

export interface HandResult {
  pots: PotResult[];
  won: number[];
  net: number[];
  showdown: boolean;
  shown: number[];
  scores: (number | null)[];
  descriptions: (string | null)[];
  refunds: number[];
}

export interface HandState {
  cfg: HandConfig;
  players: HandPlayer[];
  button: number;
  sbI: number;
  bbI: number;
  deck: Card[];
  board: Card[];
  street: Street;
  currentBet: number;
  lastRaise: number;
  toAct: number;
  actions: ActionRecord[];
  done: boolean;
  result: HandResult | null;
  raisesThisStreet: number;
  lastAggressor: number;
  preflopAggressor: number;
  /** Number of raises preflop including the open (limps don't count). */
  preflopRaises: number;
}

export type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number };

export interface Legal {
  toCall: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips added by calling (may be less than toCall if all-in). */
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

const nextIdx = (s: HandState, i: number) => (i + 1) % s.players.length;

export function potSize(s: HandState): number {
  let t = 0;
  for (const p of s.players) t += p.total + p.ante;
  return t;
}

export function createHand(cfg: HandConfig, seats: SeatInput[], buttonIndex: number, deck: Card[]): HandState {
  const n = seats.length;
  if (n < 2) throw new Error('Need at least 2 players');
  const players: HandPlayer[] = seats.map((st, i) => ({
    id: st.id,
    name: st.name,
    seat: st.seat,
    isHero: !!st.isHero,
    startStack: st.stack,
    stack: st.stack,
    cards: [deck[2 * i], deck[2 * i + 1]] as [Card, Card],
    bet: 0,
    total: 0,
    ante: 0,
    folded: false,
    allIn: false,
    acted: false,
    actedSinceFullRaise: false,
    offset: (i - buttonIndex + n) % n,
  }));
  const sbI = n === 2 ? buttonIndex : (buttonIndex + 1) % n;
  const bbI = n === 2 ? (buttonIndex + 1) % n : (buttonIndex + 2) % n;
  const s: HandState = {
    cfg,
    players,
    button: buttonIndex,
    sbI,
    bbI,
    deck: deck.slice(0, 2 * n + 5),
    board: [],
    street: 0,
    currentBet: cfg.bb,
    lastRaise: cfg.bb,
    toAct: -1,
    actions: [],
    done: false,
    result: null,
    raisesThisStreet: 0,
    lastAggressor: -1,
    preflopAggressor: -1,
    preflopRaises: 0,
  };
  const post = (i: number, type: ActionType, amount: number) => {
    const p = players[i];
    const a = Math.min(amount, p.stack);
    if (a <= 0) return;
    const pot = potSize(s);
    p.stack -= a;
    if (type === 'ante') p.ante += a;
    else { p.bet += a; p.total += a; }
    if (p.stack === 0) p.allIn = true;
    s.actions.push({ p: i, street: 0, type, add: a, to: p.bet, allIn: p.allIn, pot, toCall: 0 });
  };
  post(sbI, 'sb', cfg.sb);
  post(bbI, 'bb', cfg.bb);
  if (cfg.ante > 0) {
    if (cfg.anteMode === 'bb') post(bbI, 'ante', cfg.ante);
    else if (cfg.anteMode === 'all') for (let i = 0; i < n; i++) post(i, 'ante', cfg.ante);
  }
  // first to act preflop: after the BB
  s.toAct = findActor(s, nextIdx(s, bbI));
  if (s.toAct < 0) endStreet(s);
  return s;
}

function canAct(p: HandPlayer) {
  return !p.folded && !p.allIn;
}

function othersCanAct(s: HandState, i: number) {
  for (let j = 0; j < s.players.length; j++) if (j !== i && canAct(s.players[j])) return true;
  return false;
}

function needsAction(s: HandState, i: number): boolean {
  const p = s.players[i];
  if (!canAct(p)) return false;
  if (p.bet < s.currentBet) return true;
  if (p.acted) return false;
  // not facing a bet and hasn't acted: only matters if someone else can still act
  return othersCanAct(s, i);
}

/** First index starting at `from` (inclusive, cyclic) that needs to act, or -1. */
function findActor(s: HandState, from: number): number {
  const n = s.players.length;
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n;
    if (needsAction(s, i)) return i;
  }
  return -1;
}

export function legalActions(s: HandState): Legal {
  const p = s.players[s.toAct];
  const toCall = Math.max(0, s.currentBet - p.bet);
  const callAmount = Math.min(toCall, p.stack);
  const maxRaiseTo = p.bet + p.stack;
  const minFull = s.currentBet === 0 ? s.cfg.bb : s.currentBet + s.lastRaise;
  const canRaise = p.stack > toCall && !p.actedSinceFullRaise && othersCanAct(s, s.toAct);
  return {
    toCall,
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount,
    canRaise,
    minRaiseTo: Math.min(minFull, maxRaiseTo),
    maxRaiseTo,
  };
}

export function applyAction(s: HandState, action: PlayerAction): ActionRecord {
  if (s.done || s.toAct < 0) throw new Error('No player to act');
  const i = s.toAct;
  const p = s.players[i];
  const legal = legalActions(s);
  const pot = potSize(s);
  let rec: ActionRecord;
  let type = action.type;
  if (type === 'check' && !legal.canCheck) type = 'fold';
  if (type === 'call' && legal.toCall === 0) type = 'check';
  if (type === 'raise' && !legal.canRaise) type = legal.canCheck ? 'check' : 'call';

  if (type === 'fold') {
    p.folded = true;
    rec = { p: i, street: s.street, type: 'fold', add: 0, to: p.bet, allIn: false, pot, toCall: legal.toCall };
  } else if (type === 'check') {
    rec = { p: i, street: s.street, type: 'check', add: 0, to: p.bet, allIn: false, pot, toCall: 0 };
  } else if (type === 'call') {
    const a = legal.callAmount;
    p.stack -= a; p.bet += a; p.total += a;
    if (p.stack === 0) p.allIn = true;
    rec = { p: i, street: s.street, type: 'call', add: a, to: p.bet, allIn: p.allIn, pot, toCall: legal.toCall };
  } else {
    let to = Math.round((action as { to: number }).to);
    to = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, to));
    const a = to - p.bet;
    const raiseSize = to - s.currentBet;
    const full = raiseSize >= s.lastRaise || (s.currentBet === 0 && to >= s.cfg.bb);
    const wasBet = s.currentBet === 0;
    p.stack -= a; p.bet = to; p.total += a;
    if (p.stack === 0) p.allIn = true;
    if (full) {
      s.lastRaise = Math.max(raiseSize, s.cfg.bb);
      for (let j = 0; j < s.players.length; j++) if (j !== i) s.players[j].actedSinceFullRaise = false;
    }
    s.currentBet = Math.max(s.currentBet, to);
    s.raisesThisStreet++;
    s.lastAggressor = i;
    if (s.street === 0) { s.preflopAggressor = i; s.preflopRaises++; }
    rec = { p: i, street: s.street, type: wasBet ? 'bet' : 'raise', add: a, to, allIn: p.allIn, pot, toCall: legal.toCall, full };
  }
  p.acted = true;
  p.actedSinceFullRaise = true;
  s.actions.push(rec);
  advance(s, i);
  return rec;
}

function advance(s: HandState, last: number) {
  const alive = s.players.filter((p) => !p.folded);
  if (alive.length === 1) {
    returnUncalled(s);
    finish(s, false);
    return;
  }
  const nxt = findActor(s, nextIdx(s, last));
  if (nxt >= 0) { s.toAct = nxt; return; }
  endStreet(s);
}

function returnUncalled(s: HandState) {
  let maxI = -1, max = -1, second = 0;
  for (let i = 0; i < s.players.length; i++) {
    const b = s.players[i].bet;
    if (b > max) { second = max; max = b; maxI = i; } else if (b > second) second = b;
  }
  second = Math.max(second, 0);
  if (maxI >= 0 && max > second) {
    const diff = max - second;
    const p = s.players[maxI];
    p.bet -= diff; p.total -= diff; p.stack += diff;
    if (p.stack > 0) p.allIn = false;
    s.result = s.result ?? emptyResult(s.players.length);
    s.result.refunds[maxI] += diff;
  }
}

function emptyResult(n: number): HandResult {
  return {
    pots: [], won: new Array(n).fill(0), net: new Array(n).fill(0), showdown: false, shown: [],
    scores: new Array(n).fill(null), descriptions: new Array(n).fill(null), refunds: new Array(n).fill(0),
  };
}

function endStreet(s: HandState) {
  returnUncalled(s);
  const alive = s.players.filter((p) => !p.folded);
  if (alive.length === 1) { finish(s, false); return; }
  if (s.street === 3) { finish(s, true); return; }
  // next street
  s.street = (s.street + 1) as Street;
  const n = s.players.length;
  const boardStart = 2 * n;
  const boardLen = s.street === 1 ? 3 : s.street === 2 ? 4 : 5;
  s.board = s.deck.slice(boardStart, boardStart + boardLen);
  for (const p of s.players) { p.bet = 0; p.acted = false; p.actedSinceFullRaise = false; }
  s.currentBet = 0;
  s.lastRaise = s.cfg.bb;
  s.raisesThisStreet = 0;
  s.lastAggressor = -1;
  const actors = s.players.filter(canAct).length;
  if (actors < 2) {
    // no more betting possible: run it out
    s.toAct = -1;
    endStreet(s);
    return;
  }
  s.toAct = findActor(s, nextIdx(s, s.button));
  if (s.toAct < 0) endStreet(s);
}

function finish(s: HandState, showdown: boolean) {
  const n = s.players.length;
  const res = s.result ?? emptyResult(n);
  s.result = res;
  s.done = true;
  s.toAct = -1;
  res.showdown = showdown;
  const antes = s.players.reduce((a, p) => a + p.ante, 0);
  const alive = s.players.map((p, i) => (p.folded ? -1 : i)).filter((i) => i >= 0);
  if (!showdown) {
    const w = alive[0];
    const amount = s.players.reduce((a, p) => a + p.total, 0) + antes;
    res.pots = [{ amount, eligible: [w], winners: [w] }];
    res.won[w] += amount;
    s.players[w].stack += amount;
  } else {
    // make sure the full board is out
    s.board = s.deck.slice(2 * n, 2 * n + 5);
    const buf = new Array<number>(7);
    for (const i of alive) {
      const p = s.players[i];
      buf[0] = p.cards[0]; buf[1] = p.cards[1];
      for (let k = 0; k < 5; k++) buf[k + 2] = s.board[k];
      const sc = evaluate(buf, 7);
      res.scores[i] = sc;
      res.descriptions[i] = describeScore(sc);
    }
    res.shown = alive.slice();
    const remaining = s.players.map((p) => p.total);
    const pots: PotResult[] = [];
    for (;;) {
      const live = alive.filter((i) => remaining[i] > 0);
      if (!live.length) break;
      const level = Math.min(...live.map((i) => remaining[i]));
      let amount = 0;
      for (let j = 0; j < n; j++) {
        const take = Math.min(remaining[j], level);
        amount += take;
        remaining[j] -= take;
      }
      pots.push({ amount, eligible: live, winners: [] });
    }
    const leftover = remaining.reduce((a, b) => a + b, 0);
    if (!pots.length) pots.push({ amount: 0, eligible: alive, winners: [] });
    pots[pots.length - 1].amount += leftover;
    pots[0].amount += antes;
    // order for odd chips: first seat left of the button
    const order = alive.slice().sort((a, b) => ((s.players[a].offset + n - 1) % n) - ((s.players[b].offset + n - 1) % n));
    for (const pot of pots) {
      let best = -1;
      for (const i of pot.eligible) best = Math.max(best, res.scores[i]!);
      const winners = order.filter((i) => pot.eligible.includes(i) && res.scores[i] === best);
      pot.winners = winners;
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      for (const w of winners) {
        const amt = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
        res.won[w] += amt;
        s.players[w].stack += amt;
      }
    }
    res.pots = pots;
  }
  for (let i = 0; i < n; i++) res.net[i] = s.players[i].stack - s.players[i].startStack;
}

/** Players still in the hand (not folded). */
export const livePlayers = (s: HandState) => s.players.filter((p) => !p.folded);

/** Amount the current actor must call. */
export const toCallOf = (s: HandState) => (s.toAct >= 0 ? Math.max(0, s.currentBet - s.players[s.toAct].bet) : 0);

export interface ReplayableHand {
  cfg: HandConfig;
  seats: SeatInput[];
  button: number;
  deck: Card[];
  /** Voluntary actions only, in order. */
  moves: PlayerAction[];
}

/** Rebuild a hand and apply the first `upTo` voluntary actions (all if omitted). */
export function replay(h: ReplayableHand, upTo?: number): HandState {
  const s = createHand(h.cfg, h.seats, h.button, h.deck);
  const lim = upTo ?? h.moves.length;
  for (let k = 0; k < lim && !s.done; k++) applyAction(s, h.moves[k]);
  return s;
}

/** Convert an action record into a replayable move. */
export function toMove(r: ActionRecord): PlayerAction | null {
  switch (r.type) {
    case 'fold': return { type: 'fold' };
    case 'check': return { type: 'check' };
    case 'call': return { type: 'call' };
    case 'bet':
    case 'raise': return { type: 'raise', to: r.to };
    default: return null;
  }
}
