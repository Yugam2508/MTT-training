import { useState } from 'react';
import { useData, setSettings, resetData, exportData, importData } from '../store';
import { Seg } from '../components/common';
import { useCloud } from '../../cloud/cloud';
import { useNav } from '../nav';
import { statusText } from './Account';

function AccountLine() {
  const cloud = useCloud();
  const nav = useNav();
  if (!cloud.available) return null;
  return cloud.user
    ? <p className="small">Synced to your account <strong>{cloud.user.username}</strong> · {statusText(cloud)} · <button className="btn ghost small" style={{ padding: 0 }} onClick={() => nav({ page: 'account' })}>Manage</button></p>
    : <p className="small">Not backed up to the cloud. <button className="btn ghost small" style={{ padding: 0 }} onClick={() => nav({ page: 'account' })}>Create an account</button> to keep your progress on every device.</p>;
}

export function SettingsPage() {
  const { settings, hands, decisions, results } = useData();
  const [exported, setExported] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const copy = async () => {
    const text = exportData();
    setExported(text);
    try { await navigator.clipboard.writeText(text); setMsg('Copied your data to the clipboard.'); } catch { setMsg('Select the text below and copy it.'); }
  };
  const onFile = (f: File) => {
    const r = new FileReader();
    r.onload = () => setMsg(importData(String(r.result)) ? 'Imported.' : 'That file isn’t an MTT Coach export.');
    r.readAsText(f);
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p>Settings apply to this device.</p></div></div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="panel stack">
          <h3>Table</h3>
          <label className="stack" htmlFor="set-name"><span className="label">Your name at the table</span>
            <input id="set-name" className="input" value={settings.heroName} maxLength={16} onChange={(e) => setSettings({ heroName: e.target.value })} />
          </label>
          <span className="label">Coach feedback during play</span>
          <Seg value={settings.coach} onChange={(v) => setSettings({ coach: v })} options={[{ v: 'instant', label: 'Stop on mistakes' }, { v: 'hand', label: 'After each hand' }, { v: 'off', label: 'Silent' }]} />
          <span className="label">Speed</span>
          <Seg value={settings.speed} onChange={(v) => setSettings({ speed: v })} options={[{ v: 'slow', label: 'Relaxed' }, { v: 'normal', label: 'Normal' }, { v: 'fast', label: 'Fast' }]} />
          <span className="label">Show amounts in</span>
          <Seg value={settings.units} onChange={(v) => setSettings({ units: v })} options={[{ v: 'bb', label: 'Big blinds' }, { v: 'chips', label: 'Chips' }]} />
          <label className="row" htmlFor="set-hud"><input id="set-hud" type="checkbox" checked={settings.hud} onChange={(e) => setSettings({ hud: e.target.checked })} /> HUD stats on opponents (VPIP/PFR/3-bet · hands)</label>
          <label className="row" htmlFor="set-reveal"><input id="set-reveal" type="checkbox" checked={settings.revealTypes} onChange={(e) => setSettings({ revealTypes: e.target.checked })} /> Reveal opponent types at the table (easier; turn off to practise reading players)</label>
          <label className="row" htmlFor="set-four"><input id="set-four" type="checkbox" checked={settings.fourColor} onChange={(e) => setSettings({ fourColor: e.target.checked })} /> Four-colour deck</label>
          <span className="label">Theme</span>
          <Seg value={settings.theme} onChange={(v) => setSettings({ theme: v })} options={[{ v: 'system', label: 'System' }, { v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }]} />
        </div>
        <div className="panel stack">
          <h3>Your data</h3>
          <AccountLine />
          <p className="small muted">{results.length} tournaments · {hands.length} stored hands · {decisions.length} graded decisions.</p>
          <div className="row">
            <button className="btn" onClick={copy}>Copy export</button>
            <label className="btn" htmlFor="set-import-file">Import file<input id="set-import-file" type="file" accept="application/json,.json,.txt" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
          </div>
          {exported && <textarea className="input mono" id="set-export" readOnly rows={4} value={exported} onFocus={(e) => e.currentTarget.select()} />}
          <textarea className="input mono" id="set-import" rows={3} placeholder="…or paste an export here" value={importText} onChange={(e) => setImportText(e.target.value)} />
          <div><button className="btn" disabled={!importText.trim()} onClick={() => setMsg(importData(importText) ? 'Imported.' : 'That text isn’t an MTT Coach export.')}>Import pasted data</button></div>
          {msg && <p className="small">{msg}</p>}
          {!confirmReset ? <div><button className="btn danger" onClick={() => setConfirmReset(true)}>Reset all data…</button></div> : (
            <div className="row"><span className="small">Delete all hands, results and progress?</span><button className="btn danger" onClick={() => { resetData(); setConfirmReset(false); setMsg('All data cleared.'); }}>Delete everything</button><button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button></div>
          )}
        </div>
      </div>
    </div>
  );
}
