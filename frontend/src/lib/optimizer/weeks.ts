/**
 * Which weeks of the term a meeting runs in, and which meetings are back to
 * back.
 *
 * A meeting may carry an inclusive calendar date range (an eight-week
 * session, say); without one it runs every week. Cutting the calendar at
 * every range's first day and at the day after its last day splits it into
 * segments, and a meeting is active in each segment its range covers. Two
 * meetings share a week when some segment has both active. Segments with
 * the same set of active ranges are interchangeable, so each distinct set
 * gets one bit, and a meeting's `weeks` mask has a bit for every segment it
 * is active in (every bit when it has no dates). With no dates at all there
 * is one segment and every mask is 1.
 *
 * Back to back: within one segment and one day, the active meetings sorted
 * by start form a sequence, and neighbors in it are back to back. In a day's
 * list sorted by start, p and q (p first) are back to back when
 * `p.weeks & q.weeks & ~between` is nonzero, `between` being the OR of the
 * masks sorted strictly between them. With one segment that is exactly
 * "consecutive in the day's list".
 */

import { OptimizerInputError, type OptDateRange } from "./types";

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 of an ISO date (`YYYY-MM-DD`), or null when it is not a real calendar date. */
export function dayNumber(iso: unknown): number | null {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  // Date.UTC rolls 2027-02-30 over to March; a round trip catches it.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return ms / DAY_MS;
}

/** A segment is one bit of a 32-bit mask. Real requests have a handful of distinct ranges. */
const MAX_WEEK_SEGMENTS = 32;

export type WeekSegments = {
  /** Number of segments; 1 when no meeting has dates. */
  count: number;
  /** The mask of a meeting with these dates; every segment's bit when it has none. */
  maskOf: (dates: OptDateRange | null | undefined) => number;
};

const rangeKey = (dates: OptDateRange) => `${dates.start}/${dates.end}`;

/**
 * The segments of a set of meetings' dates. The ranges must already be
 * valid (see `validateRequest`). Asking `maskOf` for a range that was not
 * passed in is a bug and throws.
 */
export function weekSegments(allDates: Iterable<OptDateRange | null | undefined>): WeekSegments {
  const ranges = new Map<string, [number, number]>();
  let undated = false;
  for (const dates of allDates) {
    if (!dates) {
      undated = true;
      continue;
    }
    const key = rangeKey(dates);
    if (!ranges.has(key)) ranges.set(key, [dayNumber(dates.start)!, dayNumber(dates.end)!]);
  }
  if (ranges.size === 0) return { count: 1, maskOf: () => 1 };

  const keys = [...ranges.keys()];
  const bounds = keys.map((key) => ranges.get(key)!);
  const cuts = [...new Set(bounds.flatMap(([start, end]) => [start, end + 1]))].sort((a, b) => a - b);
  // One day from each piece of the cut calendar: the piece before the first
  // cut, and the piece starting at each cut (the last runs to the end of time).
  const probes = [cuts[0] - 1, ...cuts];
  const bitOfPattern = new Map<string, number>();
  const masks = new Array<number>(keys.length).fill(0);
  for (const day of probes) {
    const active: number[] = [];
    bounds.forEach(([start, end], index) => {
      if (start <= day && day <= end) active.push(index);
    });
    // A piece where nothing runs holds no pairs; it counts only when an
    // undated meeting runs there.
    if (active.length === 0 && !undated) continue;
    const pattern = active.join(",");
    let bit = bitOfPattern.get(pattern);
    if (bit === undefined) {
      bit = bitOfPattern.size;
      bitOfPattern.set(pattern, bit);
    }
    if (bit < MAX_WEEK_SEGMENTS) for (const index of active) masks[index] |= 1 << bit;
  }
  const count = bitOfPattern.size;
  if (count > MAX_WEEK_SEGMENTS) {
    throw new OptimizerInputError(
      `meeting dates split the term into ${count} distinct stretches of weeks (${ranges.size} distinct date ranges); at most ${MAX_WEEK_SEGMENTS} are supported`,
    );
  }
  const all = count === 32 ? -1 : (1 << count) - 1;
  const maskByKey = new Map(keys.map((key, index) => [key, masks[index]] as const));
  return {
    count,
    maskOf: (dates) => {
      if (!dates) return all;
      const mask = maskByKey.get(rangeKey(dates));
      if (mask === undefined) throw new Error(`optimizer: no week segments for dates ${rangeKey(dates)}`);
      return mask;
    },
  };
}

/**
 * Calls `test` on every back-to-back pair of `sorted` (sorted by day, then
 * start) until it returns true; returns whether one did. Each pair is visited
 * once even when it is back to back in several segments. Two meetings with
 * the same start can only both be active in a segment if they overlap, so in
 * a schedule without conflicts the order among equal starts does not matter.
 */
export function someBackToBack<T extends { day: unknown; weeks: number }>(
  sorted: readonly T[],
  test: (prev: T, next: T) => boolean,
): boolean {
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const prev = sorted[i];
    let between = 0;
    for (let j = i + 1; j < sorted.length && sorted[j].day === prev.day; j += 1) {
      const next = sorted[j];
      if ((prev.weeks & next.weeks & ~between) !== 0 && test(prev, next)) return true;
      between |= next.weeks;
      // Every segment of prev now has a class after it and before anything later.
      if ((prev.weeks & ~between) === 0) break;
    }
  }
  return false;
}
