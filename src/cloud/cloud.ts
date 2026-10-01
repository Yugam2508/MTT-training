/**
 * Accounts and background sync with the MTT Coach API (a Supabase Edge Function).
 * Local storage stays the working copy; sync pulls, merges, and pushes with ETag checks.
 */
import { useSyncExternalStore } from 'react';
import { getData, toSyncDoc, applySyncDoc, setOwner, resetData, subscribe as subscribeData, type SyncDoc } from '../ui/store';
import { mergeDocs, docKey } from './merge';

export interface CloudUser { id: string; username: string; createdAt: number }
export type CloudStatus = 'unavailable' | 'checking' | 'signed-out' | 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface CloudState {
  available: boolean;
  user: CloudUser | null;
  status: CloudStatus;
  lastSyncedAt: number | null;
  message: string | null;
}

const AUTH_KEY = 'mttcoach.auth.v1';
const META_KEY = 'mttcoach.sync.v1';
/** The Supabase Edge Function in production builds; the Vite server's local copy in development. */
const API: string = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '/api/main' : 'https://tyjicebieaojrtedjpnx.supabase.co/functions/v1/mtt-api');
export const CLOUD_BUILD = import.meta.env.VITE_CLOUD !== 'off';

interface Meta { etag: string | null; syncedRev: number; lastSyncedAt: number | null }

function readJSON<T>(key: string): T | null {
  try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : null; } catch { return null; }
}
function writeJSON(key: string, v: unknown) {
  try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}

let auth = readJSON<{ token: string; user: CloudUser }>(AUTH_KEY);
let meta: Meta = readJSON<Meta>(META_KEY) ?? { etag: null, syncedRev: -1, lastSyncedAt: null };
let state: CloudState = {
  available: false,
  user: auth?.user ?? null,
  status: CLOUD_BUILD ? 'checking' : 'unavailable',
  lastSyncedAt: meta.lastSyncedAt,
  message: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<CloudState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function saveMeta(patch: Partial<Meta>) {
  meta = { ...meta, ...patch };
  writeJSON(META_KEY, meta);
}

export function useCloud(): CloudState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function api(action: string, init: RequestInit = {}, withAuth = true): Promise<Response> {
  const headers = new Headers(init.headers);
  if (withAuth && auth) headers.set('authorization', `Bearer ${auth.token}`);
  return fetch(`${API}?a=${action}`, { ...init, headers, cache: 'no-store' });
}

async function apiJSON<T>(action: string, init: RequestInit = {}, withAuth = true): Promise<T> {
  const r = await api(action, init, withAuth);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, body.error ?? 'error', body.message ?? `Request failed (${r.status})`);
  return body as T;
}

// ---------- compression ----------
async function encode(doc: SyncDoc): Promise<{ bytes: Uint8Array; encoding: 'gzip' | 'identity' }> {
  const text = JSON.stringify(doc);
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), encoding: 'gzip' };
  }
  return { bytes: new TextEncoder().encode(text), encoding: 'identity' };
}

async function decode(r: Response): Promise<SyncDoc> {
  const buf = await r.arrayBuffer();
  let text: string;
  if (r.headers.get('x-data-encoding') === 'gzip') {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else text = new TextDecoder().decode(buf);
  const d = JSON.parse(text) as SyncDoc;
  if (d.v !== 2) throw new Error('Unsupported cloud data version');
  return d;
}

// ---------- sync ----------
let running = false;
let pending = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let firstDirtyAt = 0;

export async function syncNow(): Promise<void> {
  if (!auth || !state.available) return;
  if (running) { pending = true; return; }
  running = true;
  set({ status: 'syncing', message: null });
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const startRev = getData().rev;
      const owner = auth.user.id;
      const r = await api('data', { headers: meta.etag ? { 'if-none-match': meta.etag } : {} });
      if (r.status === 401) { await expireSession(); return; }
      let remote: SyncDoc | null = null;
      let remoteEtag: string | null = null;
      if (r.status === 200) { remote = await decode(r); remoteEtag = r.headers.get('etag'); }
      else if (r.status === 304) { remoteEtag = meta.etag; }
      else if (r.status !== 204) throw new ApiError(r.status, 'error', `Sync failed (${r.status})`);

      const local = toSyncDoc(getData());
      const merged = remote ? mergeDocs(local, remote) : local;
      if (remote && docKey(merged) !== docKey(local)) {
        // apply the merge on top of anything that changed while we were waiting
        applySyncDoc(mergeDocs(toSyncDoc(getData()), remote), owner);
      }
      const localChanged = startRev !== meta.syncedRev || r.status === 204;
      const needPut = r.status === 204 || (remote ? docKey(merged) !== docKey(remote) : localChanged);
      if (needPut) {
        const { bytes, encoding } = await encode(r.status === 304 ? toSyncDoc(getData()) : merged);
        const headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'x-data-encoding': encoding };
        if (r.status === 204) headers['if-none-match'] = '*';
        else if (remoteEtag) headers['if-match'] = remoteEtag;
        const put = await api('data', { method: 'PUT', body: bytes, headers });
        if (put.status === 412) { saveMeta({ etag: null }); continue; }
        if (put.status === 401) { await expireSession(); return; }
        if (!put.ok) {
          const b = await put.json().catch(() => ({}));
          throw new ApiError(put.status, b.error ?? 'error', b.message ?? `Sync failed (${put.status})`);
        }
        const { etag } = (await put.json()) as { etag: string };
        saveMeta({ etag });
      } else if (remoteEtag) saveMeta({ etag: remoteEtag });
      const now = Date.now();
      saveMeta({ syncedRev: startRev, lastSyncedAt: now });
      if (getData().rev !== startRev) pending = true;
      set({ status: 'synced', lastSyncedAt: now, message: null });
      return;
    }
    throw new Error('Too many conflicting changes. Try again.');
  } catch (e) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    set({ status: offline ? 'offline' : 'error', message: offline ? 'You’re offline. Changes will sync when you reconnect.' : (e as Error).message });
  } finally {
    running = false;
    if (pending) { pending = false; schedule(1500); }
  }
}

