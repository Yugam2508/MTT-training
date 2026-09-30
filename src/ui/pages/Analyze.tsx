import { useMemo, useState } from 'react';
import { replay, STREET_NAMES } from '../../engine/hand';
import { cardsToString } from '../../engine/cards';
import { statRows, decisionLeaks, accuracyBy, overallAccuracy, STAGE_ORDER, LEAKS } from '../../analysis/leaks';
import { rfiRange } from '../../theory/charts';
import { POS_LABEL, type ChartPos } from '../../theory/positions';
import { rangePercent } from '../../engine/ranges';
import { STAGE_LABEL, type Stage } from '../../tournament/structure';
import { KIND_LABEL, catLabel, type Grade } from '../../coach/coach';
import { lessonById } from '../../content/lessons';
import { drillById } from '../../drills/drills';
import { PROFILES, type ProfileKey } from '../../bots/profiles';
import type { HandRecord } from '../../tournament/tournament';
import type { DecisionRecord } from '../../coach/session';
import { useData } from '../store';
import { useNav } from '../nav';
import { Felt } from '../components/Felt';
import { Cards, GradeBadge, Seg, Tile, fmtMoney, fmtPct, fmtBBs } from '../components/common';
import { BarList, GradeBar, LineChart } from '../components/charts';

type Tab = 'overview' | 'leaks' | 'mistakes' | 'hands' | 'results';

export function AnalyzePage({ tab, hand, move }: { tab?: string; hand?: string; move?: number }) {
  const nav = useNav();
  const data = useData();
  const t = (tab as Tab) ?? 'overview';
  if (hand) {
    const rec = data.hands.find((h) => h.id === hand);
    if (rec) return <HandReplay rec={rec} decisions={data.decisions.filter((d) => d.handId === hand)} startMove={move} onBack={() => nav({ page: 'analyze', tab: t })} />;
  }
  const empty = data.hands.length === 0 && data.results.length === 0;
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
      {empty ? (
        <div className="empty stack">
          <p>No hands yet. Play a tournament or a scenario and your stats, leaks and mistakes will appear here.</p>
          <div><button className="btn primary" onClick={() => nav({ page: 'play' })}>Play a tournament</button></div>
        </div>
      ) : t === 'overview' ? <Overview /> : t === 'leaks' ? <Leaks /> : t === 'mistakes' ? <Mistakes /> : t === 'hands' ? <Hands /> : <Results />}
    </div>
  );
}

function Overview() {
  const { agg, decisions, results } = useData();
  const rows = statRows(agg.all);
  const acc = overallAccuracy(decisions);
  const grades: Partial<Record<Grade, number>> = {};
  decisions.forEach((d) => { grades[d.grade] = (grades[d.grade] ?? 0) + 1; });
  const byStage = accuracyBy(decisions, (d) => d.stage, (k) => STAGE_LABEL[k as Stage]).sort((a, b) => STAGE_ORDER.indexOf(a.key as Stage) - STAGE_ORDER.indexOf(b.key as Stage));
  const byKind = accuracyBy(decisions, (d) => d.kind, (k) => KIND_LABEL[k as keyof typeof KIND_LABEL]).sort((a, b) => b.scored - a.scored);
  const itm = results.filter((r) => r.prize > 0).length;
  const profit = results.reduce((a, r) => a + r.prize - r.buyIn, 0);
  const buyins = results.reduce((a, r) => a + r.buyIn, 0);
  const positions: ChartPos[] = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB'];
  return (
    <>
      <div className="grid cols-4">
        <div className="panel"><Tile label="Hands" value={agg.all.hands.toLocaleString()} sub={`${fmtBBs(agg.all.netBB)} total`} /></div>
        <div className="panel"><Tile label="Decision accuracy" value={fmtPct(acc.pct)} sub={`${acc.good} of ${acc.scored} graded decisions`} /></div>
        <div className="panel"><Tile label="Tournaments" value={results.length} sub={`${results.length ? Math.round((100 * itm) / results.length) : 0}% in the money`} /></div>
        <div className="panel"><Tile label="ROI" value={buyins ? fmtPct((100 * profit) / buyins) : '–'} sub={`${fmtMoney(profit)} profit`} /></div>
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
  const { decisions, agg } = useData();
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
  const { decisions } = useData();
  const nav = useNav();
  const [street, setStreet] = useState<'all' | 'pre' | 'post'>('all');
  const [sort, setSort] = useState<'recent' | 'cost'>('recent');
  const [min, setMin] = useState<'inaccuracy' | 'mistake'>('inaccuracy');
  const list = useMemo(() => {
    const sev: Record<string, number> = { inaccuracy: 1, mistake: 2, blunder: 3 };
    let l = decisions.filter((d) => (sev[d.grade] ?? 0) >= sev[min]);
    if (street === 'pre') l = l.filter((d) => d.street === 0);
    if (street === 'post') l = l.filter((d) => d.street > 0);
    l = l.slice().sort((a, b) => (sort === 'recent' ? b.ts - a.ts : (b.evLossBB ?? sev[b.grade]) - (a.evLossBB ?? sev[a.grade])));
    return l.slice(0, 200);
  }, [decisions, street, sort, min]);
  return (
    <div className="panel stack">
      <div className="row">
        <Seg value={street} onChange={setStreet} options={[{ v: 'all', label: 'All streets' }, { v: 'pre', label: 'Preflop' }, { v: 'post', label: 'Postflop' }]} label="Street" />
        <Seg value={min} onChange={setMin} options={[{ v: 'inaccuracy', label: 'Inaccuracies +' }, { v: 'mistake', label: 'Mistakes +' }]} label="Severity" />
        <Seg value={sort} onChange={setSort} options={[{ v: 'recent', label: 'Most recent' }, { v: 'cost', label: 'Most costly' }]} label="Sort" />
      </div>
      {list.length === 0 ? <div className="empty">Nothing here. Nice.</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Grade</th><th>Hand</th><th>Spot</th><th>You</th><th>Best</th><th>Cost</th><th>Stage</th></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => nav({ page: 'analyze', tab: 'mistakes', hand: d.handId, move: d.moveIndex })}>
                  <td><GradeBadge grade={d.grade} /></td>
                  <td className="mono">{d.cards}<div className="small muted">{d.pos} · {d.stackBB.toFixed(0)}bb</div></td>
                  <td>{d.title}<div className="small muted">{d.summary}</div></td>
                  <td>{d.actionText}</td>
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

function Hands() {
  const { hands, decisions } = useData();
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
  const { results } = useData();
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
                <td>{r.name}</td>
                <td className="num">{r.place}/{r.entrants}</td>
                <td className="num">{fmtMoney(r.prize)}</td>
                <td className="num" style={{ color: r.prize - r.buyIn > 0 ? 'var(--g-best)' : undefined }}>{fmtMoney(r.prize - r.buyIn)}</td>
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
