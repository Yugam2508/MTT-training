import { Fragment, type ReactNode } from 'react';
import { type Card, RANK_CHARS, SUIT_SYMBOLS, rankOf, suitOf } from '../../engine/cards';
import { NUM_CLASSES, className } from '../../engine/combos';
import type { Range } from '../../engine/ranges';
import { GRADE_LABEL, type Grade } from '../../coach/coach';
import { useData } from '../store';

export function PCard({ card, back, dim, empty }: { card?: Card; back?: boolean; dim?: boolean; empty?: boolean }) {
  const four = useData().settings.fourColor;
  if (empty) return <span className="pcard empty" aria-hidden="true" />;
  if (back || card === undefined) return <span className="pcard back" aria-label="hidden card" />;
  const su = suitOf(card);
  const color = su === 2 ? 'red' : su === 1 ? (four ? 'blue' : 'red') : su === 0 && four ? 'green' : '';
  const r = RANK_CHARS[rankOf(card)];
  return (
    <span className={`pcard ${color} ${dim ? 'dim' : ''}`} aria-label={`${r}${'cdhs'[su]}`}>
      <span className="r">{r === 'T' ? '10' : r}</span>
      <span className="s">{SUIT_SYMBOLS[su]}</span>
    </span>
  );
}

export function Cards({ cards, size = 'md', hidden }: { cards: readonly Card[]; size?: 'sm' | 'md' | 'lg'; hidden?: boolean }) {
  return (
    <span className={`cards ${size}`}>
      {cards.map((c, i) => <PCard key={i} card={c} back={hidden} />)}
    </span>
  );
}

export function GradeBadge({ grade }: { grade: Grade }) {
  return <span className={`grade ${grade}`}>{GRADE_LABEL[grade]}</span>;
}

export function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="tile">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub !== undefined && <span className="sub">{sub}</span>}
    </div>
  );
}

/** Renders a 13x13 range chart. `range` is drawn solid, `second` lighter behind it. */
export function RangeGrid({ range, second, hero, onPick, labels }: {
  range: Range; second?: Range; hero?: number; onPick?: (cls: number) => void; labels?: [string, string?];
}) {
  const cells = [];
  for (let i = 0; i < NUM_CLASSES; i++) {
    const w = range[i];
    const w2 = second ? Math.min(1, second[i]) : 0;
    const name = className(i);
    cells.push(
      <div
        key={i}
        className={`cell ${w > 0.5 ? 'on' : w2 > 0.5 ? 'on2' : ''} ${hero === i ? 'hero' : ''}`}
        title={`${name}${w > 0 ? ` · ${Math.round(w * 100)}%` : ''}${second && w2 > 0 ? ` · ${labels?.[1] ?? 'second'} ${Math.round(w2 * 100)}%` : ''}`}
        onClick={onPick ? () => onPick(i) : undefined}
      >
        {w2 > 0 && <div className="fill2" style={{ height: `${Math.min(1, w + w2) * 100}%` }} />}
        {w > 0 && <div className="fill" style={{ height: `${w * 100}%` }} />}
        <span>{name}</span>
      </div>,
    );
  }
  return (
    <div className="stack">
      <div className={`rgrid ${onPick ? 'pick' : ''}`} role="img" aria-label={labels?.[0] ?? 'range chart'}>{cells}</div>
      {(labels || hero !== undefined) && (
        <div className="legend">
          {labels?.[0] && <span><span className="sw" style={{ background: 'var(--accent)' }} />{labels[0]}</span>}
          {labels?.[1] && <span><span className="sw" style={{ background: 'color-mix(in srgb, var(--accent) 38%, var(--surface-2))' }} />{labels[1]}</span>}
          {hero !== undefined && <span><span className="sw" style={{ outline: '2px solid var(--g-mistake)', outlineOffset: '-2px' }} />Your hand ({className(hero)})</span>}
        </div>
      )}
    </div>
  );
}

/** Minimal markup: "- " bullets, **bold**. */
export function Markup({ lines }: { lines: string[] }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(<ul key={`u${out.length}`}>{bullets.map((b, i) => <li key={i}><Inline text={b} /></li>)}</ul>);
      bullets = [];
    }
  };
  lines.forEach((l, i) => {
    if (l.startsWith('- ')) bullets.push(l.slice(2));
    else { flush(); out.push(<p key={i}><Inline text={l} /></p>); }
  });
  flush();
  return <>{out}</>;
}

export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>))}</>;
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)} aria-pressed={o.v === value}>{o.label}</button>
      ))}
    </div>
  );
}

export const fmtMoney = (x: number) => `${x < 0 ? '−' : ''}$${Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: Math.abs(x) < 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const fmtPct = (x: number, d = 0) => (Number.isFinite(x) ? `${x.toFixed(d)}%` : '–');
export const fmtBBs = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}bb`;
