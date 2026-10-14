/**
 * BottomSheet geometry and physics (MOTION.md §5). Position is an `offset`:
 * how far the sheet is pushed down from its tallest detent (0 = fully up). A
 * detent of height h sits at offset `maxHeight - h`.
 */

/** A sheet height: pixels, or a percentage of the viewport ("50%"). */
export type Detent = number | `${number}%`;

/** px/ms. A release faster than this moves at least one detent that way. */
export const FLICK_VELOCITY = 0.11;
/** px/ms. Above this the settle spring keeps a little bounce. */
export const BOUNCE_VELOCITY = 0.5;
/** Movement before a press becomes a drag, so a tap on a row stays a tap. */
export const DRAG_HYSTERESIS = 8;
/** How far past the lowest detent a projected release must land to dismiss. */
export const DISMISS_DISTANCE = 80;
/** Momentum decay per ms, as in UIScrollView: a release travels v * d / (1 - d) further, about 199ms at speed v. */
const DECELERATION = 0.995;

export function detentHeight(detent: Detent, viewportHeight: number): number {
  return typeof detent === "number" ? detent : (parseFloat(detent) / 100) * viewportHeight;
}

/** Offsets for each detent, in the caller's detent order. */
export function detentOffsets(heights: number[]): { max: number; offsets: number[] } {
  const max = Math.max(...heights);
  return { max, offsets: heights.map((h) => max - h) };
}

/**
 * Resistance past the top detent: the sheet moves less the further it is
 * pulled, never stopping dead and never travelling a whole `dimension`.
 */
export function rubberBand(overshoot: number, dimension: number): number {
  const c = 0.55;
  return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
}

/** Where momentum would carry a release: the offset plus the decayed travel. */
export function projectedOffset(offset: number, velocity: number): number {
  return offset + (velocity * DECELERATION) / (1 - DECELERATION);
}

/**
 * Where a released sheet goes: a detent index, or "dismiss".
 *
 * The projected point picks the detent, so momentum counts and not only
 * where the finger let go. A flick (faster than FLICK_VELOCITY) always moves
 * at least one detent in its direction. A dismissible sheet closes when the
 * projection lands DISMISS_DISTANCE past the lowest detent, or on a flick
 * down from the lowest detent.
 */
export function releaseTarget(input: {
  offset: number;
  velocity: number;
  offsets: number[];
  dismissible: boolean;
}): number | "dismiss" {
  const { offset, velocity, offsets, dismissible } = input;
  const order = offsets.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const last = order.length - 1;
  const projected = projectedOffset(offset, velocity);
  const nearest = (to: number) =>
    order.reduce((best, d, i) => (Math.abs(d.value - to) < Math.abs(order[best].value - to) ? i : best), 0);

  let target = nearest(projected);
  if (velocity > FLICK_VELOCITY) {
    const below = order.findIndex((d) => d.value > offset + 1);
    target = Math.max(target, below < 0 ? last + 1 : below);
  } else if (velocity < -FLICK_VELOCITY) {
    const above = order.findLastIndex((d) => d.value < offset - 1);
    target = Math.min(target, Math.max(above, 0));
  }

  if (target > last || projected > order[last].value + DISMISS_DISTANCE) {
    if (dismissible) return "dismiss";
    target = last;
  }
  return order[target].index;
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

/** Apple's spring form: response in seconds, damping 1 = no bounce. */
export type Spring = { response: number; damping: number };
/** Settle on a detent (MOTION.md §5). */
export const SETTLE: Spring = { response: 0.34, damping: 1 };
/** After a fast flick, a little bounce (Motion's bounce 0.14). */
export const FLICK: Spring = { response: 0.34, damping: 0.86 };
/** Closing: exits run faster than entrances, at the --t-exit/--t-enter ratio (150/220). */
export const EXIT: Spring = { response: 0.23, damping: 1 };

/**
 * Advances a unit-mass spring by `dt` seconds, in substeps of 1/240s so a
 * dropped frame cannot make it unstable. Velocity is in px/s.
 */
export function springStep(
  state: { x: number; v: number },
  target: number,
  dt: number,
  { response, damping }: Spring,
): { x: number; v: number } {
  const stiffness = ((2 * Math.PI) / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  let { x, v } = state;
  let left = Math.min(dt, 0.032);
  while (left > 0) {
    const h = Math.min(left, 1 / 240);
    v += (-stiffness * (x - target) - friction * v) * h;
    x += v * h;
    left -= h;
  }
  return { x, v };
}

/** Close enough to stop: under half a pixel away and slower than 8 px/s. */
export function springSettled(state: { x: number; v: number }, target: number): boolean {
  return Math.abs(state.x - target) < 0.5 && Math.abs(state.v) < 8;
}
