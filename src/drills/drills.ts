/** Drill generators. Each question has a correct answer computed from the app's own models. */
import { type Card, fullDeck, cardsToString } from '../engine/cards';
import { makeRng, shuffleInPlace, type Rng } from '../engine/rng';
import { NUM_CLASSES, CLASS_COMBOS, COMBO_A, COMBO_B, className, classComboCount, classOfCards } from '../engine/combos';
import { type Range, rangePercent, topPercentRange } from '../engine/ranges';
import { eqVsRange, classesByRawEquity } from '../engine/preflopMatrix';
import { calcEquity } from '../engine/equity';
import { evaluate } from '../engine/evaluator';
import { nashPush, nashCallBB, pushMaxTable } from '../theory/pushfoldCharts';
import { rfiRange, vsOpenRanges, classesByPlayability } from '../theory/charts';
import { type ChartPos, POS_LABEL, posGroup } from '../theory/positions';
import { icmBatch } from '../theory/icm';
import { payoutStructure } from '../theory/payouts';
import type { DrillId } from '../analysis/leaks';

export interface DrillSeat { name: string; stackBB: number; pos?: string; note?: string; hero?: boolean }

export interface DrillQuestion {
  id: string;
  drill: DrillId;
  title: string;
  prompt: string;
  heroCards: [Card, Card];
  board?: Card[];
  seats?: DrillSeat[];
  facts: { label: string; value: string }[];
  options: { key: string; label: string }[];
  correct: string[];
  explain: string[];
  chart?: { label: string; range: Range; hero: number; second?: Range; secondLabel?: string };
}

export interface DrillInfo {
  id: DrillId;
  title: string;
  blurb: string;
  make: (rng: Rng) => DrillQuestion;
}

const PUSH_POS: { k: number; pos: string }[] = [
  { k: 8, pos: 'UTG' }, { k: 7, pos: 'UTG+1' }, { k: 6, pos: 'UTG+2' }, { k: 5, pos: 'LJ' }, { k: 4, pos: 'HJ' },
  { k: 3, pos: 'CO' }, { k: 2, pos: 'BTN' }, { k: 1, pos: 'SB' },
];

function cardsForClass(h: number, rng: Rng): [Card, Card] {
  const combos = CLASS_COMBOS[h];
  const k = combos[rng.int(combos.length)];
  return [COMBO_A[k], COMBO_B[k]];
}

