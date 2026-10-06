/**
 * App data persisted in localStorage (per browser). Everything is wrapped in try/catch:
 * storage may be unavailable (private windows, previews); the app then works in memory.
 */
import { useSyncExternalStore } from 'react';
import type { HandRecord, TournamentResult, TournamentSnapshot } from '../tournament/tournament';
import type { DecisionRecord } from '../coach/session';
import { type StatCounts, emptyCounts, accumulate, type HandFlags } from '../analysis/handFlags';
import type { DrillId, LessonId } from '../analysis/leaks';
import type { Stage } from '../tournament/structure';

export interface Settings {
  heroName: string;
  coach: 'instant' | 'hand' | 'off';
  speed: 'slow' | 'normal' | 'fast';
  /** Tournament pace: blinds by hands and folded hands skipped, or live (real-time) pace. */
  pace: 'fast' | 'live';
  units: 'bb' | 'chips';
  fourColor: boolean;
  hud: boolean;
  revealTypes: boolean;
  theme: 'system' | 'light' | 'dark';
}

export interface DrillProgress { attempts: number; correct: number; streak: number; best: number; recent: number[]; ts?: number }
export interface LessonProgress { read: boolean; quizBest: number; quizTotal: number }
export interface AggStats {
  all: StatCounts;
  byStage: Partial<Record<Stage, StatCounts>>;
  rfi: Record<string, { opp: number; open: number }>;
}

export type DrillMap = Partial<Record<DrillId, DrillProgress>>;

/** The part of the data that syncs to the cloud. Counters are kept per device so merges never double-count. */
export interface SyncDoc {
  v: 2;
  results: TournamentResult[];
  hands: HandRecord[];
  decisions: DecisionRecord[];
  aggBy: Record<string, AggStats>;
  drillsBy: Record<string, DrillMap>;
  lessons: Partial<Record<LessonId, LessonProgress>>;
}

export interface AppData extends SyncDoc {
  /** Account id this data belongs to (null = not linked to an account). */
  owner: string | null;
  /** Bumped on every change to synced data. */
  rev: number;
  settings: Settings;
  /** Derived totals across devices (recomputed, not edited directly). */
  agg: AggStats;
  drills: DrillMap;
}

const KEY = 'mttcoach.data.v1';
const ACTIVE_KEY = 'mttcoach.active.v1';
const DEVICE_KEY = 'mttcoach.device.v1';
export const MAX_HANDS = 700;
export const MAX_DECISIONS = 3000;

