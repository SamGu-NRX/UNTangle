/**
 * RRULE parsing and recurrence-date expansion for the two supported
 * frequencies, DAILY and WEEKLY. Expansion works on calendar dates with a
 * fixed wall clock; converting each candidate date to an instant in the
 * event's zone is the caller's job, so wall times survive DST shifts.
 */

import { addDaysToDate, compareDates, daysBetween, weekdayOfDate, type CalendarDate } from "./datetime";

export type Rrule = {
  freq: "DAILY" | "WEEKLY";
  interval: number;
  /** Weekday numbers (0 = Sunday through 6 = Saturday); null when BYDAY is absent. */
  byDay: number[] | null;
  /** Raw UNTIL value; the caller resolves it against the event's zone. */
  until: string | null;
  count: number | null;
  wkst: number;
};

/** Hard bound on recurrence expansion work, so a pathological rule cannot spin. */
export const MAX_EXPANSION_ITERATIONS = 100_000;

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function parseWeekdayCode(code: string): number | null {
  const day = WEEKDAY_CODES.indexOf(code.trim());
  return day < 0 ? null : day;
}

/** INTERVAL above this bound is treated as malformed rather than expanded; huge steps overflow date arithmetic. */
export const MAX_RRULE_INTERVAL = 1_000;

/**
 * Parses an RRULE value. Returns null for unsupported frequencies, unsupported
 * or malformed parts, so the event lands in `skipped` instead of producing
 * silently wrong occurrences. Part names and values are case-insensitive
 * (RFC 5545 section 2.1), so the whole value is uppercased first; the only
 * free-form part, UNTIL, is a date-time whose letters are T and Z.
 */
export function parseRrule(value: string): Rrule | null {
  let freq: "DAILY" | "WEEKLY" | null = null;
  let interval = 1;
  let byDay: number[] | null = null;
  let until: string | null = null;
  let count: number | null = null;
  let wkst = 1; // Monday, per RFC 5545.
  for (const part of value.toUpperCase().split(";")) {
    const equals = part.indexOf("=");
    if (equals <= 0) return null;
    const key = part.slice(0, equals).trim();
    const raw = part.slice(equals + 1).trim();
    if (key === "FREQ") {
      if (raw === "DAILY" || raw === "WEEKLY") freq = raw;
      else return null;
    } else if (key === "INTERVAL") {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_RRULE_INTERVAL) return null;
      interval = parsed;
    } else if (key === "BYDAY") {
      const days: number[] = [];
      for (const code of raw.split(",")) {
        const day = parseWeekdayCode(code);
        if (day === null) return null;
        days.push(day);
      }
      if (days.length === 0) return null;
      byDay = days;
    } else if (key === "UNTIL") {
      until = raw;
    } else if (key === "COUNT") {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) return null;
      count = parsed;
    } else if (key === "WKST") {
      const day = parseWeekdayCode(raw);
      if (day === null) return null;
      wkst = day;
    } else {
      return null; // Unsupported part (BYMONTH, BYSETPOS, ...).
    }
  }
  return freq === null ? null : { freq, interval, byDay, until, count, wkst };
}

/**
 * Expands a parsed rule into candidate calendar dates, chronologically,
 * honoring INTERVAL, BYDAY, COUNT, and the hard iteration cap. `shouldStop`
 * ends the walk once no later date can matter (the caller's range bound).
 * UNTIL is a suffix filter, so the caller applies it afterwards.
 *
 * `skipToDate` bounds the walk from below: candidates whose date is before it
 * are not materialized, but COUNT still counts every occurrence the rule
 * produced before the walk starts (COUNT is the size of the full expanded set
 * including DTSTART), so the pre-range contribution is computed with integer
 * weekday arithmetic instead of by walking dates.
 *
 * `budget` is shared across every event in a parse: each examined candidate
 * decrements it, and once it is spent the walk stops and `exhausted` flips so
 * the caller can skip the event instead of emitting truncated data.
 *
 * DAILY treats BYDAY as a filter over expanded days, so a DTSTART whose
 * weekday is not in BYDAY is itself filtered. WEEKLY expands a BYDAY grid per
 * WKST week and drops grid days before DTSTART; BYDAY defaults to the DTSTART
 * weekday.
 */
export type ExpansionBudget = { workRemaining: number; exhausted: boolean };