/** Pick a class, biased towards the edge of `range` so questions are instructive. */
function pickEdgeClass(range: Range, rng: Rng, edgeBias = 0.65): number {
  if (rng.next() > edgeBias) {
    let x = rng.next() * 1326;
    for (let h = 0; h < NUM_CLASSES; h++) { x -= classComboCount(h); if (x <= 0) return h; }
    return NUM_CLASSES - 1;
  }
  const order = classesByPlayability();
  const inR = order.filter((h) => range[h] > 0);
  const lastIn = inR.length ? order.indexOf(inR[inR.length - 1]) : 0;
  const lo = Math.max(0, lastIn - 14), hi = Math.min(order.length - 1, lastIn + 14);
  return order[lo + rng.int(hi - lo + 1)];
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
let qid = 0;
const nextId = () => `q${Date.now().toString(36)}${(qid++).toString(36)}`;

// ---------------- push/fold ----------------
function makePushFold(rng: Rng): DrillQuestion {
  const p = PUSH_POS[Math.min(PUSH_POS.length - 1, Math.floor(Math.pow(rng.next(), 0.8) * PUSH_POS.length))];
  const stack = 3 + rng.int(25) * 0.5; // 3 .. 15
  const range = nashPush(p.k, stack);
  const h = pickEdgeClass(range, rng);
  const push = range[h] > 0;
  const maxTbl = pushMaxTable(p.k);
  const max = maxTbl[h];
  return {
    id: nextId(), drill: 'pushfold', title: 'Push or fold?',
    prompt: `Folded to you in the ${p.pos} with ${stack.toFixed(1)}bb. Everyone has you covered. Blinds 0.5/1 with a 1bb big blind ante.`,
    heroCards: cardsForClass(h, rng),
    facts: [
      { label: 'Position', value: p.pos },
      { label: 'Stack', value: `${stack.toFixed(1)}bb` },
      { label: 'Players behind', value: String(p.k) },
      { label: 'Pot before you act', value: '2.5bb' },
    ],
    options: [{ key: 'push', label: 'Shove' }, { key: 'fold', label: 'Fold' }],
    correct: [push ? 'push' : 'fold'],
    explain: [
      `Nash shoves ${rangePercent(range).toFixed(0)}% of hands from the ${p.pos} at ${stack.toFixed(1)}bb.`,
      max > 0 ? `${className(h)} is a shove from this seat up to ${max.toFixed(1)}bb${max >= 25 ? ' or more' : ''}.` : `${className(h)} is never a shove from this seat in the 1–25bb chart.`,
      push ? 'Folding it gives up the blinds and antes you win every time everyone folds.' : 'Too many hands behind you can call and dominate it.',
    ],
    chart: { label: `${p.pos} shove range at ${stack.toFixed(1)}bb`, range, hero: h },
  };
}

// ---------------- call vs shove ----------------
function makeCallShove(rng: Rng): DrillQuestion {
  const p = PUSH_POS[rng.int(PUSH_POS.length)];
  const stack = 5 + rng.int(21) * 0.5; // 5..15
  const pushR = nashPush(p.k, stack);
  const callR = nashCallBB(p.k, stack);
  const h = pickEdgeClass(callR, rng);
  const eq = eqVsRange(h, pushR);
  // BB: posted 1bb + 1bb ante, stacks equal (villain has `stack`, hero has `stack` before posting)
  const heroMax = stack - 1; // ante is dead
  const eff = Math.min(stack, heroMax);
  const call = eff - 1;
  const pot = eff * 2 + 1 + (p.k === 1 ? 0 : 0.5);
  const req = call / pot;
  const doCall = callR[h] > 0;
  return {
    id: nextId(), drill: 'callshove', title: 'Call or fold vs a shove?',
    prompt: `${p.pos === 'SB' ? 'The small blind' : `A ${stack.toFixed(1)}bb player in the ${p.pos}`} shoves ${stack.toFixed(1)}bb. Everyone else folds. You are in the big blind with the same stack (you posted 1bb and the 1bb ante).`,
    heroCards: cardsForClass(h, rng),
    facts: [
      { label: 'Shover', value: `${p.pos}, ${stack.toFixed(1)}bb` },
      { label: 'To call', value: `${call.toFixed(1)}bb` },
      { label: 'Pot if you call', value: `${pot.toFixed(1)}bb` },
      { label: 'Needed equity', value: pct(req) },
    ],
    options: [{ key: 'call', label: 'Call' }, { key: 'fold', label: 'Fold' }],
    correct: [doCall ? 'call' : 'fold'],
    explain: [
      `The ${p.pos} shoves ${rangePercent(pushR).toFixed(0)}% of hands here (Nash).`,
      `${className(h)} has ${pct(eq)} equity against that range; you need ${pct(req)}.`,
      `Nash calls with ${rangePercent(callR).toFixed(0)}% of hands: ${doCall ? `${className(h)} is a call.` : `${className(h)} is a fold.`}`,
    ],
    chart: { label: `Call range vs ${p.pos} shove`, range: callR, hero: h, second: pushR, secondLabel: 'Their shove range' },
  };
}

// ---------------- ICM bubble / final table ----------------
function makeICM(rng: Rng): DrillQuestion {
  const finalTable = rng.next() < 0.5;
  const entrants = finalTable ? 180 : 90;
  const prizes = payoutStructure(entrants, finalTable ? 55 : 22);
  const n = finalTable ? 5 + rng.int(5) : prizes.length + 1; // FT: 5-9 left; bubble: one off the money
  const avg = 16 + rng.int(14);
  const stacks = Array.from({ length: n }, () => Math.max(3, Math.round(avg * Math.exp((rng.next() - 0.5) * 1.4))));
  const order = stacks.map((_, i) => i).sort((a, b) => stacks[b] - stacks[a]);
  // shover (small blind): usually a big stack; hero (big blind): a medium stack
  const shover = rng.next() < 0.6 ? order[0] : order[1 + rng.int(Math.max(1, Math.floor(n / 2)))];
  let hero = order[Math.floor(n / 3) + rng.int(Math.max(1, Math.floor(n / 3)))];
  if (hero === shover) hero = order[order.length - 1] === shover ? order[order.length - 2] : order[order.length - 1];
  const H = stacks[hero], S = stacks[shover];
  const matched = Math.min(S, H - 1); // hero's ante (1bb) is dead
  const pot = 2 * matched + 1;
  const call = matched - 1; // hero already posted the 1bb blind
  const chipReq = call / pot;
  const shoverRange = scaleForStack(Math.min(S, H), 1, shover === order[0]);
  const payouts = Array.from({ length: n }, (_, i) => prizes[i] ?? 0);
  const fold = stacks.slice(); fold[hero] = H - 2; fold[shover] = S + 2;
  const win = stacks.slice(); win[hero] = H + matched; win[shover] = S - matched;
  const lose = stacks.slice(); lose[hero] = H - 1 - matched; lose[shover] = S + matched + 1;
  const [vf, vw, vl] = icmBatch([fold, win, lose], payouts, 20000, 3).map((e) => e[hero]);
  const icmReq = vw - vl > 0 ? (vf - vl) / (vw - vl) : 1;
  // half the questions use a hand whose equity falls between the chip and ICM thresholds
  const tricky = rng.next() < 0.5;
  let h = 0, eq = 0;
  for (let tries = 0; tries < 400; tries++) {
    h = rng.int(NUM_CLASSES);
    eq = eqVsRange(h, shoverRange);
    if (!tricky) break;
    if (eq > Math.min(chipReq, icmReq) && eq < Math.max(chipReq, icmReq)) break;
  }
  const doCall = eq > icmReq;
  const seats: DrillSeat[] = stacks.map((st, i) => ({
    name: i === hero ? 'You' : i === shover ? 'Small blind' : `Player ${i + 1}`,
    stackBB: st,
    hero: i === hero,
    note: i === shover ? 'shoves' : i === hero ? 'big blind' : undefined,
  }));
  const ord = (i: number) => `${i + 1}${['st', 'nd', 'rd'][i] ?? 'th'}`;
  return {
    id: nextId(), drill: 'icm', title: finalTable ? `Final table, ${n} left` : `Bubble: ${n} left, ${prizes.length} paid`,
    prompt: `The small blind (${S}bb) shoves. You are in the big blind with ${H}bb (1bb blind and 1bb ante posted). Payouts: ${payouts.slice(0, Math.min(n, 6)).map((x, i) => `${ord(i)} $${x.toFixed(0)}`).join(', ')}${n > 6 ? ', …' : ''}${finalTable ? '' : `, ${ord(n - 1)} $0`}.`,
    heroCards: cardsForClass(h, rng),
    seats,
    facts: [
      { label: 'To call', value: `${call.toFixed(0)}bb` },
      { label: 'Pot if you call', value: `${pot.toFixed(0)}bb` },
      { label: 'Chip EV needs', value: pct(chipReq) },
      { label: 'ICM needs', value: pct(icmReq) },
    ],
    options: [{ key: 'call', label: 'Call' }, { key: 'fold', label: 'Fold' }],
    correct: [doCall ? 'call' : 'fold'],
    explain: [
      `Estimated shoving range: ${rangePercent(shoverRange).toFixed(0)}% of hands. ${className(h)} has ${pct(eq)} equity against it.`,
      `Pot odds alone say you need ${pct(chipReq)}. With ICM you need ${pct(icmReq)}: a risk premium of ${((icmReq - chipReq) * 100).toFixed(1)} points.`,
      eq > chipReq && !doCall ? 'This is the classic ICM fold: profitable in chips, losing in money.' : doCall ? 'You have enough equity even after the risk premium: call.' : 'Not enough equity even in chip terms: fold.',
    ],
    chart: { label: 'Their estimated shove range', range: shoverRange, hero: h },
  };
}

function scaleForStack(effBB: number, behind: number, isLeader: boolean): Range {
  const base = nashPush(behind, Math.max(1, Math.min(25, effBB)));
  const p = rangePercent(base) * (isLeader ? 1.4 : 1);
  return topPercentRange(Math.min(100, p), classesByRawEquity());
}

// ---------------- opening ranges ----------------
const RFI_POS: ChartPos[] = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB'];
function makeRFI(rng: Rng): DrillQuestion {
  const pos = RFI_POS[rng.int(RFI_POS.length)];
  const r = rfiRange(pos);
  const h = pickEdgeClass(r, rng, 0.75);
  const w = r[h];
  const correct = w >= 0.75 ? ['raise'] : w > 0 ? ['raise', 'fold'] : ['fold'];
  return {
    id: nextId(), drill: 'rfi', title: 'Open or fold?',
    prompt: `Folded to you in the ${POS_LABEL[pos]} with 40bb. 9-handed, BB ante.`,
    heroCards: cardsForClass(h, rng),
    facts: [{ label: 'Position', value: POS_LABEL[pos] }, { label: 'Stack', value: '40bb' }, { label: 'Range size', value: `${rangePercent(r).toFixed(0)}%` }],
    options: [{ key: 'raise', label: 'Raise 2.2bb' }, { key: 'fold', label: 'Fold' }],
    correct,
    explain: [
      `The ${POS_LABEL[pos]} opens about ${rangePercent(r).toFixed(0)}% of hands.`,
      w >= 0.75 ? `${className(h)} is a standard open.` : w > 0 ? `${className(h)} is a mixed hand (${Math.round(w * 100)}%): both are fine.` : `${className(h)} is below the opening range from this seat.`,
    ],
    chart: { label: `${POS_LABEL[pos]} opening range`, range: r, hero: h },
  };
}

// ---------------- facing opens ----------------
const DEF_SPOTS: { hero: ChartPos; opener: ChartPos }[] = [
  { hero: 'BB', opener: 'BTN' }, { hero: 'BB', opener: 'CO' }, { hero: 'BB', opener: 'UTG' }, { hero: 'BB', opener: 'SB' },
  { hero: 'BB', opener: 'HJ' }, { hero: 'BTN', opener: 'CO' }, { hero: 'BTN', opener: 'UTG' }, { hero: 'CO', opener: 'HJ' },
  { hero: 'SB', opener: 'BTN' }, { hero: 'SB', opener: 'CO' }, { hero: 'HJ', opener: 'UTG1' },
];
function makeDefend(rng: Rng): DrillQuestion {
  const sp = DEF_SPOTS[rng.int(DEF_SPOTS.length)];
  const { threeBet, call } = vsOpenRanges(sp.hero, posGroup(sp.opener));
  const both = new Float64Array(NUM_CLASSES);
  for (let i = 0; i < NUM_CLASSES; i++) both[i] = Math.min(1, threeBet[i] + call[i]);
  const h = pickEdgeClass(both, rng, 0.75);
  const f3 = threeBet[h], fc = Math.min(call[h], 1 - f3), ff = Math.max(0, 1 - f3 - fc);
  const freqs: [string, number][] = [['3bet', f3], ['call', fc], ['fold', ff]];
  const mx = Math.max(f3, fc, ff);
  const correct = freqs.filter(([, f]) => f >= 0.3 || f === mx).map(([k]) => k);
  return {
    id: nextId(), drill: 'defend', title: 'Facing an open',
    prompt: `The ${POS_LABEL[sp.opener]} opens to 2.2bb. Folded to you in the ${POS_LABEL[sp.hero]} with 40bb.`,
    heroCards: cardsForClass(h, rng),
    facts: [
      { label: 'Opener', value: POS_LABEL[sp.opener] },
      { label: 'You', value: POS_LABEL[sp.hero] },
      { label: '3-bet range', value: `${rangePercent(threeBet).toFixed(0)}%` },
      { label: 'Call range', value: `${rangePercent(call).toFixed(0)}%` },
    ],
    options: [{ key: '3bet', label: '3-bet' }, { key: 'call', label: 'Call' }, { key: 'fold', label: 'Fold' }],
    correct,
    explain: [
      `Baseline vs a ${posGroup(sp.opener)} open from the ${POS_LABEL[sp.hero]}: 3-bet ${rangePercent(threeBet).toFixed(0)}%, call ${rangePercent(call).toFixed(0)}%.`,
      `${className(h)}: 3-bet ${Math.round(f3 * 100)}%, call ${Math.round(fc * 100)}%, fold ${Math.round(ff * 100)}%.`,
      sp.hero === 'BB' ? 'The big blind closes the action and gets a big discount, so it defends wide.' : sp.hero === 'SB' ? 'From the small blind, prefer 3-bet or fold: flatting invites a squeeze and plays out of position.' : 'In position you can flat more hands; against early opens stay tight.',
    ],
    chart: { label: '3-bet (dark) / call (light)', range: threeBet, second: call, secondLabel: 'Call', hero: h },
  };
}

// ---------------- pot odds & outs ----------------
function makePotOdds(rng: Rng): DrillQuestion {
  for (let attempt = 0; attempt < 400; attempt++) {
    const deck = shuffleInPlace(fullDeck(), rng);
    const hero: [Card, Card] = [deck[0], deck[1]];
    const vill: [Card, Card] = [deck[2], deck[3]];
    const street = rng.next() < 0.5 ? 3 : 4; // board cards
    const board = deck.slice(4, 4 + street);
    const hs = evaluate([...hero, ...board]);
    const vs = evaluate([...vill, ...board]);
    if (hs >= vs) continue;
    const res = calcEquity([{ cards: hero }, { cards: vill }], board);
    const eq = res.equity[0];
    if (eq < 0.12 || eq > 0.5) continue;
    // outs on the next card
    const used = new Set([...hero, ...vill, ...board]);
    let outs = 0;
    for (let c = 0; c < 52; c++) {
      if (used.has(c)) continue;
      if (evaluate([...hero, ...board, c]) > evaluate([...vill, ...board, c])) outs++;
    }
    const fracs = [0.33, 0.5, 0.66, 0.75, 1, 1.5];
    const f = fracs[rng.int(fracs.length)];
    const pot = 10 + rng.int(20);
    const bet = Math.round(pot * f);
    const req = bet / (pot + 2 * bet);
    const askOuts = rng.next() < 0.35;
    const rule = street === 3 ? Math.min(100, outs * 4) : outs * 2;
    const streetName = street === 3 ? 'flop' : 'turn';
    const common = [
      `You have ${outs} outs on the next card. Rule of ${street === 3 ? '4' : '2'}: about ${rule}%; exact equity ${street === 3 ? 'by the river (all-in)' : 'on the river'}: ${pct(eq)}.`,
      `Villain bets ${bet}bb into ${pot}bb: you call ${bet} to win ${pot + 2 * bet}, so you need ${pct(req)}.`,
    ];
    if (askOuts) {
      const opts = new Set<number>([outs]);
      while (opts.size < 4) opts.add(Math.max(1, outs + (rng.int(9) - 4)));
      const sorted = [...opts].sort((a, b) => a - b);
      return {
        id: nextId(), drill: 'potodds', title: 'Count your outs',
        prompt: `On the ${streetName}, your opponent shows ${cardsToString(vill)} (face up for this drill). How many cards win for you on the next card?`,
        heroCards: hero, board,
        facts: [{ label: 'Villain', value: cardsToString(vill) }, { label: 'Street', value: streetName }],
        options: sorted.map((o) => ({ key: String(o), label: `${o} outs` })),
        correct: [String(outs)],
        explain: common,
      };
    }
    return {
      id: nextId(), drill: 'potodds', title: 'Call or fold?',
      prompt: `On the ${streetName}, your opponent shows ${cardsToString(vill)} (face up for this drill) and moves all-in for ${bet}bb into a ${pot}bb pot. No more betting after this.`,
      heroCards: hero, board,
      facts: [{ label: 'Pot', value: `${pot}bb` }, { label: 'Bet', value: `${bet}bb (${Math.round(f * 100)}% pot)` }, { label: 'Villain', value: cardsToString(vill) }],
      options: [{ key: 'call', label: 'Call' }, { key: 'fold', label: 'Fold' }],
      correct: [eq >= req ? 'call' : 'fold'],
      explain: [...common, eq >= req ? `${pct(eq)} ≥ ${pct(req)}: call.` : `${pct(eq)} < ${pct(req)}: fold.`],
    };
  }
  return makePotOdds(makeRng(rng.int(1e9)));
}

export const DRILLS: DrillInfo[] = [
  { id: 'pushfold', title: 'Push or fold', blurb: 'Short-stack open shoves from every seat, checked against Nash charts.', make: makePushFold },
  { id: 'callshove', title: 'Call vs shove', blurb: 'Big blind calling decisions against short-stack shoves: equity vs pot odds.', make: makeCallShove },
  { id: 'icm', title: 'ICM bubble calls', blurb: 'Bubble and final-table calls where chip EV and $EV disagree.', make: makeICM },
  { id: 'rfi', title: 'Opening ranges', blurb: 'Raise or fold first in from each position at 40bb.', make: makeRFI },
  { id: 'defend', title: 'Facing an open', blurb: '3-bet, call or fold against opens from different seats, including big blind defence.', make: makeDefend },
  { id: 'potodds', title: 'Pot odds & outs', blurb: 'Count outs and make calls with exact equity and pot odds.', make: makePotOdds },
];

export const drillById = (id: string) => DRILLS.find((d) => d.id === id);
export { classOfCards };
