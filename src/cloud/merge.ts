/**
 * Merge two copies of the synced data. Commutative and idempotent, so devices can sync
 * in any order: records are unioned by id, per-device counters keep the most advanced copy.
 */
import type { SyncDoc, DrillMap } from '../ui/store';
import { MAX_HANDS, MAX_DECISIONS } from '../ui/store';
import type { DrillId, LessonId } from '../analysis/leaks';

function unionById<T extends { id: string; ts: number }>(a: T[], b: T[], max: number): T[] {
  const m = new Map<string, T>();
  for (const x of [...a, ...b]) {
    const cur = m.get(x.id);
    if (!cur || x.ts > cur.ts) m.set(x.id, x);
  }
  return [...m.values()].sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : 1)).slice(-max);
}

export function mergeDocs(a: SyncDoc, b: SyncDoc): SyncDoc {
  const aggBy = { ...a.aggBy };
  for (const [dev, agg] of Object.entries(b.aggBy)) {
    const cur = aggBy[dev];
    if (!cur || agg.all.hands > cur.all.hands) aggBy[dev] = agg;
  }
  const drillsBy: Record<string, DrillMap> = { ...a.drillsBy };
  for (const [dev, map] of Object.entries(b.drillsBy)) {
    const cur = drillsBy[dev] ?? {};
    const merged: DrillMap = { ...cur };
    for (const [id, p] of Object.entries(map) as [DrillId, NonNullable<DrillMap[DrillId]>][]) {
      const c = merged[id];
      if (!c || p.attempts > c.attempts || (p.attempts === c.attempts && (p.ts ?? 0) > (c.ts ?? 0))) merged[id] = p;
    }
    drillsBy[dev] = merged;
  }
  const lessons = { ...a.lessons };
  for (const [id, p] of Object.entries(b.lessons) as [LessonId, NonNullable<SyncDoc['lessons'][LessonId]>][]) {
    const c = lessons[id];
    lessons[id] = c ? { read: c.read || p.read, quizBest: Math.max(c.quizBest, p.quizBest), quizTotal: Math.max(c.quizTotal, p.quizTotal) } : p;
  }
  return {
    v: 2,
    results: unionById(a.results, b.results, 5000),
    hands: unionById(a.hands, b.hands, MAX_HANDS),
    decisions: unionById(a.decisions, b.decisions, MAX_DECISIONS),
    aggBy,
    drillsBy,
    lessons,
  };
}

/** Stable fingerprint to tell whether two docs hold the same data. */
export function docKey(d: SyncDoc): string {
  const ids = (xs: { id: string }[]) => `${xs.length}:${xs.length ? xs[0].id + xs[xs.length - 1].id : ''}`;
  const agg = Object.entries(d.aggBy).sort().map(([k, v]) => `${k}=${v.all.hands}`).join(',');
  const drills = Object.entries(d.drillsBy).sort().map(([k, m]) => `${k}=${Object.entries(m).sort().map(([i, p]) => `${i}:${p?.attempts}`).join('/')}`).join(',');
  const lessons = Object.entries(d.lessons).sort().map(([k, p]) => `${k}:${p?.read ? 1 : 0}${p?.quizBest}`).join(',');
  return [ids(d.results), ids(d.hands), ids(d.decisions), agg, drills, lessons].join('|');
}
