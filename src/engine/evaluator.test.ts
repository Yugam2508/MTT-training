import { evaluate, categoryOf, describeScore } from './evaluator';
import { parseCards } from './cards';
import { calcEquity } from './equity';
import { makeRng } from './rng';
import { parseRange, formatRange, rangeCombos } from './ranges';
import { classFromName, className, classOfCards, NUM_CLASSES } from './combos';

const ev = (s: string) => evaluate(parseCards(s));

describe('evaluator', () => {
  it('ranks categories', () => {
    const hands = [
      'As Kd 9h 7c 3s 2d 4h', // high card
      'As Ad 9h 7c 3s', // pair
      'As Ad 9h 9c 3s', // two pair
      'As Ad Ah 9c 3s', // trips
      'As Kd Qh Jc Ts', // straight
      'Ah 2h 3h 9h Th', // flush
      'As Ad Ah 9c 9s', // full house
      'As Ad Ah Ac 9s', // quads
      '9h Th Jh Qh Kh', // straight flush
    ];
    hands.forEach((h, i) => expect(categoryOf(ev(h))).toBe(i));
  });
  it('handles the wheel and compares straights', () => {
    expect(categoryOf(ev('Ah 2c 3d 4s 5h 9c Kd'))).toBe(4);
    expect(ev('Ah 2c 3d 4s 5h')).toBeLessThan(ev('2c 3d 4s 5h 6d'));
    expect(categoryOf(ev('Ah 2h 3h 4h 5h Kc Qd'))).toBe(8);
  });
  it('uses kickers correctly', () => {
    expect(ev('As Ad Kh 7c 3s')).toBeGreaterThan(ev('Ac Ah Qh Jc 9s'));
    expect(ev('7s 7d 7h Ac 3s')).toBeGreaterThan(ev('7s 7d 7h Kc Qs'));
    expect(ev('7s 7d 7h Ac 3s')).toBeLessThan(ev('7s 7d 7h Ac 4s'));
    expect(ev('As Ad 9h 9c Ks')).toBeGreaterThan(ev('As Ad 9h 9c Qs'));
    // three pairs: best two + best kicker
    expect(ev('As Ad 9h 9c 5s 5d Kc')).toBe(ev('As Ad 9h 9c Kc'));
    expect(ev('As Ad 9h 9c 5s 5d 2c')).toBe(ev('As Ad 9h 9c 5s'));
    // two trips -> full house
    expect(categoryOf(ev('9s 9d 9h 5c 5s 5d Kc'))).toBe(6);
    expect(ev('9s 9d 9h 5c 5s 5d Kc')).toBeGreaterThan(ev('8s 8d 8h Ac As 2d Kc'));
    expect(ev('Kh Kd 2c 2d Qs Js 9h')).toBeGreaterThan(ev('Kh Kd 2c 2d Js Ts 9h'));
  });
  it('flush beats straight in 7 cards and picks best flush', () => {
    expect(categoryOf(ev('2h 5h 9h Jh Kh Tc Qd'))).toBe(5);
    expect(ev('Ah 5h 9h Jh 2h 3h Qd')).toBeGreaterThan(ev('Kh Qh 9h Jh 2h 3c Qd'));
  });
  it('describes hands', () => {
    expect(describeScore(ev('As Ad Ah 9c 9s'))).toBe('Full House, Aces full of Nines');
    expect(describeScore(ev('Ts Js Qs Ks As'))).toBe('Royal Flush');
  });
});

describe('equity', () => {
  it('AA vs KK is about 82%', () => {
    const r = calcEquity([{ cards: parseCards('AsAh') as [number, number] }, { cards: parseCards('KsKh') as [number, number] }], [], 30000, makeRng(1));
    expect(r.equity[0]).toBeGreaterThan(0.80);
    expect(r.equity[0]).toBeLessThan(0.84);
  });
  it('exact on the turn', () => {
    const r = calcEquity(
      [{ cards: parseCards('AhKh') as [number, number] }, { cards: parseCards('QsQd') as [number, number] }],
      parseCards('2h 7h Tc 3s'),
    );
    expect(r.exact).toBe(true);
    // 9 hearts + 3 aces + 3 kings = 15 outs of 44
    expect(r.equity[0]).toBeCloseTo(15 / 44, 5);
  });
});

describe('ranges', () => {
  it('parses and formats', () => {
    const r = parseRange('22+, A2s+, KTo+, QJs, AKo:0.5');
    expect(rangeCombos(r)).toBeCloseTo(13 * 6 + 12 * 4 + 3 * 12 + 4 + 6, 5);
    expect(r[classFromName('AKo')]).toBe(0.5);
    const f = formatRange(parseRange('77+, A9s+, KTs+, AJo+, KQo, A5s:0.5'));
    expect(f).toContain('77+');
    expect(f).toContain('A9s+');
    expect(f).toContain('A5s:0.5');
  });
  it('maps classes', () => {
    expect(className(classFromName('AKs'))).toBe('AKs');
    expect(className(classFromName('T9o'))).toBe('T9o');
    expect(className(classOfCards(parseCards('7h')[0], parseCards('7d')[0]))).toBe('77');
    expect(NUM_CLASSES).toBe(169);
  });
});
