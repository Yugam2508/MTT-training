import { Tournament, HERO_ID } from './tournament';
import { PRESETS } from './structure';
import { liveActionDelayMs, liveDealDelayMs, liveEndDelayMs, levelMinutes, fmtClock, BREAK_EVERY_LEVELS, BREAK_MINUTES } from './pace';
import { chooseBotAction } from '../bots/bot';
import { PROFILES } from '../bots/profiles';
import { makeRng } from '../engine/rng';

const spcMain = PRESETS.find((p) => p.key === 'spcmain')!.config;

describe('live pace', () => {
  it('raises the blinds by the clock and takes a break every few levels', () => {
    const t = new Tournament({ ...spcMain, pace: 'live', seed: 3 });
    expect(levelMinutes(t.cfg)).toBe(30);
    t.startRound();
    const playOut = () => { const s = t.current!; while (!s.done) { if (t.isHeroTurn()) t.heroAct(chooseBotAction(s, s.toAct, PROFILES.nit, t.botCtx(HERO_ID), t.rng)); else t.stepBot(); } t.finishRound(); };
    playOut();
    // hands alone never change the level at live pace
    for (let i = 0; i < 30; i++) { if (t.heroOut) return; t.startRound(); playOut(); }
    expect(t.levelIndex).toBe(0);
    t.tick(t.levelMs() - 1000);
    t.startRound(); playOut();
    expect(t.levelIndex).toBe(0);
    t.tick(1000);
    t.startRound();
    expect(t.levelIndex).toBe(1);
    playOut();
    // three more levels reach the break: no hands until it ends
    for (let k = 0; k < BREAK_EVERY_LEVELS - 1; k++) t.tick(t.levelMs());
    expect(t.startRound()).toBeNull();
    expect(t.onBreak()).toBe(true);
    expect(t.levelIndex).toBe(BREAK_EVERY_LEVELS);
    const levelBefore = t.levelElapsedMs;
    t.tick(BREAK_MINUTES * 60_000 - 1000);
    expect(t.startRound()).toBeNull();
    expect(t.levelElapsedMs).toBe(levelBefore); // the level clock waits during the break
    t.tick(1000);
    expect(t.startRound()).not.toBeNull();
    // the clock survives save and restore
    t.tick(5000);
    const back = Tournament.restore(t.serialize());
    expect(back.levelElapsedMs).toBe(t.levelElapsedMs);
    expect(back.playedMs).toBe(t.playedMs);
  });

  it('leaves fast-paced tournaments on hand-count levels', () => {
    const t = new Tournament({ ...spcMain, seed: 5 });
    t.tick(10 * t.levelMs());
    t.startRound();
    expect(t.levelIndex).toBe(0);
  });

  it('deals about 25-30 hands an hour, like a live table', () => {
    const r = makeRng(17);
    const rand = () => r.next();
    const t = new Tournament({ ...spcMain, pace: 'live', seed: 17 });
    let ms = 0, hands = 0;
    for (let i = 0; i < 400 && !t.heroOut && !t.finished; i++) {
      const s = t.startRound();
      if (!s) break;
      while (!s.done) {
        ms += liveActionDelayMs(s, rand);
        if (t.isHeroTurn()) t.heroAct(chooseBotAction(s, s.toAct, PROFILES.tag, t.botCtx(HERO_ID), t.rng));
        else t.stepBot();
      }
      ms += liveEndDelayMs(!!s.result?.showdown, rand) + liveDealDelayMs(rand);
      t.finishRound();
      hands++;
    }
    const perHour = hands / (ms / 3_600_000);
    console.log(`live pace: ${hands} hands, ${(ms / hands / 1000).toFixed(0)}s per hand, ${perHour.toFixed(1)} hands/hour`);
    expect(hands).toBeGreaterThan(50);
    expect(perHour).toBeGreaterThan(25);
    expect(perHour).toBeLessThan(32);
  });

  it('formats the clock', () => {
    expect(fmtClock(65_000)).toBe('1:05');
    expect(fmtClock(3_725_000)).toBe('1:02:05');
    expect(fmtClock(-5)).toBe('0:00');
  });
});