function schedule(delay = 8000) {
  if (!auth || !state.available) return;
  const now = Date.now();
  if (!firstDirtyAt) firstDirtyAt = now;
  const wait = Math.max(500, Math.min(delay, firstDirtyAt + 45000 - now));
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; firstDirtyAt = 0; void syncNow(); }, wait);
}

async function expireSession() {
  auth = null;
  writeJSON(AUTH_KEY, null);
  set({ user: null, status: 'signed-out', message: 'Your session ended. Sign in again to keep syncing.' });
}

async function startSession(session: { token: string; user: CloudUser }) {
  const d = getData();
  if (d.owner && d.owner !== session.user.id) {
    // this device holds another account's progress; that progress is already in its own account
    resetData(session.user.id);
  } else setOwner(session.user.id);
  auth = session;
  writeJSON(AUTH_KEY, session);
  saveMeta({ etag: null, syncedRev: -1 });
  set({ user: session.user, status: 'idle', message: null });
  await syncNow();
}

export async function register(username: string, password: string) {
  const s = await apiJSON<{ token: string; user: CloudUser }>('register', { method: 'POST', body: JSON.stringify({ username, password }) }, false);
  await startSession(s);
}

export async function signIn(username: string, password: string) {
  const s = await apiJSON<{ token: string; user: CloudUser }>('login', { method: 'POST', body: JSON.stringify({ username, password }) }, false);
  await startSession(s);
}

export async function signOut(clearDevice: boolean) {
  if (auth && !clearDevice) await syncNow().catch(() => {});
  auth = null;
  writeJSON(AUTH_KEY, null);
  saveMeta({ etag: null, syncedRev: -1, lastSyncedAt: null });
  if (clearDevice) resetData(null);
  set({ user: null, status: 'signed-out', lastSyncedAt: null, message: null });
}

export async function changePassword(oldPassword: string, newPassword: string) {
  const s = await apiJSON<{ token: string; user: CloudUser }>('password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) });
  auth = s;
  writeJSON(AUTH_KEY, s);
}

export async function deleteAccount(password: string) {
  await apiJSON('account', { method: 'DELETE', body: JSON.stringify({ password }) });
  auth = null;
  writeJSON(AUTH_KEY, null);
  saveMeta({ etag: null, syncedRev: -1, lastSyncedAt: null });
  setOwner(null);
  set({ user: null, status: 'signed-out', lastSyncedAt: null, message: 'Your account and cloud data were deleted. Progress on this device was kept.' });
}

export { ApiError };

/** Start-up: check the API, then sync and keep syncing on changes. */
export async function initCloud() {
  if (!CLOUD_BUILD) return;
  try {
    const r = await fetch(`${API}?a=health`, { cache: 'no-store' });
    const ok = r.ok && (await r.json().catch(() => ({}))).ok === true;
    if (!ok) throw new Error('no api');
  } catch {
    set({ available: false, status: 'unavailable' });
    return;
  }
  set({ available: true, status: auth ? 'idle' : 'signed-out' });
  subscribeData(() => { if (auth && getData().rev !== meta.syncedRev) schedule(); });
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && auth && getData().rev !== meta.syncedRev) void syncNow(); });
  if (auth) void syncNow();
}
