/**
 * Opponents fitted to real players: each bot belongs to one of the styles learned from the HandHQ
 * hands (research/handhq) and plays preflop with that style's measured fold/call/raise/shove
 * frequencies for the situation it is in. The data has no hole cards for most decisions, so a
 * frequency becomes a range by assuming players continue with their strongest hands: the most
 * aggressive action takes the top of the range, calling the next band, folding the rest.
 *
 * The data comes from cash games, where there is no bubble, so ICM awareness is a dial
 * (`icmAware`, 0 = the data as measured): it tightens shoves and calls by the player's bubble factor.
 * After the flop each style plays like the closest hand-made profile.
 */
import { type HandState, type PlayerAction, legalActions } from '../engine/hand';
import { NUM_CLASSES, classOfCards, classComboCount } from '../engine/combos';
import type { Rng } from '../engine/rng';
import { chooseBotAction, bucketToAction } from '../bots/bot';
import { PROFILES, type ProfileKey } from '../bots/profiles';
import { classesByPlayability } from '../theory/charts';
import { classesByRawEquity } from '../engine/preflopMatrix';
import { classifyPreflop } from '../theory/spot';
import { makeRng } from '../engine/rng';
import { Tournament } from '../tournament/tournament';
import type { TournamentConfig } from '../tournament/structure';
import FREQS from './styleFreqs.json';

export interface StyleFreqs {
  styles: { style: number; players: number; hands: number; vpip: number; pfr: number }[];
  axes: { facing: string[]; pos: string[]; effBB: number[]; raiseSizeBB: number[]; action: string[] };
  /** freq[style][facing][pos][eff][big table][raise size] = [fold, call, raise, allin] */
  freq: number[][][][][][][];
}

const F = FREQS as unknown as StyleFreqs;
export const STYLE_COUNT = F.styles.length;
/** The hand-made profile each learned style plays like after the flop (and for its ICM habits). */
export const STYLE_POSTFLOP: ProfileKey[] = ['nit', 'tag', 'fish', 'lag'];
export const STYLE_LABEL = ['Tight-passive', 'Tight-aggressive regular', 'Loose-passive', 'Loose-aggressive'];

const bin = (edges: number[], x: number) => {
  let k = 0;
  while (k < edges.length - 2 && x >= edges[k + 1]) k++;
  return k;
};

/** The style's [fold, call, raise, allin] frequencies for player `i`'s current preflop decision. */
export function styleFreqs(s: HandState, i: number, style: number): number[] {
  const sp = classifyPreflop(s, i);
  const facing = sp.facingAllIn ? 4 : sp.raises === 0 ? (sp.limpers > 0 ? 1 : 0) : sp.raises === 1 ? 2 : 3;
  const pos = F.axes.pos.indexOf(sp.pos);
  const eff = bin(F.axes.effBB, sp.effBB);
  const big = sp.n >= 7 ? 1 : 0;
  const size = facing === 2 ? bin(F.axes.raiseSizeBB, sp.lastRaiseToBB) : 0;
  return F.freq[style][facing][pos][eff][big][size];
}

/** Hand classes ordered from strongest, with the fraction of all combos above each. */
function ladder(order: number[]): Float64Array {
  const at = new Float64Array(NUM_CLASSES);
  let cum = 0;
  for (const h of order) { at[h] = cum; cum += classComboCount(h) / 1326; }
  return at;
}
let openLadder: Float64Array | null = null, allinLadder: Float64Array | null = null;

/**
 * What a data-style bot does. `bf` is its bubble factor and `icmAware` how much it reacts to it.
 */
export function dataStyleAction(s: HandState, i: number, style: number, bf: number, icmAware: number, rng: Rng): PlayerAction {
  const L = legalActions(s);
  if (s.street !== 0) return chooseBotAction(s, i, PROFILES[STYLE_POSTFLOP[style]], { bf: 1 + (bf - 1) * icmAware }, rng);
  const [, call, raise, allin] = styleFreqs(s, i, style);
  const sp = classifyPreflop(s, i);
  // bubble pressure: shoves and calls of shoves shrink with the bubble factor
  const squeeze = Math.pow(1 / Math.max(1, bf), icmAware);
  const facingShove = sp.facingAllIn;
  const aggr = (raise + allin) * (facingShove ? 1 : Math.sqrt(squeeze));
  const passive = call * (facingShove ? squeeze : 1);
  openLadder ??= ladder(classesByPlayability());
  allinLadder ??= ladder(classesByRawEquity());
  const p = s.players[i];
  const h = classOfCards(p.cards[0], p.cards[1]);
  // facing a shove only raw equity matters; otherwise playability
  const above = (facingShove || sp.effBB <= 12 ? allinLadder : openLadder)[h];
  const myTotal = p.stack + p.bet;
  const bb = s.cfg.bb;
  if (facingShove) {
    // calling (or re-shoving, the same here) with the top of the range
    return above < aggr + passive ? { type: 'call' } : L.canCheck ? { type: 'check' } : { type: 'fold' };
  }
  if (above < aggr) {
    // the strongest share of aggressive hands shoves, the rest raise
    const shove = allin / Math.max(1e-9, raise + allin);
    const raiseTo = sp.raises === 0 ? Math.round(bb * (2.5 + sp.limpers)) : Math.round(sp.lastRaiseToBB * bb * 3);
    if (rng.next() < shove || raiseTo >= myTotal * 0.4) return bucketToAction('allin', 0, L);
    return bucketToAction('raise', raiseTo, L);
  }
  if (above < aggr + passive) return bucketToAction('passive', 0, L);
  return L.canCheck ? { type: 'check' } : { type: 'fold' };
}

export interface DataField {
  /** Share of entrants in each style (default: the share of players in the data). */
  weights?: number[];
  /** 0 = ICM-blind as measured in cash games, 1 = fully reacts to the bubble factor. */
  icmAware: number;
}

/** A tournament whose opponents are data-style bots. */
export class DataTournament extends Tournament {
  readonly styleOf = new Map<string, number>();
  readonly field: DataField;

  constructor(cfg: TournamentConfig, field: DataField) {
    super(cfg);
    this.field = field;
    const w = field.weights ?? F.styles.map((x) => x.players);
    const total = w.reduce((a, b) => a + b, 0);
    const rng = makeRng(cfg.seed ^ 0x5eed);
    for (const p of this.players.values()) {
      if (p.isHero) continue;
      let x = rng.next() * total, k = 0;
      while (k < w.length - 1 && (x -= w[k]) > 0) k++;
      this.styleOf.set(p.id, k);
      // the hand-made profile matching the style, for anything that reads profiles (ICM awareness, HUD labels)
      p.profile = STYLE_POSTFLOP[k];
    }
  }

  protected botAction(s: HandState, id: string): PlayerAction {
    const raw = this.bf.get(id) ?? 1;
    return dataStyleAction(s, s.toAct, this.styleOf.get(id)!, raw, this.field.icmAware, this.rng);
  }
}
