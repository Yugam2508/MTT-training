import { useMemo, useState } from 'react';
import { parseCards, cardsToString } from '../../engine/cards';
import { parseRange, rangePercent, formatRange } from '../../engine/ranges';
import { calcEquity, type EquitySpec } from '../../engine/equity';
import { makeRng } from '../../engine/rng';
import { className } from '../../engine/combos';
import { icmEquity } from '../../theory/icm';
import { rfiRange, vsOpenRanges } from '../../theory/charts';
import { nashPush, nashCallBB, pushMaxTable } from '../../theory/pushfoldCharts';
import { POS_LABEL, type ChartPos, type PosGroup } from '../../theory/positions';
import { useNav } from '../nav';
import { RangeGrid, Seg } from '../components/common';

export function ToolsPage({ tab }: { tab?: string }) {
  const nav = useNav();
  const t = tab ?? 'ranges';
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tools</h1>
          <p>The same engines the coach uses: range charts, push/fold charts, an equity calculator and an ICM calculator.</p>
        </div>
        <Seg value={t} onChange={(v) => nav({ page: 'tools', tab: v })} options={[{ v: 'ranges', label: 'Preflop ranges' }, { v: 'pushfold', label: 'Push/fold charts' }, { v: 'equity', label: 'Equity' }, { v: 'icm', label: 'ICM' }]} label="Tool" />
      </div>
      {t === 'ranges' ? <RangesTool /> : t === 'pushfold' ? <PushFoldTool /> : t === 'equity' ? <EquityTool /> : <IcmTool />}
    </div>
  );
}

const OPEN_POS: ChartPos[] = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB'];

function RangesTool() {
  const [mode, setMode] = useState<'rfi' | 'vsopen'>('rfi');
  const [pos, setPos] = useState<ChartPos>('CO');
  const [hero, setHero] = useState<ChartPos>('BB');
  const [opener, setOpener] = useState<Exclude<PosGroup, 'BB'>>('LP');
  const r = mode === 'rfi' ? { main: rfiRange(pos), second: undefined as never, l1: `${POS_LABEL[pos]} open`, l2: undefined } : (() => {
    const v = vsOpenRanges(hero, opener);
    return { main: v.threeBet, second: v.call, l1: `3-bet (${rangePercent(v.threeBet).toFixed(0)}%)`, l2: `Call (${rangePercent(v.call).toFixed(0)}%)` };
  })();
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="panel stack">
        <Seg value={mode} onChange={setMode} options={[{ v: 'rfi', label: 'Opening (RFI)' }, { v: 'vsopen', label: 'Facing an open' }]} label="Chart type" />
        {mode === 'rfi' ? (
          <Seg value={pos} onChange={setPos} options={OPEN_POS.map((p) => ({ v: p, label: POS_LABEL[p] }))} label="Position" />
        ) : (
          <>
            <span className="label">You are in</span>
            <Seg value={hero} onChange={setHero} options={(['HJ', 'CO', 'BTN', 'SB', 'BB'] as ChartPos[]).map((p) => ({ v: p, label: POS_LABEL[p] }))} label="Hero position" />
            <span className="label">Opener is in</span>
            <Seg value={opener} onChange={setOpener} options={[{ v: 'EP', label: 'Early' }, { v: 'MP', label: 'Middle' }, { v: 'LP', label: 'CO/BTN' }, { v: 'SB', label: 'SB' }]} label="Opener position" />
          </>
        )}
        <p className="small muted">Baseline for 9-handed MTTs with a big blind ante and 25bb+ stacks. Mixed hands are shaded partially: play them some of the time.</p>
        <div className="small mono">{formatRange(r.main)}</div>
        {r.second && <div className="small mono muted">Call: {formatRange(r.second)}</div>}
      </div>
      <div className="panel"><RangeGrid range={r.main} second={r.second} labels={[mode === 'rfi' ? `${r.l1} (${rangePercent(r.main).toFixed(0)}%)` : r.l1, r.l2]} /></div>
    </div>
  );
}

function PushFoldTool() {
  const [behind, setBehind] = useState(3);
  const [stack, setStack] = useState(10);
  const [view, setView] = useState<'push' | 'call'>('push');
  const [pick, setPick] = useState<number | undefined>();
  const push = nashPush(behind, stack);
  const call = nashCallBB(behind, stack);
  const maxT = useMemo(() => pushMaxTable(behind), [behind]);
  const posName = ['SB', 'BTN', 'CO', 'HJ', 'LJ', 'UTG+2', 'UTG+1', 'UTG'][behind - 1];
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="panel stack">
        <Seg value={view} onChange={setView} options={[{ v: 'push', label: 'Shove range' }, { v: 'call', label: 'BB call range' }]} label="Chart" />
        <label className="stack" htmlFor="pf-behind"><span className="label">Shover position: {posName} ({behind} behind)</span>
          <input id="pf-behind" type="range" min={1} max={8} value={9 - behind} onChange={(e) => setBehind(9 - Number(e.target.value))} />
        </label>
        <label className="stack" htmlFor="pf-stack"><span className="label">Effective stack: {stack.toFixed(1)}bb</span>
          <input id="pf-stack" type="range" min={1} max={25} step={0.5} value={stack} onChange={(e) => setStack(Number(e.target.value))} />
        </label>
        <p className="small">{view === 'push' ? `Shove ${rangePercent(push).toFixed(1)}% of hands from the ${posName}.` : `The big blind calls ${rangePercent(call).toFixed(1)}% of hands against that shove.`}</p>
        <p className="small muted">Chip-EV Nash equilibrium, computed by this app’s solver: 9-handed, 0.5/1 blinds with a 1bb big blind ante, everyone at the same stack. Near the money, tighten calls (see ICM).</p>
        {pick !== undefined && <p className="small"><strong>{className(pick)}</strong>: {maxT[pick] > 0 ? `a shove from the ${posName} up to ${maxT[pick].toFixed(1)}bb${maxT[pick] >= 25 ? ' or more' : ''}.` : `never a shove from the ${posName} in the 1–25bb range.`}</p>}
        <p className="small muted">Click a hand to see the largest stack it shoves with.</p>
      </div>
      <div className="panel"><RangeGrid range={view === 'push' ? push : call} hero={pick} onPick={setPick} labels={[view === 'push' ? `${posName} shove at ${stack}bb` : `BB call vs ${posName} at ${stack}bb`]} /></div>
    </div>
  );
}

