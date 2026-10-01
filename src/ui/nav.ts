import { createContext, useContext } from 'react';
import type { DrillId, LessonId } from '../analysis/leaks';
import { Tournament } from '../tournament/tournament';
import { loadActive } from './store';

export type Route =
  | { page: 'home' }
  | { page: 'play'; preset?: string }
  | { page: 'train'; drill?: DrillId }
  | { page: 'learn'; lesson?: LessonId }
  | { page: 'strategy'; tab?: string }
  | { page: 'analyze'; tab?: string; hand?: string; move?: number }
  | { page: 'tools'; tab?: string }
  | { page: 'settings' }
  | { page: 'account' };

export const NavContext = createContext<(r: Route) => void>(() => {});
export const useNav = () => useContext(NavContext);

/** The running tournament lives outside React so it survives page switches. */
let active: Tournament | null = null;
let restored = false;
export function getActiveTournament(): Tournament | null {
  if (!restored) {
    restored = true;
    const snap = loadActive();
    if (snap) {
      try { active = Tournament.restore(snap); } catch { active = null; }
    }
  }
  return active;
}
export function setActiveTournament(t: Tournament | null) {
  restored = true;
  active = t;
}
