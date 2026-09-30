import { createHand, applyAction, legalActions, potSize, replay, toMove, type HandConfig, type SeatInput, type HandState } from './hand';
import { parseCards, fullDeck } from './cards';
import { makeRng, shuffleInPlace } from './rng';

const cfg: HandConfig = { sb: 50, bb: 100, ante: 100, anteMode: 'bb' };
const seats = (stacks: number[]): SeatInput[] => stacks.map((s, i) => ({ id: `p${i}`, name: `P${i}`, seat: i + 1, stack: s }));
const total = (s: HandState) => s.players.reduce((a, p) => a + p.stack, 0) + (s.done ? 0 : potSize(s));

/** Deck with given hole cards (in seat order) followed by a board, then the rest. */
function stackedDeck(holes: string[], board: string): number[] {
  const pre = [...holes.flatMap((h) => parseCards(h)), ...parseCards(board)];
  const rest = fullDeck().filter((c) => !pre.includes(c));
  return [...pre, ...rest];
}

describe('hand engine', () => {
  it('posts blinds and BB ante, first actor is UTG', () => {
    const s = createHand(cfg, seats([10000, 10000, 10000, 10000]), 0, fullDeck());
    expect(s.sbI).toBe(1);
    expect(s.bbI).toBe(2);
    expect(s.toAct).toBe(3);
    expect(potSize(s)).toBe(250);
    expect(s.players[2].stack).toBe(9800);
  });

  it('fold around: BB wins blinds and gets ante back', () => {
    const s = createHand(cfg, seats([10000, 10000, 10000, 10000]), 0, fullDeck());
    applyAction(s, { type: 'fold' });
    applyAction(s, { type: 'fold' });
    applyAction(s, { type: 'fold' });
    expect(s.done).toBe(true);
    expect(s.result!.net[2]).toBe(50);
    expect(s.result!.net[1]).toBe(-50);
    expect(total(s)).toBe(40000);
  });

  it('heads-up: button is SB and acts first preflop, last postflop', () => {
    const s = createHand(cfg, seats([5000, 5000]), 0, fullDeck());
    expect(s.sbI).toBe(0);
    expect(s.bbI).toBe(1);
    expect(s.toAct).toBe(0);
    applyAction(s, { type: 'call' });
    expect(s.toAct).toBe(1); // BB option
    applyAction(s, { type: 'check' });
    expect(s.street).toBe(1);
    expect(s.toAct).toBe(1); // BB first postflop
  });

  it('min-raise rules and short all-in does not reopen betting', () => {
    // UTG raises to 300, CO shoves 450 total (short raise: 150 < 200), UTG can only call/fold
    const s = createHand(cfg, seats([10000, 10000, 10000, 10000, 450]), 0, fullDeck());
    // order: button 0, sb 1, bb 2, utg 3, co 4
    expect(s.toAct).toBe(3);
    let l = legalActions(s);
    expect(l.minRaiseTo).toBe(200);
    applyAction(s, { type: 'raise', to: 300 });
    expect(s.toAct).toBe(4);
    applyAction(s, { type: 'raise', to: 450 }); // all-in short raise
    expect(s.players[4].allIn).toBe(true);
    applyAction(s, { type: 'fold' }); // btn
    applyAction(s, { type: 'fold' }); // sb
    // BB has not acted since the last full raise, so BB may re-raise
    l = legalActions(s);
    expect(s.toAct).toBe(2);
    expect(l.canRaise).toBe(true);
    expect(l.minRaiseTo).toBe(650); // 450 + last full raise size 200
    applyAction(s, { type: 'call' });
    // UTG faces only a short raise after acting: call or fold only
    expect(s.toAct).toBe(3);
    l = legalActions(s);
    expect(l.canRaise).toBe(false);
    expect(l.toCall).toBe(150);
  });

  it('side pots with three all-ins pay correctly', () => {
    // p0 btn 1000 (AA), p1 sb 3000 (KK), p2 bb 6000 (QQ); board blanks
    const deck = stackedDeck(['AsAh', 'KsKh', 'QsQh'], '2c 7d 9c 3h 4d');
    const s = createHand({ sb: 50, bb: 100, ante: 0, anteMode: 'none' }, seats([1000, 3000, 6000]), 0, deck);
    applyAction(s, { type: 'raise', to: 1000 }); // btn all-in
    applyAction(s, { type: 'raise', to: 3000 }); // sb all-in
    applyAction(s, { type: 'call' }); // bb calls 3000
    expect(s.done).toBe(true);
    const r = s.result!;
    expect(r.showdown).toBe(true);
    expect(r.pots.map((p) => p.amount)).toEqual([3000, 4000]);
    expect(s.players[0].stack).toBe(3000);
    expect(s.players[1].stack).toBe(4000);
    expect(s.players[2].stack).toBe(3000);
  });

  it('returns uncalled bets', () => {
    const s = createHand({ sb: 50, bb: 100, ante: 0, anteMode: 'none' }, seats([10000, 10000, 2000]), 0, fullDeck());
    applyAction(s, { type: 'raise', to: 10000 }); // btn shoves 10k
    applyAction(s, { type: 'fold' });
    applyAction(s, { type: 'call' }); // bb calls 2000 all-in
    expect(s.done).toBe(true);
    expect(s.result!.refunds[0]).toBe(8000);
    expect(s.players.reduce((a, p) => a + p.stack, 0)).toBe(22000);
  });

  it('splits pots and conserves chips in random play (fuzz)', () => {
    const rng = makeRng(42);
    for (let h = 0; h < 3000; h++) {
      const n = 2 + rng.int(8);
      const stacks = Array.from({ length: n }, () => 1 + rng.int(20000));
      const deck = shuffleInPlace(fullDeck(), rng);
      const c: HandConfig = { sb: 50, bb: 100, ante: rng.next() < 0.5 ? 100 : 0, anteMode: rng.next() < 0.5 ? 'bb' : 'all' };
      const s = createHand(c, seats(stacks), rng.int(n), deck);
      const before = stacks.reduce((a, b) => a + b, 0);
      let guard = 0;
      while (!s.done) {
        const l = legalActions(s);
        const x = rng.next();
        if (x < 0.15 && l.canFold) applyAction(s, { type: 'fold' });
        else if (x < 0.55) applyAction(s, l.canCheck ? { type: 'check' } : { type: 'call' });
        else if (l.canRaise) applyAction(s, { type: 'raise', to: l.minRaiseTo + rng.int(Math.max(1, l.maxRaiseTo - l.minRaiseTo + 1)) });
        else applyAction(s, l.canCheck ? { type: 'check' } : { type: 'call' });
        if (++guard > 500) throw new Error('hand did not terminate');
      }
      const after = s.players.reduce((a, p) => a + p.stack, 0);
      expect(after).toBe(before);
      for (const p of s.players) expect(p.stack).toBeGreaterThanOrEqual(0);
      // replay reproduces the same result
      const moves = s.actions.map(toMove).filter((m) => m !== null) as never[];
      const r = replay({ cfg: c, seats: seats(stacks), button: s.button, deck, moves });
      expect(r.players.map((p) => p.stack)).toEqual(s.players.map((p) => p.stack));
    }
  });
});
