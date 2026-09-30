import { Tournament, HERO_ID } from '../tournament/tournament';
import { PRESETS } from '../tournament/structure';
import { chooseBotAction } from '../bots/bot';
import { PROFILES, type ProfileKey } from '../bots/profiles';
import { gradeHeroAction } from './session';

function run(heroProfile: ProfileKey, presetIdx: number, seed: number, rounds: number) {
  const t = new Tournament({ ...PRESETS[presetIdx].config, seed });
  const grades: Record<string, number> = {};
  const kinds: Record<string, number> = {};
  let maxMs = 0, n = 0;
  for (let r = 0; r < rounds && !t.heroOut && !t.finished; r++) {
    const s = t.startRound()!;
    while (!s.done) {
      if (t.isHeroTurn()) {
        const a = chooseBotAction(s, s.toAct, PROFILES[heroProfile], t.botCtx(HERO_ID), t.rng);
        const t0 = performance.now();
        const { record } = gradeHeroAction(t, a);
        maxMs = Math.max(maxMs, performance.now() - t0);
        n++;
        grades[record.grade] = (grades[record.grade] ?? 0) + 1;
        kinds[record.kind] = (kinds[record.kind] ?? 0) + 1;
        t.heroAct(a);
      } else t.stepBot();
    }
    t.finishRound();
  }
  return { grades, kinds, maxMs, n };
}

describe('coach', () => {
  it('grades a solid player mostly well and a maniac worse', () => {
    const pro = run('pro', 4, 5, 120);
    const man = run('maniac', 4, 5, 120);
    console.log('pro', pro);
    console.log('maniac', man);
    const bad = (g: Record<string, number>) => ((g.mistake ?? 0) + (g.blunder ?? 0)) / Math.max(1, Object.entries(g).filter(([k]) => k !== 'unscored').reduce((a, [, v]) => a + v, 0));
    expect(bad(pro.grades)).toBeLessThan(bad(man.grades));
    expect(pro.maxMs).toBeLessThan(3000);
  });
});
