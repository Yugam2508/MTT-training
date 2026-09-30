/**
 * Independent Chip Model (Malmuth-Harville).
 * - Exact dynamic programming over "set of already-placed players" when the state space is small.
 * - Plackett-Luce Monte Carlo otherwise (sampling E_i/stack_i with exponential E_i gives exactly
 *   the Harville finishing-order distribution). A batch API reuses the same random numbers for
 *   several stack vectors (common random numbers) so EV differences are low-noise.
 */
import { makeRng } from '../engine/rng';

/** payouts[k] = prize for finishing place k+1 among the players still in. */
export type Payouts = readonly number[];

/** ICM $ equity for each stack. Zero stacks are treated as busted in this outcome (they take the lowest places). */
export function icmEquity(stacks: readonly number[], payouts: Payouts): number[] {
  return icmBatch([stacks], payouts)[0];
}

/**
 * ICM equities for several stack vectors over the same players (e.g. the outcomes of an all-in).
 */
export function icmBatch(vectors: readonly (readonly number[])[], payouts: Payouts, mcSamples = 4000, seed = 7): number[][] {
  const n = vectors[0].length;
  const paid = payouts.reduce((c, p) => (p > 0 ? c + 1 : c), 0);
  if (paid === 0) return vectors.map(() => new Array(n).fill(0));
  const maxAlive = Math.max(...vectors.map((v) => v.filter((s) => s > 0).length));
  if (maxAlive <= 16) {
    return vectors.map((v) => icmExact(v, payouts));
  }
  return icmMonteCarlo(vectors, payouts, mcSamples, seed);
}

function assignBusted(stacks: readonly number[], payouts: Payouts, alive: number[], out: number[]) {
  // Busted players (stack 0) occupy the bottom places; split those prizes evenly.
  const busted = stacks.map((s, i) => (s > 0 ? -1 : i)).filter((i) => i >= 0);
  if (!busted.length) return;
  const n = stacks.length;
  let pool = 0;
  for (let place = alive.length; place < n; place++) pool += payouts[place] ?? 0;
  for (const i of busted) out[i] = pool / busted.length;
}

export function icmExact(stacks: readonly number[], payouts: Payouts): number[] {
  const n = stacks.length;
  const out = new Array(n).fill(0);
  const alive = stacks.map((s, i) => (s > 0 ? i : -1)).filter((i) => i >= 0);
  assignBusted(stacks, payouts, alive, out);
  const m = alive.length;
  if (m === 0) return out;
  if (m === 1) { out[alive[0]] += payouts[0] ?? 0; return out; }
  const s = alive.map((i) => stacks[i]);
  const total = s.reduce((a, b) => a + b, 0);
  const places = Math.min(m, payouts.length);
  const size = 1 << m;
  // prob[mask] = probability that exactly the players in `mask` took the top |mask| places.
  // Every predecessor of a mask is numerically smaller, so one ascending pass suffices.
  const prob = new Float64Array(size);
  const used = new Float64Array(size);
  const pop = new Uint8Array(size);
  const eq = new Float64Array(m);
  prob[0] = 1;
  for (let mask = 0; mask < size; mask++) {
    if (mask) {
      const low = mask & -mask;
      const j = 31 - Math.clz32(low);
      used[mask] = used[mask ^ low] + s[j];
      pop[mask] = pop[mask ^ low] + 1;
    }
    const p = prob[mask];
    if (p === 0) continue;
    const place = pop[mask];
    if (place >= places) continue;
    const rem = total - used[mask];
    if (rem <= 0) continue;
    const prize = payouts[place] ?? 0;
    for (let j = 0; j < m; j++) {
      const bit = 1 << j;
      if (mask & bit) continue;
      const pj = (p * s[j]) / rem;
      eq[j] += pj * prize;
      if (place + 1 < places) prob[mask | bit] += pj;
    }
  }
  for (let j = 0; j < m; j++) out[alive[j]] += eq[j];
  return out;
}

function icmMonteCarlo(vectors: readonly (readonly number[])[], payouts: Payouts, samples: number, seed: number): number[][] {
  const n = vectors[0].length;
  const rng = makeRng(seed);
  const outs = vectors.map(() => new Float64Array(n));
  const keys = new Float64Array(n);
  const order = new Int32Array(n);
  const e = new Float64Array(n);
  const paid = payouts.length;
  for (let s = 0; s < samples; s++) {
    for (let i = 0; i < n; i++) e[i] = -Math.log(1 - rng.next());
    for (let v = 0; v < vectors.length; v++) {
      const st = vectors[v];
      for (let i = 0; i < n; i++) { keys[i] = st[i] > 0 ? e[i] / st[i] : Infinity; order[i] = i; }
      // partial selection sort for the paid places
      const lim = Math.min(paid, n);
      for (let p = 0; p < lim; p++) {
        let best = p;
        for (let j = p + 1; j < n; j++) if (keys[order[j]] < keys[order[best]]) best = j;
        const t = order[p]; order[p] = order[best]; order[best] = t;
        if (keys[order[p]] === Infinity) {
          // everyone left is busted: split remaining prizes among busted players
          const bust: number[] = [];
          for (let q = p; q < n; q++) bust.push(order[q]);
          let pool = 0;
          for (let q = p; q < lim; q++) pool += payouts[q];
          for (const b of bust) outs[v][b] += pool / bust.length;
          break;
        }
        outs[v][order[p]] += payouts[p];
      }
    }
  }
  return outs.map((o) => Array.from(o, (x) => x / samples));
}

/**
 * Bubble factor for player `i` against player `j` if they got all-in against each other:
 * (equity lost when losing) / (equity gained when winning). 1.0 means chip EV = $EV.
 */
export function bubbleFactor(stacks: readonly number[], payouts: Payouts, i: number, j: number): number {
  const risk = Math.min(stacks[i], stacks[j]);
  if (risk <= 0) return 1;
  const win = stacks.slice(); win[i] += risk; win[j] -= risk;
  const lose = stacks.slice(); lose[i] -= risk; lose[j] += risk;
  const [base, w, l] = icmBatch([stacks, win, lose], payouts, 3000);
  const gain = w[i] - base[i];
  const loss = base[i] - l[i];
  if (gain <= 1e-9) return 3;
  return Math.max(1, Math.min(4, loss / gain));
}

/** Required equity to call risking `risk` to win `win` (chips) with a bubble factor. */
export function requiredEquity(risk: number, win: number, bf = 1): number {
  return (risk * bf) / (risk * bf + win);
}