function makeDeviceId(): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = `d${Date.now().toString(36)}${rand()}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return `d${Date.now().toString(36)}${rand()}`;
  }
}
export const DEVICE_ID = makeDeviceId();

/** True when the browser actually persists data (false in some private modes or when blocked). */
export const STORAGE_OK = (() => {
  try {
    localStorage.setItem('mttcoach.probe', '1');
    localStorage.removeItem('mttcoach.probe');
    return true;
  } catch {
    return false;
  }
})();

export const DEFAULT_SETTINGS: Settings = {
  heroName: 'You', coach: 'instant', speed: 'normal', pace: 'fast', units: 'bb', fourColor: false, hud: true, revealTypes: false, theme: 'system',
};

export const emptyAgg = (): AggStats => ({ all: emptyCounts(), byStage: {}, rfi: {} });

function fresh(): AppData {
  return {
    v: 2, owner: null, rev: 0, settings: { ...DEFAULT_SETTINGS }, results: [], hands: [], decisions: [],
    aggBy: {}, drillsBy: {}, lessons: {}, agg: emptyAgg(), drills: {},
  };
}

function addCounts(a: StatCounts, b: StatCounts): StatCounts {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof StatCounts)[]) out[k] = (a[k] ?? 0) + (b[k] ?? 0);
  return out;
}

export function sumAgg(aggBy: Record<string, AggStats>): AggStats {
  let total = emptyAgg();
  for (const a of Object.values(aggBy)) {
    const byStage = { ...total.byStage };
    for (const [st, c] of Object.entries(a.byStage) as [Stage, StatCounts][]) byStage[st] = addCounts(byStage[st] ?? emptyCounts(), c);
    const rfi = { ...total.rfi };
    for (const [pos, e] of Object.entries(a.rfi)) rfi[pos] = { opp: (rfi[pos]?.opp ?? 0) + e.opp, open: (rfi[pos]?.open ?? 0) + e.open };
    total = { all: addCounts(total.all, a.all), byStage, rfi };
  }
  return total;
}

export function combineDrills(drillsBy: Record<string, DrillMap>): DrillMap {
  const out: DrillMap = {};
  for (const m of Object.values(drillsBy)) {
    for (const [id, p] of Object.entries(m) as [DrillId, DrillProgress][]) {
      const cur = out[id];
      if (!cur) { out[id] = { ...p }; continue; }
      const newer = (p.ts ?? 0) > (cur.ts ?? 0) ? p : cur;
      out[id] = { attempts: cur.attempts + p.attempts, correct: cur.correct + p.correct, best: Math.max(cur.best, p.best), streak: newer.streak, recent: newer.recent, ts: newer.ts };
    }
  }
  return out;
}

/** Recompute the derived totals. */
export function derive(d: AppData): AppData {
  d.agg = sumAgg(d.aggBy);
  d.drills = combineDrills(d.drillsBy);
  return d;
}

function load(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const d = JSON.parse(raw) as Omit<AppData, 'v'> & { v: number; agg?: AggStats; drills?: DrillMap };
    if (d.v === 1) {
      // migrate: the old totals become this device's counters
      return derive({ ...fresh(), ...d, v: 2, owner: null, rev: 1, aggBy: d.agg ? { [DEVICE_ID]: d.agg } : {}, drillsBy: d.drills ? { [DEVICE_ID]: d.drills } : {}, settings: { ...DEFAULT_SETTINGS, ...d.settings } });
    }
    if (d.v !== 2) return fresh();
    return derive({ ...fresh(), ...d, v: 2, settings: { ...DEFAULT_SETTINGS, ...d.settings } });
  } catch {
    return fresh();
  }
}

/** Extract the synced portion. */
export function toSyncDoc(d: AppData): SyncDoc {
  return { v: 2, results: d.results, hands: d.hands, decisions: d.decisions, aggBy: d.aggBy, drillsBy: d.drillsBy, lessons: d.lessons };
}

let data: AppData = load();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { agg: _a, drills: _d, ...persisted } = data;
    void _a; void _d;
    try { localStorage.setItem(KEY, JSON.stringify(persisted)); } catch {
      // storage full or unavailable: trim history and retry once
      try {
        data = { ...data, hands: data.hands.slice(-200), decisions: data.decisions.slice(-1000) };
        const { agg: _a2, drills: _d2, ...trimmed } = data;
        void _a2; void _d2;
        localStorage.setItem(KEY, JSON.stringify(trimmed));
      } catch { /* in-memory only */ }
    }
  }, 250);
}

export function getData() { return data; }

export function update(fn: (d: AppData) => void, opts: { synced?: boolean } = { synced: true }) {
  const next = { ...data };
  fn(next);
  if (opts.synced !== false) next.rev = data.rev + 1;
  data = next;
  listeners.forEach((l) => l());
  save();
}

/** Subscribe to any data change (used by cloud sync). */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useData(): AppData {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => data);
}

export function setSettings(patch: Partial<Settings>) {
  update((d) => { d.settings = { ...d.settings, ...patch }; }, { synced: false });
}

export function recordHand(rec: HandRecord, decisions: DecisionRecord[]) {
  update((d) => {
    d.hands = [...d.hands, rec].slice(-MAX_HANDS);
    if (decisions.length) d.decisions = [...d.decisions, ...decisions.map(compactDecision)].slice(-MAX_DECISIONS);
    d.aggBy = { ...d.aggBy, [DEVICE_ID]: addFlags(d.aggBy[DEVICE_ID] ?? emptyAgg(), rec.flags, rec.stage) };
    derive(d);
  });
}

/** Keep full explanations only for the decisions worth reviewing. */
function compactDecision(r: DecisionRecord): DecisionRecord {
  if (r.grade === 'best' || r.grade === 'good') return { ...r, lines: [] };
  return r;
}

function addFlags(agg: AggStats, f: HandFlags, stage: Stage): AggStats {
  const all = { ...agg.all };
  accumulate(all, f);
  const st = { ...(agg.byStage[stage] ?? emptyCounts()) };
  accumulate(st, f);
  const rfi = { ...agg.rfi };
  if (f.rfiOpp) {
    const e = rfi[f.pos] ?? { opp: 0, open: 0 };
    rfi[f.pos] = { opp: e.opp + 1, open: e.open + (f.rfi ? 1 : 0) };
  }
  return { all, byStage: { ...agg.byStage, [stage]: st }, rfi };
}

export function recordResult(r: TournamentResult) {
  update((d) => { d.results = [...d.results.filter((x) => x.id !== r.id), r]; });
}

export function recordDrill(id: DrillId, correct: boolean) {
  update((d) => {
    const mine = d.drillsBy[DEVICE_ID] ?? {};
    const p = mine[id] ?? { attempts: 0, correct: 0, streak: 0, best: 0, recent: [] };
    const shared = d.drills[id];
    // streak and recent history continue from the most recent device
    const baseStreak = shared && (shared.ts ?? 0) > (p.ts ?? 0) ? shared.streak : p.streak;
    const baseRecent = shared && (shared.ts ?? 0) > (p.ts ?? 0) ? shared.recent : p.recent;
    const streak = correct ? baseStreak + 1 : 0;
    const next: DrillProgress = { attempts: p.attempts + 1, correct: p.correct + (correct ? 1 : 0), streak, best: Math.max(p.best, streak), recent: [...baseRecent, correct ? 1 : 0].slice(-30), ts: Date.now() };
    d.drillsBy = { ...d.drillsBy, [DEVICE_ID]: { ...mine, [id]: next } };
    derive(d);
  });
}

export function recordLesson(id: LessonId, patch: Partial<LessonProgress>) {
  update((d) => {
    const p = d.lessons[id] ?? { read: false, quizBest: 0, quizTotal: 0 };
    const next = { ...p, ...patch };
    if (patch.quizBest !== undefined) next.quizBest = Math.max(p.quizBest, patch.quizBest);
    d.lessons = { ...d.lessons, [id]: next };
  });
}

export function resetData(owner: string | null = null) {
  const settings = data.settings;
  data = { ...fresh(), settings, owner, rev: data.rev + 1 };
  try { localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
  listeners.forEach((l) => l());
  save();
}

export function exportData(): string {
  const { agg: _a, drills: _d, ...persisted } = data;
  void _a; void _d;
  return JSON.stringify(persisted);
}

export function importData(json: string): boolean {
  try {
    const d = JSON.parse(json) as Omit<AppData, 'v'> & { v: number; agg?: AggStats; drills?: DrillMap };
    if (!Array.isArray(d.results)) return false;
    let next: AppData;
    if (d.v === 1) next = { ...fresh(), ...d, v: 2, aggBy: d.agg ? { [`import-${Date.now().toString(36)}`]: d.agg } : {}, drillsBy: d.drills ? { [`import-${Date.now().toString(36)}`]: d.drills } : {} } as AppData;
    else if (d.v === 2) next = { ...fresh(), ...d, v: 2 } as AppData;
    else return false;
    data = derive({ ...next, owner: data.owner, rev: data.rev + 1, settings: { ...DEFAULT_SETTINGS, ...d.settings } });
    listeners.forEach((l) => l());
    save();
    return true;
  } catch {
    return false;
  }
}

/** Replace the synced portion with a merged document (from cloud sync). */
export function applySyncDoc(doc: SyncDoc, owner: string | null) {
  update((d) => {
    d.results = doc.results; d.hands = doc.hands; d.decisions = doc.decisions;
    d.aggBy = doc.aggBy; d.drillsBy = doc.drillsBy; d.lessons = doc.lessons;
    d.owner = owner;
    derive(d);
  }, { synced: false });
}

export function setOwner(owner: string | null) {
  update((d) => { d.owner = owner; }, { synced: false });
}

// ---------- active tournament ----------
let activeTimer: ReturnType<typeof setTimeout> | null = null;
export function saveActive(snapshot: () => TournamentSnapshot | null) {
  if (activeTimer) clearTimeout(activeTimer);
  activeTimer = setTimeout(() => {
    try {
      const snap = snapshot();
      if (snap) localStorage.setItem(ACTIVE_KEY, JSON.stringify(snap));
      else localStorage.removeItem(ACTIVE_KEY);
    } catch { /* ignore */ }
  }, 400);
}

export function loadActive(): TournamentSnapshot | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    return raw ? (JSON.parse(raw) as TournamentSnapshot) : null;
  } catch {
    return null;
  }
}

export function clearActive() {
  if (activeTimer) clearTimeout(activeTimer);
  try { localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
}
