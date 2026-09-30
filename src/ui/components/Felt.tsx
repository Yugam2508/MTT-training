import { useEffect, useState, type ReactNode } from 'react';

function useNarrow(limit = 640) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < limit);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < limit);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [limit]);
  return narrow;
}
import { type HandState, potSize } from '../../engine/hand';
import { Cards, PCard } from './common';

export const fmtAmt = (x: number, bb: number, units: 'bb' | 'chips') =>
  units === 'bb' ? `${(Math.round((x / bb) * 10) / 10).toLocaleString()}bb` : Math.round(x).toLocaleString();

export interface SeatMeta { hud?: string; tag?: string }

function lastActionLabel(s: HandState, i: number, bb: number, units: 'bb' | 'chips'): string | null {
  for (let k = s.actions.length - 1; k >= 0; k--) {
    const a = s.actions[k];
    if (a.street !== s.street && !s.done) break;
    if (a.p !== i) continue;
    if (a.type === 'ante' || a.type === 'sb' || a.type === 'bb') return null;
    if (a.type === 'fold') return 'Fold';
    if (a.type === 'check') return 'Check';
    if (a.allIn) return 'All-in';
    if (a.type === 'call') return 'Call';
    return `${a.type === 'bet' ? 'Bet' : 'Raise'} ${fmtAmt(a.to, bb, units)}`;
  }
  return null;
}

export function Felt({ s, tableSize, heroIdx, meta, revealAll, units, message, overlay, toasts }: {
  s: HandState;
  tableSize: number;
  heroIdx: number;
  meta?: (i: number) => SeatMeta;
  revealAll?: boolean;
  units: 'bb' | 'chips';
  message?: ReactNode;
  overlay?: ReactNode;
  toasts?: ReactNode;
}) {
  const bb = s.cfg.bb;
  const narrow = useNarrow();
  const rx = narrow ? 38 : 45, ry = narrow ? 44 : 43;
  const heroSeat = s.players[heroIdx]?.seat ?? 0;
  const res = s.result;
  const angleOf = (seat: number) => {
    const rel = (seat - heroSeat + tableSize) % tableSize;
    return Math.PI / 2 + (rel * 2 * Math.PI) / tableSize;
  };
  const board = s.done && res?.showdown ? s.board : s.board;
  return (
    <div className="felt-wrap">
      <div className="felt" />
      <div className="felt-center">
        <span className="felt-logo">MTT COACH</span>
        <div className="board" aria-label="board">
          {[0, 1, 2, 3, 4].map((k) => (board[k] !== undefined ? <PCard key={k} card={board[k]} /> : <PCard key={k} empty />))}
        </div>
        <span className="pot num">Pot {fmtAmt(potSize(s), bb, units)}</span>
        {message && <div className="felt-msg">{message}</div>}
      </div>
      {s.players.map((p, i) => {
        const a = angleOf(p.seat);
        const cx = 50 + rx * Math.cos(a), cy = 50 + ry * Math.sin(a);
        const bx = 50 + (narrow ? 24 : 30) * Math.cos(a), by = 47 + (narrow ? 30 : 27) * Math.sin(a);
        const isHero = i === heroIdx;
        const showCards = isHero || revealAll || (s.done && res?.showdown && res.shown.includes(i));
        const won = s.done && res ? res.won[i] : 0;
        const label = s.done && won > 0 ? `Wins ${fmtAmt(won, bb, units)}` : lastActionLabel(s, i, bb, units);
        const m = meta?.(i);
        const cls = ['seat', isHero ? 'hero' : '', p.folded ? 'folded' : '', s.toAct === i && !s.done ? 'acting' : '', won > 0 ? 'winner' : ''].join(' ');
        return (
          <div key={p.id}>
            <div className={cls} style={{ left: `${cx}%`, top: `${cy}%` }}>
              {label && <span className="act">{label}</span>}
              {(!p.folded || revealAll) && (
                <Cards cards={p.cards} hidden={!showCards} size="md" />
              )}
              <div className="plate">
                <span className="name" title={p.name}>{p.name}</span>
                <span className="stackv num">{p.stack === 0 && p.allIn ? 'ALL-IN' : fmtAmt(p.stack, bb, units)}</span>
                {m?.hud && <span className="hud">{m.hud}</span>}
                {m?.tag && <span className="tag">{m.tag}</span>}
                {s.done && res?.showdown && res.descriptions[i] && showCards && <span className="hud">{res.descriptions[i]}</span>}
              </div>
            </div>
            {!s.done && p.bet > 0 && (
              <div className="bet num" style={{ left: `${bx}%`, top: `${by}%` }}>{fmtAmt(p.bet, bb, units)}</div>
            )}
            {i === s.button && (
              <div className="dealer" style={{ left: `${50 + 36 * Math.cos(a + 0.22)}%`, top: `${48 + 34 * Math.sin(a + 0.22)}%` }}>D</div>
            )}
          </div>
        );
      })}
      {toasts && <div className="toast-area">{toasts}</div>}
      {overlay}
    </div>
  );
}
