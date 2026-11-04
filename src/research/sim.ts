/** Headless satellites: play whole tournaments with a policy in the hero seat and count seats. */
import { makeRng } from '../engine/rng';
import { toCallOf } from '../engine/hand';
import { Tournament } from '../tournament/tournament';
import { PRESETS, type TournamentConfig } from '../tournament/structure';
import type { HeroPolicy } from './policies';
import { DataTournament, type DataField } from './dataBots';

/** Where the hero's chips went, in big blinds summed over hands played before 20 were left. */
export type ChipKind = 'blinds' | 'steal' | 'preflop' | 'allinPre' | 'postflop';
export interface SimTrace {
  /** The hero's stack (bb) the first time the field was down to 50, 30 and 20 players (absent if busted before). */
  reach: Partial<Record<'50' | '30' | '20', number>>;
  /** How the hero went out: players left, street, and whether the last chips went in as a shove, a call or postflop. */
  bust?: { left: number; street: number; role: 'shove' | 'call' | 'post' };
  /** Hands played, voluntarily entered and raised preflop. */
  vpip: [number, number, number];
  chips: Record<ChipKind, number>;
  /** Late entry: players left and the field's average stack (bb) when the hero sat down. */
  entry?: { left: number; avgBB: number };
}
export interface SimRun { seed: number; seat: boolean; place: number; hands: number; trace?: SimTrace }

export function satelliteConfig(start: 'beginning' | 'bubble', seed: number): TournamentConfig {
  const key = start === 'bubble' ? 'spcsatbubble' : 'spcsat';
  const p = PRESETS.find((x) => x.key === key)!;
  return { ...p.config, seed, pace: 'fast', adaptive: false } as TournamentConfig;
}

/**
 * One satellite to the end (or until the hero busts). The same seed deals the same field and the
 * same cards for every policy until the hero's choices change what happens. With `field`, the
 * opponents are bots fitted to real players (see dataBots.ts) instead of the hand-made profiles.
 */
export function runSatellite(policy: HeroPolicy, cfg: TournamentConfig, field?: DataField): SimRun {
  const t = field ? new DataTournament(cfg, field) : new Tournament(cfg);
  const rng = makeRng(cfg.seed ^ 0x9e3779b9);
  const trace: SimTrace = { reach: {}, vpip: [0, 0, 0], chips: { blinds: 0, steal: 0, preflop: 0, allinPre: 0, postflop: 0 } };
  let guard = 0;
  // late entry: sit out until the entry level, then take a fresh starting stack (as a new entry would)
  let seated = !policy.lateLevel || policy.lateLevel <= 1;
  while (!t.finished && !t.heroOut && guard++ < 5000) {
    const left = t.alive().length;
    const bb = t.level().bb;
    if (!seated && t.levelIndex >= policy.lateLevel! - 1) {
      seated = true;
      t.hero().stack = cfg.startingStack;
      const avg = t.alive().reduce((a, p) => a + p.stack, 0) / left;
      trace.entry = { left, avgBB: avg / bb };
    }
    for (const n of [50, 30, 20] as const) if (left <= n && trace.reach[n] === undefined) trace.reach[n] = t.hero().stack / bb;
    const s = t.startRound();
    if (!s) break;
    while (!s.done) {
      t.runBots();
      if (t.isHeroTurn()) t.heroAct(seated ? policy.act(t, s, rng) : toCallOf(s) > 0 ? { type: 'fold' } : { type: 'check' });
    }
    const hi = t.heroIndex();
    const me = s.players[hi];
    const mine = s.actions.filter((a) => a.p === hi && a.type !== 'sb' && a.type !== 'bb' && a.type !== 'ante');
    const pre = mine.filter((a) => a.street === 0);
    const vol = pre.some((a) => a.type === 'call' || a.type === 'raise' || a.type === 'bet');
    trace.vpip[0]++;
    if (vol) trace.vpip[1]++;
    if (pre.some((a) => a.type === 'raise' || a.type === 'bet')) trace.vpip[2]++;
    const net = (me.stack - me.startStack) / bb;
    const allinPre = pre.some((a) => a.allIn);
    const sawFlop = !me.folded && s.board.length >= 3 && !allinPre;
    const kind: ChipKind = !vol ? 'blinds' : allinPre ? 'allinPre' : sawFlop ? 'postflop' : net > 0 && !s.result?.showdown ? 'steal' : 'preflop';
    if (left > 20) trace.chips[kind] += net;
    if (me.stack <= 0) {
      const last = mine[mine.length - 1];
      trace.bust = { left, street: last?.street ?? 0, role: !last || last.street > 0 ? 'post' : last.type === 'call' ? 'call' : 'shove' };
    }
    t.finishRound();
    t.history.length = 0;
  }
  const r = t.result();
  return { seed: cfg.seed, seat: !!r.seat, place: r.place, hands: r.handsPlayed, trace };
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
