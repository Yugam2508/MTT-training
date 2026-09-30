/** Small hand-built SVG charts: single-series line with crosshair tooltip, bar lists, stacked bar. */
import { useRef, useState } from 'react';
import { GRADE_LABEL, type Grade } from '../../coach/coach';

export function LineChart({ values, height = 180, width = 640, format = (v) => v.toFixed(1), xLabel = (i) => `#${i + 1}`, zero = false, ariaLabel }: {
  values: number[]; height?: number; width?: number; format?: (v: number) => string; xLabel?: (i: number) => string; zero?: boolean; ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = width, H = height, padL = 44, padR = 14, padT = 12, padB = 22;
  if (values.length < 2) return <div className="empty">Not enough data yet.</div>;
  let lo = Math.min(...values), hi = Math.max(...values);
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const ticks = niceTicks(lo, hi, 4);
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
  const x = (i: number) => padL + (i / (values.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${path}L${x(values.length - 1)},${y(zero ? 0 : lo)}L${x(0)},${y(zero ? 0 : lo)}Z`;
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - padL) / (W - padL - padR)) * (values.length - 1));
    setHover(Math.max(0, Math.min(values.length - 1, i)));
  };
  const last = values.length - 1;
  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {zero && <line className="zero" x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} />}
        <path className="area" d={area} />
        <path className="series" d={path} />
        <circle className="dot" cx={x(last)} cy={y(values[last])} r={4} />
        <text x={x(last) - 6} y={y(values[last]) - 9} textAnchor="end" style={{ fill: 'var(--ink)', fontWeight: 600 }}>{format(values[last])}</text>
        <text x={padL} y={H - 5}>{xLabel(0)}</text>
        <text x={W - padR} y={H - 5} textAnchor="end">{xLabel(last)}</text>
        {hover !== null && (
          <g>
            <line className="cross" x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} />
            <circle className="dot" cx={x(hover)} cy={y(values[hover])} r={5} />
          </g>
        )}
        <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="transparent" />
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 0, transform: `translateX(${hover > values.length / 2 ? '-105%' : '5%'})` }}>
          <span className="muted">{xLabel(hover)}</span> <strong className="num">{format(values[hover])}</strong>
        </div>
      )}
    </div>
  );
}

function niceTicks(lo: number, hi: number, n: number): number[] {
  const span = hi - lo;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? 10 * mag;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.5; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Horizontal bars for one measure, value labelled at the tip. */
export function BarList({ rows, max, format }: { rows: { label: string; value: number; note?: string }[]; max?: number; format: (v: number) => string }) {
  const m = max ?? Math.max(1e-9, ...rows.map((r) => r.value));
  return (
    <div className="stack">
      {rows.map((r) => (
        <div className="hbar" key={r.label} title={r.note ?? `${r.label}: ${format(r.value)}`}>
          <span className="small">{r.label}</span>
          <div className="track"><div style={{ width: `${Math.max(0, (r.value / m) * 100)}%` }} /></div>
          <span className="num small" style={{ textAlign: 'right' }}>{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

const GRADE_ORDER: Grade[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
const GRADE_VAR: Record<string, string> = { best: '--g-best', good: '--g-good', inaccuracy: '--g-inacc', mistake: '--g-mistake', blunder: '--g-blunder' };

/** Distribution of grades as a stacked bar with a legend (labels always present). */
export function GradeBar({ counts }: { counts: Partial<Record<Grade, number>> }) {
  const total = GRADE_ORDER.reduce((a, g) => a + (counts[g] ?? 0), 0);
  if (!total) return <div className="empty">No graded decisions yet.</div>;
  return (
    <div className="stack">
      <div className="stackbar" role="img" aria-label="Decision grades">
        {GRADE_ORDER.filter((g) => counts[g]).map((g) => (
          <div key={g} title={`${GRADE_LABEL[g]}: ${counts[g]} (${Math.round(((counts[g] ?? 0) / total) * 100)}%)`} style={{ width: `${((counts[g] ?? 0) / total) * 100}%`, background: `var(${GRADE_VAR[g]})` }} />
        ))}
      </div>
      <div className="legend">
        {GRADE_ORDER.map((g) => (
          <span key={g}><span className="sw" style={{ background: `var(${GRADE_VAR[g]})` }} />{GRADE_LABEL[g]} <span className="num">{counts[g] ?? 0}</span></span>
        ))}
      </div>
    </div>
  );
}
