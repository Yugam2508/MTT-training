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
  units: 'bb' | 'chips';
  fourColor: boolean;
  hud: boolean;
  revealTypes: boolean;
  theme: 'system' | 'light' | 'dark';
}

export interface DrillProgress { attempts: number; correct: number; streak: number; best: number; recent: number[] }
export interface LessonProgress { read: boolean; quizBest: number; quizTotal: number }
export interface AggStats {
  all: StatCounts;
  byStage: Partial<Record<Stage, StatCounts>>;
  rfi: Record<string, { opp: number; open: number }>;
}

export interface AppData {
  v: 1;
  settings: Settings;
  results: TournamentResult[];
  hands: HandRecord[];
  decisions: DecisionRecord[];
  agg: AggStats;
  drills: Partial<Record<DrillId, DrillProgress>>;
  lessons: Partial<Record<LessonId, LessonProgress>>;
}

const KEY = 'mttcoach.data.v1';
const ACTIVE_KEY = 'mttcoach.active.v1';
const MAX_HANDS = 700;
const MAX_DECISIONS = 3000;

export const DEFAULT_SETTINGS: Settings = {
  heroName: 'You', coach: 'instant', speed: 'normal', units: 'bb', fourColor: false, hud: true, revealTypes: false, theme: 'system',
};

function fresh(): AppData {
  return { v: 1, settings: { ...DEFAULT_SETTINGS }, results: [], hands: [], decisions: [], agg: { all: emptyCounts(), byStage: {}, rfi: {} }, drills: {}, lessons: {} };
}

function load(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const d = JSON.parse(raw) as AppData;
    if (d.v !== 1) return fresh();
    return { ...fresh(), ...d, settings: { ...DEFAULT_SETTINGS, ...d.settings } };
  } catch {
    return fresh();
  }
}

let data: AppData = load();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {
      // storage full or unavailable: trim history and retry once
      try {
        data = { ...data, hands: data.hands.slice(-200), decisions: data.decisions.slice(-1000) };
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch { /* in-memory only */ }
    }
  }, 250);
}

export function getData() { return data; }

export function update(fn: (d: AppData) => void) {
  const next = { ...data };
  fn(next);
  data = next;
  listeners.forEach((l) => l());
  save();
}

export function useData(): AppData {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => data);
}

export function setSettings(patch: Partial<Settings>) {
  update((d) => { d.settings = { ...d.settings, ...patch }; });
}

export function recordHand(rec: HandRecord, decisions: DecisionRecord[]) {
  update((d) => {
    d.hands = [...d.hands, rec].slice(-MAX_HANDS);
    if (decisions.length) d.decisions = [...d.decisions, ...decisions.map(compactDecision)].slice(-MAX_DECISIONS);
    d.agg = addFlags(d.agg, rec.flags, rec.stage);
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
    const p = d.drills[id] ?? { attempts: 0, correct: 0, streak: 0, best: 0, recent: [] };
    const streak = correct ? p.streak + 1 : 0;
    d.drills = { ...d.drills, [id]: { attempts: p.attempts + 1, correct: p.correct + (correct ? 1 : 0), streak, best: Math.max(p.best, streak), recent: [...p.recent, correct ? 1 : 0].slice(-30) } };
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

export function resetData() {
  const settings = data.settings;
  data = { ...fresh(), settings };
  try { localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
  listeners.forEach((l) => l());
  save();
}

export function exportData(): string {
  return JSON.stringify(data);
}

export function importData(json: string): boolean {
  try {
    const d = JSON.parse(json) as AppData;
    if (d.v !== 1 || !Array.isArray(d.results)) return false;
    data = { ...fresh(), ...d, settings: { ...DEFAULT_SETTINGS, ...d.settings } };
    listeners.forEach((l) => l());
    save();
    return true;
  } catch {
    return false;
  }
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
