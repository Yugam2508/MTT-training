import { Tournament, HERO_ID } from './tournament';
import { PRESETS, type TournamentConfig } from './structure';
import { chooseBotAction } from '../bots/bot';
import { PROFILES } from '../bots/profiles';

function playOut(cfg: TournamentConfig, maxRounds = 3000) {
  const t = new Tournament(cfg);
  const total = cfg.entrants * cfg.startingStack;
  let rounds = 0;
  let maxMs = 0;
  while (!t.finished && !t.heroOut && rounds < maxRounds) {
    const t0 = performance.now();
    const s = t.startRound();
    if (!s) break;
    while (!s.done) {
      if (t.isHeroTurn()) t.heroAct(chooseBotAction(s, s.toAct, PROFILES.pro, t.botCtx(HERO_ID), t.rng));
      else t.stepBot();
    }
    t.finishRound();
    maxMs = Math.max(maxMs, performance.now() - t0);
    rounds++;
    const chips = t.alive().reduce((a, p) => a + p.stack, 0);
    expect(chips).toBe(total);
    for (const tb of t.tables) {
      const n = tb.seats.filter((x) => x).length;
      expect(n).toBeLessThanOrEqual(cfg.tableSize);
    }
  }
  return { t, rounds, maxMs };
}

describe('tournament', () => {
  it('plays a 27-player tournament to the end with conserved chips', () => {
    const cfg = { ...PRESETS[0].config, seed: 12345 };
    const { t, rounds, maxMs } = playOut(cfg);
    expect(t.finished || t.heroOut).toBe(true);
    const r = t.result();
    expect(r.place).toBeGreaterThanOrEqual(1);
    expect(r.place).toBeLessThanOrEqual(27);
    console.log(`27p: ${rounds} rounds, hero place ${r.place}, max round ${maxMs.toFixed(0)}ms, events ${t.events.length}`);
  });

  it('runs a 180-player field and balances tables', () => {
    const cfg = { ...PRESETS[2].config, seed: 99 };
    const { t, rounds, maxMs } = playOut(cfg, 400);
    const counts = t.tables.map((tb) => tb.seats.filter((x) => x).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    console.log(`180p: ${rounds} rounds, left ${t.playersLeft()}, tables ${t.tables.length}, max round ${maxMs.toFixed(0)}ms, hero ${t.heroOut ? 'out ' + t.hero().place : 'in'}`);
  });

  it('bubble and final-table scenario starts are valid', () => {
    for (const idx of [4, 5]) {
      const cfg = { ...PRESETS[idx].config, seed: 7 + idx };
      const t = new Tournament(cfg);
      const chips = t.alive().reduce((a, p) => a + p.stack, 0);
      expect(chips).toBe(cfg.entrants * cfg.startingStack);
      if (idx === 4) expect(t.playersLeft()).toBeGreaterThan(t.paid);
      if (idx === 5) expect(t.tables.length).toBe(1);
      const { rounds, maxMs } = playOut(cfg, 150);
      console.log(`${cfg.name}: ${rounds} rounds, max round ${maxMs.toFixed(0)}ms`);
    }
  });
});
