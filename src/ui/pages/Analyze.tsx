import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { replay, STREET_NAMES } from '../../engine/hand';
import { cardsToString } from '../../engine/cards';
import { statRows, decisionLeaks, accuracyBy, overallAccuracy, counts, STAGE_ORDER, LEAKS } from '../../analysis/leaks';
import { rfiRange } from '../../theory/charts';
import { POS_LABEL, type ChartPos } from '../../theory/positions';
import { rangePercent } from '../../engine/ranges';
import { STAGE_LABEL, EVENT_LABEL, EVENT_ORDER, eventOfName, type EventType, type Stage } from '../../tournament/structure';
import { KIND_LABEL, catLabel, type Grade } from '../../coach/coach';
import { lessonById } from '../../content/lessons';
import { drillById } from '../../drills/drills';
import { PROFILES, type ProfileKey } from '../../bots/profiles';
import type { HandRecord, TournamentResult } from '../../tournament/tournament';
import type { DecisionRecord } from '../../coach/session';
import { useData, aggFromHands, type AggStats } from '../store';
import { useNav } from '../nav';
import { Felt } from '../components/Felt';
import { Cards, GradeBadge, Seg, Tile, fmtMoney, fmtPct, fmtBBs } from '../components/common';
import { BarList, GradeBar, LineChart } from '../components/charts';
import { DeliberateToggle } from '../components/Deliberate';
import { allInLuck, summarize, type AllIn, type AllInLuck } from '../../analysis/allinLuck';

type Tab = 'overview' | 'leaks' | 'mistakes' | 'hands' | 'results';

/** The records Analyze shows: everything, or one kind of event. */
interface Scope {
  hands: HandRecord[];
  decisions: DecisionRecord[];
  results: TournamentResult[];
  agg: AggStats;
  event: EventType | 'all';
  /** One row per kind of event played, for the all-events view. */
  summary: EventRow[];
  /** All-in run-outs in the stored hands shown. */
  allins: AllInLuck;
  setEvent: (e: EventType | 'all') => void;
}

interface EventRow { event: EventType; tournaments: number; itm: number; roi: number; avgFinish: number; scored: number; acc: number; bad: number; luckBB: number; allins: number }

const ScopeCtx = createContext<Scope | null>(null);
const useScope = () => useContext(ScopeCtx)!;
const EVENT_KEY = 'mtt-coach-analyze-event';

function readEvent(): EventType | 'all' {
  try {
    const v = localStorage.getItem(EVENT_KEY);
    return v && v in EVENT_LABEL ? (v as EventType) : 'all';
  } catch { return 'all'; }
}

function useEventScope(event: EventType | 'all', setEvent: (e: EventType | 'all') => void): { scope: Scope; present: EventType[] } {
  const { hands, decisions, results, agg } = useData();
  return useMemo(() => {
    // records saved before they carried an event type fall back to their tournament's name
    const byTid = new Map<string, EventType>();
    results.forEach((r) => byTid.set(r.id, r.event ?? eventOfName(r.name)));
    hands.forEach((h) => { if (h.event) byTid.set(h.tid, h.event); });
    const evOf = (x: { tid: string; event?: EventType }): EventType => x.event ?? byTid.get(x.tid) ?? 'mtt';
    const resOf = (r: TournamentResult): EventType => r.event ?? eventOfName(r.name);
    const seen = new Set<EventType>([...hands.map(evOf), ...decisions.map(evOf), ...results.map(resOf)]);
    const present = EVENT_ORDER.filter((e) => seen.has(e));
    const luckAll = allInLuck(hands);
    const tidEvent = new Map(hands.map((h) => [h.tid, evOf(h)]));
    const luckFor = (keep: (a: AllIn) => boolean): AllInLuck => summarize(luckAll.list.filter(keep));
    const summary: EventRow[] = present.map((e) => {
      const rs = results.filter((r) => resOf(r) === e);
      const ds = decisions.filter((d) => evOf(d) === e && counts(d));
      const cost = rs.reduce((a, r) => a + r.buyIn, 0);
      return {
        event: e,
        tournaments: rs.length,
        itm: rs.length ? (100 * rs.filter((r) => r.prize > 0).length) / rs.length : NaN,
        roi: cost ? (100 * rs.reduce((a, r) => a + r.prize - r.buyIn, 0)) / cost : NaN,
        avgFinish: rs.length ? (100 * rs.reduce((a, r) => a + r.place / r.entrants, 0)) / rs.length : NaN,
        scored: ds.length,
        acc: ds.length ? (100 * ds.filter((d) => d.grade === 'best' || d.grade === 'good').length) / ds.length : NaN,
        bad: ds.length ? (100 * ds.filter((d) => d.grade === 'mistake' || d.grade === 'blunder').length) / ds.length : NaN,
        ...(() => { const l = luckFor((a) => tidEvent.get(a.tid) === e); return { luckBB: l.luckBB, allins: l.count }; })(),
      };
    });
    if (event === 'all') return { scope: { hands, decisions, results, agg, event, summary, allins: luckAll, setEvent }, present };
    const h = hands.filter((x) => evOf(x) === event);
    return {
      scope: { hands: h, decisions: decisions.filter((x) => evOf(x) === event), results: results.filter((r) => resOf(r) === event), agg: aggFromHands(h), event, summary, allins: luckFor((a) => tidEvent.get(a.tid) === event), setEvent },
      present,
    };
  }, [hands, decisions, results, agg, event, setEvent]);
}

