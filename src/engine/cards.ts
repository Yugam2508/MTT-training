/**
 * Cards are integers 0..51: rank = card >> 2 (0 = deuce .. 12 = ace), suit = card & 3 (c, d, h, s).
 */
export type Card = number;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];
export const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
export const RANK_PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

export const rankOf = (c: Card) => c >> 2;
export const suitOf = (c: Card) => c & 3;
export const makeCard = (rank: number, suit: number): Card => (rank << 2) | suit;

export function cardToString(c: Card): string {
  return RANK_CHARS[rankOf(c)] + SUIT_CHARS[suitOf(c)];
}

export function cardsToString(cs: readonly Card[]): string {
  return cs.map(cardToString).join(' ');
}

export function parseCard(s: string): Card {
  const r = RANK_CHARS.indexOf(s[0].toUpperCase());
  const su = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error(`Bad card: ${s}`);
  return makeCard(r, su);
}

/** Parses "AsKd", "As Kd" or "As,Kd". */
export function parseCards(s: string): Card[] {
  const clean = s.replace(/[\s,]+/g, '');
  if (clean.length % 2 !== 0) throw new Error(`Bad cards: ${s}`);
  const out: Card[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseCard(clean.slice(i, i + 2)));
  return out;
}

export function fullDeck(): Card[] {
  const d: Card[] = [];
  for (let c = 0; c < 52; c++) d.push(c);
  return d;
}
