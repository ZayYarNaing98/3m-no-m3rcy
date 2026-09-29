/**
 * Deterministic PRNG (mulberry32). The engine never calls Math.random, so a game
 * is fully reproducible from its seed and action log.
 */
export function nextRandom(rngState: number): [value: number, rngState: number] {
  let t = (rngState + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Fisher–Yates shuffle in place; returns the new rng state. */
export function shuffleInPlace<T>(items: T[], rngState: number): number {
  let s = rngState;
  for (let i = items.length - 1; i > 0; i--) {
    let r: number;
    [r, s] = nextRandom(s);
    const j = Math.floor(r * (i + 1));
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return s;
}
