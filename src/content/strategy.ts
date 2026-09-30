/** Stage-by-stage tournament playbooks. */
import type { LessonId, DrillId } from '../analysis/leaks';
import type { Stage } from '../tournament/structure';

export interface Playbook {
  id: string;
  stage: Stage | 'plan';
  title: string;
  when: string;
  goal: string;
  plays: { label: string; text: string }[];
  avoid: string[];
  lessons: LessonId[];
  drills: DrillId[];
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'early', stage: 'early', title: 'Early stage', when: 'First levels, 60bb+ stacks, no one near the money.',
    goal: 'Build a stack with low variance. Win pots in position; avoid stacking off with one pair.',
    plays: [
      { label: 'Opens', text: 'Standard position-based ranges, 2.2–2.5bb. Isolate limpers with 3bb + 1bb per limper.' },
      { label: 'Speculative hands', text: 'Call opens with small pairs and suited connectors when stacks are deep (15–20x the call) and you are in position.' },
      { label: 'Postflop', text: 'C-bet small on dry high boards, check more on low connected ones. Value bet the weak players relentlessly.' },
      { label: 'Big pots', text: 'Need big hands. Top pair is a medium-strength hand when stacks are 100bb deep.' },
    ],
    avoid: ['Calling 3-bets out of position with dominated hands', 'Bluffing calling stations', 'Big all-ins with one pair against tight players'],
    lessons: ['preflop-opening', 'postflop-cbet', 'value-bluff'], drills: ['rfi', 'defend'],
  },
  {
    id: 'middle', stage: 'middle', title: 'Middle stage', when: 'Antes are significant, average stack 25–50bb, the bubble is still far.',
    goal: 'Accumulate. This is where deep runs are built, while ICM pressure is still low.',
    plays: [
      { label: 'Steal', text: 'Open CO/BTN/SB wide: the blinds and antes are 2.5bb, about 10% of a 25bb stack.' },
      { label: 'Re-steal', text: 'With 15–25bb, 3-bet shove over late-position opens with pairs, good aces and broadways.' },
      { label: '3-bet', text: 'With 30–50bb, 3-bet or fold more than you flat; use suited aces as bluffs.' },
      { label: 'Short stack', text: 'At 12bb or less, switch to push/fold. Don’t wait for premiums while the blinds eat you.' },
    ],
    avoid: ['Flatting opens with 20bb (calls leave awkward stacks)', 'Limping', 'Letting your stack drift below 10bb without a shove'],
    lessons: ['stack-depth', 'pushfold', 'vs-opens'], drills: ['pushfold', 'defend'],
  },
  {
    id: 'bubble', stage: 'bubble', title: 'Bubble', when: 'A handful of eliminations from the money. Play is hand-for-hand.',
    goal: 'Big stack: attack. Medium stack: survive into the money with a playable stack. Short stack: pick fold-equity spots.',
    plays: [
      { label: 'Big stack', text: 'Open and shove wide into medium stacks who cannot call. Avoid confrontations with the other big stacks.' },
      { label: 'Medium stack', text: 'Tighten calls a lot (risk premium). Keep stealing from the tightest players first in.' },
      { label: 'Short stack', text: 'Shove first in rather than call; check other tables for even shorter stacks before gambling.' },
      { label: 'Calling shoves', text: 'Use ICM: required equity can rise by 10–15 points. Chip-EV calls are often ICM folds.' },
    ],
    avoid: ['Calling off a medium stack with a marginal hand', 'Folding the chip lead into irrelevance (big stacks must attack)', 'Blinding out when a shove had fold equity'],
    lessons: ['icm', 'pushfold'], drills: ['icm', 'callshove'],
  },
  {
    id: 'itm', stage: 'itm', title: 'In the money', when: 'The bubble has burst; pay jumps are small until the final tables.',
    goal: 'Accumulate for the final table. Short stacks gamble now; call them lighter.',
    plays: [
      { label: 'After the bubble', text: 'Many short stacks shove wide right after the bubble. Widen your calling ranges back toward chip EV.' },
      { label: 'Steal', text: 'Keep stealing; tight players who just made the money often loosen up, others keep folding.' },
      { label: 'Pay jumps', text: 'ICM returns near the final table and each table break; play tighter against covering stacks there.' },
    ],
    avoid: ['Min-cash mentality: folding your way to the next small jump', 'Ignoring that short stacks now shove very wide'],
    lessons: ['icm', 'stack-depth'], drills: ['callshove', 'pushfold'],
  },
  {
    id: 'final', stage: 'final', title: 'Final table', when: 'Nine or fewer players, large pay jumps.',
    goal: 'Maximise $EV: exploit ICM pressure on others, avoid it on yourself, then win heads-up.',
    plays: [
      { label: 'Map the stacks', text: 'Every hand, note who covers you, who you cover and who is about to bust.' },
      { label: 'Chip leader', text: 'Open very wide against medium stacks; they can’t call without a strong hand.' },
      { label: 'Medium stack', text: 'Avoid other medium stacks and the leader when a short stack is about to bust.' },
      { label: 'Short-handed', text: 'Six-handed and fewer: open, defend and 3-bet wider every orbit.' },
      { label: 'Heads-up', text: 'No ICM. Very wide ranges; push/fold at ≤ 12bb (SB shoves ~73% at 10bb).' },
    ],
    avoid: ['Medium-vs-medium coolers when someone is at 3bb', 'Playing heads-up as tight as nine-handed'],
    lessons: ['final-table', 'icm'], drills: ['icm', 'pushfold'],
  },
  {
    id: 'plan', stage: 'plan', title: 'Your training plan', when: 'Between sessions.',
    goal: 'Turn every session into improvement: play, review, drill.',
    plays: [
      { label: '1. Play', text: 'One tournament or scenario with the coach set to “after each hand” so you stay in rhythm.' },
      { label: '2. Review', text: 'Open Analyze: read your top three leaks and the biggest mistakes, with the hand replays.' },
      { label: '3. Drill', text: 'Do 20–30 reps of the drill linked to your top leak until accuracy is above 85%.' },
      { label: '4. Learn', text: 'Read the lesson for any leak you don’t fully understand, and pass its quiz.' },
      { label: '5. Scenario', text: 'Use the Bubble and Final Table trainers to get many reps of the most valuable spots quickly.' },
    ],
    avoid: ['Judging a session by results', 'Reviewing only bad beats'],
    lessons: ['mental'], drills: [],
  },
];
