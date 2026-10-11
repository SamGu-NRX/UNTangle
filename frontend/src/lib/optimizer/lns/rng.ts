/**
 * Local seeded PRNG for the LNS variant — the mulberry32 pattern of
 * bench/rng.ts (itself mirroring tests/schedule-oracle.test.ts), implemented
 * here so lns/ owns its randomness: Math.random is never used, so the same
 * request makes the same search decisions, always.
 */

export type LnsRng = () => number;

/** Deterministic PRNG in [0, 1). Same seed, same stream. */
export function mulberry32(seed: number): LnsRng {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle of a copy; deterministic given the rng stream. */
export function shuffled<T>(rng: LnsRng, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}