export function AnalyzePage({ tab, hand, move }: { tab?: string; hand?: string; move?: number }) {
  const nav = useNav();
  const data = useData();
  const t = (tab as Tab) ?? 'overview';
  if (hand) {
    const rec = data.hands.find((h) => h.id === hand);
    if (rec) return <HandReplay rec={rec} decisions={data.decisions.filter((d) => d.handId === hand)} startMove={move} onBack={() => nav({ page: 'analyze', tab: t })} />;
  }
  const [event, setEventState] = useState<EventType | 'all'>(readEvent);
  const setEvent = useCallback((e: EventType | 'all') => { setEventState(e); try { localStorage.setItem(EVENT_KEY, e); } catch { /* ignore */ } }, []);
  const { scope, present } = useEventScope(event, setEvent);
  const empty = data.hands.length === 0 && data.results.length === 0;
  const scopeEmpty = scope.hands.length === 0 && scope.results.length === 0 && scope.decisions.length === 0;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analyze</h1>
          <p>Your patterns across every hand you’ve played: stats against winning MTT ranges, the leaks costing you the most, and every graded decision with a replay.</p>
        </div>
        <Seg value={t} onChange={(v) => nav({ page: 'analyze', tab: v })} options={[
          { v: 'overview', label: 'Overview' }, { v: 'leaks', label: 'Leaks' }, { v: 'mistakes', label: 'Mistakes' }, { v: 'hands', label: 'Hands' }, { v: 'results', label: 'Results' },
        ]} label="Analyze sections" />
      </div>
      {!empty && (present.length > 1 || event !== 'all') && (
        <div className="row">
          <span className="label">Event type</span>
          <Seg value={event} onChange={setEvent} options={[{ v: 'all' as const, label: 'All events' }, ...EVENT_ORDER.filter((e) => present.includes(e) || e === event).map((e) => ({ v: e, label: EVENT_LABEL[e] }))]} label="Event type" />
        </div>
      )}
      {!empty && event !== 'all' && <p className="small muted">Showing {EVENT_LABEL[event]} only: {scope.results.length} tournament{scope.results.length === 1 ? '' : 's'}, {scope.hands.length} stored hands and {scope.decisions.length} graded decisions. Stats come from your stored hands (the last 700 across all events).</p>}
      {empty ? (
        <div className="empty stack">
          <p>No hands yet. Play a tournament or a scenario and your stats, leaks and mistakes will appear here.</p>
          <div><button className="btn primary" onClick={() => nav({ page: 'play' })}>Play a tournament</button></div>
        </div>
      ) : scopeEmpty ? (
        <div className="empty stack">
          <p>No {event === 'all' ? '' : EVENT_LABEL[event]} hands yet.</p>
          <div><button className="btn" onClick={() => setEvent('all')}>Show all events</button></div>
        </div>
      ) : (
        <ScopeCtx.Provider value={scope}>
          {t === 'overview' ? <Overview /> : t === 'leaks' ? <Leaks /> : t === 'mistakes' ? <Mistakes /> : t === 'hands' ? <Hands /> : <Results />}
        </ScopeCtx.Provider>
      )}
    </div>
  );
}

