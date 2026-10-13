/** Value arithmetic for Slider and RangeSlider. */

export type SliderBounds = { min: number; max: number; step: number };

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/**
 * Snaps to the step grid that starts at `min`, then clamps. Float-safe:
 * rounds to the finer of the step's and the minimum's decimals, since the
 * grid points are min + n·step (min 0.5, step 1 gives 0.5, 1.5, …).
 */
export function snap(value: number, { min, max, step }: SliderBounds): number {
  const snapped = Math.round((value - min) / step) * step + min;
  const fixed = Number(snapped.toFixed(Math.max(decimalsOf(step), decimalsOf(min))));
  return Math.min(max, Math.max(min, fixed));
}

/** Pointer position (0..1 along the track) to a snapped value. */
export function valueFromRatio(ratio: number, bounds: SliderBounds): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  return snap(bounds.min + clamped * (bounds.max - bounds.min), bounds);
}

export function ratioFromValue(value: number, { min, max }: SliderBounds): number {
  return max === min ? 0 : (value - min) / (max - min);
}

/**
 * The value after a key press, or null for keys the slider ignores.
 * Arrows step by one, Shift+arrow and PageUp/PageDown by five, Home/End
 * jump to the ends (DESIGN.md §4 Slider).
 */
export function valueForKey(value: number, key: string, shift: boolean, bounds: SliderBounds): number | null {
  const big = bounds.step * 5;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return snap(value + (shift ? big : bounds.step), bounds);
    case "ArrowLeft":
    case "ArrowDown":
      return snap(value - (shift ? big : bounds.step), bounds);
    case "PageUp":
      return snap(value + big, bounds);
    case "PageDown":
      return snap(value - big, bounds);
    case "Home":
      return bounds.min;
    case "End":
      return bounds.max;
    default:
      return null;
  }
}

/**
 * Moves one thumb of a range to `next` without letting the thumbs cross:
 * the low thumb stops `minGap` below the high one and vice versa.
 */
export function moveRangeThumb(
  range: readonly [number, number],
  thumb: 0 | 1,
  next: number,
  minGap: number,
): [number, number] {
  const [low, high] = range;
  return thumb === 0 ? [Math.min(next, high - minGap), high] : [low, Math.max(next, low + minGap)];
}

/** Which range thumb a press at `value` should grab: the nearer one. */
export function nearestThumb(range: readonly [number, number], value: number): 0 | 1 {
  const [low, high] = range;
  if (value <= low) return 0;
  if (value >= high) return 1;
  return value - low <= high - value ? 0 : 1;
}
