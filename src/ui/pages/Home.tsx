import { useMemo } from 'react';
import { PRESETS } from '../../tournament/structure';
import { decisionLeaks, overallAccuracy, statRows } from '../../analysis/leaks';
import { LESSONS, lessonById } from '../../content/lessons';
import { DRILLS, drillById } from '../../drills/drills';
import { ordinal } from '../../tournament/tournament';
import { useData } from '../store';
import { useNav, getActiveTournament } from '../nav';
import { Tile, fmtMoney, fmtPct } from '../components/common';

export function HomePage() {
  const nav = useNav();
  const data = useData();
  const active = getActiveTournament();
  const leaks = useMemo(() => decisionLeaks(data.decisions).slice(0, 3), [data.decisions]);
  const acc = overallAccuracy(data.decisions);
  const results = data.results;
  const itm = results.filter((r) => r.prize > 0).length;
  const profit = results.reduce((a, r) => a + r.prize - r.buyIn, 0);
  const statIssues = statRows(data.agg.all).filter((r) => r.status === 'low' || r.status === 'high').slice(0, 2);
  const lessonsDone = LESSONS.filter((l) => data.lessons[l.id]?.read).length;
  const fresh = data.hands.length === 0;
  const top = leaks[0];
  return (
    <div className="page">
      <div className="hero-band">
        <div className="intro">
          <span className="label" style={{ color: 'var(--on-felt-muted)' }}>Tournament poker trainer</span>
          <h1>Play deep. Cash more. Close it out.</h1>
          <p>Simulated multi-table tournaments against seven kinds of opponents, a coach that grades every decision with real ICM and push/fold maths, and the lessons and drills to fix what it finds.</p>
          <div className="row">
            {active && !active.heroOut && !active.finished
              ? <button className="btn primary" onClick={() => nav({ page: 'play' })}>Resume {active.cfg.name} · {active.playersLeft()} left</button>
              : <button className="btn primary" onClick={() => nav({ page: 'play' })}>Start a tournament</button>}
            <button className="btn ghostlight" onClick={() => nav({ page: 'train', drill: 'pushfold' })}>Quick drill: push or fold</button>
          </div>
        </div>
        <div className="panel stack">
          <h3>{fresh ? 'How to use this' : 'Your next step'}</h3>
          {fresh ? (
            <ol className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
              <li><strong>Play</strong> a Quick 27 or the Bubble Trainer. The coach stops you on mistakes and explains the maths.</li>
              <li><strong>Analyze</strong> your stats and leaks once you have a few dozen hands.</li>
              <li><strong>Train</strong> the drill linked to your top leak until you’re above 85%.</li>
              <li><strong>Learn</strong> the theory behind anything that surprised you: start with “How tournaments are won”.</li>
            </ol>
          ) : top ? (
            <div className="stack">
              <div className="stripe mistake"><strong>{top.def.title}</strong> <span className="muted small">· {top.count}× {top.evLoss > 0 ? `· ≈${top.evLoss.toFixed(1)}bb` : ''}</span></div>
              <p className="small">{top.def.detail}</p>
              <div className="row">
                {top.def.drills[0] && <button className="btn primary small" onClick={() => nav({ page: 'train', drill: top.def.drills[0] })}>Drill: {drillById(top.def.drills[0])?.title}</button>}
                {top.def.lessons[0] && <button className="btn small" onClick={() => nav({ page: 'learn', lesson: top.def.lessons[0] })}>Lesson: {lessonById(top.def.lessons[0])?.title}</button>}
              </div>
            </div>
          ) : (
            <p className="small">No clear leaks yet: keep playing. The Bubble and Final Table trainers give the most valuable reps per minute.</p>
          )}
          {statIssues.map((r) => <div key={r.key} className="small stripe inaccuracy"><strong>{r.label}</strong> {r.key === 'af' ? r.value.toFixed(1) : `${r.value.toFixed(0)}%`} (target {r.lo}–{r.hi}): {r.note}</div>)}
        </div>
      </div>

      <div className="grid cols-4">
        <div className="panel"><Tile label="Tournaments" value={results.length} sub={results.length ? `${Math.round((100 * itm) / results.length)}% cashed` : 'none finished yet'} /></div>
        <div className="panel"><Tile label="Profit" value={fmtMoney(profit)} sub={results.length ? `best finish ${ordinal(Math.min(...results.map((r) => r.place)))}` : '–'} /></div>
        <div className="panel"><Tile label="Decision accuracy" value={fmtPct(acc.pct)} sub={`${acc.scored} graded decisions`} /></div>
        <div className="panel"><Tile label="Lessons" value={`${lessonsDone}/${LESSONS.length}`} sub="completed" /></div>
      </div>

      <section className="stack">
        <div className="spread"><h2>Quick start</h2><button className="btn ghost" onClick={() => nav({ page: 'play' })}>All formats →</button></div>
        <div className="grid cols-3">
          {PRESETS.slice(0, 6).map((p) => (
            <button key={p.key} className="panel preset" onClick={() => nav({ page: 'play', preset: p.key })}>
              <div className="spread"><h3 style={{ margin: 0 }}>{p.label}</h3><span className="pill">{p.config.entrants} players</span></div>
              <p className="small muted">{p.blurb}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2>Training</h2>
        <div className="grid cols-3">
          {DRILLS.map((d) => {
            const p = data.drills[d.id];
            const recent = p?.recent.length ? Math.round((100 * p.recent.reduce((a, b) => a + b, 0)) / p.recent.length) : null;
            return (
              <button key={d.id} className="panel preset" onClick={() => nav({ page: 'train', drill: d.id })}>
                <div className="spread"><h3 style={{ margin: 0 }}>{d.title}</h3>{recent !== null && <span className="pill accent num">{recent}%</span>}</div>
                <p className="small muted">{d.blurb}</p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
