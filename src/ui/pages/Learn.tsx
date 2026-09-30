import { useState } from 'react';
import { LESSONS, lessonById, type Lesson } from '../../content/lessons';
import { drillById } from '../../drills/drills';
import type { LessonId } from '../../analysis/leaks';
import { useData, recordLesson } from '../store';
import { useNav } from '../nav';
import { Markup } from '../components/common';

const TRACKS: Lesson['track'][] = ['Foundations', 'Preflop', 'Short stack & ICM', 'Postflop', 'Game plan'];

export function LearnPage({ lesson }: { lesson?: LessonId }) {
  const nav = useNav();
  const { lessons } = useData();
  const l = lesson ? lessonById(lesson) : undefined;
  if (l) return <LessonView l={l} onBack={() => nav({ page: 'learn' })} />;
  const done = LESSONS.filter((x) => lessons[x.id]?.read).length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Learn</h1>
          <p>The theory behind every grade: short lessons with worked numbers and a quiz at the end. Start with the foundations or jump to whatever your leaks point at.</p>
        </div>
        <div className="stack" style={{ minWidth: 200 }}>
          <span className="label">{done} of {LESSONS.length} lessons completed</span>
          <div className="progress"><div style={{ width: `${(100 * done) / LESSONS.length}%` }} /></div>
        </div>
      </div>
      {TRACKS.map((track) => (
        <section key={track} className="stack">
          <h2>{track}</h2>
          <div className="grid cols-3">
            {LESSONS.filter((x) => x.track === track).map((x) => {
              const p = lessons[x.id];
              return (
                <button key={x.id} className="panel preset" onClick={() => nav({ page: 'learn', lesson: x.id })}>
                  <div className="spread"><h3 style={{ margin: 0 }}>{x.title}</h3><span className="pill">{x.minutes} min</span></div>
                  <p className="small muted">{x.summary}</p>
                  <div className="row small">
                    {p?.read ? <span className="pill accent">Completed</span> : <span className="pill">Not read</span>}
                    {p && p.quizTotal > 0 && <span className="pill num">Quiz {p.quizBest}/{p.quizTotal}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function LessonView({ l, onBack }: { l: Lesson; onBack: () => void }) {
  const nav = useNav();
  const idx = LESSONS.indexOf(l);
  const next = LESSONS[idx + 1];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button className="btn ghost small" onClick={onBack} style={{ padding: 0 }}>← All lessons</button>
          <span className="label" style={{ display: 'block' }}>{l.track} · {l.minutes} min</span>
          <h1>{l.title}</h1>
          <p>{l.summary}</p>
        </div>
      </div>
      <div className="grid cols-2" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <article className="lesson-body panel">
          {l.sections.map((sec) => (
            <section key={sec.heading}>
              <h2>{sec.heading}</h2>
              <div className="prose"><Markup lines={sec.body} /></div>
              {sec.table && (
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr>{sec.table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>{sec.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </article>
        <aside className="stack">
          <div className="panel stack">
            <h3>Key points</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>{l.keyPoints.map((k) => <li key={k}>{k}</li>)}</ul>
          </div>
          <Quiz l={l} />
          {l.drills.length > 0 && (
            <div className="panel stack">
              <h3>Practise it</h3>
              <div className="row">{l.drills.map((d) => <button key={d} className="btn" onClick={() => nav({ page: 'train', drill: d })}>{drillById(d)?.title}</button>)}</div>
            </div>
          )}
          {next && <button className="btn" onClick={() => nav({ page: 'learn', lesson: next.id })}>Next lesson: {next.title} →</button>}
        </aside>
      </div>
    </div>
  );
}

function Quiz({ l }: { l: Lesson }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const q = l.quiz[i];
  if (!l.quiz.length) return null;
  const choose = (k: number) => {
    if (picked !== null) return;
    setPicked(k);
    if (k === q.answer) setScore((s) => s + 1);
  };
  const advance = () => {
    if (i + 1 >= l.quiz.length) {
      setDone(true);
      recordLesson(l.id, { read: true, quizBest: score, quizTotal: l.quiz.length });
    } else { setI(i + 1); setPicked(null); }
  };
  if (done) {
    return (
      <div className="panel stack">
        <h3>Quiz complete</h3>
        <p><strong className="num">{score}/{l.quiz.length}</strong> correct. {score === l.quiz.length ? 'Perfect.' : 'Re-read the sections behind the ones you missed, then try again.'}</p>
        <button className="btn" onClick={() => { setI(0); setPicked(null); setScore(0); setDone(false); }}>Retake quiz</button>
      </div>
    );
  }
  return (
    <div className="panel stack">
      <div className="spread"><h3 style={{ margin: 0 }}>Quiz</h3><span className="pill num">{i + 1}/{l.quiz.length}</span></div>
      <p>{q.q}</p>
      <div className="stack">
        {q.options.map((o, k) => {
          const cls = picked === null ? '' : k === q.answer ? 'right' : k === picked ? 'wrong' : '';
          return <button key={k} className={`btn ${cls}`} style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => choose(k)}>{o}</button>;
        })}
      </div>
      {picked !== null && (
        <>
          <p className="small"><strong>{picked === q.answer ? 'Correct.' : 'Not quite.'}</strong> {q.explain}</p>
          <button className="btn primary" onClick={advance}>{i + 1 >= l.quiz.length ? 'Finish' : 'Next question'}</button>
        </>
      )}
    </div>
  );
}
