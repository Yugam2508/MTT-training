/** Screen-name generator for opponents. */
import type { Rng } from '../engine/rng';

const A = ['River', 'Nut', 'Shove', 'Tilt', 'Ace', 'Donk', 'Grind', 'Chip', 'Bluff', 'Felt', 'Deep', 'Short', 'Lucky', 'Cold', 'Snap',
  'Quad', 'Turbo', 'Rail', 'Nit', 'Slow', 'Fold', 'Value', 'Monkey', 'Silent', 'Wild', 'Iron', 'Salty', 'Crush', 'Flop', 'Kicker',
  'Ninja', 'Sharky', 'Tank', 'Punt', 'Stack', 'Dealer', 'Sunday', 'Mad', 'Rounder', 'Gutshot'];
const B = ['Rat', 'King', 'Queen', 'Wizard', 'Hunter', 'Maker', 'Boss', 'Runner', 'Dog', 'Master', 'Bandit', 'Machine', 'Fish', 'Shark',
  'Crusher', 'Goblin', 'Pilot', 'Viking', 'Wolf', 'Owl', 'Samurai', 'Lord', 'Kid', 'Ghost', 'Baron', 'Cowboy', 'Tiger', 'Bear',
  'Grinder', 'Nomad', 'Gambler', 'Magician', 'Monk', 'Hero', 'Captain', 'Rider'];

export function makeNames(count: number, rng: Rng): string[] {
  const out = new Set<string>();
  let guard = 0;
  while (out.size < count && guard++ < count * 50) {
    const style = rng.int(4);
    const a = A[rng.int(A.length)], b = B[rng.int(B.length)];
    let n: string;
    if (style === 0) n = `${a}${b}`;
    else if (style === 1) n = `${a}${b}${rng.int(99) + 1}`;
    else if (style === 2) n = `${a.toLowerCase()}_${b.toLowerCase()}`;
    else n = `${b}Of${a}`;
    out.add(n);
  }
  while (out.size < count) out.add(`Player${out.size + 1}`);
  return [...out];
}
