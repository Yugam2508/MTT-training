import { useState, type FormEvent } from 'react';
import { useCloud, register, signIn, signOut, syncNow, changePassword, deleteAccount, CLOUD_BUILD, type CloudState } from '../../cloud/cloud';
import { useData, STORAGE_OK } from '../store';
import { Seg } from '../components/common';

export const SITE_URL: string = import.meta.env.VITE_SITE_URL ?? '';

export function timeAgo(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function statusText(c: CloudState): string {
  switch (c.status) {
    case 'syncing': return 'Syncing…';
    case 'synced': return `Synced ${timeAgo(c.lastSyncedAt)}`;
    case 'offline': return 'Offline: will sync later';
    case 'error': return 'Sync problem';
    case 'idle': return 'Waiting to sync';
    case 'checking': return 'Connecting…';
    default: return '';
  }
}

export function AccountPage() {
  const cloud = useCloud();
  const data = useData();
  if (!CLOUD_BUILD || (!cloud.available && cloud.status !== 'checking')) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Account</h1><p>Cloud accounts save your progress across devices.</p></div></div>
        <div className="panel stack">
          <p>Cloud sync isn’t available in this copy of MTT Coach{SITE_URL ? '' : ' (the server isn’t reachable)'}.</p>
          {SITE_URL && <p>Use the website version to create an account: <a href={SITE_URL} target="_blank" rel="noreferrer">{SITE_URL.replace(/^https?:\/\//, '')}</a>. To bring your current progress, copy an export from Settings here and import it there.</p>}
          <p className="small muted">{STORAGE_OK ? 'Your progress is saved in this browser.' : 'This browser is not saving your progress (private mode or blocked storage).'}</p>
        </div>
      </div>
    );
  }
  return cloud.user ? <SignedIn cloud={cloud} /> : <SignedOut cloud={cloud} hasLocal={data.hands.length + data.results.length > 0} />;
}

function SignedOut({ cloud, hasLocal }: { cloud: CloudState; hasLocal: boolean }) {
  const [mode, setMode] = useState<'signin' | 'create'>('create');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'create' && password !== confirm) { setError('The passwords don’t match.'); return; }
    setBusy(true);
    try {
      if (mode === 'create') await register(username, password); else await signIn(username, password);
    } catch (err) {
      setError((err as Error).message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Account</h1><p>Save your stats, hand histories, graded decisions, drill streaks and lesson progress to the cloud, so they’re safe and follow you to any device.</p></div></div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <form className="panel stack" onSubmit={submit}>
          <Seg value={mode} onChange={(v) => { setMode(v); setError(null); }} options={[{ v: 'create', label: 'Create account' }, { v: 'signin', label: 'Sign in' }]} label="Account mode" />
          <label className="stack" htmlFor="acct-user"><span className="label">Username</span>
            <input id="acct-user" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={24} required />
          </label>
          <label className="stack" htmlFor="acct-pass"><span className="label">Password</span>
            <input id="acct-pass" className="input" type="password" autoComplete={mode === 'create' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          </label>
          {mode === 'create' && (
            <label className="stack" htmlFor="acct-confirm"><span className="label">Confirm password</span>
              <input id="acct-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
            </label>
          )}
          {error && <p className="small" role="alert" style={{ color: 'var(--g-blunder)' }}>{error}</p>}
          {cloud.message && !error && <p className="small">{cloud.message}</p>}
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Working…' : mode === 'create' ? 'Create account' : 'Sign in'}</button>
          <p className="small muted">{mode === 'create' ? 'Usernames are 3–24 letters, numbers, - or _. Passwords need 8+ characters.' : ''} No email is needed, which also means there’s no password reset: keep your password somewhere safe.</p>
        </form>
        <div className="panel stack">
          <h3>What gets saved</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>Tournament results and your lifetime stats</li>
            <li>Your last 700 hands and 3,000 graded decisions, with replays</li>
            <li>Drill accuracy and streaks, lessons and quiz scores</li>
          </ul>
          <p className="small">{hasLocal ? 'The progress already on this device will be added to your account.' : 'Play on any device: everything merges, nothing gets overwritten.'}</p>
          <p className="small muted">Settings (speed, units, theme) and an unfinished tournament stay on each device.</p>
        </div>
      </div>
    </div>
  );
}

function SignedIn({ cloud }: { cloud: CloudState }) {
  const [panel, setPanel] = useState<'none' | 'password' | 'delete' | 'signout'>('none');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(ok); setOldPw(''); setNewPw(''); setPanel('none'); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const user = cloud.user!;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Account</h1><p>Signed in as <strong>{user.username}</strong>. Your progress syncs automatically a few seconds after each hand, drill or lesson.</p></div></div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="panel stack">
          <div className="spread">
            <h3 style={{ margin: 0 }}>Cloud sync</h3>
            <span className={`sync-pill ${cloud.status}`}>{statusText(cloud)}</span>
          </div>
          {cloud.message && <p className="small" role="status">{cloud.message}</p>}
          <div className="row">
            <button className="btn primary" onClick={() => void syncNow()} disabled={cloud.status === 'syncing'}>Sync now</button>
          </div>
          <p className="small muted">Member since {new Date(user.createdAt).toLocaleDateString()}. Data is stored privately on the MTT Coach server and only returned to you when you’re signed in.</p>
          {msg && <p className="small" role="status">{msg}</p>}
        </div>
        <div className="panel stack">
          <h3>Manage</h3>
          <div className="row">
            <button className="btn" onClick={() => setPanel(panel === 'password' ? 'none' : 'password')}>Change password</button>
            <button className="btn" onClick={() => setPanel(panel === 'signout' ? 'none' : 'signout')}>Sign out…</button>
            <button className="btn danger" onClick={() => setPanel(panel === 'delete' ? 'none' : 'delete')}>Delete account…</button>
          </div>
          {panel === 'password' && (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(() => changePassword(oldPw, newPw), 'Password changed. Other devices will need to sign in again.'); }}>
              <label className="stack" htmlFor="pw-old"><span className="label">Current password</span><input id="pw-old" className="input" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required /></label>
              <label className="stack" htmlFor="pw-new"><span className="label">New password</span><input id="pw-new" className="input" type="password" autoComplete="new-password" minLength={8} value={newPw} onChange={(e) => setNewPw(e.target.value)} required /></label>
              <div><button className="btn primary" disabled={busy}>Save new password</button></div>
            </form>
          )}
          {panel === 'signout' && (
            <div className="stack">
              <p className="small">Your progress is safe in your account either way.</p>
              <div className="row">
                <button className="btn" disabled={busy} onClick={() => void run(() => signOut(false), 'Signed out. Your progress stays on this device too.')}>Sign out, keep data on this device</button>
                <button className="btn danger" disabled={busy} onClick={() => void run(() => signOut(true), 'Signed out and cleared this device.')}>Sign out and clear this device</button>
              </div>
            </div>
          )}
          {panel === 'delete' && (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(() => deleteAccount(oldPw), 'Account deleted.'); }}>
              <p className="small">This permanently deletes your account and everything stored in the cloud. Progress on this device is kept.</p>
              <label className="stack" htmlFor="del-pw"><span className="label">Password</span><input id="del-pw" className="input" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required /></label>
              <div><button className="btn danger" disabled={busy}>Delete my account</button></div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
