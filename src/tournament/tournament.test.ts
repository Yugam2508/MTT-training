import { Tournament, HERO_ID } from './tournament';
import { PRESETS, type TournamentConfig } from './structure';
import { satellitePayouts } from '../theory/payouts';
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

  it('pays satellite seats: guarantee, full seats, and leftover cash', () => {
    expect(satellitePayouts(100, 60, 600, 10)).toEqual(new Array(10).fill(600));
    expect(satellitePayouts(80, 60, 600, 10)).toEqual(new Array(10).fill(600)); // guarantee covers the overlay
    expect(satellitePayouts(125, 60, 600, 10)).toEqual([...new Array(12).fill(600), 300]);
  });

  it('plays an SPC satellite until the seats are decided', () => {
    // When the hero survives, play stops as soon as everyone left has a seat.
    const checkEnd = (t: Tournament) => {
      expect(t.finished).toBe(true);
      const left = t.alive();
      expect(left.length).toBeLessThanOrEqual(10);
      for (const p of left) expect(p.prize).toBe(600);
      const seatWinners = [...t.players.values()].filter((p) => p.prize === 600);
      expect(new Set(seatWinners.map((p) => p.place))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
      const r = t.result();
      expect(r.seat).toBe(true);
      expect(r.place).toBeLessThanOrEqual(10);
      expect(r.currency).toBe('S$');
    };
    const full = PRESETS.find((p) => p.key === 'spcsat')!;
    for (const seed of [3, 11]) {
      const { t, rounds, maxMs } = playOut({ ...full.config, seed }, 4000);
      expect(t.paid).toBe(10);
      if (t.finished) checkEnd(t);
      else { expect(t.heroOut).toBe(true); expect(t.result().place).toBeGreaterThan(10); expect(t.result().seat).toBe(false); }
      console.log(`SPC satellite seed ${seed}: ${rounds} rounds, hero place ${t.result().place}, max round ${maxMs.toFixed(0)}ms`);
    }
    const bubble = PRESETS.find((p) => p.key === 'spcsatbubble')!;
    let finished = 0;
    for (let seed = 1; seed <= 8 && finished < 2; seed++) {
      const { t } = playOut({ ...bubble.config, heroStack: 'big', seed }, 1000);
      if (!t.finished) continue;
      checkEnd(t);
      finished++;
    }
    expect(finished).toBeGreaterThan(0);
  });

  it('starts the SPC satellite bubble with 15 left', () => {
    const preset = PRESETS.find((p) => p.key === 'spcsatbubble')!;
    const cfg = { ...preset.config, seed: 21 };
    const t = new Tournament(cfg);
    expect(t.playersLeft()).toBe(15);
    expect(t.alive().reduce((a, p) => a + p.stack, 0)).toBe(cfg.entrants * cfg.startingStack);
    expect(t.avgStack() / t.level().bb).toBeGreaterThan(10);
    expect(t.avgStack() / t.level().bb).toBeLessThan(20);
    const bfs = [...t.bf.values()];
    expect(bfs.length).toBe(15);
    for (const b of bfs) { expect(b).toBeGreaterThanOrEqual(1); expect(b).toBeLessThanOrEqual(10); }
    const back = Tournament.restore(t.serialize());
    expect(back.paid).toBe(10);
    expect(back.prizes).toEqual(t.prizes);
    const { rounds, maxMs } = playOut(cfg, 300);
    console.log(`SPC bubble: bubble factors ${bfs.map((b) => b.toFixed(1)).join(' ')}; ${rounds} rounds, max round ${maxMs.toFixed(0)}ms`);
  });

  it('lets satellite bubble factors go past the normal cap of 3', () => {
    // 11 left for 10 seats, ten 15bb stacks and one 1bb stack: the 15bb stacks are nearly locked,
    // so a 15bb all-in between two of them risks a seat for almost no gain.
    const bfAtSeatBubble = (key: string) => {
      const t = new Tournament({ ...PRESETS.find((p) => p.key === key)!.config, seed: 5 });
      const bb = t.level().bb;
      t.alive().slice(11).forEach((p) => { p.busted = true; p.stack = 0; });
      const left = t.alive();
      left.forEach((p, i) => { p.stack = (i === 0 ? 1 : 15) * bb; });
      (t as unknown as { computeBubbleFactors(): void }).computeBubbleFactors();
      return Math.min(...left.slice(1).map((p) => t.bf.get(p.id)!));
    };
    expect(bfAtSeatBubble('spcsatbubble')).toBeGreaterThan(5);
    expect(bfAtSeatBubble('bubble')).toBeLessThanOrEqual(3);
  });
});