export function expandRuleDates(
  rule: Rrule,
  dtstartDate: CalendarDate,
  shouldStop: (candidate: CalendarDate) => boolean,
  skipToDate: CalendarDate | null,
  budget: ExpansionBudget,
): CalendarDate[] {
  const dates: CalendarDate[] = [];
  if (rule.freq === "DAILY") {
    const step0 = firstDailyStep(rule, dtstartDate, skipToDate);
    const priorAccepted = dailyPriorOccurrences(rule, dtstartDate, step0);
    let accepted = priorAccepted;
    if (rule.count !== null && accepted >= rule.count) return dates;
    for (let step = step0; step - step0 < MAX_EXPANSION_ITERATIONS; step += 1) {
      if (budget.workRemaining <= 0) {
        budget.exhausted = true;
        return dates;
      }
      budget.workRemaining -= 1;
      const candidate = addDaysToDate(dtstartDate, step * rule.interval);
      if (!candidateIsUsable(candidate)) return dates;
      if (shouldStop(candidate)) return dates;
      if (rule.byDay !== null && !rule.byDay.includes(weekdayOfDate(candidate))) continue;
      dates.push(candidate);
      accepted += 1;
      if (rule.count !== null && accepted >= rule.count) return dates;
    }
    // Only the step bound can end the loop without an early return: reaching it
    // means the walk was truncated, so flag the budget rather than emit a
    // silently partial set.
    budget.exhausted = true;
    return dates;
  }
  const weekDays = [...new Set(rule.byDay ?? [weekdayOfDate(dtstartDate)])].sort(
    (a, b) => weekOffset(a, rule.wkst) - weekOffset(b, rule.wkst),
  );
  const anchor = addDaysToDate(dtstartDate, -weekOffset(weekdayOfDate(dtstartDate), rule.wkst));
  const week0 = firstWeeklyWeek(rule, anchor, skipToDate);
  let accepted = weeklyPriorOccurrences(rule, anchor, dtstartDate, weekDays, week0);
  if (rule.count !== null && accepted >= rule.count) return dates;
  for (let week = week0; week - week0 < MAX_EXPANSION_ITERATIONS; week += 1) {
    const weekBase = addDaysToDate(anchor, week * rule.interval * 7);
    if (!candidateIsUsable(weekBase)) return dates;
    for (const day of weekDays) {
      if (budget.workRemaining <= 0) {
        budget.exhausted = true;
        return dates;
      }
      budget.workRemaining -= 1;
      const candidate = addDaysToDate(weekBase, weekOffset(day, rule.wkst));
      if (compareDates(candidate, dtstartDate) < 0) continue; // week-zero days before DTSTART
      if (shouldStop(candidate)) return dates;
      dates.push(candidate);
      accepted += 1;
      if (rule.count !== null && accepted >= rule.count) return dates;
    }
  }
  // Same as the DAILY walk: only the week bound reaches here, which is a
  // truncation, not a natural end.
  budget.exhausted = true;
  return dates;
}

/** False for dates whose year arithmetic overflowed or left the representable calendar. */
function candidateIsUsable(date: CalendarDate): boolean {
  return Number.isInteger(date.year) && date.year >= 1 && date.year <= 9999;
}

/** First DAILY step whose date is not before skipToDate, so old DTSTARTs do not walk the whole gap. */
function firstDailyStep(rule: Rrule, dtstartDate: CalendarDate, skipToDate: CalendarDate | null): number {
  if (skipToDate === null) return 0;
  const delta = daysBetween(dtstartDate, skipToDate);
  let step = delta <= 0 ? 0 : Math.floor(delta / rule.interval);
  while (step > 0 && compareDates(addDaysToDate(dtstartDate, (step - 1) * rule.interval), skipToDate) >= 0) {
    step -= 1;
  }
  while (compareDates(addDaysToDate(dtstartDate, step * rule.interval), skipToDate) < 0) {
    step += 1;
  }
  return step;
}

/**
 * How many occurrences the rule produced before the first walked step, so
 * COUNT keeps counting from DTSTART. Pure integer weekday arithmetic: the
 * stepped weekday sequence repeats with period 7 / gcd(interval, 7).
 */
function dailyPriorOccurrences(rule: Rrule, dtstartDate: CalendarDate, steps: number): number {
  if (steps <= 0) return 0;
  if (rule.byDay === null) return steps;
  const dtstartWeekday = weekdayOfDate(dtstartDate);
  const cycle = 7 / gcd(rule.interval, 7);
  const perCycle = countCycleDays(rule.byDay, dtstartWeekday, rule.interval, cycle);
  const fullCycles = Math.floor(steps / cycle);
  let remainder = 0;
  for (let step = fullCycles * cycle; step < steps; step += 1) {
    if (rule.byDay.includes((dtstartWeekday + step * rule.interval) % 7)) remainder += 1;
  }
  return fullCycles * perCycle + remainder;
}

function countCycleDays(byDay: number[], dtstartWeekday: number, interval: number, cycle: number): number {
  let count = 0;
  for (let step = 0; step < cycle; step += 1) {
    if (byDay.includes((dtstartWeekday + step * interval) % 7)) count += 1;
  }
  return count;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** First WEEKLY week whose grid days are not all before skipToDate. */
function firstWeeklyWeek(rule: Rrule, anchor: CalendarDate, skipToDate: CalendarDate | null): number {
  if (skipToDate === null) return 0;
  const delta = daysBetween(anchor, skipToDate);
  let week = delta <= 0 ? 0 : Math.floor(delta / (rule.interval * 7));
  // A week is skippable only when its last possible grid day is still before
  // skipToDate; adjust the estimate with at most a couple of comparisons.
  while (week > 0 && compareDates(addDaysToDate(anchor, (week - 1) * rule.interval * 7 + 6), skipToDate) >= 0) {
    week -= 1;
  }
  while (compareDates(addDaysToDate(anchor, week * rule.interval * 7 + 6), skipToDate) < 0) {
    week += 1;
  }
  return week;
}

/**
 * Occurrences produced in the weeks before the first walked week. Weeks after
 * the first emit their whole grid; only week zero can drop days before
 * DTSTART, so the adjustment is exact.
 */
function weeklyPriorOccurrences(
  rule: Rrule,
  anchor: CalendarDate,
  dtstartDate: CalendarDate,
  weekDays: number[],
  weeks: number,
): number {
  if (weeks <= 0) return 0;
  let droppedInWeekZero = 0;
  for (const day of weekDays) {
    if (compareDates(addDaysToDate(anchor, weekOffset(day, rule.wkst)), dtstartDate) < 0) droppedInWeekZero += 1;
  }
  return weeks * weekDays.length - droppedInWeekZero;
}

/** Days from the week start (WKST) to the given weekday. */
function weekOffset(day: number, weekStart: number): number {
  return (day - weekStart + 7) % 7;
}
