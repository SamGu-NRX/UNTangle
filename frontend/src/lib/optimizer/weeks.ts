/**
 * Weekday occurrences with identical active date ranges share a segment bit.
 * Undated meetings use the explicit term; dated meetings use their own range,
 * even outside the term. Each weekday is swept separately, so ranges touching
 * on Sunday cannot make two Monday meetings conflict or become back to back.
 * With no dates or term, every meeting has mask 1, the weekly fast path.
 *
 * In a day's list sorted by start, p and q are back to back when
 * `p.weeks & q.weeks & ~between` is nonzero, where `between` is the OR of
 * masks strictly between them. Each pair counts once across all segments.
 */

import { OPT_DAYS, OptimizerInputError, type OptDateRange, type OptMeeting } from "./types";

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

const MAX_WEEK_SEGMENTS = 32;
type CalendarMeeting = Pick<OptMeeting, "day" | "dates">;

export type WeekSegments = {
  count: number;
  /** Zero when the range contains no occurrence of the meeting's weekday. */
  maskOf: (meeting: CalendarMeeting) => number;
};

const rangeKey = (dates: OptDateRange) => `${dates.start}/${dates.end}`;

/** Ranges must already be validated. The callback throws if preparation is out of time. */
export function weekSegments(
  meetings: Iterable<CalendarMeeting>,
  term?: OptDateRange,
  checkDeadline: () => void = () => {},
): WeekSegments {
  const ranges = new Map<string, { id: number; start: number; end: number; days: number }>();
  let steps = 0;
  for (const meeting of meetings) {
    if ((steps++ & 127) === 0) checkDeadline();
    const dates = meeting.dates ?? term;
    if (!dates) continue;
    if (meeting.dates && !term) throw new OptimizerInputError("term is required when any meeting has dates");
    const key = rangeKey(dates);
    let range = ranges.get(key);
    if (!range) {
      range = { id: ranges.size, start: dayNumber(dates.start)!, end: dayNumber(dates.end)!, days: 0 };
      ranges.set(key, range);
    }
    range.days |= 1 << OPT_DAYS.indexOf(meeting.day);
  }
  if (ranges.size === 0) return { count: 1, maskOf: () => 1 };

  const bitOfPattern = new Map<string, number>();
  const masks = OPT_DAYS.map(() => new Int32Array(ranges.size));
  for (let weekday = 0; weekday < OPT_DAYS.length; weekday += 1) {
    const events: Array<{ date: number; id: number; add: boolean }> = [];
    for (const range of ranges.values()) {
      if ((steps++ & 127) === 0) checkDeadline();
      if ((range.days & (1 << weekday)) === 0) continue;
      // Epoch day 0 was Thursday, index 3 in OPT_DAYS. Sweep only actual
      // occurrences: the first on/after start, through the last on/before end.
      const first = range.start + ((weekday - ((range.start + 3) % 7) + 7) % 7);
      const last = range.end - ((((range.end + 3) % 7) - weekday + 14) % 7);
      if (first > last) continue;
      events.push({ date: first, id: range.id, add: true }, { date: last + 7, id: range.id, add: false });
    }
    events.sort((a, b) => {
      if ((steps++ & 1023) === 0) checkDeadline();
      return a.date - b.date;
    });
    const active = new Set<number>();
    for (let i = 0; i < events.length;) {
      checkDeadline();
      const date = events[i].date;
      do {
        const event = events[i++];
        if (event.add) active.add(event.id);
        else active.delete(event.id);
        if ((steps++ & 127) === 0) checkDeadline();
      } while (i < events.length && events[i].date === date);
      if (active.size === 0) continue;
      const ids = [...active].sort((a, b) => a - b);
      const pattern = ids.join(",");
      let bit = bitOfPattern.get(pattern);
      if (bit === undefined) {
        bit = bitOfPattern.size;
        // Stop at the first unrepresentable pattern, not after sweeping the
        // rest of a large request. No all-ranges scan is needed at each cut.
        if (bit === MAX_WEEK_SEGMENTS) {
          throw new OptimizerInputError(
            `meeting dates split the term into ${bit + 1} distinct stretches of weeks (${ranges.size} distinct date ranges); at most ${MAX_WEEK_SEGMENTS} are supported`,
          );
        }
        bitOfPattern.set(pattern, bit);
      }
      for (const id of ids) {
        if ((steps++ & 127) === 0) checkDeadline();
        masks[weekday][id] |= 1 << bit;
      }
    }
  }
  return {
    count: Math.max(1, bitOfPattern.size),
    maskOf: (meeting) => {
      const dates = meeting.dates ?? term;
      const range = dates && ranges.get(rangeKey(dates));
      if (!range) throw new Error("optimizer: no week segments for meeting range");
      return masks[OPT_DAYS.indexOf(meeting.day)][range.id];
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
