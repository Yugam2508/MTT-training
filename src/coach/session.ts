/** Glue between the tournament and the coach: context building and decision records. */
import type { PlayerAction } from '../engine/hand';
import { cardsToString } from '../engine/cards';
import { classOfCards, className } from '../engine/combos';
import { PROFILES, type ProfileKey } from '../bots/profiles';
import { positionOf } from '../theory/spot';
import { POS_LABEL } from '../theory/positions';
import type { Tournament } from '../tournament/tournament';
import type { Stage } from '../tournament/structure';
import { adviseHero, gradeAction, actionCategory, describeAction, type Advice, type Verdict, type ActionCat, type Grade, type CoachContext, type DecisionKind } from './coach';

export interface DecisionRecord {
  id: string;
  tid: string;
  handId: string;
  handNo: number;
  /** Index into the hand's voluntary move list of the hero's action. */
  moveIndex: number;
  ts: number;
  street: number;
  kind: DecisionKind;
  title: string;
  cards: string;
  handClass: string;
  pos: string;
  stackBB: number;
  stage: Stage;
  icm: boolean;
  action: ActionCat;
  actionText: string;
  best: ActionCat[];
  grade: Grade;
  evLossBB: number | null;
  equity?: number;
  required?: number;
  lines: string[];
  summary: string;
  tags: string[];
}

export function coachContextFor(t: Tournament, seatIds: string[]): CoachContext {
  const icmOn = t.icmRelevant();
  let icm: CoachContext['icm'] = null;
  if (icmOn) {
    const f = t.icmField();
    const pos = new Map(f.ids.map((id, i) => [id, i]));
    icm = { fieldStacks: f.stacks, payouts: f.payouts, fieldIndex: seatIds.map((id) => pos.get(id)!), bfCap: t.bubbleFactorCap() };
  }
  return {
    profileOf: (i) => {
      const p = t.profileOf(seatIds[i]);
      return p === 'hero' ? null : PROFILES[p as ProfileKey];
    },
    botCtxOf: (i) => t.botCtx(seatIds[i]),
    icm,
    stage: t.stage(),
    playersLeft: t.playersLeft(),
    paid: t.paid,
  };
}

/** Advice for the hero's current decision at the tournament's live table. */
export function liveAdvice(t: Tournament): Advice | null {
  const s = t.current;
  if (!s || !t.isHeroTurn()) return null;
  return adviseHero(s, t.heroIndex(), coachContextFor(t, t.currentSeatIds));
}

/** Grade the hero's action (call before applying it). */
export function gradeHeroAction(t: Tournament, action: PlayerAction, advice?: Advice | null): { advice: Advice; verdict: Verdict; record: DecisionRecord } {
  const s = t.current!;
  const hi = t.heroIndex();
  const ctx = coachContextFor(t, t.currentSeatIds);
  const adv = advice ?? adviseHero(s, hi, ctx);
  const cat = actionCategory(s, action);
  const verdict = gradeAction(adv, cat, s, action, ctx);
  const hero = s.players[hi];
  const moveIndex = s.actions.filter((a) => !['sb', 'bb', 'ante'].includes(a.type)).length;
  const record: DecisionRecord = {
    id: `${t.id}-h${t.handNo}-m${moveIndex}`,
    tid: t.id,
    handId: `${t.id}-h${t.handNo}`,
    handNo: t.handNo,
    moveIndex,
    ts: Date.now(),
    street: s.street,
    kind: adv.kind,
    title: adv.title,
    cards: cardsToString(hero.cards),
    handClass: className(classOfCards(hero.cards[0], hero.cards[1])),
    pos: POS_LABEL[positionOf(s, hi)],
    stackBB: (hero.stack + hero.bet) / s.cfg.bb,
    stage: t.stage(),
    icm: adv.icm,
    action: cat,
    actionText: describeAction(s, action),
    best: adv.best,
    grade: verdict.grade,
    evLossBB: verdict.evLossBB,
    equity: adv.equity,
    required: adv.required,
    lines: adv.lines,
    summary: verdict.summary,
    tags: verdict.tags,
  };
  return { advice: adv, verdict, record };
}
