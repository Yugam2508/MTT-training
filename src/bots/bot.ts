/** Turn a policy distribution into a concrete action. */
import { type HandState, type PlayerAction, type ActionRecord, legalActions } from '../engine/hand';
import { classOfCards, comboIndex } from '../engine/combos';
import type { Rng } from '../engine/rng';
import { boardTable } from './boardStrength';
import { preflopPlan, preflopBuckets, postflopCtx, postflopDist, normalize, type BotCtx, type Buckets, type Bucket } from './policy';
import type { Profile } from './profiles';

export function botBuckets(s: HandState, i: number, prof: Profile, ctx: BotCtx): { buckets: Buckets; raiseTo: number } {
  const p = s.players[i];
  if (s.street === 0) {
    const plan = preflopPlan(s, i, prof, ctx);
    return { buckets: preflopBuckets(plan, classOfCards(p.cards[0], p.cards[1])), raiseTo: plan.raiseTo };
  }
  const table = boardTable(s.board);
  const k = comboIndex(p.cards[0], p.cards[1]);
  const c = postflopCtx(s, i, prof, table.wetness);
  const b = normalize(postflopDist(c, prof, table.hs[k], table.ppot[k]));
  return { buckets: b, raiseTo: c.toCall > 0 ? c.raiseTo : c.betTo };
}

export function chooseBotAction(s: HandState, i: number, prof: Profile, ctx: BotCtx, rng: Rng): PlayerAction {
  const L = legalActions(s);
  const { buckets, raiseTo } = botBuckets(s, i, prof, ctx);
  const x = rng.next();
  let bucket: Bucket;
  if (x < buckets.allin) bucket = 'allin';
  else if (x < buckets.allin + buckets.raise) bucket = 'raise';
  else if (x < buckets.allin + buckets.raise + buckets.passive) bucket = 'passive';
  else bucket = 'fold';
  return bucketToAction(bucket, raiseTo, L);
}

export function bucketToAction(bucket: Bucket, raiseTo: number, L: ReturnType<typeof legalActions>): PlayerAction {
  const passive: PlayerAction = L.canCheck ? { type: 'check' } : { type: 'call' };
  switch (bucket) {
    case 'fold': return L.canCheck ? { type: 'check' } : { type: 'fold' };
    case 'passive': return passive;
    case 'raise':
      if (!L.canRaise) return passive;
      return { type: 'raise', to: Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, raiseTo || L.minRaiseTo)) };
    case 'allin':
      if (!L.canRaise) return passive;
      return { type: 'raise', to: L.maxRaiseTo };
  }
}

/** Which bucket an observed action falls in (for range inference). */
export function bucketOf(r: ActionRecord): Bucket {
  if (r.type === 'fold') return 'fold';
  if (r.type === 'check' || r.type === 'call') return 'passive';
  return r.allIn ? 'allin' : 'raise';
}
