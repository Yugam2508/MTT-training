import type { DecisionRecord } from '../../coach/session';
import { setDeliberate } from '../store';

/** Whether a decision can be marked deliberate: only ones the coach graded below good. */
export const canMark = (r: DecisionRecord) => r.grade === 'inaccuracy' || r.grade === 'mistake' || r.grade === 'blunder';

/**
 * Toggle for "I went against the baseline on purpose" (to be safe, or to throw someone off).
 * Marked decisions stay visible but leave accuracy and leak counts.
 */
export function DeliberateToggle({ r, onChange }: { r: DecisionRecord; onChange?: () => void }) {
  if (!canMark(r)) return null;
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const on = !r.deliberate;
    // the record may not be saved yet (mid-hand): mark this copy too so it's stored with the mark
    r.deliberate = on;
    r.editedAt = Date.now();
    setDeliberate(r.id, on);
    onChange?.();
  };
  return (
    <button className={`btn small${r.deliberate ? ' deliberate-on' : ''}`} aria-pressed={!!r.deliberate} onClick={toggle}
      title="Mark this as a deliberate deviation (to be safe or to throw someone off). It stays in your history but leaves accuracy and leaks.">
      {r.deliberate ? '✓ Deliberate' : 'I did this on purpose'}
    </button>
  );
}
