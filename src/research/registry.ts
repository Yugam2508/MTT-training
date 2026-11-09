/** Every hero policy the satellite research can run, by key. */
import { chipNash, fieldReg, seatEV, seatVsChip, seatDecision, type HeroPolicy } from './policies';
import { exploitOracle, exploitRead } from './exploit';
import { DataTournament, dataStyleAction, fieldShare, STYLE_SIGMA, STYLE_LABEL } from './dataBots';
import type { FieldModel } from './policies';
import { topPercentRange } from '../engine/ranges';
import { classesByRawEquity } from '../engine/preflopMatrix';
import { positionOf } from '../theory/spot';
import { HERO_ID, type Tournament } from '../tournament/tournament';
import type { HandState } from '../engine/hand';

/**
 * A real-player style in the hero seat (a control): it plays exactly like the field's bots of that
 * style, so with a data-fitted field its seat rate shows how that style fares, and the
 * population-weighted average of the styles should come out near the 10% an average entrant gets.
 */
function dataStyle(k: number): HeroPolicy {
  return {
    key: `style${k}`,
    label: `${STYLE_LABEL[k]} (data style in the hero seat)`,
    act: (t, s, rng) => {
      const icm = t instanceof DataTournament ? t.field.icmAware : 0;
      return dataStyleAction(s, t.heroIndex(), k, t.bf.get(HERO_ID) ?? 1, icm, rng, STYLE_SIGMA[k]);
    },
  };
}

/**
 * A hybrid: the seat-equity push/fold against a chip-EV field where it applies (short-stack shoves,
 * re-shoves and calls of all-ins), and a real-player style everywhere else.
 */
function seatStyle(k: number): HeroPolicy {
  const base = dataStyle(k);
  return {
    key: `seatStyle${k}`,
    label: `Seat push/fold + ${STYLE_LABEL[k]}`,
    act: (t, s, rng) => seatDecision(t, s, t.heroIndex(), 'chip') ?? base.act(t, s, rng),
  };
}

/**
 * The hybrid, but the seat push/fold only switches on once `left` or fewer players remain: before
 * that the real-player style plays every hand, short stacks included.
 */
function seatStyleLate(k: number, left: number): HeroPolicy {
  const base = dataStyle(k);
  return {
    key: `seatStyle${k}late${left}`,
    label: `Seat push/fold from ${left} left + ${STYLE_LABEL[k]}`,
    act: (t, s, rng) => (t.alive().length <= left ? seatDecision(t, s, t.heroIndex(), 'chip') : null) ?? base.act(t, s, rng),
  };
}

/**
 * The field as the hero reads it without knowing who is who: every opponent calls and shoves with
 * the population's measured frequencies for their seat and stack, taking the strongest hands.
 */
function fieldModelOf(weights?: number[]): FieldModel {
  return {
    callRange: (s, h, effBB) => topPercentRange(100 * fieldShare('callAllIn', positionOf(s, h), effBB, s.players.length, weights), classesByRawEquity()),
    shoveRange: (s, h, effBB) => topPercentRange(100 * Math.max(0.02, fieldShare('openShove', positionOf(s, h), effBB, s.players.length, weights)), classesByRawEquity()),
  };
}
const fieldModel = fieldModelOf();

/** Seat push/fold that best-responds to the field's measured ranges; `base` plays everything else. */
function fieldSeat(key: string, label: string, base: HeroPolicy, fromLeft = Infinity, model = fieldModel): HeroPolicy {
  return {
    key, label,
    act: (t, s, rng) => (t.alive().length <= fromLeft ? seatDecision(t, s, t.heroIndex(), model) : null) ?? base.act(t, s, rng),
  };
}

/**
 * Per-opponent reads, as an upper bound: the field-aware bot told each opponent's true style, so it
 * predicts every caller and shover from that style's own measured frequencies.
 */
function playerSeat(key: string, label: string, base: HeroPolicy, fromLeft = Infinity): HeroPolicy {
  const oneHot = (t: Tournament, s: HandState, h: number) => {
    const k = t instanceof DataTournament ? t.styleOf.get(s.players[h].id) : undefined;
    return k === undefined ? undefined : STYLE_LABEL.map((_, j) => (j === k ? 1 : 0));
  };
  return {
    key, label,
    act: (t, s, rng) => {
      if (t.alive().length > fromLeft) return base.act(t, s, rng);
      const model: FieldModel = {
        callRange: (st, h, effBB) => topPercentRange(100 * fieldShare('callAllIn', positionOf(st, h), effBB, st.players.length, oneHot(t, st, h)), classesByRawEquity()),
        shoveRange: (st, h, effBB) => topPercentRange(100 * Math.max(0.02, fieldShare('openShove', positionOf(st, h), effBB, st.players.length, oneHot(t, st, h))), classesByRawEquity()),
      };
      return seatDecision(t, s, t.heroIndex(), model) ?? base.act(t, s, rng);
    },
  };
}

/** The best satellite bot, entering late at `level` with a fresh starting stack. */
function lateEntry(level: number): HeroPolicy {
  const base = fieldSeat('fieldSeatStyle0late50', '', dataStyle(0), 50);
  return { key: `enterL${level}`, label: `Best bot entering at level ${level}`, act: base.act, lateLevel: level };
}

export const POLICIES: Record<string, HeroPolicy> = {
  chipNash, fieldReg, seatEV, seatVsChip, exploitOracle, exploitRead,
  style0: dataStyle(0), style1: dataStyle(1), style2: dataStyle(2), style3: dataStyle(3),
  seatStyle0: seatStyle(0), seatStyle1: seatStyle(1),
  seatStyle0late20: seatStyleLate(0, 20), seatStyle0late30: seatStyleLate(0, 30),
  fieldSeatReg: fieldSeat('fieldSeatReg', 'Field-aware seat push/fold + regular', fieldReg),
  fieldSeatStyle0: fieldSeat('fieldSeatStyle0', 'Field-aware seat push/fold + tight-passive style', dataStyle(0)),
  fieldSeatStyle0late50: fieldSeat('fieldSeatStyle0late50', 'Field-aware seat push/fold from 50 left + tight-passive style', dataStyle(0), 50),
  fieldSeatStyle0late70: fieldSeat('fieldSeatStyle0late70', 'Field-aware seat push/fold from 70 left + tight-passive style', dataStyle(0), 70),
  // the same bot told the field's true mix: loose (mostly loose-passive and LAG) or tight
  fieldSeatStyle0late50knowsLoose: fieldSeat('fieldSeatStyle0late50knowsLoose', 'Field-aware from 50 left, modelling a loose field', dataStyle(0), 50, fieldModelOf([15, 15, 45, 25])),
  fieldSeatStyle0late50knowsTight: fieldSeat('fieldSeatStyle0late50knowsTight', 'Field-aware from 50 left, modelling a tight field', dataStyle(0), 50, fieldModelOf([55, 25, 12, 8])),
  playerSeatStyle0late50: playerSeat('playerSeatStyle0late50', 'Per-opponent reads from 50 left + tight-passive style', dataStyle(0), 50),
  enterL1: lateEntry(1), enterL2: lateEntry(2), enterL3: lateEntry(3), enterL4: lateEntry(4), enterL5: lateEntry(5), enterL6: lateEntry(6),
  fieldSeatStyle0late30: fieldSeat('fieldSeatStyle0late30', 'Field-aware seat push/fold from 30 left + tight-passive style', dataStyle(0), 30),
};
