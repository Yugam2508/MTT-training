import { describe, it, expect } from 'vitest';
import { Tournament } from '../tournament/tournament';
import { chipOutcomes } from '../theory/pushfold';
import { makeRng } from '../engine/rng';
import { POLICIES, fieldReg, seatSpot, seatValues } from './policies';
import { runSatellite, satelliteConfig, summarize } from './sim';

describe('satellite research', () => {
  it('conserves chips in every outcome of the seat spots it builds, and values them as seat chances', () => {
    let spots = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const t = new Tournament(satelliteConfig('bubble', seed));
      const rng = makeRng(seed);
      while (!t.finished && !t.heroOut) {
        const s = t.startRound();
        if (!s) break;
        while (!s.done) {
          t.runBots();
          if (!t.isHeroTurn()) continue;
          const hi = t.heroIndex();
          const f = s.street === 0 ? seatSpot(s, hi) : null;
          if (f) {
            spots++;
            const table = s.players.reduce((a, p) => a + p.stack + p.bet + p.ante, 0);
            const others = s.players.filter((_, h) => !f.ss.order.includes(h)).reduce((a, p) => a + p.stack, 0);
            const c = chipOutcomes(f.ss.spot);
            for (const v of [c.fold, c.steal, ...c.win, ...c.lose]) expect(v.reduce((a, b) => a + b, 0) + others).toBeCloseTo(table, 0);
            const vals = seatValues(t, s, f.ss, 1);
            for (const x of [...vals.fold, ...vals.steal]) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(600 + 1e-6); }
          }
          t.heroAct(POLICIES.seatEV.act(t, s, rng));
        }
        t.finishRound();
      }
    }
    expect(spots).toBeGreaterThan(0);
  });

  it('plays the same satellite the same way for the same seed', () => {
    const a = runSatellite(fieldReg, satelliteConfig('bubble', 5));
    const b = runSatellite(fieldReg, satelliteConfig('bubble', 5));
    expect(a).toEqual(b);
    expect(summarize('x', [a, b]).runs).toBe(2);
  });
});
