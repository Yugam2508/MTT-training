/**
 * Bayesian range estimation: replay the hand and, at each voluntary action by a player,
 * multiply each combo's weight by P(observed action | combo) under that player's policy.
 * Uses only public information plus the hero's own cards (as card removal).
 */
import { type HandState, type ReplayableHand, createHand, applyAction, toMove, legalActions } from '../engine/hand';
import { NUM_COMBOS, COMBO_A, COMBO_B, COMBO_CLASS, NUM_CLASSES } from '../engine/combos';
import { type Range, emptyRange } from '../engine/ranges';
import { preflopPlan, postflopCtx, postflopDist, normalize, type BotCtx, type Buckets } from '../bots/policy';
import { bucketOf } from '../bots/bot';
import { boardTable } from '../bots/boardStrength';
import type { Profile } from '../bots/profiles';

export function replayableFromState(s: HandState): ReplayableHand {
  return {
    cfg: s.cfg,
    seats: s.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, stack: p.startStack, isHero: p.isHero })),
    button: s.button,
    deck: s.deck,
    moves: s.actions.map(toMove).filter((m) => m !== null) as ReplayableHand['moves'],
  };
}

const FLOOR = 0.02;

function likelihood(b: Buckets, observed: ReturnType<typeof bucketOf>, canCheck: boolean, canRaise: boolean): number {
  switch (observed) {
    case 'fold': return b.fold;
    case 'passive': return b.passive + (canCheck ? b.fold : 0) + (canRaise ? 0 : b.raise + b.allin);
    case 'raise': return b.raise;
    case 'allin': return b.allin + b.raise * 0.15; // sizing noise: large raises that end up all-in
  }
}

export interface RangeEstimate {
  combos: Float64Array; // 1326 weights (normalized to max 1)
  classes: Range; // aggregated 169 weights (fraction of combos alive)
}

/**
 * Estimate ranges for the given players at the current point of `live` (only actions so far).
 * `profileOf(i)` returns the player's policy profile (null = unknown -> no filtering).
 */
export function estimateRanges(
  live: HandState,
  heroIdx: number,
  targets: number[],
  profileOf: (i: number) => Profile | null,
  ctxOf: (i: number) => BotCtx,
): Map<number, RangeEstimate> {
  const h = replayableFromState(live);
  const s = createHand(h.cfg, h.seats, h.button, h.deck);
  const dead = new Uint8Array(52);
  const hero = live.players[heroIdx];
  dead[hero.cards[0]] = 1; dead[hero.cards[1]] = 1;
  for (const c of live.board) dead[c] = 1;
  const weights = new Map<number, Float64Array>();
  for (const t of targets) {
    const w = new Float64Array(NUM_COMBOS);
    for (let k = 0; k < NUM_COMBOS; k++) w[k] = dead[COMBO_A[k]] || dead[COMBO_B[k]] ? 0 : 1;
    weights.set(t, w);
  }
  for (const move of h.moves) {
    const i = s.toAct;
    const w = weights.get(i);
    const prof = profileOf(i);
    if (w && prof) {
      const L = legalActions(s);
      // Predict the bucket from the move itself (all-in if it puts the player all-in)
      const p = s.players[i];
      let observed: ReturnType<typeof bucketOf>;
      if (move.type === 'fold') observed = 'fold';
      else if (move.type === 'check' || move.type === 'call') observed = 'passive';
      else observed = move.to >= p.bet + p.stack ? 'allin' : 'raise';
      if (s.street === 0) {
        const plan = preflopPlan(s, i, prof, ctxOf(i));
        const byClass = new Float64Array(NUM_CLASSES);
        for (let c = 0; c < NUM_CLASSES; c++) {
          const b = normalize({ fold: 0, passive: plan.passive[c], raise: plan.raise[c], allin: plan.allin[c] });
          byClass[c] = Math.max(FLOOR, likelihood(b, observed, L.canCheck, L.canRaise));
        }
        for (let k = 0; k < NUM_COMBOS; k++) if (w[k] > 0) w[k] *= byClass[COMBO_CLASS[k]];
      } else {
        const table = boardTable(s.board);
        const c = postflopCtx(s, i, prof, table.wetness);
        for (let k = 0; k < NUM_COMBOS; k++) {
          if (w[k] <= 0) continue;
          const hs = table.hs[k];
          if (Number.isNaN(hs)) { w[k] = 0; continue; }
          const b = normalize(postflopDist(c, prof, hs, table.ppot[k]));
          w[k] *= Math.max(FLOOR, likelihood(b, observed, L.canCheck, L.canRaise));
        }
      }
      // renormalize to avoid underflow
      let mx = 0;
      for (let k = 0; k < NUM_COMBOS; k++) if (w[k] > mx) mx = w[k];
      if (mx > 0) for (let k = 0; k < NUM_COMBOS; k++) w[k] /= mx;
    }
    applyAction(s, move);
  }
  const out = new Map<number, RangeEstimate>();
  for (const [i, w] of weights) {
    const classes = emptyRange();
    const cnt = new Float64Array(NUM_CLASSES);
    for (let k = 0; k < NUM_COMBOS; k++) {
      const c = COMBO_CLASS[k];
      classes[c] += w[k];
      cnt[c] += 1;
    }
    for (let c = 0; c < NUM_CLASSES; c++) classes[c] = cnt[c] ? classes[c] / cnt[c] : 0;
    out.set(i, { combos: w, classes });
  }
  return out;
}

/** Percentage of all starting hands represented by combo weights. */
export function comboRangePercent(w: Float64Array): number {
  let t = 0;
  for (let k = 0; k < NUM_COMBOS; k++) t += w[k];
  return (100 * t) / NUM_COMBOS;
}
