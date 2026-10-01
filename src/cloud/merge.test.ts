import { mergeDocs, docKey } from './merge';
import type { SyncDoc } from '../ui/store';
import { emptyCounts } from '../analysis/handFlags';

const agg = (hands: number) => ({ all: { ...emptyCounts(), hands, vpip: hands }, byStage: {}, rfi: {} });
const doc = (p: Partial<SyncDoc>): SyncDoc => ({ v: 2, results: [], hands: [], decisions: [], aggBy: {}, drillsBy: {}, lessons: {}, ...p });
const hand = (id: string, ts: number) => ({ id, ts } as never);

describe('merge', () => {
  it('unions records and keeps the most advanced per-device counters', () => {
    const a = doc({ hands: [hand('h1', 1), hand('h2', 2)], aggBy: { A: agg(10), B: agg(3) }, drillsBy: { A: { pushfold: { attempts: 5, correct: 4, streak: 2, best: 3, recent: [1], ts: 5 } } }, lessons: { icm: { read: true, quizBest: 2, quizTotal: 4 } } });
    const b = doc({ hands: [hand('h2', 2), hand('h3', 3)], aggBy: { A: agg(7), B: agg(5), C: agg(1) }, drillsBy: { A: { pushfold: { attempts: 3, correct: 3, streak: 3, best: 3, recent: [1], ts: 3 } } }, lessons: { icm: { read: false, quizBest: 4, quizTotal: 4 } } });
    const m = mergeDocs(a, b);
    expect(m.hands.map((h) => h.id)).toEqual(['h1', 'h2', 'h3']);
    expect(m.aggBy.A.all.hands).toBe(10);
    expect(m.aggBy.B.all.hands).toBe(5);
    expect(m.aggBy.C.all.hands).toBe(1);
    expect(m.drillsBy.A.pushfold!.attempts).toBe(5);
    expect(m.lessons.icm).toEqual({ read: true, quizBest: 4, quizTotal: 4 });
  });
  it('is commutative and idempotent', () => {
    const a = doc({ hands: [hand('h1', 1)], aggBy: { A: agg(2) } });
    const b = doc({ hands: [hand('h2', 2)], aggBy: { B: agg(4) } });
    expect(docKey(mergeDocs(a, b))).toBe(docKey(mergeDocs(b, a)));
    const m = mergeDocs(a, b);
    expect(docKey(mergeDocs(m, m))).toBe(docKey(m));
    expect(docKey(mergeDocs(m, a))).toBe(docKey(m));
  });
});
