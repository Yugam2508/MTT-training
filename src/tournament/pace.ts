/**
 * Live pace: blind levels by the clock, breaks, and the time live players and dealers take.
 * A 9-handed live table deals about 25-30 hands an hour; these delays come to about 30.
 */
import { legalActions, type HandState } from '../engine/hand';
import type { TournamentConfig } from './structure';

export const LIVE_HANDS_PER_HOUR = 30;
export const BREAK_EVERY_LEVELS = 4;
export const BREAK_MINUTES = 15;

/** Level length in minutes: the event's own, or the hands-per-level converted at a live hand rate. */
export function levelMinutes(cfg: Pick<TournamentConfig, 'levelMinutes' | 'handsPerLevel'>): number {
  return cfg.levelMinutes ?? Math.max(10, Math.round((cfg.handsPerLevel * 60) / LIVE_HANDS_PER_HOUR));
}

const between = (lo: number, hi: number, r: () => number) => Math.round((lo + (hi - lo) * r()) * 1000);

/** Between hands: pushing the pot, collecting the cards, shuffling, posting blinds and pitching 18 cards. */
export function liveDealDelayMs(r: () => number = Math.random): number {
  return between(45, 60, r);
}

/** After the last action: the dealer reads the hands at showdown, or pushes the pot. */
export function liveEndDelayMs(showdown: boolean, r: () => number = Math.random): number {
  return showdown ? between(8, 14, r) : between(3, 6, r);
}

/**
 * Think time for the player to act: quick folds and checks, longer facing bets, a tank facing an
 * all-in, plus the dealer burning and turning the board before the first action on each street.
 */
export function liveActionDelayMs(s: HandState, r: () => number = Math.random): number {
  const L = legalActions(s);
  const me = s.players[s.toAct];
  const newStreet = s.street > 0 && !s.actions.some((a) => a.street === s.street);
  const deal = newStreet ? between(4, 7, r) : 0;
  if (L.toCall > 0 && L.toCall >= me.stack) return deal + between(10, 30, r);
  if (s.street === 0) return L.toCall > 0 && s.currentBet > s.cfg.bb ? between(3, 9, r) : between(2.5, 5.5, r);
  return deal + (L.toCall > 0 ? between(5, 14, r) : between(3, 8, r));
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
