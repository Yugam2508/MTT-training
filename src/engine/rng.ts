/** Small seeded PRNG (mulberry32). Deterministic so hands and drills are reproducible. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Current seed state (to resume/replay). */
  state(): number;
}

export function makeRng(seed: number = (Math.random() * 2 ** 32) >>> 0): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    state: () => s,
  };
}

export function randomSeed(): number {
  return (Math.random() * 2 ** 32) >>> 0;
}

export function shuffleInPlace<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

export function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[rng.int(arr.length)];
}
