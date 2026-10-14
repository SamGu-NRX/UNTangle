/**
 * RRULE parsing and recurrence-date expansion for the two supported
 * frequencies, DAILY and WEEKLY. Expansion works on calendar dates with a
 * fixed wall clock; converting each candidate date to an instant in the
 * event's zone is the caller's job, so wall times survive DST shifts.
 */

import { addDaysToDate, compareDates, weekdayOfDate, type CalendarDate } from "./datetime";

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
  const day = WEEKDAY_CODES.indexOf(code.trim().toUpperCase());
  return day;
}

/**
 * Parses an RRULE value. Returns null for unsupported frequencies, unsupported
 * or malformed parts, so the event lands in `skipped` instead of producing
 * silently wrong occurrences.
 */
export function parseRrule(value: string): Rrule | null {
  let freq: "DAILY" | "WEEKLY" | null = null;
  let interval = 1;
  let byDay: number[] | null = null;
  let until: string | null = null;
  let count: number | null = null;
  let wkst = 1; // Monday, per RFC 5545.
  for (const part of value.split(";")) {
    const equals = part.indexOf("=");
    if (equals <= 0) return null;
    const key = part.slice(0, equals).trim().toUpperCase();
    const raw = part.slice(equals + 1).trim();
    if (key === "FREQ") {
      if (raw === "DAILY" || raw === "WEEKLY") freq = raw;
      else return null;
    } else if (key === "INTERVAL") {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) return null;
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
 * DAILY treats BYDAY as a filter over expanded days, so a DTSTART whose
 * weekday is not in BYDAY is itself filtered. WEEKLY expands a BYDAY grid per
 * WKST week and drops grid days before DTSTART; BYDAY defaults to the DTSTART
 * weekday.
 */
export function expandRuleDates(
  rule: Rrule,
  dtstartDate: CalendarDate,
  shouldStop: (candidate: CalendarDate) => boolean,
): CalendarDate[] {
  const dates: CalendarDate[] = [];
  let accepted = 0;
  let examined = 0;
  if (rule.freq === "DAILY") {
    for (let step = 0; step < MAX_EXPANSION_ITERATIONS; step += 1) {
      const candidate = addDaysToDate(dtstartDate, step * rule.interval);
      if (shouldStop(candidate)) break;
      if (rule.byDay !== null && !rule.byDay.includes(weekdayOfDate(candidate))) continue;
      dates.push(candidate);
      accepted += 1;
      if (rule.count !== null && accepted >= rule.count) break;
    }
    return dates;
  }
  const weekDays = [...new Set(rule.byDay ?? [weekdayOfDate(dtstartDate)])].sort(
    (a, b) => weekOffset(a, rule.wkst) - weekOffset(b, rule.wkst),
  );
  const anchor = addDaysToDate(dtstartDate, -weekOffset(weekdayOfDate(dtstartDate), rule.wkst));
  for (let week = 0; examined < MAX_EXPANSION_ITERATIONS; week += 1) {
    const weekBase = addDaysToDate(anchor, week * rule.interval * 7);
    for (const day of weekDays) {
      examined += 1;
      if (examined > MAX_EXPANSION_ITERATIONS) return dates;
      const candidate = addDaysToDate(weekBase, weekOffset(day, rule.wkst));
      if (compareDates(candidate, dtstartDate) < 0) continue; // week-zero days before DTSTART
      if (shouldStop(candidate)) return dates;
      dates.push(candidate);
      accepted += 1;
      if (rule.count !== null && accepted >= rule.count) return dates;
    }
  }
  return dates;
}

/** Days from the week start (WKST) to the given weekday. */
function weekOffset(day: number, weekStart: number): number {
  return (day - weekStart + 7) % 7;
}