function EquityTool() {
  const [players, setPlayers] = useState<string[]>(['AsKs', 'QQ+, AK']);
  const [board, setBoard] = useState('');
  const [res, setRes] = useState<{ eq: number[]; exact: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = () => {
    try {
      setErr(null);
      const b = board.trim() ? parseCards(board) : [];
      const specs: EquitySpec[] = players.map((p) => {
        const clean = p.replace(/\s+/g, '');
        if (/^([2-9TJQKA][cdhs]){2}$/i.test(clean)) return { cards: parseCards(clean) as [number, number] };
        return { range: parseRange(p) };
      });
      const r = calcEquity(specs, b, 30000, makeRng(42));
      setRes({ eq: r.equity, exact: r.exact });
    } catch (e) { setErr((e as Error).message); setRes(null); }
  };
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="panel stack">
        <p className="small muted">Enter exact cards (AsKd) or a range (QQ+, AKs, A5s-A2s, KTo+). Board is optional (e.g. Ah 7c 2d).</p>
        {players.map((p, i) => (
          <div key={i} className="row">
            <label className="label" htmlFor={`eq-p${i}`} style={{ width: 70 }}>Player {i + 1}</label>
            <input id={`eq-p${i}`} className="input" style={{ flex: 1, minWidth: 0 }} value={p} onChange={(e) => setPlayers(players.map((x, j) => (j === i ? e.target.value : x)))} />
            {players.length > 2 && <button className="btn small" onClick={() => setPlayers(players.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        <div className="row">
          <label className="label" htmlFor="eq-board" style={{ width: 70 }}>Board</label>
          <input id="eq-board" className="input" style={{ flex: 1, minWidth: 0 }} value={board} onChange={(e) => setBoard(e.target.value)} placeholder="optional" />
        </div>
        <div className="row">
          {players.length < 6 && <button className="btn" onClick={() => setPlayers([...players, 'random'])}>Add player</button>}
          <button className="btn primary" onClick={run}>Calculate</button>
        </div>
        {err && <p className="small" style={{ color: 'var(--g-blunder)' }}>{err}</p>}
      </div>
      <div className="panel stack">
        <h3>Equity</h3>
        {res ? players.map((p, i) => (
          <div key={i} className="hbar"><span className="small mono" title={p}>{p.length > 14 ? p.slice(0, 14) + '…' : p}</span><div className="track"><div style={{ width: `${res.eq[i] * 100}%` }} /></div><span className="num small" style={{ textAlign: 'right' }}>{(res.eq[i] * 100).toFixed(1)}%</span></div>
        )) : <p className="small muted">Press Calculate.</p>}
        {res && <p className="small muted">{res.exact ? 'Exact enumeration.' : 'Monte Carlo, 30,000 samples (±0.5%).'}</p>}
      </div>
    </div>
  );
}

function IcmTool() {
  const [stacks, setStacks] = useState('5000, 3000, 2000');
  const [pay, setPay] = useState('50, 30, 20');
  const parsed = useMemo(() => {
    const s = stacks.split(/[,\s]+/).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
    const p = pay.split(/[,\s]+/).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
    if (s.length < 2 || !p.length || s.length > 16) return null;
    const payouts = Array.from({ length: s.length }, (_, i) => p[i] ?? 0);
    return { s, eq: icmEquity(s, payouts), total: s.reduce((a, b) => a + b, 0), pool: payouts.reduce((a, b) => a + b, 0) };
  }, [stacks, pay]);
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="panel stack">
        <label className="stack" htmlFor="icm-stacks"><span className="label">Stacks (up to 16 players)</span><input id="icm-stacks" className="input" value={stacks} onChange={(e) => setStacks(e.target.value)} /></label>
        <label className="stack" htmlFor="icm-pay"><span className="label">Payouts (1st, 2nd, …)</span><input id="icm-pay" className="input" value={pay} onChange={(e) => setPay(e.target.value)} /></label>
        <p className="small muted">Malmuth-Harville ICM, computed exactly. Compare each player’s share of the chips with their share of the prize pool.</p>
      </div>
      <div className="panel table-wrap">
        {parsed ? (
          <table className="data">
            <thead><tr><th>Player</th><th>Stack</th><th>Chip share</th><th>$ equity</th><th>Prize share</th></tr></thead>
            <tbody>{parsed.s.map((st, i) => (
              <tr key={i}><td>{i + 1}</td><td className="num">{st.toLocaleString()}</td><td className="num">{((100 * st) / parsed.total).toFixed(1)}%</td><td className="num">{parsed.eq[i].toFixed(2)}</td><td className="num">{((100 * parsed.eq[i]) / parsed.pool).toFixed(1)}%</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="small muted">Enter at least two stacks and one payout.</p>}
      </div>
    </div>
  );
}

export { cardsToString };
