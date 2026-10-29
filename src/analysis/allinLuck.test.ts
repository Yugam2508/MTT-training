import { allInOf, allInLuck } from './allinLuck';
import { parseCards, fullDeck } from '../engine/cards';
import type { HandRecord } from '../tournament/tournament';

/** Heads-up hand: hero (seat 0, button/SB) shoves, villain calls; the deck fixes cards and board. */
function shoveHand(hero: string, villain: string, board: string, id = 'h1'): HandRecord {
  const fixed = [...parseCards(hero), ...parseCards(villain), ...parseCards(board)];
  const deck = [...fixed, ...fullDeck().filter((c) => !fixed.includes(c))];
  return {
    id, tid: 't', handNo: 1, ts: 1, level: 1, cfg: { sb: 50, bb: 100, ante: 0, anteMode: 'none' }, button: 0,
    seats: [{ id: 'hero', name: 'You', seat: 0, stack: 1000, isHero: true, profile: 'hero', pos: 'BTN' }, { id: 'v', name: 'V', seat: 1, stack: 1000, profile: 'tag', pos: 'BB' }],
    deck, moves: [{ type: 'raise', to: 1000 }, { type: 'call' }], heroIndex: 0, tableId: 1, playersLeft: 2, paid: 1, entrants: 2,
    stage: 'final', avgStackBB: 10, heroStartBB: 10, heroNet: 0, heroNetBB: 0, flags: {} as never,
  } as HandRecord;
}

describe('all-in luck', () => {
  it('prices a cooler that lost: AA all-in preflop against KK, king on the river', () => {
    const a = allInOf(shoveHand('Ah As', 'Kh Kd', '2c 7d 9s 3h Kc'))!;
    expect(a.street).toBe(0);
    expect(a.equity).toBeGreaterThan(0.78);
    expect(a.equity).toBeLessThan(0.86);
    expect(a.won).toBe(false);
    expect(a.actualBB).toBe(0);
    // a 20bb pot at ~82% is worth ~16.4bb; winning nothing is ~16bb of bad luck
    expect(a.expectedBB).toBeCloseTo(20 * a.equity, 5);
    expect(a.luckBB).toBeCloseTo(-a.expectedBB, 5);
    expect(a.forStack).toBe(true);
  });

  it('counts a suck-out as good luck and sums a batch', () => {
    const r = allInLuck([shoveHand('Kh Kd', 'Ah As', '2c 7d 9s 3h Kc', 'a'), shoveHand('Ah As', 'Kh Kd', '2c 7d 9s 3h Kc', 'b')]);
    expect(r.count).toBe(2);
    expect(r.won).toBe(1);
    expect(r.expectedWins).toBeCloseTo(1, 1);
    // the same cooler from both sides: the luck cancels out
    expect(Math.abs(r.luckBB)).toBeLessThan(1);
    expect(r.list[0].luckBB).toBeGreaterThan(14);
  });

  it('ignores hands without an all-in run-out', () => {
    const h = shoveHand('Ah As', 'Kh Kd', '2c 7d 9s 3h Kc');
    expect(allInOf({ ...h, moves: [{ type: 'fold' }] })).toBeNull();
  });
});
