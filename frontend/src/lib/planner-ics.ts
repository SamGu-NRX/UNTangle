import type { ScheduleEvent, WeekDay } from "@/lib/types";

/**
 * iCalendar (RFC 5545) export of the weekly plan over term dates the user
 * typed in. UNTangle does not know UNT's academic calendar, so it never
 * guesses term dates, holidays or breaks.
 *
 * Times are floating local times (no TZID): the plan's times are wall-clock
 * times at UNT, and calendar apps place floating times in the device's zone.
 * This avoids shipping a hand-written VTIMEZONE block for America/Chicago.
 */

export type TermDates = { start: string; end: string };

export type TermDatesCheck =
  | { ok: true; start: string; end: string }
  | { ok: false; field: "start" | "end"; message: string };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
/** A typo guard, not a calendar rule: no single term runs longer than a year. */
const MAX_TERM_DAYS = 366;

function parseDate(value: string): number | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return time;
}

export function checkTermDates(term: TermDates): TermDatesCheck {
  const start = parseDate(term.start);
  if (start === null) {
    return { ok: false, field: "start", message: "Enter the first day of the term." };
  }
  const end = parseDate(term.end);
  if (end === null) {
    return { ok: false, field: "end", message: "Enter the last day of the term." };
  }
  if (end < start) {
    return { ok: false, field: "end", message: "The last day must be on or after the first day." };
  }
  if ((end - start) / DAY_MS > MAX_TERM_DAYS) {
    return { ok: false, field: "end", message: "That term is longer than a year. Check the dates." };
  }
  return { ok: true, start: term.start, end: term.end };
}

const WEEKDAY_INDEX: Record<WeekDay, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };
const RRULE_DAY: Record<WeekDay, string> = { Mon: "MO", Tue: "TU", Wed: "WE", Thu: "TH", Fri: "FR" };

function compactDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10).replaceAll("-", "");
}

function compactTime(hhmm: string): string {
  return `${hhmm.replace(":", "")}00`;
}

function utcStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/** RFC 5545 §3.3.11 TEXT escaping. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

/** RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + space. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export type IcsBuildResult = {
  ics: string;
  /** One per plan meeting written to the file. */
  eventCount: number;
  /** Meetings whose weekday never falls inside the term (e.g. a 2-day term). */
  skipped: Array<Pick<ScheduleEvent, "courseCode" | "day" | "start">>;
};

export function buildPlanIcs(events: ScheduleEvent[], term: TermDates, now: Date = new Date()): IcsBuildResult {
  const checked = checkTermDates(term);
  if (!checked.ok) {
    throw new Error(`buildPlanIcs needs valid term dates: ${checked.message}`);
  }
  const termStart = parseDate(checked.start)!;
  const termEnd = parseDate(checked.end)!;
  const stamp = utcStamp(now);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//UNTangle//Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:UNTangle schedule (sample data)",
  ];
  const skipped: IcsBuildResult["skipped"] = [];
  let eventCount = 0;

  [...events]
    .sort((a, b) => WEEKDAY_INDEX[a.day] - WEEKDAY_INDEX[b.day] || a.start.localeCompare(b.start))
    .forEach((event) => {
      const offset = (WEEKDAY_INDEX[event.day] - new Date(termStart).getUTCDay() + 7) % 7;
      const first = termStart + offset * DAY_MS;
      if (first > termEnd) {
        skipped.push({ courseCode: event.courseCode, day: event.day, start: event.start });
        return;
      }
      const date = compactDate(first);
      eventCount += 1;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${event.sectionId}-${event.day}-${event.start.replace(":", "")}-${checked.start}@untangle.local`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${date}T${compactTime(event.start)}`,
        `DTEND:${date}T${compactTime(event.end)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${RRULE_DAY[event.day]};UNTIL=${compactDate(termEnd)}T235959`,
        `SUMMARY:${escapeText(`${event.courseCode} ${event.title} (sample)`)}`,
        `LOCATION:${escapeText(event.location)}`,
        `DESCRIPTION:${escapeText(
          `Section ${event.sectionId}, instructor ${event.professor}. Sample data: this section, its times and its instructor are synthetic, not UNT's class schedule.`,
        )}`,
        "END:VEVENT",
      );
    });

  lines.push("END:VCALENDAR");
  return { ics: `${lines.map(foldLine).join("\r\n")}\r\n`, eventCount, skipped };
}

export function icsFileName(term: TermDates): string {
  return `untangle-schedule-${term.start}-to-${term.end}.ics`;
}
