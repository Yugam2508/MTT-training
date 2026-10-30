/**
 * Hero policies for satellite research: who sits in the hero seat when a satellite is simulated
 * without a person playing. Each one picks the hero's action from the hand state and the tournament.
 *
 * - chipNash: the regular's game with chip-EV Nash push/fold and no ICM at all.
 * - fieldReg: the regular as the field plays it, with the tournament's bubble-factor ICM shortcut.
 * - seatEV:   push/fold re-solved for seat equity: every short-stack shove, re-shove and call is
 *             the equilibrium for that exact spot, valued by each player's chance of a seat (ICM over
 *             the whole field with the satellite's flat payouts). Deeper spots play like fieldReg.
 * - seatVsChip: the hero plays for seats but expects opponents to play chip-EV Nash (to ignore the
 *             bubble), and best-responds to that. Deeper spots play like fieldReg.
 */
import { type HandState, type PlayerAction, legalActions } from '../engine/hand';
import { classOfCards, NUM_CLASSES, NONCONFLICT } from '../engine/combos';
import { preflopMatrix, eqVsRange } from '../engine/preflopMatrix';
import type { Rng } from '../engine/rng';
import type { Range } from '../engine/ranges';
import { chooseBotAction } from '../bots/bot';
import { PROFILES } from '../bots/profiles';
import { classifyPreflop, preflopOrder, positionOf } from '../theory/spot';
import { rfiRange } from '../theory/charts';
import { chipOutcomes, solvePushFold, type PFOutcomeValues, type PFSpot } from '../theory/pushfold';
import { icmBatch } from '../theory/icm';
import { HERO_ID, type Tournament } from '../tournament/tournament';

export interface HeroPolicy {
  key: string;
  label: string;
  act(t: Tournament, s: HandState, rng: Rng): PlayerAction;
}

const reg = PROFILES.pro;

export const chipNash: HeroPolicy = {
  key: 'chipNash',
  label: 'Chip-EV Nash regular',
  act: (t, s, rng) => chooseBotAction(s, t.heroIndex(), reg, { bf: 1 }, rng),
};

export const fieldReg: HeroPolicy = {
  key: 'fieldReg',
  label: 'Regular with bubble factors',
  act: (t, s, rng) => chooseBotAction(s, t.heroIndex(), reg, { bf: t.botCtx(HERO_ID).bf }, rng),
};

/** At or below this effective stack (bb) the seat-EV policy open-shoves or folds. */
export const SEAT_SHOVE_BB = 15;
/** At or below this effective stack it re-shoves or folds over a single open. */
export const SEAT_RESHOVE_BB = 25;
const ICM_SAMPLES = 3000;

export interface SeatSpot {
  /** Hand indices of the pusher and then the callers, in the order they act. */
  order: number[];
  spot: PFSpot;
  priors: (Range | null)[];
}

/** Whole-field chances of a seat (in prize units) for each outcome of a push/fold spot. */
export function seatValues(t: Tournament, s: HandState, ss: SeatSpot, seed: number): PFOutcomeValues {
  const chips = chipOutcomes(ss.spot);
  const { ids, stacks, payouts } = t.icmField();
  const where = new Map(ids.map((id, k) => [id, k]));
  // everyone at this table who isn't in the spot keeps what they have now (posted chips are dead)
  const base = stacks.slice();
  s.players.forEach((p) => { const k = where.get(p.id); if (k !== undefined) base[k] = p.stack; });
  const fieldIdx = ss.order.map((h) => where.get(s.players[h].id)!);
  const vec = (finals: number[]) => { const v = base.slice(); finals.forEach((x, j) => (v[fieldIdx[j]] = Math.max(0, x))); return v; };
  const vectors = [chips.fold, chips.steal, ...chips.win, ...chips.lose].map(vec);
  const vals = icmBatch(vectors, payouts, ICM_SAMPLES, seed);
  const pick = (v: number[]) => fieldIdx.map((k) => v[k]);
  const k = chips.win.length;
  return {
    fold: pick(vals[0]),
    steal: pick(vals[1]),
    win: vals.slice(2, 2 + k).map(pick),
    lose: vals.slice(2 + k, 2 + 2 * k).map(pick),
  };
}

const total = (s: HandState, h: number) => s.players[h].stack + s.players[h].bet;
const anteDead = (s: HandState) => s.players.reduce((a, p) => a + p.ante, 0);

/** Live players who act after `from` preflop, in order. */
function after(s: HandState, from: number, include: (h: number) => boolean): number[] {
  const me = preflopOrder(s, from);
  return s.players.map((_, h) => h).filter((h) => h !== from && preflopOrder(s, h) > me && include(h))
    .sort((a, b) => preflopOrder(s, a) - preflopOrder(s, b));
}

/**
 * The push/fold spot the hero is in, if it is one: an open-shove, a re-shove over a single open,
 * or a call of a single all-in (an open-shove, or a re-shove over the hero's own open).
 */
