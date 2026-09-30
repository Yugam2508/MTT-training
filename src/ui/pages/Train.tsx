import { useCallback, useEffect, useMemo, useState } from 'react';
import { DRILLS, drillById, type DrillQuestion } from '../../drills/drills';
import { makeRng } from '../../engine/rng';
import type { DrillId } from '../../analysis/leaks';
import { lessonById } from '../../content/lessons';
import { useData, recordDrill } from '../store';
import { useNav } from '../nav';
import { Cards, RangeGrid, Tile } from '../components/common';

export function TrainPage({ drill }: { drill?: DrillId }) {
  const nav = useNav();
  const { drills } = useData();
  if (drill && drillById(drill)) return <DrillRunner id={drill} onBack={() => nav({ page: 'train' })} />;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Train</h1>
          <p>Fast, focused reps on the spots that decide tournaments. Every answer is checked against the same solver and charts the coach uses during play.</p>
        </div>
      </div>
      <div className="grid cols-3">
        {DRILLS.map((d) => {
          const p = drills[d.id];
          const recent = p?.recent.length ? (100 * p.recent.reduce((a, b) => a + b, 0)) / p.recent.length : NaN;
          return (
            <button key={d.id} className="panel preset" onClick={() => nav({ page: 'train', drill: d.id })}>
              <h3 style={{ margin: 0 }}>{d.title}</h3>
              <p className="small muted">{d.blurb}</p>
              <div className="row small">
                {p ? (
                  <>
                    <span className="pill">{p.attempts} answered</span>
                    <span className="pill accent">last 30: {Math.round(recent)}%</span>
                    <span className="pill">best streak {p.best}</span>
                  </>
                ) : <span className="pill">Not started</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DrillRunner({ id, onBack }: { id: DrillId; onBack: () => void }) {
  const info = drillById(id)!;
  const nav = useNav();
  const rng = useMemo(() => makeRng(), []);
  const [q, setQ] = useState<DrillQuestion>(() => info.make(rng));
  const [answer, setAnswer] = useState<string | null>(null);
  const [score, setScore] = useState({ n: 0, ok: 0, streak: 0 });
  const progress = useData().drills[id];
  const next = useCallback(() => { setQ(info.make(rng)); setAnswer(null); }, [info, rng]);
  const choose = useCallback((key: string) => {
    if (answer) return;
    const ok = q.correct.includes(key);
    setAnswer(key);
    recordDrill(id, ok);
    setScore((s) => ({ n: s.n + 1, ok: s.ok + (ok ? 1 : 0), streak: ok ? s.streak + 1 : 0 }));
  }, [answer, q, id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (answer && (e.key === 'Enter' || e.key === ' ' || e.key === 'n')) { e.preventDefault(); next(); return; }
      const k = Number(e.key);
      if (!answer && k >= 1 && k <= q.options.length) choose(q.options[k - 1].key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, q, next, choose]);

  const ok = answer ? q.correct.includes(answer) : null;
  const lesson = { pushfold: 'pushfold', callshove: 'pushfold', icm: 'icm', rfi: 'preflop-opening', defend: 'vs-opens', potodds: 'pot-odds' }[id];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button className="btn ghost small" onClick={onBack} style={{ padding: 0 }}>← All drills</button>
          <h1>{info.title}</h1>
          <p>{info.blurb}</p>
        </div>
        <div className="row">
          <Tile label="This session" value={<span className="num">{score.ok}/{score.n}</span>} sub={`streak ${score.streak}`} />
          <Tile label="All time" value={<span className="num">{progress ? Math.round((100 * progress.correct) / Math.max(1, progress.attempts)) : 0}%</span>} sub={`${progress?.attempts ?? 0} answered`} />
        </div>
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="panel qcard">
          <div className="spread"><h2>{q.title}</h2><span className="pill">{info.title}</span></div>
          <p>{q.prompt}</p>
          <div className="row" style={{ gap: 18, alignItems: 'end' }}>
            <div className="stack" style={{ gap: 4 }}><span className="label">Your hand</span><Cards cards={q.heroCards} size="lg" /></div>
            {q.board && <div className="stack" style={{ gap: 4 }}><span className="label">Board</span><Cards cards={q.board} size="md" /></div>}
          </div>
          {q.seats && (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Player</th><th>Stack</th><th /></tr></thead>
                <tbody>{q.seats.map((st, i) => <tr key={i} style={st.hero ? { fontWeight: 700 } : undefined}><td>{st.name}</td><td className="num">{st.stackBB}bb</td><td className="muted">{st.note ?? ''}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <div className="facts">{q.facts.map((f) => <div key={f.label}><span className="label">{f.label}</span><strong className="num">{f.value}</strong></div>)}</div>
          <div className="options">
            {q.options.map((o, i) => {
              const cls = answer ? (q.correct.includes(o.key) ? 'right' : o.key === answer ? 'wrong' : '') : '';
              return <button key={o.key} className={`btn ${cls}`} onClick={() => choose(o.key)} disabled={!!answer && !cls}>{o.label} <span className="kbd">{i + 1}</span></button>;
            })}
          </div>
          {answer && (
            <div className="stack">
              <div className={`stripe ${ok ? 'best' : 'mistake'}`}><strong>{ok ? 'Correct.' : `Not quite: ${q.options.filter((o) => q.correct.includes(o.key)).map((o) => o.label).join(' or ')}.`}</strong></div>
              <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>{q.explain.map((l, i) => <li key={i}>{l}</li>)}</ul>
              <div className="row">
                <button className="btn primary" onClick={next} autoFocus>Next <span className="kbd">Enter</span></button>
                {lesson && <button className="btn ghost" onClick={() => nav({ page: 'learn', lesson: lesson as never })}>Read: {lessonById(lesson)?.title}</button>}
              </div>
            </div>
          )}
        </div>
        <div className="panel">
          {q.chart && answer ? (
            <RangeGrid range={q.chart.range} second={q.chart.second} hero={q.chart.hero} labels={[q.chart.label, q.chart.secondLabel]} />
          ) : (
            <div className="stack">
              <h3>How this drill works</h3>
              <p className="small muted">Answer with the buttons or the number keys. After each answer you’ll see the relevant range with your hand outlined, and why. Aim for 85%+ over your last 30 answers before moving on.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
