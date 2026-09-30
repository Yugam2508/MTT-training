import { PLAYBOOKS } from '../../content/strategy';
import { PROFILES } from '../../bots/profiles';
import { lessonById } from '../../content/lessons';
import { drillById } from '../../drills/drills';
import { useNav } from '../nav';
import { Seg } from '../components/common';

export function StrategyPage({ tab }: { tab?: string }) {
  const nav = useNav();
  const current = tab ?? 'early';
  const pb = PLAYBOOKS.find((p) => p.id === current);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Strategy</h1>
          <p>Playbooks for each stage of a tournament, and how to beat each type of opponent you’ll meet at the tables.</p>
        </div>
        <Seg value={current} onChange={(v) => nav({ page: 'strategy', tab: v })} options={[...PLAYBOOKS.map((p) => ({ v: p.id, label: p.title })), { v: 'players', label: 'Player types' }]} label="Playbook" />
      </div>
      {pb && (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <div className="panel stack">
            <span className="label">{pb.when}</span>
            <h2>{pb.title}</h2>
            <p><strong>Goal:</strong> {pb.goal}</p>
            <div className="stack">
              {pb.plays.map((p) => (
                <div key={p.label} className="stripe good"><strong>{p.label}.</strong> {p.text}</div>
              ))}
            </div>
          </div>
          <div className="stack">
            <div className="panel stack">
              <h3>Avoid</h3>
              {pb.avoid.map((a) => <div key={a} className="stripe mistake small">{a}</div>)}
            </div>
            <div className="panel stack">
              <h3>Study and practise</h3>
              <div className="row">
                {pb.lessons.map((id) => <button key={id} className="btn small" onClick={() => nav({ page: 'learn', lesson: id })}>Lesson: {lessonById(id)?.title}</button>)}
                {pb.drills.map((id) => <button key={id} className="btn small primary" onClick={() => nav({ page: 'train', drill: id })}>Drill: {drillById(id)?.title}</button>)}
              </div>
            </div>
          </div>
        </div>
      )}
      {current === 'players' && (
        <div className="grid cols-3">
          {Object.values(PROFILES).map((p) => (
            <div key={p.key} className="panel stack">
              <div className="spread"><h3 style={{ margin: 0 }}>{p.label}</h3><span className="pill">{p.short}</span></div>
              <p className="small">{p.description}</p>
              <div className="stripe good small"><strong>How to beat them:</strong> {p.exploit}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
