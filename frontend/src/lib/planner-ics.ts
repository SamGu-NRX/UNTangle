import type { TermDates } from "@/lib/export/term-dates";
import type { Day, Section } from "@/lib/sections";
import { classDayStatus } from "@/lib/terms/terms";

/**
 * iCalendar (RFC 5545) file for a week of classes. Each timed meeting is one
 * weekly event in America/Chicago, from its first day in the term to the
 * term's last day of classes (an eight-week class keeps its own, narrower
 * dates). Every weekly date the registrar's calendar marks as no class or
 * finals (`classDayStatus`, for the meeting's own session) becomes an
 * EXDATE, so an imported calendar shows nothing over spring break or a
 * holiday. A date the calendar can't answer yet ("unknown") stays: the file
 * never guesses. An online class that meets at a set time
 * is a real class time and stays; only meetings with no set time are left
 * out. Pure: the same input gives the same file.
 */

export const ICS_TIMEZONE = "America/Chicago";

/**
 * Central time since the 2007 US rules: daylight time from the second Sunday
 * of March to the first Sunday of November, changing at 2:00 local.
 */
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${ICS_TIMEZONE}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0600",
  "TZOFFSETTO:-0500",
  "TZNAME:CDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0600",
  "TZNAME:CST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

const DAY_MS = 86_400_000;
const WEEKDAY: Record<Day, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const BYDAY: Record<Day, string> = { Sun: "SU", Mon: "MO", Tue: "TU", Wed: "WE", Thu: "TH", Fri: "FR", Sat: "SA" };

const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const compactDate = (time: number) => new Date(time).toISOString().slice(0, 10).replaceAll("-", "");
const compactClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}${String(minutes % 60).padStart(2, "0")}00`;

/** Day of the month of the nth `weekday` (0 Sunday) in a month, month 0-based. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
}

/** Hours behind UTC at the end of a Chicago calendar day: 5 in daylight time, 6 otherwise. */
export function chicagoOffsetHours(time: number): 5 | 6 {
  const date = new Date(time);
  const year = date.getUTCFullYear();
  const dstStart = Date.UTC(year, 2, nthWeekday(year, 2, 0, 2));
  const dstEnd = Date.UTC(year, 10, nthWeekday(year, 10, 0, 1));
  return time >= dstStart && time < dstEnd ? 5 : 6;
}

/** 23:59:59 Chicago time on `time`'s date, written in UTC as RFC 5545 §3.3.10 requires beside a TZID start. */
function untilUtc(time: number): string {
  const instant = new Date(time + 86_399_000 + chicagoOffsetHours(time) * 3_600_000);
  return `${instant.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

const utcStamp = (date: Date) => `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;

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

export type IcsResult = {
  ics: string;
  /** Weekly events written, one per timed meeting. */
  eventCount: number;
  /** Courses with nothing in the file: no meeting with a set time, or none inside the term. */
  leftOut: string[];
};

export type IcsOptions = {
  /** Course titles for the event summaries; the code alone when missing. */
  titleOf?: (courseCode: string) => string | undefined;
  calendarName?: string;
  now?: Date;
};

export function buildWeekIcs(sections: readonly Section[], term: TermDates, options: IcsOptions = {}): IcsResult {
  const stamp = utcStamp(options.now ?? new Date());
  const termFirst = toTime(term.first);
  const termLast = toTime(term.last);
  /** The session a meeting runs in: the one its own dates match (an eight-week half), else the full term's. */
  const sessionOf = (dates: { start: string | null; end: string | null }) =>
    term.sessions.find((session) => session.begin === dates.start && session.end === dates.end)?.id ?? term.sessionId;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//UNTangle//Schedule builder//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.calendarName ?? `${term.term} classes`)}`,
    `X-WR-TIMEZONE:${ICS_TIMEZONE}`,
    ...VTIMEZONE,
  ];
  const leftOut: string[] = [];
  let eventCount = 0;

  for (const section of sections) {
    const timed = section.meetings.filter(
      (meeting): meeting is typeof meeting & { day: Day; startMinutes: number; endMinutes: number } =>
        !meeting.tba && !meeting.async && meeting.day !== null && meeting.startMinutes !== null && meeting.endMinutes !== null,
    );
    const title = options.titleOf?.(section.courseCode);
    const written = eventCount;
    for (const [index, meeting] of timed.entries()) {
      // A meeting's own dates narrow the term (an eight-week session); they never widen it into finals week.
      const from = Math.max(termFirst, meeting.dates.start ? toTime(meeting.dates.start) : termFirst);
      const until = Math.min(termLast, meeting.dates.end ? toTime(meeting.dates.end) : termLast);
      const first = from + ((WEEKDAY[meeting.day] - new Date(from).getUTCDay() + 7) % 7) * DAY_MS;
      if (first > until) continue;
      const startClock = compactClock(meeting.startMinutes);
      const session = sessionOf(meeting.dates);
      const skipped: number[] = [];
      for (let day = first; day <= until; day += 7 * DAY_MS) {
        const status = classDayStatus(new Date(day).toISOString().slice(0, 10), session);
        if (status === "no-class" || status === "finals") skipped.push(day);
      }
      const instructor = meeting.instructor.display ?? section.instructor.display;
      eventCount += 1;
      lines.push(
        "BEGIN:VEVENT",
        // The meeting's position in its section tells apart two records at the same day and time (other dates or rooms).
        `UID:${section.id.replace(/[^A-Za-z0-9+-]/g, "-")}-${index}-${meeting.day}-${meeting.startMinutes}@untangle`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${ICS_TIMEZONE}:${compactDate(first)}T${startClock}`,
        // A class ending at midnight ends at 00:00 the next day; RFC 5545 has no hour 24.
        meeting.endMinutes >= 1440
          ? `DTEND;TZID=${ICS_TIMEZONE}:${compactDate(first + DAY_MS)}T000000`
          : `DTEND;TZID=${ICS_TIMEZONE}:${compactDate(first)}T${compactClock(meeting.endMinutes)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[meeting.day]};UNTIL=${untilUtc(until)}`,
        ...(skipped.length > 0 ? [`EXDATE;TZID=${ICS_TIMEZONE}:${skipped.map((day) => `${compactDate(day)}T${startClock}`).join(",")}`] : []),
        `SUMMARY:${escapeText(`${section.courseCode}${title ? ` ${title}` : ""}`)}`,
        `LOCATION:${escapeText(meeting.room)}`,
        `DESCRIPTION:${escapeText(
          `Section ${section.sectionCode}${instructor ? `, ${instructor}` : ""}.${section.term === null ? " Sample section: its time and instructor are made up." : ""}`,
        )}`,
        "END:VEVENT",
      );
    }
    if (eventCount === written) leftOut.push(section.courseCode);
  }

  lines.push("END:VCALENDAR");
  return { ics: `${lines.map(foldLine).join("\r\n")}\r\n`, eventCount, leftOut };
}

/** "spring-2027-classes.ics" */
export function icsFileName(term: TermDates): string {
  return `${term.term.toLowerCase().replace(/\s+/g, "-")}-classes.ics`;
}
