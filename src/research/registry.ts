/** Every hero policy the satellite research can run, by key. */
import { chipNash, fieldReg, seatEV, seatVsChip, seatDecision, type HeroPolicy } from './policies';
import { exploitOracle, exploitRead } from './exploit';
import { DataTournament, dataStyleAction, fieldShare, STYLE_SIGMA, STYLE_LABEL } from './dataBots';
import type { FieldModel } from './policies';
import { topPercentRange } from '../engine/ranges';
import { classesByRawEquity } from '../engine/preflopMatrix';
import { positionOf } from '../theory/spot';
import { HERO_ID } from '../tournament/tournament';

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
const fieldModel: FieldModel = {
  callRange: (s, h, effBB) => topPercentRange(100 * fieldShare('callAllIn', positionOf(s, h), effBB, s.players.length), classesByRawEquity()),
  shoveRange: (s, h, effBB) => topPercentRange(100 * Math.max(0.02, fieldShare('openShove', positionOf(s, h), effBB, s.players.length)), classesByRawEquity()),
};

/** Seat push/fold that best-responds to the field's measured ranges; `base` plays everything else. */
function fieldSeat(key: string, label: string, base: HeroPolicy, fromLeft = Infinity): HeroPolicy {
  return {
    key, label,
    act: (t, s, rng) => (t.alive().length <= fromLeft ? seatDecision(t, s, t.heroIndex(), fieldModel) : null) ?? base.act(t, s, rng),
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
  enterL1: lateEntry(1), enterL2: lateEntry(2), enterL3: lateEntry(3), enterL4: lateEntry(4), enterL5: lateEntry(5), enterL6: lateEntry(6),
  fieldSeatStyle0late30: fieldSeat('fieldSeatStyle0late30', 'Field-aware seat push/fold from 30 left + tight-passive style', dataStyle(0), 30),
};
