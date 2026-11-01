/** Every hero policy the satellite research can run, by key. */
import { chipNash, fieldReg, seatEV, seatVsChip, seatDecision, type HeroPolicy } from './policies';
import { exploitOracle, exploitRead } from './exploit';
import { DataTournament, dataStyleAction, STYLE_SIGMA, STYLE_LABEL } from './dataBots';
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

export const POLICIES: Record<string, HeroPolicy> = {
  chipNash, fieldReg, seatEV, seatVsChip, exploitOracle, exploitRead,
  style0: dataStyle(0), style1: dataStyle(1), style2: dataStyle(2), style3: dataStyle(3),
  seatStyle0: seatStyle(0), seatStyle1: seatStyle(1),
};
