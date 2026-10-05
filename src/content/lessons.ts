/**
 * Theory lessons. Text uses light markup rendered by the UI:
 * paragraphs are strings; a string starting with "- " is a bullet; **bold** is supported.
 */
import type { LessonId, DrillId } from '../analysis/leaks';

export interface LessonSection {
  heading: string;
  body: string[];
  table?: { head: string[]; rows: string[][] };
}

export interface QuizQuestion {
  q: string;
  options: string[];
  answer: number;
  explain: string;
}

export interface Lesson {
  id: LessonId;
  title: string;
  track: 'Foundations' | 'Preflop' | 'Short stack & ICM' | 'Postflop' | 'Game plan';
  minutes: number;
  summary: string;
  sections: LessonSection[];
  keyPoints: string[];
  quiz: QuizQuestion[];
  drills: DrillId[];
}

export const LESSONS: Lesson[] = [
  {
    id: 'mtt-basics',
    title: 'How tournaments are won',
    track: 'Foundations',
    minutes: 8,
    summary: 'Why tournament chips are not money, how to measure your stack, and what each stage of an MTT asks of you.',
    sections: [
      {
        heading: 'Chips are not money',
        body: [
          'In a cash game a chip is always worth its face value. In a tournament the prize pool is fixed and paid out by finishing place, so the value of a chip depends on how many you have and how close you are to the money.',
          'The practical consequence: **the chips you lose are worth more than the chips you win**. Doubling your stack never doubles your prize equity, and losing your stack ends your tournament. This is why a fold that looks too tight in a cash game can be correct on a bubble.',
          'The model that converts stacks into prize equity is the Independent Chip Model (ICM), covered in its own lesson. Early in a big field the effect is small; near the money and at the final table it dominates many decisions.',
        ],
      },
      {
        heading: 'Measure your stack in big blinds',
        body: [
          'Your stack only means something relative to the blinds. Always think in big blinds (bb): 18,000 chips at 600/1,200 is 15bb, and that number decides which strategy you use.',
          'Modern online MTTs use a **big blind ante**: the player in the big blind posts an ante equal to one big blind for the whole table. Every orbit costs you about 2.5bb (small blind + big blind + ante), so a 20bb stack survives about 8 orbits if it never plays a hand.',
          'Some players use M = stack / (SB + BB + antes). With a BB ante, M is your stack divided by 2.5bb, so 25bb is M = 10. Big blinds are simpler and are what charts use.',
        ],
        table: {
          head: ['Stack', 'What it means', 'Main tools'],
          rows: [
            ['60bb+', 'Deep: postflop skill matters most', 'Open, 3-bet, play pots in position'],
            ['30–60bb', 'Middle: fewer speculative calls', '3-bet or fold more, steal the antes'],
            ['15–30bb', 'Short: preflop aggression', 'Small opens, 3-bet shoves over late opens'],
            ['≤ 12–15bb', 'Push/fold', 'Open-shove or fold, call shoves by the numbers'],
          ],
        },
      },
      {
        heading: 'Stages of a tournament',
        body: [
          '- **Early** (deep stacks): play solid, position-aware poker. Avoid huge pots with one pair. There is no need to gamble.',
          '- **Middle** (antes kick in, stacks 25–50bb): stealing the blinds and antes becomes a big source of chips. Players who don’t adjust get blinded out.',
          '- **Bubble** (just before the money): the tightest players become targets. Medium stacks must avoid marginal all-ins; big stacks should attack.',
          '- **In the money**: pay jumps are small at first, so play for chips; they grow near the final table.',
          '- **Final table**: pay jumps are large. ICM pressure, short-handed ranges and heads-up play decide the biggest share of the prize pool.',
        ],
      },
      {
        heading: 'Where the money is',
        body: [
          'Payouts are top-heavy. In the Turbo 90 structure in this app, 14 players are paid; first place takes about 29% of the prize pool, roughly 12 times a min-cash. In real fields of thousands the gap is even larger.',
          'Min-cashing a lot rarely makes a player profitable. Long-term winners convert enough deep runs into top-three finishes. That means accumulating chips in the middle stages, surviving the bubble with a playable stack, and playing the final table well.',
        ],
      },
    ],
    keyPoints: [
      'Think in big blinds; your strategy changes with stack depth.',
      'Chips lost are worth more than chips won; the effect grows near the money.',
      'Each orbit costs ~2.5bb with a BB ante; waiting is expensive.',
      'Profit comes from deep runs, so accumulate chips when ICM pressure is low.',
    ],
    quiz: [
      { q: 'Blinds are 1,000/2,000 with a 2,000 BB ante. You have 50,000 chips. How many big blinds is that, and what is your M?', options: ['25bb, M = 10', '25bb, M = 16.7', '50bb, M = 20', '12.5bb, M = 5'], answer: 0, explain: '50,000 / 2,000 = 25bb. One orbit costs 1,000 + 2,000 + 2,000 = 5,000, so M = 50,000 / 5,000 = 10.' },
      { q: 'Why can a fold be correct on the bubble even when calling is +EV in chips?', options: ['Because the chips you can lose are worth more than the chips you can win', 'Because the blinds are higher', 'Because opponents are always strong on the bubble', 'It can’t: chip EV is always right'], answer: 0, explain: 'ICM: busting forfeits your share of the prize pool, while doubling up adds less than double your equity.' },
      { q: 'About how many big blinds does one orbit cost with a big blind ante?', options: ['1.5bb', '2.5bb', '4bb', '1bb'], answer: 1, explain: 'SB 0.5 + BB 1 + BB ante 1 = 2.5bb per orbit.' },
      { q: 'What mainly separates long-term winning MTT players?', options: ['Min-cashing often', 'Converting deep runs into top finishes', 'Never playing marginal hands', 'Playing only premium hands on the bubble'], answer: 1, explain: 'Payouts are top-heavy; profit comes from the top finishes, which requires accumulating chips.' },
    ],
    drills: ['rfi'],
  },
  {
    id: 'preflop-opening',
    title: 'Position and opening ranges',
    track: 'Preflop',
    minutes: 10,
    summary: 'What to raise first in from each seat, how big to open with antes in play, and why limping is a leak.',
    sections: [
      {
        heading: 'Position is the biggest edge in poker',
        body: [
          'Acting last lets you see what your opponents do before you decide, control the pot size and realise more of your equity. Every good strategy opens tight from early position and wide from late position.',
          'Early seats have many players left to act, so the chance someone behind holds a strong hand is high. From the button only the two blinds remain, and they are out of position for the rest of the hand.',
        ],
      },
      {
        heading: 'Raise-first-in ranges (25bb+, BB ante)',
        body: [
          'These baseline ranges are what the coach compares your opens to. They are a sound, slightly simplified default for 9-handed MTTs; open the Tools → Ranges tab to see each one on the grid.',
        ],
        table: {
          head: ['Position', 'Share of hands', 'Range'],
          rows: [
            ['UTG', '≈11%', '77+, A9s+, KTs+, QTs+, JTs, AJo+, KQo (+ some A5s, T9s)'],
            ['UTG+1', '≈12%', '66+, A8s+, A5s–A4s, KTs+, QTs+, JTs, T9s, AJo+, KQo'],
            ['UTG+2', '≈16%', '55+, A7s+, A5s–A3s, K9s+, Q9s+, J9s+, T9s, 98s, ATo+, KJo+'],
            ['LJ', '≈19%', '44+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, ATo+, KJo+, QJo'],
            ['HJ', '≈24%', '33+, A2s+, K7s+, suited connectors to 65s, A9o+, KTo+, QTo+, JTo'],
            ['CO', '≈30%', '22+, A2s+, K5s+, most suited broadways and connectors, A7o+, A5o, KTo+, QTo+, JTo'],
            ['BTN', '≈45%', '22+, any suited ace and king, most suited hands, A2o+, K8o+, Q9o+, J9o+, T8o+, 98o'],
            ['SB', '≈41%', 'Similar to the button but slightly tighter: you are out of position vs the BB'],
          ],
        },
      },
      {
        heading: 'Open sizing with antes',
        body: [
          'With a big blind ante there are already 2.5bb in the pot before anyone acts. A small open risks little to win that dead money.',
          '- Deep (40bb+): 2.2–2.5bb.',
          '- 20–40bb: 2–2.2bb.',
          '- Under 20bb: 2bb (a min-raise), or shove if raising would commit you anyway.',
          '- Small blind: 2.5–3bb, because you will be out of position.',
          '- Add about 1bb for each limper.',
          'Break-even maths for a steal: risking 2.2bb to win 2.5bb needs the blinds to fold 2.2 / (2.2 + 2.5) = 47% of the time, and you still have equity when called. That is why late-position steals are so profitable.',
        ],
      },
      {
        heading: 'Why not limp?',
        body: [
          'An open-limp gives up fold equity (you can’t win the pot preflop), invites the big blind to see a free flop, and announces a weak range to aggressive players who will raise you. Raising first in wins the pot outright a large share of the time and gives you the initiative.',
          'The one common exception is advanced small-blind strategies that complete against a passive big blind. Unless you have studied that strategy, raise or fold.',
        ],
      },
    ],
    keyPoints: [
      'Open tight early (≈11–16%), wide late (CO ≈30%, BTN ≈45%).',
      'Open small: 2–2.5bb; the dead money from antes makes steals profitable.',
      'Raise or fold first in. Open-limping is a leak.',
      'Stacks under 20bb: open 2bb, or shove hands that can’t stand a re-shove.',
    ],
    quiz: [
      { q: 'You open 2.2bb on the button. The pot has 2.5bb (SB, BB, BB ante). How often must the blinds fold for the steal to break even immediately?', options: ['About 30%', 'About 47%', 'About 60%', 'About 88%'], answer: 1, explain: 'Risk / (risk + reward) = 2.2 / (2.2 + 2.5) ≈ 47%. And you still have equity when called.' },
      { q: 'Which hand is a standard open from UTG in the baseline ranges?', options: ['K9o', 'ATo', 'AJo', '65s'], answer: 2, explain: 'UTG opens AJo+; ATo starts at UTG+2 and K9o, 65s are later-position hands.' },
      { q: 'Folded to you in the cutoff with 45bb. Recommended size?', options: ['Min-raise to 2bb exactly', '2.2–2.5bb', '3.5bb', 'All-in'], answer: 1, explain: 'Deep with antes, 2.2–2.5bb gets the same folds as bigger sizes while risking less.' },
      { q: 'What is the main problem with open-limping?', options: ['It costs more chips', 'You give up fold equity and invite cheap flops', 'It is against the rules', 'It only works in the big blind'], answer: 1, explain: 'Limping can’t win the pot preflop, lets the BB in for free and gets you raised by good players.' },
    ],
    drills: ['rfi'],
  },
  {
    id: 'vs-opens',
    title: 'Facing opens: 3-bet, call or fold',
    track: 'Preflop',
    minutes: 11,
    summary: 'How to respond to a raise from each seat, how wide the big blind defends, and how to choose 3-bet bluffs.',
    sections: [
      {
        heading: 'Respect the opener’s position',
        body: [
          'An early-position open represents a strong range, so you continue tight: 3-bet QQ+/AK and a few blocker bluffs, call with pairs and strong suited broadways. Against a cutoff or button open you continue much wider, because their range is wide.',
          'Hands like KJo, QJo and A9o are the classic trap against early opens: when they win a pot it is small, and when they hit top pair they are often dominated by AK, AQ, KQ.',
        ],
      },
      {
        heading: 'Linear vs polarised 3-betting',
        body: [
          '- **Linear**: 3-bet your best hands (QQ+, AK, AQs) with no bluffs; good against players who call too much.',
          '- **Polarised**: 3-bet premiums plus some bluffs, and flat the middle. The best bluffs are suited aces (A5s–A2s): the ace blocks AA/AK, they make nut flushes and wheels, and they play well when called.',
          'Sizing: about 3x the open in position, 3.5–4x out of position, plus one open size per caller (a squeeze).',
        ],
      },
      {
        heading: 'Big blind defence',
        body: [
          'The big blind closes the action and already has chips in the pot, so it gets a great price. Against a 2.2bb button open, the pot is 2.2 + 0.5 + 1 + 1 (ante) = 4.7bb and you call 1.2bb to win 5.9bb: you need only about **20% equity**.',
          'That is why the BB defends around half its hands (or more) against late-position min-raises, including many offsuit hands. Against early opens it defends much tighter, because the opener’s range is strong and you are out of position.',
          'Minimum defence frequency (MDF) gives the same intuition: if the opener risks 2.2bb to win 2.5bb, the two blinds together must continue about 2.5 / 4.7 ≈ 53% of the time or the opener profits with any two cards.',
        ],
      },
      {
        heading: 'Small blind: 3-bet or fold',
        body: [
          'Flatting from the small blind lets the big blind squeeze and leaves you out of position in a multiway pot. Baseline strategy: mostly 3-bet or fold, calling only a few strong hands against late opens.',
        ],
      },
      {
        heading: 'Facing a 3-bet',
        body: [
          'Deep: 4-bet QQ+ and AK (plus a few A5s-type bluffs), call with JJ–88 and strong suited broadways in position, fold the rest. Out of position, call less.',
          'Under ~35bb: calling a 3-bet leaves awkward stacks. Jam or fold: TT+, AQs+, AK and a few more against wide 3-bettors.',
        ],
      },
    ],
    keyPoints: [
      'Continue tighter vs early opens, wider vs late opens.',
      'Avoid flatting dominated offsuit broadways against early opens.',
      'The big blind needs ~20% equity vs a 2.2bb steal: defend wide.',
      'Use suited aces as 3-bet bluffs; 3-bet ~3x IP, ~4x OOP.',
      'Short stacks facing a 3-bet: jam or fold.',
    ],
    quiz: [
      { q: 'BTN opens to 2.2bb. You are in the BB (BB ante in). What equity do you need to call?', options: ['About 20%', 'About 33%', 'About 45%', 'About 50%'], answer: 0, explain: 'Pot = 2.2 + 0.5 + 1 + 1 = 4.7bb. You call 1.2bb to win 5.9bb: 1.2 / 5.9 ≈ 20%.' },
      { q: 'Best 3-bet bluff candidate vs a cutoff open?', options: ['K7o', 'A4s', '72o', 'QJo'], answer: 1, explain: 'A4s blocks AA/AK, makes nut flushes and wheels, and plays well when called.' },
      { q: 'UTG opens. You are on the HJ with KJo. Baseline play?', options: ['3-bet', 'Call', 'Fold', 'Shove'], answer: 2, explain: 'KJo is dominated by UTG’s strong range (AK, AQ, KQ, AJ). Fold.' },
      { q: 'You opened with 28bb and face a 3-bet from the button. Which approach fits your stack?', options: ['Flat call most hands', 'Jam or fold', 'Always fold', 'Min 4-bet'], answer: 1, explain: 'At under ~35bb, calling a 3-bet leaves you committed with awkward stacks. Jam your continuing range or fold.' },
    ],
    drills: ['defend'],
  },
  {
    id: 'stack-depth',
    title: 'Playing by stack depth',
    track: 'Short stack & ICM',
    minutes: 10,
    summary: 'What changes at 100bb, 40bb, 25bb and 12bb: implied odds, commitment, re-shoves and push/fold.',
    sections: [
      {
        heading: '60bb and deeper',
        body: [
          'Implied odds exist: small pairs and suited connectors can call opens hoping to win a big pot. A common rule for set-mining is that the effective stack should be at least 15–20 times the call.',
          'Postflop skill matters most. Avoid stacking off with one pair in big pots.',
        ],
      },
      {
        heading: '30–60bb',
        body: [
          'Speculative calls lose value because you can’t win enough when you hit. Prefer 3-bet or fold over flatting, especially out of position.',
          'Opens should be small (2–2.2bb) so you can fold to a shove without losing much.',
        ],
      },
      {
        heading: '15–25bb: the re-shove zone',
        body: [
          'This is where many MTT chips change hands. Late-position players open wide; a stack of 15–25bb that **3-bet shoves** over the open wins the open plus the blinds and antes (often 5bb+, a quarter of your stack) whenever they fold, and still has equity when called.',
          'Good re-shove hands: pairs, strong aces (ATo+, A9s+ against late opens), KQ, KJs. The wider the opener, the wider you shove. Against early-position opens you re-shove much tighter.',
          'With 13–18bb, hands too weak to raise and call a shove but good enough to shove (small pairs, weak aces) are often best played as open-shoves.',
        ],
      },
      {
        heading: '12bb and less: push or fold',
        body: [
          'A raise that can’t call a shove wastes chips. Below about 12bb, open-shove or fold. The Push/Fold lesson and drill cover the ranges.',
          'Below about 5bb, fold equity disappears: shove very wide, especially from late position, because you will be called and need to win.',
        ],
      },
      {
        heading: 'Commitment',
        body: [
          'If a raise would put a third or more of your stack in the pot, you are committed: just shove. The same applies postflop with a low stack-to-pot ratio (SPR below about 3): top pair is usually good enough to get it in.',
        ],
      },
    ],
    keyPoints: [
      'Deep: implied odds, postflop play, avoid bloating pots with one pair.',
      '30–60bb: 3-bet or fold more, flat less.',
      '15–25bb: re-shoving over late opens is a major source of chips.',
      '≤12bb: open-shove or fold; ≤5bb: shove very wide.',
      'If a raise commits a third of your stack, shove instead.',
    ],
    quiz: [
      { q: 'You have 18bb in the SB. The button opens to 2.2bb. You hold A9o. Standard play?', options: ['Fold', 'Flat call', 'Re-shove all-in', 'Min 3-bet'], answer: 2, explain: 'Re-shoving wins 2.2 + 1 + 1 = 4.2bb of dead money uncontested often, and A9o has good equity against a button calling range.' },
      { q: 'With 9bb UTG+1 and 99, what do you do?', options: ['Raise to 2.2bb', 'Limp', 'Shove', 'Fold'], answer: 2, explain: 'At 9bb, raise-folding wastes chips and 99 is a clear shove.' },
      { q: 'Rule of thumb for set-mining with a small pair?', options: ['Effective stack ≥ 15–20x the call', 'Always call', 'Only in the big blind', 'Effective stack ≥ 5x the call'], answer: 0, explain: 'You flop a set about 12% of the time, so you need to win a big pot when you hit.' },
    ],
    drills: ['pushfold', 'defend'],
  },
  {
    id: 'pushfold',
    title: 'Push/fold and Nash ranges',
    track: 'Short stack & ICM',
    minutes: 12,
    summary: 'How equilibrium shoving and calling ranges work, why calling ranges are tighter, and the numbers to remember.',
    sections: [
      {
        heading: 'Why push/fold works',
        body: [
          'With a short stack, shoving gives your opponents only two options: call or fold. You win the blinds and antes every time they fold, and when they call you still have equity. A small raise, by contrast, lets them re-shove and forces you to fold or call with a bad price.',
          'A **Nash equilibrium** push/fold chart is a pair of strategies (shove range, call range) where neither side can do better by changing. If you shove the Nash range, no calling strategy can exploit you.',
        ],
      },
      {
        heading: 'Numbers to remember (chip EV, BB ante)',
        body: [
          'These come from the solver built into this app (Tools → Push/Fold charts), for an unopened pot with everyone at the same stack:',
        ],
        table: {
          head: ['Stack', 'UTG (8 behind)', 'CO (3 behind)', 'BTN (2 behind)', 'SB (vs BB)'],
          rows: [
            ['15bb', '≈10%', '≈30%', '≈33%', '≈65%'],
            ['12bb', '≈13%', '≈31%', '≈38%', '≈69%'],
            ['10bb', '≈15%', '≈32%', '≈42%', '≈73%'],
            ['8bb', '≈18%', '≈37%', '≈45%', '≈77%'],
            ['5bb', '≈34%', '≈54%', '≈61%', '≈87%'],
          ],
        },
      },
      {
        heading: 'Calling ranges are tighter than shoving ranges',
        body: [
          'The shover wins when everybody folds; the caller only wins at showdown. So you need a stronger hand to call a shove than to make one. At 10bb, the big blind calls a cutoff shove with about 30% of hands, while the cutoff shoves about 32%; against an UTG shove the BB calls only about 13%.',
          'To decide a call precisely, compare your equity against the shover’s range to the pot odds: required equity = call amount / (pot after your call). The Call vs Shove drill trains exactly this.',
        ],
      },
      {
        heading: 'Hands that play differently from their looks',
        body: [
          '- Small pairs are good shoves (they are ahead of or flipping with most calling hands) but weak calls at deeper stacks.',
          '- Any ace, even A2o, is a strong short-stack shove: it blocks the hands that would call.',
          '- Suited connectors like 76s are fine shoves from late position but poor calls: they are dominated by calling ranges.',
          '- Offsuit kings and queens (K7o, Q9o) are shoves from the small blind and button, not from early position.',
        ],
      },
      {
        heading: 'When not to use the chart',
        body: [
          'Charts assume opponents play correctly. Against very tight players, shove wider; against calling stations, shove tighter and lean on hand strength. Near the money, ICM tightens calling ranges a lot and shoving ranges somewhat.',
        ],
      },
    ],
    keyPoints: [
      'Short-stacked, shove or fold; don’t raise-fold.',
      'Shoving ranges widen as you get closer to the button and shorter.',
      'Calling ranges are tighter than shoving ranges.',
      'Any ace and small pairs are strong shoves; suited connectors are shoves, not calls.',
      'Adjust to opponents and to ICM.',
    ],
    quiz: [
      { q: 'At 10bb, roughly what share of hands does the SB shove against the BB (Nash, BB ante)?', options: ['About 25%', 'About 45%', 'About 73%', '100%'], answer: 2, explain: 'Heads-up with dead money in the pot and one player to get through, the SB shoves about 73% of hands at 10bb.' },
      { q: 'Why is the calling range tighter than the shoving range?', options: ['Callers have worse position', 'The shover also wins when everyone folds', 'Callers pay more chips', 'Charts are wrong'], answer: 1, explain: 'Fold equity gives the shover extra value that the caller doesn’t have.' },
      { q: '10bb in the cutoff, folded to you with 76s. Nash play?', options: ['Shove', 'Fold', 'Raise to 2bb', 'Limp'], answer: 0, explain: 'From the cutoff at 10bb, suited connectors like 76s are shoves (not calls).' },
      { q: 'Which is the best shove from UTG with 10bb?', options: ['K9o', 'A7s', 'Q8s', '98s'], answer: 1, explain: 'UTG shoves about 15%: 44+, A7s+, A5s, K9s+, Q9s+, J9s+, T9s, ATo+, KQo. A7s is in, the others are not.' },
    ],
    drills: ['pushfold', 'callshove'],
  },
  {
    id: 'pot-odds',
    title: 'Pot odds, equity and outs',
    track: 'Postflop',
    minutes: 10,
    summary: 'The maths behind every call: required equity, counting outs, implied odds and stack-to-pot ratio.',
    sections: [
      {
        heading: 'Required equity',
        body: [
          'To call a bet profitably (ignoring future streets), your chance of winning must beat **call / (pot after your call)**.',
        ],
        table: {
          head: ['Bet size', 'You need', 'Bluff must work'],
          rows: [
            ['1/3 pot', '20%', '25%'],
            ['1/2 pot', '25%', '33%'],
            ['2/3 pot', '29%', '40%'],
            ['Pot', '33%', '50%'],
            ['2x pot', '40%', '67%'],
          ],
        },
      },
      {
        heading: 'Counting outs',
        body: [
          'Outs are the unseen cards that improve you to the likely best hand. Rule of 4 and 2: on the flop, outs × 4 ≈ your chance by the river (if all-in); on the turn, outs × 2 ≈ your chance on the river.',
          '- Flush draw: 9 outs, about 35% by the river from the flop, 19.6% with one card.',
          '- Open-ended straight draw: 8 outs, about 31.5% / 17.4%.',
          '- Gutshot: 4 outs, about 16.5% / 8.7%.',
          '- Flush draw + open-ender: about 15 outs, roughly a coin flip against one pair.',
          'Discount outs that also help your opponent (for example a flush card that pairs the board when they may have a full house).',
        ],
      },
      {
        heading: 'Equity against a range, not a hand',
        body: [
          'You rarely know the exact hand. Estimate what your opponent can have after their actions: a player who bets big on the river is mostly value, a player who checks twice is capped. The coach in this app does this with a Bayesian range estimate: it narrows the opponent’s range at every action using how that player type actually plays.',
        ],
      },
      {
        heading: 'Implied odds and realisation',
        body: [
          'On the flop and turn, direct pot odds understate draws that win a big pot when they hit (implied odds) and overstate hands that are hard to play (reverse implied odds, like weak top pair out of position).',
          'Position helps you realise your equity: in position you see a free card more often and control the size of the pot.',
        ],
      },
      {
        heading: 'Stack-to-pot ratio (SPR)',
        body: [
          'SPR = effective stack / pot on the flop. With SPR below about 3, top pair is usually good enough to stack off. With SPR above 10, one-pair hands should keep the pot small, and big pots need two pair or better.',
        ],
      },
    ],
    keyPoints: [
      'Required equity = call / (pot after calling).',
      'Half-pot bet → you need 25%; pot bet → 33%.',
      'Rule of 4 and 2 converts outs to equity.',
      'Estimate equity against a range, narrowed by the opponent’s actions.',
      'Low SPR: commit with top pair. High SPR: pot control with one pair.',
    ],
    quiz: [
      { q: 'River: pot is 10bb, villain bets 5bb. What equity do you need to call?', options: ['20%', '25%', '33%', '50%'], answer: 1, explain: 'You call 5 to win a final pot of 20: 5 / 20 = 25%.' },
      { q: 'On the flop you have an open-ended straight draw. Roughly what is your chance of making it by the river if all-in?', options: ['17%', '24%', '31.5%', '45%'], answer: 2, explain: '8 outs: 1 − (39/47 × 38/46) ≈ 31.5%.' },
      { q: 'You bet pot as a bluff on the river. How often must your opponent fold for it to break even?', options: ['33%', '50%', '66%', '25%'], answer: 1, explain: 'Risk / (risk + reward) = 1 / (1 + 1) = 50%.' },
      { q: 'SPR on the flop is 2. You have top pair, good kicker. General plan?', options: ['Pot control and fold to raises', 'Happy to get stacks in', 'Check-fold', 'Only call'], answer: 1, explain: 'At low SPR, top pair is strong enough to commit.' },
    ],
    drills: ['potodds'],
  },
  {
    id: 'icm',
    title: 'ICM and bubble play',
    track: 'Short stack & ICM',
    minutes: 13,
    summary: 'How the Independent Chip Model turns stacks into money, what a risk premium is, and how each stack size should play the bubble.',
    sections: [
      {
        heading: 'The Independent Chip Model',
        body: [
          'ICM estimates each player’s share of the remaining prize pool from the stack sizes: your chance of finishing first equals your share of the chips, and the chances for lower places follow from removing winners one by one (Malmuth-Harville).',
          'Example: three players with 5,000 / 3,000 / 2,000 chips and payouts of 50 / 30 / 20. The chip leader has 50% of the chips but only **38.4%** of the money ($38.39). The middle stack has $32.75, and the short stack, with 20% of the chips, has **$28.86**. Chips are worth less the more you have.',
        ],
      },
      {
        heading: 'Risk premium and bubble factor',
        body: [
          'Because losing costs more than winning gains, you need more equity to call an all-in than pot odds say. The difference is the **risk premium**.',
          'A **bubble factor** (BF) measures this: $ lost when you lose / $ won when you win. Required equity becomes risk × BF / (risk × BF + reward). A coin-flip call that needs 50% in chips needs 60% with BF = 1.5 and 67% with BF = 2.',
          'The coach shows this directly: on the bubble it computes $EV with ICM across the whole field and tells you how much the required equity rose.',
        ],
      },
      {
        heading: 'Who feels the pressure',
        body: [
          '- **Medium stacks** that can be busted by a bigger stack have the highest bubble factors. They should avoid marginal all-ins, especially against the chip leader.',
          '- **Big stacks** risk the least and can open and shove very wide against medium stacks, who must fold.',
          '- **Short stacks** have less to lose relative to what they can gain but are about to be blinded out; they must still pick spots, ideally first in with fold equity.',
          'Pressure is strongest when shorter stacks exist at other tables: every player who busts before you moves you up.',
        ],
      },
      {
        heading: 'Shoving vs calling under ICM',
        body: [
          'ICM tightens **calling** ranges far more than **shoving** ranges. The shover wins the pot uncontested often, which is pure gain with no risk of busting. The caller is always risking their tournament.',
          'So on the bubble: be the one who shoves, and be careful being the one who calls.',
        ],
      },
      {
        heading: 'After the bubble and at the final table',
        body: [
          'Right after the bubble bursts, pay jumps are small and short stacks start gambling: good time to call shoves a bit lighter again and accumulate.',
          'At the final table every pay jump matters. ICM pressure peaks when a player is very short: the medium stacks should avoid confrontations with each other and let the short stack bust.',
          'Heads-up, ICM disappears: the difference between first and second is fixed, so chip EV and $EV are the same.',
        ],
      },
    ],
    keyPoints: [
      'ICM: chips have diminishing value; big stacks are worth less than their chip share.',
      'Required equity rises with the bubble factor: risk × BF / (risk × BF + reward).',
      'Medium stacks feel the most pressure; big stacks should attack them.',
      'ICM tightens calls much more than shoves.',
      'Heads-up there is no ICM.',
    ],
    quiz: [
      { q: 'Stacks 5,000 / 3,000 / 2,000, payouts 50/30/20. Roughly how much is the 5,000 stack worth?', options: ['$50', '$38', '$33', '$45'], answer: 1, explain: 'ICM gives about $38.39: far less than the 50% chip share.' },
      { q: 'A call needs 40% equity in chip terms. Your bubble factor is 1.5. Required equity?', options: ['40%', 'About 50%', 'About 60%', 'About 33%'], answer: 1, explain: 'Risk 40, reward 60: (40 × 1.5) / (40 × 1.5 + 60) = 60 / 120 = 50%.' },
      { q: 'On the bubble, which player should be the most careful about calling all-ins?', options: ['The chip leader', 'A medium stack facing the chip leader', 'A 2bb stack', 'Nobody'], answer: 1, explain: 'Medium stacks that can be busted have the highest bubble factors.' },
      { q: 'Which is affected more by ICM?', options: ['Shoving ranges', 'Calling ranges', 'Both equally', 'Neither'], answer: 1, explain: 'Shoves win uncontested often; calls always risk your tournament. ICM hits calls hardest.' },
    ],
    drills: ['icm'],
  },
  {
    id: 'satellites',
    title: 'Satellites: play for the seat',
    track: 'Short stack & ICM',
    minutes: 8,
    summary: 'Why every seat is worth the same, why that makes satellite bubbles the most extreme ICM spots in poker, and how each stack size should play them.',
    sections: [
      {
        heading: 'Every seat is worth the same',
        body: [
          'A satellite pays its winners with entries to a bigger event instead of a prize ladder. In the SPC Main Event satellite, ten S$60 entries buy one S$600 Main Event seat, and everyone who gets a seat gets exactly the same prize.',
          'So **the chip leader and the player who squeaks in with one big blind win the same thing**. There is no reward for finishing first, only for not finishing outside the seats. Money left after the last full seat (when the field is not a multiple of ten) usually goes as cash to the next finisher.',
        ],
      },
      {
        heading: 'Chips you do not need are worth almost nothing',
        body: [
          'In a normal tournament, extra chips are worth less than your first chips. In a satellite they can be worth **nothing**: once your stack is big enough that you will get a seat even if you fold every hand, winning more chips adds no prize, while losing them can cost you the seat.',
          'That is why bubble factors in satellites can reach 5, 10 or more, where a normal bubble rarely goes above 2 or 3. With a bubble factor of 5, a call that needs 33% equity in chips needs about 71%. Folding pocket kings, or even aces, can be correct when calling could knock you out and folding all but guarantees a seat.',
          'The satellite bubble also starts much earlier than a normal one. With 10 seats, the pressure is already strong at 15 or 16 players left.',
        ],
      },
      {
        heading: 'How each stack should play',
        body: [
          '- **Big stacks (comfortably safe):** stop playing. Fold almost everything, and do not call all-ins that could cost you your seat. The exception: calling a tiny shove from the big blind when it barely dents your stack, because a bust helps you too.',
          '- **Medium stacks:** the most dangerous spot. Avoid all-ins against anyone who covers you. Steal the blinds of other medium stacks only when they cannot profitably call.',
          '- **Short stacks:** you have to accumulate. Shove first in rather than call, and target the big stacks that should be folding. Before you gamble, check whether players at other tables are shorter than you: every one of them who busts first moves you closer to a seat.',
        ],
      },
      {
        heading: 'Playing a live satellite field',
        body: [
          'Many recreational players in a cheap live satellite do not adjust at all: they call shoves with any ace or pair on the bubble, even with a big stack. Against them, short-stack bluff shoves work less often, so shove a little tighter and value-shove more.',
          'At the same time, nobody will make you fold your way into a seat. If you are safe, let the players who ignore ICM knock each other out.',
          'Use the **SPC Satellite** and **SPC Satellite Bubble** formats on the Play page to practise this. The coach uses the satellite’s flat payouts when it grades your all-ins and calls.',
        ],
      },
    ],
    keyPoints: [
      'All seats are worth the same: 1st and the last seat win the same prize.',
      'Once you have enough chips to be nearly sure of a seat, extra chips are worth almost nothing: stop playing.',
      'Satellite bubble factors are huge, so calling ranges collapse; even big pairs can be folds.',
      'Short stacks must shove first in, ideally into big stacks who should fold, and watch for shorter stacks elsewhere.',
      'The satellite bubble starts early: with 10 seats, play tightens around 15 players left.',
    ],
    quiz: [
      { q: 'In a 10-seat satellite, what does the chip leader win compared with the 10th-place finisher?', options: ['About 3 times more', 'About 50% more', 'The same seat', 'Nothing extra, but they get a cash bonus'], answer: 2, explain: 'Every seat is the same prize. Finishing first earns nothing extra.' },
      { q: 'Why are bubble factors so much higher in satellites than in normal tournaments?', options: ['The blinds go up faster', 'Winning chips adds little to a seat you will probably get, while losing can cost the whole seat', 'Players are worse', 'There is no ante'], answer: 1, explain: 'Bubble factor = $ you lose when you lose ÷ $ you gain when you win. With flat prizes, the gain is small and the loss can be the whole seat.' },
      { q: 'You have enough chips to be almost certain of a seat. 13 players are left for 10 seats. What is usually best?', options: ['Keep raising to build a bigger lead', 'Fold almost every hand and let others bust', 'Call any all-in with a pair', 'Shove every button'], answer: 1, explain: 'Extra chips win nothing. Folding keeps your seat while the short stacks bust.' },
      { q: 'Satellite bubble: you are the big stack in the big blind and cover everyone easily. A 2bb stack shoves; it costs you 1bb more to call with 9-4 offsuit. Call or fold?', options: ['Fold: never call on a satellite bubble', 'Call: it costs very little of your stack and can bust a player', 'Raise all-in', 'It depends only on your cards'], answer: 1, explain: 'You risk almost nothing that matters to your seat, and a bust brings everyone, including you, closer to the seats. The pot odds make the call easy.' },
    ],
    drills: ['icm'],
  },
  {
    id: 'postflop-cbet',
    title: 'C-betting and board texture',
    track: 'Postflop',
    minutes: 10,
    summary: 'When the preflop raiser should bet the flop, how big, and which boards call for caution.',
    sections: [
      {
        heading: 'Range advantage',
        body: [
          'The preflop raiser has more strong hands (overpairs, AK, AQ) than the caller, especially on high-card boards. On boards like A-7-2 rainbow or K-8-3 the raiser can bet small (25–33% pot) with most of their range: the caller has few strong hands and must fold a lot.',
          'On low, connected boards like 7-6-5 or 8-7-4 two-tone, the caller (especially the big blind) has more two pairs, sets and straights. Here the raiser should check more often and bet bigger when betting.',
        ],
      },
      {
        heading: 'Texture checklist',
        body: [
          '- **Dry** (K-7-2 rainbow, A-8-3): few draws. Small c-bets, high frequency.',
          '- **Wet** (J-T-8 two-tone, 9-8-6): many draws and strong hands for the caller. Bet less often, larger (60–75%).',
          '- **Paired** (Q-Q-5, 7-7-2): few strong hands for anyone. Small bets work well.',
          '- **Monotone** (three of one suit): bet small and less often; hands without the suit lose value.',
        ],
      },
      {
        heading: 'Multiway and position',
        body: [
          'C-bet much less often against two or more opponents: someone usually has a piece of the board. In position you can check back more hands and still realise equity; out of position, checking often means giving up.',
        ],
      },
      {
        heading: 'Turn barrels',
        body: [
          'Keep betting on turn cards that improve your range (overcards like an ace or king when you raised preflop) or your hand (draws that picked up equity). Slow down on cards that complete obvious draws for the caller.',
        ],
      },
    ],
    keyPoints: [
      'Dry, high boards: c-bet small and often.',
      'Low connected boards favour the caller: check more, bet bigger when you do.',
      'Multiway: c-bet much less.',
      'Barrel good turn cards for your range; slow down when draws complete.',
    ],
    quiz: [
      { q: 'You opened the button, the BB called. Flop A♠7♦2♣. Typical strategy?', options: ['Check always', 'Small c-bet with most of your range', 'Overbet shove', 'Bet only with an ace'], answer: 1, explain: 'Dry ace-high boards strongly favour the raiser: bet small, often.' },
      { q: 'Flop 7♥6♥5♣ after you opened UTG and the BB called. What changes?', options: ['Nothing', 'Check more; the board favours the BB', 'C-bet 100% small', 'Always shove'], answer: 1, explain: 'Low connected boards hit the BB’s range (two pairs, straights, sets) much more than UTG’s.' },
      { q: 'Three players see the flop. Your c-bet frequency should…', options: ['Increase', 'Decrease', 'Stay the same', 'Be 100%'], answer: 1, explain: 'With more opponents, someone connects more often.' },
    ],
    drills: ['potodds'],
  },
  {
    id: 'value-bluff',
    title: 'Value betting and bluffing',
    track: 'Postflop',
    minutes: 11,
    summary: 'Betting for value, choosing bluffs, defending against bets, and using blockers.',
    sections: [
      {
        heading: 'Value betting',
        body: [
          'A bet is for value when worse hands call more than half the time you get called. Most players at low and mid stakes do not value bet thin enough on the river, especially against opponents who call too much.',
          'Against calling stations: bet top pair for three streets and size up. Against nits: bet thinner only if they call with worse; otherwise check back and take the showdown.',
        ],
      },
      {
        heading: 'Bluffing',
        body: [
          'A bluff needs the opponent to fold often enough: bet / (pot + bet). A half-pot bluff must work 33% of the time, a pot-size bluff 50%.',
          'Choose bluffs that **block** the hands your opponent calls with and **unblock** the hands they fold. Holding the ace of the flush suit on a three-flush river makes a great bluff because the opponent can’t have the nut flush.',
          'Don’t bluff players who don’t fold. It is the most expensive leak against recreational players.',
        ],
      },
      {
        heading: 'Balanced river betting',
        body: [
          'With a polarised range (very strong hands or nothing), the ratio of value bets to bluffs that makes your opponent indifferent depends on your size: for a pot-size bet, 2 value : 1 bluff; for a half-pot bet, 3 value : 1 bluff.',
        ],
      },
      {
        heading: 'Defending against bets',
        body: [
          'Minimum defence frequency = pot / (pot + bet): against a pot-size bet you must continue with 50% of your range to stop any two cards from profiting. Use this as a guide, not a rule: most players under-bluff big river bets, so folding more than MDF against them is correct.',
          'Your best bluff-catchers are hands that beat bluffs and block value hands.',
        ],
      },
    ],
    keyPoints: [
      'Bet for value when worse hands call; bet thinner vs stations.',
      'Bluffs need fold equity: bet / (pot + bet).',
      'Use blockers to choose bluffs and bluff-catchers.',
      'Pot-size bets: 2:1 value to bluffs. Most players under-bluff big rivers.',
    ],
    quiz: [
      { q: 'You bet half pot on the river as a bluff. How often must it work?', options: ['25%', '33%', '50%', '66%'], answer: 1, explain: '0.5 / (1 + 0.5) = 33%.' },
      { q: 'Against a calling station, the river goes check to you with top pair, decent kicker. Best play?', options: ['Check back', 'Bet for value, often bigger', 'Bluff-raise', 'Fold'], answer: 1, explain: 'Stations call with worse pairs; bet for value and size up.' },
      { q: 'Minimum defence frequency against a pot-size bet?', options: ['33%', '50%', '67%', '75%'], answer: 1, explain: 'Pot / (pot + bet) = 1 / 2 = 50%.' },
      { q: 'Which makes the best river bluff on a board with three hearts?', options: ['A hand with the A♥', 'A hand with no hearts', 'A hand with a small heart', 'It doesn’t matter'], answer: 0, explain: 'Holding A♥ means your opponent can’t have the nut flush: you block their strongest calls.' },
    ],
    drills: ['potodds'],
  },
  {
    id: 'final-table',
    title: 'Final table and heads-up',
    track: 'Game plan',
    minutes: 10,
    summary: 'Pay jumps, short-handed ranges, using your stack as a weapon, and closing out heads-up.',
    sections: [
      {
        heading: 'Pay jumps change everything',
        body: [
          'At the final table each elimination moves everyone up a pay jump. With a very short stack at the table, medium stacks should avoid each other and let the short stack bust. The chip leader can open almost any two cards into those medium stacks.',
          'Watch every stack, not just your own: who can bust you, who you can bust, and who is about to be forced all-in.',
        ],
      },
      {
        heading: 'Short-handed ranges',
        body: [
          'With six or fewer players, the blinds come around faster and every seat is a late position. Open wider (the earliest seat at six-handed plays like a lojack), defend wider and 3-bet more.',
        ],
      },
      {
        heading: 'Heads-up',
        body: [
          'The button is the small blind and acts first preflop, last postflop. Deep heads-up, raise or limp most hands from the button (70–100%) and defend the big blind very wide.',
          'Short heads-up, push/fold: at 10bb the SB shoves about 73% of hands and the BB calls about 56%. Any ace, any pair and most kings are strong heads-up hands.',
          'ICM no longer applies: play for chips.',
        ],
      },
    ],
    keyPoints: [
      'Each bust is a pay jump: medium stacks avoid each other when a short stack is present.',
      'Chip leaders apply pressure; watch every stack.',
      'Short-handed: open, defend and 3-bet wider.',
      'Heads-up: very wide ranges; no ICM.',
    ],
    quiz: [
      { q: 'Final table, 6 left. You are second in chips; the chip leader shoves into you and there is a 3bb stack at the table. You have AJo. Tendency?', options: ['Call any ace', 'Fold more often than chip EV suggests', 'Always call', 'Min-raise'], answer: 1, explain: 'With a very short stack about to bust, ICM pressure on medium stacks is high; call only with strong hands.' },
      { q: 'Heads-up with 10bb in the SB. Approximately how wide does Nash shove?', options: ['20%', '45%', '73%', '100%'], answer: 2, explain: 'About 73% with a BB ante. Heads-up ranges are very wide.' },
      { q: 'Does ICM matter heads-up?', options: ['Yes, a lot', 'No: first minus second is fixed', 'Only with antes', 'Only for the short stack'], answer: 1, explain: 'With two players left, $EV is linear in chips.' },
    ],
    drills: ['pushfold', 'icm'],
  },
  {
    id: 'exploits',
    title: 'Exploiting player types',
    track: 'Game plan',
    minutes: 9,
    summary: 'Read opponents from HUD stats and adjust: what to do against nits, stations, maniacs and regulars.',
    sections: [
      {
        heading: 'Reading the HUD',
        body: [
          'VPIP (voluntarily put money in pot) and PFR (preflop raise) are the first two stats to trust; they become meaningful after about 30–50 hands. The table below shows typical signatures of the player types you will meet in this app.',
        ],
        table: {
          head: ['Type', 'VPIP / PFR', 'Tells', 'Adjustment'],
          rows: [
            ['Nit', '< 14 / < 11', 'Folds a lot, tightens near the money', 'Steal relentlessly; respect their raises'],
            ['TAG', '18–24 / 15–20', 'Solid, a little too tight on later streets', 'Steal and 3-bet their late opens; respect big turn/river bets'],
            ['LAG', '28–35 / 23–30', '3-bets and barrels a lot', 'Widen value ranges, call down lighter, 4-bet your strong hands'],
            ['Calling station', '35+ / < 10', 'Limps, calls, rarely folds a pair', 'Never bluff; value bet thin and big'],
            ['Recreational', '30–45 / 5–15', 'Limps, calls too wide, bets when strong', 'Isolate limps, value bet, believe big bets'],
            ['Maniac', '45+ / 35+', 'Raises everything, bluffs every street', 'Tighten up, trap, call down with medium hands'],
          ],
        },
      },
      {
        heading: 'Isolating limpers',
        body: [
          'When a weak player limps, raise to about 3bb + 1bb per limper with a range a little tighter than your normal open. You get heads-up, in position, against a weak range with the initiative.',
        ],
      },
      {
        heading: 'Bet sizing tells',
        body: [
          'Recreational players often size by hand strength: big bets are strong, small bets are weak or drawing. Against them, fold more to big bets and raise small ones.',
        ],
      },
    ],
    keyPoints: [
      'Identify types with VPIP/PFR first.',
      'Steal from nits, value bet stations, trap maniacs.',
      'Isolate limpers with raises.',
      'Most players under-bluff large river bets.',
    ],
    quiz: [
      { q: 'HUD shows VPIP 42 / PFR 6 after 80 hands. Best adjustment?', options: ['Bluff them more', 'Value bet thinner and avoid bluffs', 'Fold more preflop', 'Limp behind them'], answer: 1, explain: 'This is a calling station: they call too much, so bluffs fail and thin value wins.' },
      { q: 'A nit on the bubble folds to steals 80% of the time from the big blind. You are on the button. Your steal range should…', options: ['Tighten', 'Widen a lot', 'Stay the same', 'Only premiums'], answer: 1, explain: 'High fold frequency plus ICM pressure: steal very wide.' },
      { q: 'A recreational player limps from middle position. You have AJo on the cutoff. Play?', options: ['Over-limp', 'Raise to about 4bb', 'Fold', 'Shove 60bb'], answer: 1, explain: 'Isolate with a raise of about 3bb + 1bb per limper.' },
    ],
    drills: ['rfi'],
  },
  {
    id: 'mental',
    title: 'Variance, bankroll and review',
    track: 'Game plan',
    minutes: 7,
    summary: 'What winning looks like in MTTs, how much bankroll you need, and how to review your play.',
    sections: [
      {
        heading: 'Variance is enormous',
        body: [
          'Even a strong player cashes only about 15–20% of the time and most profit comes from rare deep runs. Long losing streaks of 50–100 tournaments are normal. Judge yourself on decisions, not results; that is what the grades in this app measure.',
        ],
      },
      {
        heading: 'Bankroll',
        body: [
          'Common guidance for online MTTs is at least 100 buy-ins for your average tournament, and more (200+) for very large fields or if poker pays your bills. Move down after a downswing rather than taking shots to win it back.',
        ],
      },
      {
        heading: 'How to review',
        body: [
          '- Review your biggest mistakes first (the Analyze page sorts them by cost).',
          '- Look for patterns, not single hands: the leak list groups mistakes by type.',
          '- Practise the matching drill until the right answer is automatic.',
          '- Ignore bad beats. If the money went in good, you played well.',
        ],
      },
      {
        heading: 'Tilt',
        body: [
          'Set a stop rule before you play (for example, stop after two bad beats in a row or a set loss). Take breaks between tournaments. Tilt shows up in the data as higher VPIP and more loose calls: check your stats after bad sessions.',
        ],
      },
    ],
    keyPoints: [
      'Cashing 15–20% of the time is normal; profit comes from rare deep runs.',
      'Keep 100+ buy-ins for MTTs.',
      'Judge decisions, not results. Review mistakes by pattern.',
    ],
    quiz: [
      { q: 'You have lost 40 tournaments in a row but your decision grades are good. Most likely explanation?', options: ['You are a losing player', 'Normal MTT variance', 'The site is rigged', 'You should play only premiums'], answer: 1, explain: 'Long losing streaks are normal in MTTs; decision quality is the better signal.' },
      { q: 'A sensible minimum bankroll for online MTTs?', options: ['10 buy-ins', '30 buy-ins', '100+ buy-ins', '5 buy-ins'], answer: 2, explain: 'Because of variance, 100+ buy-ins is the usual minimum.' },
    ],
    drills: [],
  },
];

export const lessonById = (id: string) => LESSONS.find((l) => l.id === id);
