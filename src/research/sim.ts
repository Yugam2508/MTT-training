/** Headless satellites: play whole tournaments with a policy in the hero seat and count seats. */
import { makeRng } from '../engine/rng';
import { Tournament } from '../tournament/tournament';
import { PRESETS, type TournamentConfig } from '../tournament/structure';
import type { HeroPolicy } from './policies';

export interface SimRun { seed: number; seat: boolean; place: number; hands: number }

export function satelliteConfig(start: 'beginning' | 'bubble', seed: number): TournamentConfig {
  const key = start === 'bubble' ? 'spcsatbubble' : 'spcsat';
  const p = PRESETS.find((x) => x.key === key)!;
  return { ...p.config, seed, pace: 'fast', adaptive: false } as TournamentConfig;
}

/**
 * One satellite to the end (or until the hero busts). The same seed deals the same field and the
 * same cards for every policy until the hero's choices change what happens.
 */
export function runSatellite(policy: HeroPolicy, cfg: TournamentConfig): SimRun {
  const t = new Tournament(cfg);
  const rng = makeRng(cfg.seed ^ 0x9e3779b9);
  let guard = 0;
  while (!t.finished && !t.heroOut && guard++ < 5000) {
    const s = t.startRound();
    if (!s) break;
    while (!s.done) {
      t.runBots();
      if (t.isHeroTurn()) t.heroAct(policy.act(t, s, rng));
    }
    t.finishRound();
    t.history.length = 0;
  }
  const r = t.result();
  return { seed: cfg.seed, seat: !!r.seat, place: r.place, hands: r.handsPlayed };
}

export interface SimSummary { policy: string; runs: number; seats: number; rate: number; ci95: number; avgPlace: number; avgHands: number }

export function summarize(policy: string, runs: SimRun[]): SimSummary {
  const n = runs.length;
  const seats = runs.filter((r) => r.seat).length;
  const rate = seats / Math.max(1, n);
  return {
    policy, runs: n, seats, rate,
    ci95: 1.96 * Math.sqrt((rate * (1 - rate)) / Math.max(1, n)),
    avgPlace: runs.reduce((a, r) => a + r.place, 0) / Math.max(1, n),
    avgHands: runs.reduce((a, r) => a + r.hands, 0) / Math.max(1, n),
  };
}
