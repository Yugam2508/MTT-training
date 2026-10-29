/**
 * Merge two copies of the synced data. Commutative and idempotent, so devices can sync
 * in any order: records are unioned by id, per-device counters keep the most advanced copy.
 */
import type { SyncDoc, DrillMap } from '../ui/store';
import { MAX_HANDS, MAX_DECISIONS } from '../ui/store';
import type { DrillId, LessonId } from '../analysis/leaks';

function unionById<T extends { id: string; ts: number; editedAt?: number }>(a: T[], b: T[], max: number): T[] {
  const m = new Map<string, T>();
  const ver = (x: T) => x.editedAt ?? x.ts;
  for (const x of [...a, ...b]) {
    const cur = m.get(x.id);
    // the most recently edited copy wins; ties go to the larger id-stable JSON so merging stays commutative
    if (!cur || ver(x) > ver(cur) || (ver(x) === ver(cur) && JSON.stringify(x) > JSON.stringify(cur))) m.set(x.id, x);
  }
  return [...m.values()].sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : 1)).slice(-max);
}

export function mergeDocs(a: SyncDoc, b: SyncDoc): SyncDoc {
  // Copies from before the newest reset contribute nothing reset by it.
  const statsResetAt = Math.max(a.statsResetAt ?? 0, b.statsResetAt ?? 0);
  const progressResetAt = Math.max(a.progressResetAt ?? 0, b.progressResetAt ?? 0);
  const statsOk = (d: SyncDoc) => (d.statsResetAt ?? 0) === statsResetAt;
  const progressOk = (d: SyncDoc) => (d.progressResetAt ?? 0) === progressResetAt;
  const recent = <T extends { ts: number }>(xs: T[]) => xs.filter((x) => x.ts >= statsResetAt);
  const aggBy = statsOk(a) ? { ...a.aggBy } : {};
  for (const [dev, agg] of Object.entries(statsOk(b) ? b.aggBy : {})) {
    const cur = aggBy[dev];
    if (!cur || agg.all.hands > cur.all.hands) aggBy[dev] = agg;
  }
  const drillsBy: Record<string, DrillMap> = progressOk(a) ? { ...a.drillsBy } : {};
  for (const [dev, map] of Object.entries(progressOk(b) ? b.drillsBy : {})) {
    const cur = drillsBy[dev] ?? {};
    const merged: DrillMap = { ...cur };
    for (const [id, p] of Object.entries(map) as [DrillId, NonNullable<DrillMap[DrillId]>][]) {
      const c = merged[id];
      if (!c || p.attempts > c.attempts || (p.attempts === c.attempts && (p.ts ?? 0) > (c.ts ?? 0))) merged[id] = p;
    }
    drillsBy[dev] = merged;
  }
  const lessons = progressOk(a) ? { ...a.lessons } : {};
  for (const [id, p] of Object.entries(progressOk(b) ? b.lessons : {}) as [LessonId, NonNullable<SyncDoc['lessons'][LessonId]>][]) {
    const c = lessons[id];
    lessons[id] = c ? { read: c.read || p.read, quizBest: Math.max(c.quizBest, p.quizBest), quizTotal: Math.max(c.quizTotal, p.quizTotal) } : p;
  }
  return {
    v: 2,
    results: unionById(recent(a.results), recent(b.results), 5000),
    hands: unionById(recent(a.hands), recent(b.hands), MAX_HANDS),
    decisions: unionById(recent(a.decisions), recent(b.decisions), MAX_DECISIONS),
    aggBy,
    drillsBy,
    lessons,
    statsResetAt,
    progressResetAt,
  };
}

/** Stable fingerprint to tell whether two docs hold the same data. */
export function docKey(d: SyncDoc): string {
  const ids = (xs: { id: string }[]) => `${xs.length}:${xs.length ? xs[0].id + xs[xs.length - 1].id : ''}`;
  const agg = Object.entries(d.aggBy).sort().map(([k, v]) => `${k}=${v.all.hands}`).join(',');
  const drills = Object.entries(d.drillsBy).sort().map(([k, m]) => `${k}=${Object.entries(m).sort().map(([i, p]) => `${i}:${p?.attempts}`).join('/')}`).join(',');
  const lessons = Object.entries(d.lessons).sort().map(([k, p]) => `${k}:${p?.read ? 1 : 0}${p?.quizBest}`).join(',');
  const edits = d.decisions.reduce((a, x) => a + (x.editedAt ?? 0) % 1e9, 0);
  return [ids(d.results), ids(d.hands), ids(d.decisions), edits, agg, drills, lessons, d.statsResetAt ?? 0, d.progressResetAt ?? 0].join('|');
}
