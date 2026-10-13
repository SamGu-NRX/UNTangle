/**
 * Where a released bottom sheet should come to rest.
 *
 * The sheet's position is its visible height in pixels. On release we
 * project where the drag's momentum would carry it (the same decay iOS uses
 * for scroll), snap to the detent nearest that projection, and make sure a
 * quick flick always moves at least one detent in its direction even when
 * the projection falls short.
 */

/** Apple's projection: distance a release velocity carries before it decays, in px. */
export function projectMomentum(velocityPxPerMs: number, decelerationRate = 0.998): number {
  const velocityPxPerS = velocityPxPerMs * 1000;
  return ((velocityPxPerS / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Faster than this counts as a flick (px/ms), per the design's sheet rule. */
export const FLICK_VELOCITY = 0.11;

/**
 * @param visible current visible height (px)
 * @param velocity px/ms, positive when the sheet is growing (finger moving up)
 * @param detents visible heights, any order
 * @returns index into `detents`
 */
export function chooseDetent(visible: number, velocity: number, detents: readonly number[]): number {
  if (detents.length === 0) throw new Error("chooseDetent needs at least one detent");
  const projected = visible + projectMomentum(velocity);
  let nearest = 0;
  for (let index = 1; index < detents.length; index += 1) {
    if (Math.abs(detents[index] - projected) < Math.abs(detents[nearest] - projected)) nearest = index;
  }
  if (Math.abs(velocity) <= FLICK_VELOCITY) return nearest;

  // A flick must land past where it started, in its own direction.
  const direction = Math.sign(velocity);
  if (Math.sign(detents[nearest] - visible) === direction) return nearest;
  let best = -1;
  for (let index = 0; index < detents.length; index += 1) {
    const ahead = (detents[index] - visible) * direction;
    if (ahead > 0 && (best === -1 || ahead < (detents[best] - visible) * direction)) best = index;
  }
  return best === -1 ? nearest : best;
}

/** Resistance past an edge: the further past it, the less the sheet follows. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Clamp a dragged height into [min, max], rubber-banding whatever lies outside. */
export function resistedHeight(raw: number, min: number, max: number, dimension: number): number {
  if (raw > max) return max + rubberband(raw - max, dimension);
  if (raw < min) return min + rubberband(raw - min, dimension);
  return raw;
}

/** Release velocity from recent samples (time ms, visible px), using roughly the last 100 ms. */
export function releaseVelocity(samples: ReadonlyArray<{ t: number; y: number }>): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    first = samples[index];
    if (last.t - first.t >= 100) break;
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}