export function seatSpot(s: HandState, hi: number): { ss: SeatSpot; heroAt: number } | null {
  const sp = classifyPreflop(s, hi);
  const live = (h: number) => !s.players[h].folded;
  const dead = (exclude: number[]) => anteDead(s) + s.players.reduce((a, p, h) => a + (exclude.includes(h) ? 0 : p.bet), 0);
  const build = (order: number[], priors: (Range | null)[]): SeatSpot => {
    const players = order.map((h) => ({ stack: total(s, h), posted: s.players[h].bet }));
    return { order, spot: { pusher: players[0], callers: players.slice(1), dead: dead(order) }, priors };
  };
  if (sp.kind === 'unopened' && sp.limpers === 0 && sp.effBB <= SEAT_SHOVE_BB) {
    const callers = after(s, hi, live);
    if (!callers.length) return null;
    return { ss: build([hi, ...callers], callers.map(() => null)), heroAt: 0 };
  }
  if (sp.kind === 'vsOpen' && sp.callers === 0 && sp.limpers === 0 && sp.effBB <= SEAT_RESHOVE_BB) {
    const o = sp.openerIdx;
    const behind = after(s, hi, (h) => live(h) && h !== o);
    const openRange = rfiRange(positionOf(s, o) === 'BB' ? 'SB' : positionOf(s, o));
    return { ss: build([hi, ...behind, o], [...behind.map(() => null), openRange]), heroAt: 0 };
  }
  if (sp.kind === 'vsAllIn' && sp.callers === 0 && sp.limpers === 0) {
    const j = sp.lastRaiserIdx;
    if (!s.players[j].allIn) return null;
    if (sp.raises === 1) {
      // an open-shove: everyone who was behind the shover could have called
      const callers = after(s, j, (h) => live(h) || s.players[h].folded);
      const at = callers.indexOf(hi);
      if (at < 0) return null;
      const ss = build([j, ...callers], callers.map(() => null));
      // the shover put in their whole stack; what they had posted before is in their total
      ss.spot.pusher = { stack: total(s, j), posted: blindOf(s, j) };
      return { ss, heroAt: at + 1 };
    }
    if (sp.raises === 2 && sp.heroWasOpener) {
      const callers = after(s, j, (h) => h !== hi);
      const ss = build([j, ...callers, hi], [...callers.map(() => null), rfiRange(sp.pos === 'BB' ? 'SB' : sp.pos)]);
      ss.spot.pusher = { stack: total(s, j), posted: blindOf(s, j) };
      return { ss, heroAt: callers.length + 1 };
    }
  }
  return null;
}

/** What a player had posted as a blind before they acted. */
function blindOf(s: HandState, h: number): number {
  const a = s.actions.find((x) => x.p === h && (x.type === 'sb' || x.type === 'bb'));
  return a ? a.add : 0;
}

/** EV(push) - EV(fold) for hand class `h` against fixed call ranges, in the units of `values`. */
export function pushGainVs(values: PFOutcomeValues, calls: Range[], priors: (Range | null)[], h: number): number {
  const m = preflopMatrix();
  const base = h * NUM_CLASSES;
  let pReach = 1, ev = 0;
  calls.forEach((cr, i) => {
    const pr = priors[i];
    let num = 0, inR = 0, all = 0;
    for (let v = 0; v < NUM_CLASSES; v++) {
      const c = pr ? NONCONFLICT[base + v] * pr[v] : NONCONFLICT[base + v];
      all += c;
      if (cr[v] > 0) { const cw = c * cr[v]; inR += cw; num += cw * m[base + v]; }
    }
    const f = all > 0 ? inR / all : 0;
    if (f > 0) { const eq = num / inR; ev += pReach * f * (eq * values.win[i][0] + (1 - eq) * values.lose[i][0]); }
    pReach *= 1 - f;
  });
  return ev + pReach * values.steal[0] - values.fold[0];
}

/**
 * @param opponents 'seat': everyone plays the seat-equity equilibrium. 'chip': opponents play the
 * chip-EV equilibrium (they ignore the bubble) and the hero best-responds in seat equity.
 */
export function seatDecision(t: Tournament, s: HandState, hi: number, opponents: 'seat' | 'chip' = 'seat'): PlayerAction | null {
  if (s.street !== 0) return null;
  const found = seatSpot(s, hi);
  if (!found) return null;
  const { ss, heroAt } = found;
  const values = seatValues(t, s, ss, t.handNo * 7919 + s.actions.length);
  const p = s.players[hi];
  const h = classOfCards(p.cards[0], p.cards[1]);
  const L = legalActions(s);
  const passive: PlayerAction = L.canCheck ? { type: 'check' } : { type: 'fold' };
  const shove: PlayerAction = L.canRaise ? { type: 'raise', to: L.maxRaiseTo } : { type: 'call' };
  if (opponents === 'seat') {
    const res = solvePushFold(values, 40, 0.3, ss.priors);
    if (heroAt === 0) return res.push[h] > 0 ? shove : passive;
    return res.calls[heroAt - 1][h] > 0 ? { type: 'call' } : passive;
  }
  const chip = solvePushFold(chipOutcomes(ss.spot), 40, 0.3, ss.priors);
  if (heroAt === 0) return pushGainVs(values, chip.calls, ss.priors, h) > 0 ? shove : passive;
  // calling: the shover pushes their chip-EV range; call when it gains seat equity against it
  const i = heroAt - 1;
  const eq = eqVsRange(h, chip.push);
  return eq * values.lose[i][i + 1] + (1 - eq) * values.win[i][i + 1] > values.steal[i + 1] ? { type: 'call' } : passive;
}

export const seatEV: HeroPolicy = {
  key: 'seatEV',
  label: 'Seat-equity push/fold',
  act: (t, s, rng) => seatDecision(t, s, t.heroIndex()) ?? fieldReg.act(t, s, rng),
};

export const seatVsChip: HeroPolicy = {
  key: 'seatVsChip',
  label: 'Seat equity vs a chip-EV field',
  act: (t, s, rng) => seatDecision(t, s, t.heroIndex(), 'chip') ?? fieldReg.act(t, s, rng),
};
