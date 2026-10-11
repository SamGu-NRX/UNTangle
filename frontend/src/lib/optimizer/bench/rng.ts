/**
 * Seeded PRNG helpers for the benchmark. The mulberry32 pattern matches the
 * one already used in tests/schedule-oracle.test.ts. Everything in bench/
 * draws randomness from here — Math.random is NEVER used, so a suite seed
 * fully reproduces its instances.
 */

export type Rng = () => number;

/** Deterministic PRNG in [0, 1). Same seed, same stream. */
export function mulberry32(seed: number): Rng {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [minInclusive, maxInclusive]. */
export function randInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

/** Uniform pick from a non-empty list. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("rng.pick: empty list");
  return items[Math.floor(rng() * items.length)];
}

/** Fisher-Yates shuffle of a copy; deterministic given the rng stream. */
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/** True with the given probability. */
export function maybe(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

/** Round to `digits` decimal places (deterministic float hygiene). */
export function round2(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
