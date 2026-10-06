/** The SPC XXIII registration watcher's status (Supabase function spc-watch), for the banner and the Home card. */
import { useEffect, useState } from 'react';
import { CLOUD_BUILD } from './cloud';

export type SpcStatus = 'waiting' | 'changed' | 'open';
export interface SpcWatch {
  status: SpcStatus | 'unknown';
  checkedAt?: string;
  lastAlert?: { status: Exclude<SpcStatus, 'waiting'>; at: string } | null;
  site?: string;
}

export const SPC_SITE = 'https://www.sgpokerchamps.com';
const URL = import.meta.env.VITE_SPC_WATCH_URL
  || (import.meta.env.DEV ? '' : 'https://tyjicebieaojrtedjpnx.supabase.co/functions/v1/spc-watch?forceFunctionRegion=us-east-1&a=status');
const ALERT_DAYS = 3;

let request: Promise<SpcWatch | null> | null = null;

function load(): Promise<SpcWatch | null> {
  if (!CLOUD_BUILD || !URL) return Promise.resolve(null);
  request ??= fetch(URL, { cache: 'no-store' }).then((r) => (r.ok ? (r.json() as Promise<SpcWatch>) : null)).catch(() => null);
  return request;
}

export function useSpcWatch(): SpcWatch | null {
  const [w, setW] = useState<SpcWatch | null>(null);
  useEffect(() => {
    let live = true;
    load().then((v) => { if (live) setW(v); });
    return () => { live = false; };
  }, []);
  return w;
}

/** What the banner should say: registration open now, or the site changed in the last few days. */
export function spcAlert(w: SpcWatch | null): SpcStatus | null {
  if (!w) return null;
  if (w.status === 'open') return 'open';
  const a = w.lastAlert;
  if (a && Date.now() - new Date(a.at).getTime() < ALERT_DAYS * 86400_000) return a.status;
  return null;
}
