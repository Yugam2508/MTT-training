import { overallAccuracy, accuracyBy, decisionLeaks } from './leaks';
import type { DecisionRecord } from '../coach/session';

const d = (id: string, grade: string, extra: Partial<DecisionRecord> = {}) =>
  ({ id, tid: 't', handId: 'h', handNo: 1, moveIndex: 0, ts: 1, street: 0, kind: 'rfi', title: '', cards: '', handClass: '', pos: 'BTN', stackBB: 50, stage: 'early', icm: false, action: 'fold', actionText: 'Fold', best: ['raise'], grade, evLossBB: null, lines: [], summary: '', tags: ['open-too-tight'], ...extra }) as DecisionRecord;

describe('deliberate deviations', () => {
  it('leave accuracy and leak counts but stay in the history', () => {
    const ds = [d('a', 'best', { tags: [] }), d('b', 'best', { tags: [] }), d('c', 'mistake'), d('e', 'mistake', { deliberate: true })];
    expect(overallAccuracy(ds)).toEqual({ scored: 3, good: 2, pct: (100 * 2) / 3 });
    expect(accuracyBy(ds, (x) => x.stage, (k) => k)[0].mistakes).toBe(1);
    expect(decisionLeaks(ds)[0].count).toBe(1);
    expect(ds.filter((x) => x.deliberate)).toHaveLength(1);
  });
});
