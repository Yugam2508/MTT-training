import { heroRead, readNotes, vsHero, type HeroRead } from './read';
import { emptyCounts } from '../analysis/handFlags';
import { preflopPlan, estimateShoveRange } from './policy';
import { PROFILES } from './profiles';
import { createHand, applyAction, type SeatInput } from '../engine/hand';
import { fullDeck } from '../engine/cards';
import { classComboCount, NUM_CLASSES } from '../engine/combos';
import { Tournament, HERO_ID } from '../tournament/tournament';
import { PRESETS } from '../tournament/structure';
import { chooseBotAction } from './bot';

const seats = (n: number): SeatInput[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, seat: i, stack: 4000 }));
/** 9-handed, button = seat 0, everyone folds to the button (seat 1 = SB, seat 2 = BB). */
function foldedToButton() {
  const s = createHand({ sb: 50, bb: 100, ante: 100, anteMode: 'bb' }, seats(9), 0, fullDeck());
  while (s.toAct !== 0) applyAction(s, { type: 'fold' });
  return s;
}
const mass = (xs: Float64Array[]) => { let m = 0; for (let h = 0; h < NUM_CLASSES; h++) m += xs.reduce((a, x) => a + x[h], 0) * classComboCount(h); return m / 1326; };
const read = (idx: number, p: Partial<HeroRead>): HeroRead => ({ idx, foldsToSteals: 0, steals: 0, foldsTo3bet: 0, threeBets: 0, foldsToCbet: 0, callsDown: 0, aggression: 0, ...p });

describe('adaptive opponents', () => {
  it('builds reads only from a real sample, scaled by how observant the bot is', () => {
    const c = emptyCounts();
    expect(heroRead(c, 1, 0)).toBeNull();
    Object.assign(c, { hands: 60, bbVsStealOpp: 20, bbFoldToSteal: 18, stealOpp: 20, steal: 8 });
    const pro = heroRead(c, PROFILES.pro.adapt, 0)!;
    const fish = heroRead(c, PROFILES.fish.adapt, 0)!;
    expect(pro.foldsToSteals).toBeGreaterThan(0.4);
    expect(fish.foldsToSteals).toBeLessThan(pro.foldsToSteals / 5);
    expect(Math.abs(pro.steals)).toBeLessThan(0.05); // 40% steals is typical
    expect(readNotes(c)[0].trait).toBe('foldsToSteals');
  });

  it('steals wider when the hero over-folds the big blind', () => {
    const s = foldedToButton();
    const base = preflopPlan(s, 0, PROFILES.pro, { bf: 1 });
    const vs = preflopPlan(s, 0, PROFILES.pro, { bf: 1, read: read(2, { foldsToSteals: 1 }) });
    expect(mass([vs.raise, vs.allin])).toBeGreaterThan(mass([base.raise, base.allin]) * 1.2);
    // a hero who defends a lot gets stolen from less
    const tight = preflopPlan(s, 0, PROFILES.pro, { bf: 1, read: read(2, { foldsToSteals: -1 }) });
    expect(mass([tight.raise, tight.allin])).toBeLessThan(mass([base.raise, base.allin]));
  });

  it("3-bets a wide-stealing hero more, and widens its picture of the hero's shoves", () => {
    const s = foldedToButton();
    applyAction(s, { type: 'raise', to: 250 }); // hero (button) opens
    applyAction(s, { type: 'fold' }); // SB folds; BB (seat 2) to act
    const base = preflopPlan(s, 2, PROFILES.pro, { bf: 1 });
    const vs = preflopPlan(s, 2, PROFILES.pro, { bf: 1, read: read(0, { steals: 1, foldsTo3bet: 1 }) });
    expect(mass([vs.raise, vs.allin])).toBeGreaterThan(mass([base.raise, base.allin]) * 1.3);
    const r1 = estimateShoveRange(s, 0), r2 = estimateShoveRange(s, 0, vsHero.shoveRange(read(0, { steals: 1 })));
    expect(mass([r2 as Float64Array])).toBeGreaterThan(mass([r1 as Float64Array]));
  });

  it('runs tournaments with adaptive opponents and shows reads on the hero', () => {
    const cfg = { ...PRESETS.find((p) => p.key === 'spcsat')!.config, adaptive: true, seed: 9 };
    const t = new Tournament(cfg);
    let rounds = 0;
    while (!t.finished && !t.heroOut && rounds++ < 80) {
      const s = t.startRound();
      if (!s) break;
      // a hero who folds everything: the table should notice
      while (!s.done) { if (t.isHeroTurn()) t.heroAct({ type: s.players[s.toAct].bet >= s.currentBet ? 'check' : 'fold' }); else t.stepBot(); }
      t.finishRound();
    }
    expect(t.botCtx(t.currentSeatIds.find((id) => id !== HERO_ID) ?? 'p0').bf).toBeGreaterThan(0);
    expect(t.heroReads().length).toBeGreaterThan(0);
    void chooseBotAction;
  });
});
