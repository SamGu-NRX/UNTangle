/**
 * When two sections clash. Pure and host-free, so UNTangle's Courses detail
 * and the standalone builder answer the same way (HANDOFF §5 reads
 * `sectionConflicts` from here).
 */
import type { Day, Meeting, Section } from "@/lib/sections";

export type TimedMeeting = Meeting & { day: Day; startMinutes: number; endMinutes: number };

/** A meeting with a known day and time: the only kind that goes on the grid. */
export function isTimed(meeting: Meeting): meeting is TimedMeeting {
  return !meeting.tba && !meeting.async && meeting.day !== null && meeting.startMinutes !== null && meeting.endMinutes !== null;
}

/** Online, or nothing with a set time: what the No set time strip holds. */
export function hasNoSetTime(section: Section): boolean {
  return !section.meetings.some(isTimed);
}

const WEEKDAY: Record<Day, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DAY_MS = 86_400_000;

type Range = { start: string | null; end: string | null } | null | undefined;

/**
 * True when two meetings on `day` share a date: some `day` lies inside both
 * of their ranges. A missing bound is open, so meetings without dates (the
 * usual case) always meet together. Ranges that merely touch are not enough:
 * Jan 11–17 and Jan 17–24 share only a Sunday, so two Monday classes in them
 * never meet.
 */
export function meetTogether(day: Day, a: Range, b: Range): boolean {
  const starts = [a?.start, b?.start].filter((d): d is string => Boolean(d)).sort();
  const ends = [a?.end, b?.end].filter((d): d is string => Boolean(d)).sort();
  const from = starts.at(-1);
  const to = ends[0];
  if (!from || !to) return true;
  const start = Date.parse(`${from}T00:00:00Z`);
  const offset = (WEEKDAY[day] - new Date(start).getUTCDay() + 7) % 7;
  return start + offset * DAY_MS <= Date.parse(`${to}T00:00:00Z`);
}

/** Same day, overlapping times (half-open: 9:50 end and 9:50 start don't clash), and a shared date. */
export function meetingsOverlap(a: Meeting, b: Meeting): boolean {
  return (
    isTimed(a) &&
    isTimed(b) &&
    a.day === b.day &&
    a.startMinutes < b.endMinutes &&
    b.startMinutes < a.endMinutes &&
    meetTogether(a.day, a.dates, b.dates)
  );
}

export type Conflict = { courseCode: string; days: Day[] };

/**
 * The sections in `schedule` that `section` would clash with, one entry per
 * course, each with the days they clash, in week order. The course's own
 * section is skipped, so a section swap is never its own conflict.
 */
export function sectionConflicts(schedule: readonly Section[], section: Section): Conflict[] {
  const out: Conflict[] = [];
  for (const other of schedule) {
    if (other.courseCode === section.courseCode) continue;
    const days = new Set<Day>();
    for (const m of section.meetings.filter(isTimed)) for (const n of other.meetings) if (meetingsOverlap(m, n)) days.add(m.day);
    if (days.size > 0) out.push({ courseCode: other.courseCode, days: [...days].sort((x, y) => (WEEKDAY[x] || 7) - (WEEKDAY[y] || 7)) });
  }
  return out;
}
