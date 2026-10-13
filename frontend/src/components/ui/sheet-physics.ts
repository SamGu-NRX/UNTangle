/**
 * BottomSheet geometry. Position is an `offset`: how far the sheet is
 * pushed down from its tallest detent (0 = fully up). A detent of height h
 * sits at offset `maxHeight - h`; fully closed is `maxHeight`.
 */

/** A sheet height: pixels, or a percentage of the viewport ("50%"). */
export type Detent = number | `${number}%`;

/** px per ms. A release faster than this moves a detent or dismisses (DESIGN.md §4). */
export const FLICK_VELOCITY = 0.11;
/** Past the top detent the sheet follows the finger at this fraction (DESIGN.md §4). */
export const OVERDRAG_FACTOR = 0.3;

export function detentHeight(detent: Detent, viewportHeight: number): number {
  return typeof detent === "number" ? detent : (parseFloat(detent) / 100) * viewportHeight;
}

/** Offsets for each detent, in the caller's detent order. */
export function detentOffsets(heights: number[]): { max: number; offsets: number[] } {
  const max = Math.max(...heights);
  return { max, offsets: heights.map((h) => max - h) };
}

/** Where the sheet sits for a raw drag offset: resisted above the top. */
export function dampedOffset(raw: number): number {
  return raw < 0 ? raw * OVERDRAG_FACTOR : raw;
}

/**
 * Where a released sheet settles: a detent index, or "dismiss".
 *
 * - A flick down (velocity > 0.11) goes to the next detent below the
 *   current position, or dismisses when none is below.
 * - A flick up goes to the next detent above.
 * - A slow release settles on the nearest resting place, where "closed"
 *   (offset = max) counts as one when the sheet is dismissible.
 */
export function releaseTarget(input: {
  offset: number;
  velocity: number;
  offsets: number[];
  max: number;
  dismissible: boolean;
}): number | "dismiss" {
  const { offset, velocity, offsets, max, dismissible } = input;
  const order = offsets.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const EPS = 1;

  if (velocity > FLICK_VELOCITY) {
    const below = order.find((d) => d.value > offset + EPS);
    if (below) return below.index;
    return dismissible ? "dismiss" : order[order.length - 1].index;
  }
  if (velocity < -FLICK_VELOCITY) {
    const above = [...order].reverse().find((d) => d.value < offset - EPS);
    return (above ?? order[0]).index;
  }

  let best: number | "dismiss" = order[0].index;
  let bestDistance = Infinity;
  for (const d of order) {
    const distance = Math.abs(d.value - offset);
    if (distance < bestDistance) {
      best = d.index;
      bestDistance = distance;
    }
  }
  if (dismissible && Math.abs(max - offset) < bestDistance) return "dismiss";
  return best;
}

/**
 * Release velocity (px/ms, positive = down) from recent pointer samples:
 * the slope over the last `windowMs`, so a pause before letting go reads as
 * a slow release rather than the speed of an earlier flick.
 */
export function releaseVelocity(samples: Array<{ y: number; t: number }>, windowMs = 100): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = last;
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    if (last.t - samples[i].t > windowMs) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}
