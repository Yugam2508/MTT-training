/** Prize structures. Returns prizes in dollars by finishing place (index 0 = 1st). */

export function paidPlaces(entrants: number): number {
  if (entrants <= 6) return 1;
  if (entrants <= 10) return 3;
  if (entrants <= 20) return 4;
  if (entrants <= 30) return 5;
  return Math.max(6, Math.round(entrants * 0.15));
}

/**
 * Typical online MTT curve: prize_k proportional to 1/k^alpha, with a min-cash of
 * roughly 1.5-2.5 buy-ins for large fields. Rounded to cents, remainder to 1st.
 */
export function payoutStructure(entrants: number, buyIn: number): number[] {
  const paid = paidPlaces(entrants);
  const pool = entrants * buyIn;
  if (paid === 1) return [pool];
  if (paid === 3 && entrants <= 10) return [0.5, 0.3, 0.2].map((f) => Math.round(pool * f * 100) / 100);
  if (paid === 4) return [0.4, 0.3, 0.2, 0.1].map((f) => Math.round(pool * f * 100) / 100);
  if (paid === 5) return [0.36, 0.25, 0.18, 0.12, 0.09].map((f) => Math.round(pool * f * 100) / 100);
  const alpha = paid > 40 ? 1.05 : 0.95;
  const w = Array.from({ length: paid }, (_, k) => 1 / Math.pow(k + 1, alpha));
  const sum = w.reduce((a, b) => a + b, 0);
  const prizes = w.map((x) => Math.floor((pool * x * 100) / sum) / 100);
  const rem = Math.round((pool - prizes.reduce((a, b) => a + b, 0)) * 100) / 100;
  prizes[0] = Math.round((prizes[0] + rem) * 100) / 100;
  return prizes;
}

/**
 * Satellite: every seat has the same value. Seats = the guarantee or as many full seats as the
 * pool buys, whichever is more; money left after the last full seat is paid as cash to the next place.
 */
export function satellitePayouts(entrants: number, buyIn: number, seatValue: number, guaranteedSeats: number): number[] {
  const pool = entrants * buyIn;
  const seats = Math.max(guaranteedSeats, Math.floor(pool / seatValue + 1e-9));
  const prizes: number[] = new Array(seats).fill(seatValue);
  const left = Math.round((pool - seats * seatValue) * 100) / 100;
  if (left > 0) prizes.push(left);
  return prizes;
}

/** Remaining payouts for ICM given how many players are left. */
export function remainingPayouts(allPrizes: readonly number[], playersLeft: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < playersLeft; k++) out.push(allPrizes[k] ?? 0);
  return out;
}
