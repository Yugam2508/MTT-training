import { DRILLS } from './drills';
import { makeRng } from '../engine/rng';

describe('drills', () => {
  it('every drill generates valid questions', () => {
    const rng = makeRng(8);
    for (const d of DRILLS) {
      for (let i = 0; i < 30; i++) {
        const q = d.make(rng);
        expect(q.options.length).toBeGreaterThanOrEqual(2);
        expect(q.correct.length).toBeGreaterThanOrEqual(1);
        for (const c of q.correct) expect(q.options.map((o) => o.key)).toContain(c);
        expect(q.explain.length).toBeGreaterThan(0);
        expect(new Set(q.heroCards).size).toBe(2);
      }
    }
  });
  it('ICM drill shows a risk premium on the bubble', () => {
    const rng = makeRng(3);
    let premiums = 0, n = 0;
    for (let i = 0; i < 40; i++) {
      const q = DRILLS.find((d) => d.id === 'icm')!.make(rng);
      const chip = parseFloat(q.facts[2].value), icm = parseFloat(q.facts[3].value);
      if (icm > chip) premiums++;
      n++;
    }
    expect(premiums / n).toBeGreaterThan(0.8);
  });
});
