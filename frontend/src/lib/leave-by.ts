/**
 * When to leave for a class, and what Day's hero says about it.
 *
 * Every time is whole minutes after midnight. The design mockup kept clock
 * times as fractional hours, and rounding made "leave when class ends"
 * compare unequal to the class's end; integer minutes compare exactly, so
 * every function here refuses anything else.
 */

/**
 * Minutes kept between arriving and the class starting. A starting value
 * with no data behind it (docs/design/untangle-v3.md, "Placeholders"):
 * check it against how early students actually want to arrive.
 */
export const LEAVE_BUFFER_MINUTES = 2;

function wholeMinutes(name: string, value: number) {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${name} must be whole minutes, got ${value}`);
  }
}

/** The latest time to leave and still arrive `bufferMin` minutes before `start`. */
export function leaveBy(start: number, walkMin: number, bufferMin = LEAVE_BUFFER_MINUTES): number {
  wholeMinutes("start", start);
  wholeMinutes("walkMin", walkMin);
  wholeMinutes("bufferMin", bufferMin);
  if (walkMin < 0 || bufferMin < 0) {
    throw new RangeError(`walkMin and bufferMin can't be negative, got ${walkMin} and ${bufferMin}`);
  }
  return start - walkMin - bufferMin;
}

/** Tight: leaving on time means walking out the moment the previous class ends, or before it does. */
export function isTight(leave: number, previousEnd: number): boolean {
  wholeMinutes("leave", leave);
  wholeMinutes("previousEnd", previousEnd);
  return leave <= previousEnd;
}

/** One class on the day, with the walk that reaches it (null when that walk's time is unknown). */
export type HeroClass = { start: number; end: number; walkMin: number | null };

/**
 * What the hero answers, in order of the day:
 * - `leave`: the next class, and when to leave for it. `minutesUntil` is
 *   null on a day other than today. `leave` is never before the previous
 *   class ends; `tight` says that is the moment to go.
 * - `leave-now`: today, with a minute or less to spare (or already past it).
 * - `next-class`: the next class when its walk time is unknown.
 * - `last-class`: in class, with no class left to start today. With
 *   overlapping classes it is the one that ends last.
 * - `done`: today's classes are over.
 * - `no-classes`: nothing meets on this day.
 */
export type Hero =
  | { kind: "leave"; index: number; leave: number; minutesUntil: number | null; tight: boolean }
  | { kind: "leave-now"; index: number; tight: boolean }
  | { kind: "next-class"; index: number; minutesUntil: number | null }
  | { kind: "last-class"; index: number }
  | { kind: "done" }
  | { kind: "no-classes" };

function forClass(classes: readonly HeroClass[], index: number, now: number | null): Hero {
  const { start, walkMin } = classes[index];
  if (walkMin === null) {
    return { kind: "next-class", index, minutesUntil: now === null ? null : start - now };
  }
  const latest = leaveBy(start, walkMin);
  const previousEnd = index > 0 ? classes[index - 1].end : null;
  const tight = previousEnd !== null && isTight(latest, previousEnd);
  const leave = previousEnd !== null ? Math.max(latest, previousEnd) : latest;
  if (now === null) return { kind: "leave", index, leave, minutesUntil: null, tight };
  const minutesUntil = leave - now;
  if (minutesUntil <= 1) return { kind: "leave-now", index, tight };
  return { kind: "leave", index, leave, minutesUntil, tight };
}

/**
 * The hero for a day's classes, in start order. `now` is the minute of
 * today, or null when the day shown isn't today (the hero then answers for
 * the first class).
 */
export function dayHero(classes: readonly HeroClass[], now: number | null): Hero {
  if (now !== null) wholeMinutes("now", now);
  if (classes.length === 0) return { kind: "no-classes" };
  if (now === null) return forClass(classes, 0, null);
  const next = classes.findIndex((entry) => now < entry.start);
  if (next >= 0) return forClass(classes, next, now);
  let current = -1;
  classes.forEach((entry, index) => {
    if (now < entry.end && (current < 0 || entry.end >= classes[current].end)) current = index;
  });
  return current >= 0 ? { kind: "last-class", index: current } : { kind: "done" };
}