function EventTable() {
  const { summary, setEvent } = useScope();
  const f = (x: number, d = 0) => (Number.isFinite(x) ? `${x.toFixed(d)}%` : '–');
  return (
    <div className="panel table-wrap">
      <h3>By event type</h3>
      <table className="data">
        <thead><tr><th>Event type</th><th>Tournaments</th><th>In the money</th><th>ROI</th><th>Avg finish</th><th>Decisions</th><th>Accuracy</th><th>Mistakes + blunders</th><th>All-in luck</th></tr></thead>
        <tbody>
          {summary.map((r) => (
            <tr key={r.event} className="clickable" onClick={() => setEvent(r.event)} title={`Show ${EVENT_LABEL[r.event]} only`}>
              <td>{EVENT_LABEL[r.event]}</td>
              <td className="num">{r.tournaments}</td>
              <td className="num">{f(r.itm)}</td>
              <td className="num" style={{ color: r.roi > 0 ? 'var(--g-best)' : undefined }}>{f(r.roi)}</td>
              <td className="num">{Number.isFinite(r.avgFinish) ? `top ${r.avgFinish.toFixed(0)}%` : '–'}</td>
              <td className="num">{r.scored}</td>
              <td className="num">{f(r.acc)}</td>
              <td className="num">{f(r.bad, 1)}</td>
              <td className="num" style={{ color: r.luckBB > 0 ? 'var(--g-best)' : r.luckBB < 0 ? 'var(--g-blunder)' : undefined }}>{r.allins ? `${r.luckBB >= 0 ? '+' : '−'}${Math.abs(r.luckBB).toFixed(0)}bb` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Click a row to see that event type on its own. Scenario starts count their finish from where they began.</p>
    </div>
  );
}

/** How the cards ran when you were all-in, compared with your equity. */
function LuckPanel() {
  const { allins } = useScope();
  const nav = useNav();
  const [open, setOpen] = useState(false);
  if (!allins.count) return null;
  const sign = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;
  const fs = allins.forStack;
  const z = allins.spreadBB ? allins.luckBB / allins.spreadBB : 0;
  const verdict = Math.abs(z) < 1
    ? `Within normal swings (±${allins.spreadBB.toFixed(0)}bb is typical for this many all-ins).`
    : z > 0 ? `Above your equity by more than a normal swing (±${allins.spreadBB.toFixed(0)}bb): expect results to cool off.` : `Below your equity by more than a normal swing (±${allins.spreadBB.toFixed(0)}bb): your results understate how you played these spots.`;
  return (
    <div className="panel stack">
      <div className="spread"><h3 style={{ margin: 0 }}>All-in luck</h3><span className="small muted">{allins.count} all-ins with cards to come</span></div>
      <div className="grid cols-3">
        <Tile label="All-ins won" value={<span className="num">{allins.won} / {allins.count}</span>} sub={`your equity says ${allins.expectedWins.toFixed(1)}`} />
        <Tile label="Luck" value={<span className="num" style={{ color: allins.luckBB >= 0 ? 'var(--g-best)' : 'var(--g-blunder)' }}>{sign(allins.luckBB)}bb</span>} sub="chips won minus what your equity was worth" />
        <Tile label="For your tournament life" value={fs.count ? <span className="num">{fs.won} / {fs.count}</span> : '–'} sub={fs.count ? `survived; equity says ${fs.expectedWins.toFixed(1)}` : 'none yet'} />
      </div>
      <p className="small muted">{verdict} Luck evens out over hundreds of all-ins; your decisions are what you control.</p>
      <div><button className="btn ghost small" onClick={() => setOpen(!open)}>{open ? 'Hide all-ins' : 'Show all-ins'}</button></div>
      {open && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Hand</th><th>Street</th><th>Equity</th><th>Result</th><th>Luck</th></tr></thead>
            <tbody>
              {allins.list.slice().sort((a, b) => b.ts - a.ts).slice(0, 60).map((a) => (
                <tr key={a.id} className="clickable" onClick={() => nav({ page: 'analyze', tab: 'overview', hand: a.id })}>
                  <td className="mono">{a.cards}{a.forStack ? <span className="pill" style={{ marginLeft: 6 }}>for stack</span> : null}</td>
                  <td>{STREET_NAMES[a.street]}</td>
                  <td className="num">{Math.round(a.equity * 100)}%</td>
                  <td>{a.won ? 'Won' : 'Lost'}</td>
                  <td className="num" style={{ color: a.luckBB >= 0 ? 'var(--g-best)' : 'var(--g-blunder)' }}>{sign(a.luckBB)}bb</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Overview() {
  const { agg, decisions, results, event, summary } = useScope();
  const rows = statRows(agg.all);
  const acc = overallAccuracy(decisions);
  const grades: Partial<Record<Grade, number>> = {};
  decisions.filter(counts).forEach((d) => { grades[d.grade] = (grades[d.grade] ?? 0) + 1; });
  const deliberate = decisions.filter((d) => d.deliberate).length;
  const byStage = accuracyBy(decisions, (d) => d.stage, (k) => STAGE_LABEL[k as Stage]).sort((a, b) => STAGE_ORDER.indexOf(a.key as Stage) - STAGE_ORDER.indexOf(b.key as Stage));
  const byKind = accuracyBy(decisions, (d) => d.kind, (k) => KIND_LABEL[k as keyof typeof KIND_LABEL]).sort((a, b) => b.scored - a.scored);
  const itm = results.filter((r) => r.prize > 0).length;
  const profit = results.reduce((a, r) => a + r.prize - r.buyIn, 0);
  const buyins = results.reduce((a, r) => a + r.buyIn, 0);
  const positions: ChartPos[] = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB'];
  return (
    <>
      {event === 'all' && summary.length > 1 && <EventTable />}
      <LuckPanel />
      <div className="grid cols-4">
        <div className="panel"><Tile label="Hands" value={agg.all.hands.toLocaleString()} sub={`${fmtBBs(agg.all.netBB)} total`} /></div>
        <div className="panel"><Tile label="Decision accuracy" value={fmtPct(acc.pct)} sub={`${acc.good} of ${acc.scored} graded decisions`} /></div>
        <div className="panel"><Tile label="Tournaments" value={results.length} sub={`${results.length ? Math.round((100 * itm) / results.length) : 0}% in the money`} /></div>
        <div className="panel"><Tile label="ROI" value={buyins ? fmtPct((100 * profit) / buyins) : '–'} sub={`${fmtMoney(profit, new Set(results.map((r) => r.currency)).size === 1 ? results[0].currency : undefined)} profit`} /></div>
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="panel stack">
          <h3>Your stats vs winning MTT ranges</h3>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Stat</th><th>You</th><th>Target</th><th>Sample</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} title={r.note}>
                    <td>{r.label}</td>
                    <td className="num">{Number.isFinite(r.value) ? (r.key === 'af' ? r.value.toFixed(1) : `${r.value.toFixed(0)}%`) : '–'}</td>
                    <td className="num muted">{r.key === 'af' ? `${r.lo}–${r.hi}` : `${r.lo}–${r.hi}%`}</td>
                    <td className="num muted">{r.sample}</td>
                    <td className={`status-${r.status}`}>{r.status === 'few' ? 'need more hands' : r.status === 'ok' ? 'on target' : r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.filter((r) => r.status === 'low' || r.status === 'high').map((r) => (
            <div key={r.key} className="stripe mistake small"><strong>{r.label} {r.status}:</strong> {r.note}</div>
          ))}
        </div>
        <div className="stack">
          <div className="panel stack">
            <h3>Decision grades</h3>
            <GradeBar counts={grades} />
            {deliberate > 0 && <p className="small muted">{deliberate} deliberate play{deliberate === 1 ? '' : 's'} not counted. See Mistakes, Deliberate.</p>}
          </div>
          <div className="panel stack">
            <h3>Accuracy by stage</h3>
            {byStage.length ? <BarList rows={byStage.map((r) => ({ label: r.label, value: (100 * r.good) / r.scored, note: `${r.good}/${r.scored} good · ${r.mistakes} mistakes` }))} max={100} format={(v) => `${v.toFixed(0)}%`} /> : <p className="small muted">No graded decisions yet.</p>}
          </div>
          <div className="panel stack">
            <h3>Accuracy by spot</h3>
            {byKind.length ? <BarList rows={byKind.map((r) => ({ label: r.label, value: (100 * r.good) / r.scored, note: `${r.good}/${r.scored} good` }))} max={100} format={(v) => `${v.toFixed(0)}%`} /> : <p className="small muted">No graded decisions yet.</p>}
          </div>
        </div>
      </div>
      <div className="panel stack">
        <h3>Opening frequency by position</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Position</th><th>Chances</th><th>You open</th><th>Baseline</th><th /></tr></thead>
            <tbody>
              {positions.filter((p) => agg.rfi[p]).map((p) => {
                const e = agg.rfi[p];
                const you = (100 * e.open) / e.opp;
                const base = rangePercent(rfiRange(p));
                const diff = you - base;
                return (
                  <tr key={p}>
                    <td>{POS_LABEL[p]}</td><td className="num">{e.opp}</td><td className="num">{you.toFixed(0)}%</td><td className="num muted">{base.toFixed(0)}%</td>
                    <td className={e.opp < 10 ? 'status-few' : Math.abs(diff) > Math.max(6, base * 0.35) ? 'status-high' : 'status-ok'}>{e.opp < 10 ? 'small sample' : Math.abs(diff) > Math.max(6, base * 0.35) ? (diff > 0 ? 'too loose' : 'too tight') : 'on target'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Leaks() {
  const { decisions, agg } = useScope();
  const nav = useNav();
  const leaks = decisionLeaks(decisions);
  const statLeaks = statRows(agg.all).filter((r) => r.status === 'low' || r.status === 'high');
  if (!leaks.length && !statLeaks.length) return <div className="empty">No leaks detected yet. Keep playing: the coach needs a few dozen graded decisions to find patterns.</div>;
  return (
    <div className="stack">
      {leaks.map((l, rank) => (
        <div key={l.tag} className={`panel stack stripe ${rank < 2 ? 'blunder' : 'mistake'}`}>
          <div className="spread">
            <h3 style={{ margin: 0 }}>{l.def.title}</h3>
            <div className="row">
              <span className="pill num">{l.count}×</span>
              {l.evLoss > 0 && <span className="pill num">≈ {l.evLoss.toFixed(1)}bb lost</span>}
            </div>
          </div>
          <p className="small">{l.def.detail}</p>
          <div className="row">
            {l.def.lessons.map((id) => <button key={id} className="btn small" onClick={() => nav({ page: 'learn', lesson: id })}>Lesson: {lessonById(id)?.title}</button>)}
            {l.def.drills.map((id) => <button key={id} className="btn small primary" onClick={() => nav({ page: 'train', drill: id })}>Drill: {drillById(id)?.title}</button>)}
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">Recent examples</span>
            {l.examples.slice(0, 4).map((d) => (
              <button key={d.id} className="btn ghost small" style={{ justifyContent: 'flex-start', padding: '2px 0' }} onClick={() => nav({ page: 'analyze', tab: 'leaks', hand: d.handId, move: d.moveIndex })}>
                <GradeBadge grade={d.grade} /> {d.cards} · {d.pos} · {d.title} · {d.actionText}
              </button>
            ))}
          </div>
        </div>
      ))}
      {statLeaks.map((r) => (
        <div key={r.key} className="panel stack stripe inaccuracy">
          <div className="spread"><h3 style={{ margin: 0 }}>{r.label} is {r.status}</h3><span className="pill num">{r.key === 'af' ? r.value.toFixed(1) : `${r.value.toFixed(0)}%`} vs {r.lo}–{r.hi}</span></div>
          <p className="small">{r.note}</p>
          <div className="row">{r.lessons.map((id) => <button key={id} className="btn small" onClick={() => nav({ page: 'learn', lesson: id })}>Lesson: {lessonById(id)?.title}</button>)}</div>
        </div>
      ))}
    </div>
  );
}

function Mistakes() {
  const { decisions } = useScope();
  const nav = useNav();
  const [street, setStreet] = useState<'all' | 'pre' | 'post'>('all');
  const [sort, setSort] = useState<'recent' | 'cost'>('recent');
  const [min, setMin] = useState<'inaccuracy' | 'mistake' | 'deliberate'>('inaccuracy');
  const list = useMemo(() => {
    const sev: Record<string, number> = { inaccuracy: 1, mistake: 2, blunder: 3 };
    let l = min === 'deliberate' ? decisions.filter((d) => d.deliberate) : decisions.filter((d) => !d.deliberate && (sev[d.grade] ?? 0) >= sev[min]);
    if (street === 'pre') l = l.filter((d) => d.street === 0);
    if (street === 'post') l = l.filter((d) => d.street > 0);
    l = l.slice().sort((a, b) => (sort === 'recent' ? b.ts - a.ts : (b.evLossBB ?? sev[b.grade]) - (a.evLossBB ?? sev[a.grade])));
    return l.slice(0, 200);
  }, [decisions, street, sort, min]);
  return (
    <div className="panel stack">
      <div className="row">
        <Seg value={street} onChange={setStreet} options={[{ v: 'all', label: 'All streets' }, { v: 'pre', label: 'Preflop' }, { v: 'post', label: 'Postflop' }]} label="Street" />
        <Seg value={min} onChange={setMin} options={[{ v: 'inaccuracy', label: 'Inaccuracies +' }, { v: 'mistake', label: 'Mistakes +' }, { v: 'deliberate', label: 'Deliberate' }]} label="Severity" />
        <Seg value={sort} onChange={setSort} options={[{ v: 'recent', label: 'Most recent' }, { v: 'cost', label: 'Most costly' }]} label="Sort" />
      </div>
      {min === 'deliberate' && list.length > 0 && <DeliberateSummary list={list} />}
      {list.length === 0 ? <div className="empty">{min === 'deliberate' ? 'No deliberate plays marked. Use “I did this on purpose” on a graded decision to mark one.' : 'Nothing here. Nice.'}</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Grade</th><th>Hand</th><th>Spot</th><th>You</th><th>Best</th><th>Cost</th><th>Stage</th></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => nav({ page: 'analyze', tab: 'mistakes', hand: d.handId, move: d.moveIndex })}>
                  <td><GradeBadge grade={d.grade} /></td>
                  <td className="mono">{d.cards}<div className="small muted">{d.pos} · {d.stackBB.toFixed(0)}bb</div></td>
                  <td>{d.title}<div className="small muted">{d.summary}</div></td>
                  <td>{d.actionText}<div style={{ marginTop: 4 }}><DeliberateToggle r={d} /></div></td>
                  <td>{d.best.map(catLabel).join(' / ')}</td>
                  <td className="num">{d.evLossBB !== null ? `${d.evLossBB.toFixed(2)}bb` : '–'}</td>
                  <td className="small">{STAGE_LABEL[d.stage]}{d.icm ? ' · ICM' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** What deliberate deviations have cost, where the coach could put a number on it. */
function DeliberateSummary({ list }: { list: DecisionRecord[] }) {
  const costed = list.filter((d) => d.evLossBB !== null);
  const cost = costed.reduce((a, d) => a + (d.evLossBB ?? 0), 0);
  const folds = list.filter((d) => d.action === 'fold').length;
  return (
    <p className="small">
      <strong>{list.length}</strong> deliberate play{list.length === 1 ? '' : 's'}: {folds} fold{folds === 1 ? '' : 's'} (usually “to be safe”) and {list.length - folds} other{list.length - folds === 1 ? '' : 's'}.
      {costed.length > 0 ? ` Where the coach can price them (${costed.length}), they cost about ${cost.toFixed(1)}bb in total.` : ''} They don’t count towards accuracy or leaks, so check here whether they paid off.
    </p>
  );
}

function Hands() {
  const { hands, decisions } = useScope();
  const nav = useNav();
  const [filter, setFilter] = useState<'all' | 'big' | 'graded'>('all');
  const gradedIds = useMemo(() => new Set(decisions.filter((d) => d.grade !== 'best' && d.grade !== 'good').map((d) => d.handId)), [decisions]);
  let list = hands.slice().reverse();
  if (filter === 'big') list = list.filter((h) => Math.abs(h.heroNetBB) >= 8);
  if (filter === 'graded') list = list.filter((h) => gradedIds.has(h.id));
  return (
    <div className="panel stack">
      <Seg value={filter} onChange={setFilter} options={[{ v: 'all', label: 'All hands' }, { v: 'big', label: 'Big pots' }, { v: 'graded', label: 'With mistakes' }]} label="Hand filter" />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Hand</th><th>Cards</th><th>Pos</th><th>Stack</th><th>Result</th><th>Stage</th></tr></thead>
          <tbody>
            {list.slice(0, 250).map((h) => {
              const me = h.seats[h.heroIndex];
              const cards = [h.deck[2 * h.heroIndex], h.deck[2 * h.heroIndex + 1]];
              return (
                <tr key={h.id} className="clickable" onClick={() => nav({ page: 'analyze', tab: 'hands', hand: h.id })}>
                  <td className="num">#{h.handNo}{gradedIds.has(h.id) && <span className="grade mistake" style={{ marginLeft: 6 }}>review</span>}</td>
                  <td><Cards cards={cards} size="sm" /></td>
                  <td>{me.pos}</td>
                  <td className="num">{h.heroStartBB.toFixed(1)}bb</td>
                  <td className="num" style={{ color: h.heroNetBB > 0 ? 'var(--g-best)' : h.heroNetBB < 0 ? 'var(--g-blunder)' : undefined }}>{fmtBBs(h.heroNetBB)}</td>
                  <td className="small">{STAGE_LABEL[h.stage]} · {h.playersLeft} left</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Results() {
  const { results } = useScope();
  if (!results.length) return <div className="empty">Finish a tournament to see results here.</div>;
  const sorted = results.slice().sort((a, b) => a.ts - b.ts);
  let cum = 0;
  const series = sorted.map((r) => (cum += r.prize - r.buyIn));
  return (
    <div className="stack">
      <div className="panel">
        <h3>Cumulative profit ($)</h3>
        <LineChart values={[0, ...series]} zero ariaLabel="Cumulative profit by tournament" xLabel={(i) => (i === 0 ? 'start' : `tournament ${i}`)} format={(v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(0)}`} />
      </div>
      <div className="panel table-wrap">
        <table className="data">
          <thead><tr><th>Date</th><th>Tournament</th><th>Finish</th><th>Prize</th><th>Profit</th><th>Hands</th><th>Reached</th></tr></thead>
          <tbody>
            {sorted.slice().reverse().map((r) => (
              <tr key={r.id}>
                <td className="small">{new Date(r.ts).toLocaleDateString()}</td>
                <td>{r.name}{r.seat ? <span className="pill accent" style={{ marginLeft: 6 }}>seat</span> : null}</td>
                <td className="num">{r.place}/{r.entrants}</td>
                <td className="num">{fmtMoney(r.prize, r.currency)}</td>
                <td className="num" style={{ color: r.prize - r.buyIn > 0 ? 'var(--g-best)' : undefined }}>{fmtMoney(r.prize - r.buyIn, r.currency)}</td>
                <td className="num">{r.handsPlayed}</td>
                <td className="small">{STAGE_LABEL[r.stageReached]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function HandReplay({ rec, decisions, startMove, onBack }: { rec: HandRecord; decisions: DecisionRecord[]; startMove?: number; onBack: () => void }) {
  const { settings } = useData();
  const [step, setStep] = useState(startMove ?? rec.moves.length);
  const [reveal, setReveal] = useState(false);
  const state = useMemo(() => replay(rec, step), [rec, step]);
  const atDecision = decisions.find((d) => d.moveIndex === step);
  const next = decisions.find((d) => d.moveIndex >= step);
  const me = rec.seats[rec.heroIndex];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button className="btn ghost small" onClick={onBack} style={{ padding: 0 }}>← Back</button>
          <h1>Hand #{rec.handNo}</h1>
          <p>{me.pos} with {rec.heroStartBB.toFixed(1)}bb · blinds {rec.cfg.sb}/{rec.cfg.bb} · {STAGE_LABEL[rec.stage]} · {rec.playersLeft} of {rec.entrants} left · result {fmtBBs(rec.heroNetBB)}</p>
        </div>
        <div className="row">
          <label className="row small"><input type="checkbox" id="reveal-cards" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Show all hole cards</label>
        </div>
      </div>
      <div className="play-layout">
        <div className="stack">
          <Felt s={state} tableSize={9} heroIdx={rec.heroIndex} units={settings.units} revealAll={reveal}
            meta={(i) => ({ tag: reveal && rec.seats[i].profile !== 'hero' ? PROFILES[rec.seats[i].profile as ProfileKey]?.label : undefined })}
            message={state.done ? undefined : `${STREET_NAMES[state.street]} · ${state.toAct === rec.heroIndex ? 'your decision' : `${state.players[state.toAct]?.name ?? ''} to act`}`} />
          <div className="row">
            <button className="btn" onClick={() => setStep(0)} disabled={step === 0}>⏮ Start</button>
            <button className="btn" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>◀ Back</button>
            <button className="btn primary" onClick={() => setStep(Math.min(rec.moves.length, step + 1))} disabled={step >= rec.moves.length}>Next ▶</button>
            <button className="btn" onClick={() => setStep(rec.moves.length)} disabled={step >= rec.moves.length}>End ⏭</button>
            {next && next.moveIndex !== step && <button className="btn ghost" onClick={() => setStep(next.moveIndex)}>Jump to your graded decision</button>}
            <span className="small muted num">Action {step}/{rec.moves.length}</span>
          </div>
        </div>
        <aside className="side">
          {atDecision ? (
            <div className="panel stack">
              <div className="spread"><span className="label">{KIND_LABEL[atDecision.kind]}</span><GradeBadge grade={atDecision.grade} /></div>
              <h3 style={{ margin: 0 }}>{atDecision.title}</h3>
              <div className="small">You: <strong>{atDecision.actionText}</strong> · Best: <strong>{atDecision.best.map(catLabel).join(' / ')}</strong>{atDecision.evLossBB ? ` · cost ${atDecision.evLossBB.toFixed(2)}bb` : ''}</div>
              {atDecision.summary && <p className="small">{atDecision.summary}</p>}
              <div><DeliberateToggle r={atDecision} /></div>
              {atDecision.lines.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>{atDecision.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
              {atDecision.tags.filter((tg) => LEAKS[tg]).map((tg) => <span key={tg} className="pill">{LEAKS[tg].title}</span>)}
            </div>
          ) : (
            <div className="panel stack">
              <h3>Graded decisions in this hand</h3>
              {decisions.length === 0 ? <p className="small muted">No graded decisions (or all were best/good and stored compactly).</p> : decisions.map((d) => (
                <button key={d.id} className="btn ghost small" style={{ justifyContent: 'flex-start' }} onClick={() => setStep(d.moveIndex)}>
                  <GradeBadge grade={d.grade} /> {STREET_NAMES[d.street]}: {d.actionText}
                </button>
              ))}
            </div>
          )}
          <div className="panel stack small">
            <h3>Players</h3>
            {rec.seats.map((st, i) => (
              <div key={i} className="spread">
                <span>{st.isHero ? <strong>{st.name} (you)</strong> : st.name} <span className="muted">{st.pos}</span></span>
                <span className="num">{(st.stack / rec.cfg.bb).toFixed(1)}bb {reveal && <span className="mono">{cardsToString([rec.deck[2 * i], rec.deck[2 * i + 1]])}</span>}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
