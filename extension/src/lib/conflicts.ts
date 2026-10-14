/**
 * Conflict semantics for the Main-schedule badge, on the sections model's
 * terms (frontend/src/lib/sections/INTEGRATION.md): times are minutes after
 * midnight, TBA is excluded from no-conflict claims, and meetings compare
 * only where their date ranges overlap.
 *
 * No-conflict invariant: a row may show a no-conflict verdict only when both
 * sides have concrete times; anything less is "unknown", never a clean bill.
 */
import type { Day } from "../shared/api-types";
import type { ConflictHit, ConflictVerdict, ParsedSectionRow } from "../shared/messages";
import { parseIsoDateSpan, parsePageDateRange, rangesOverlap } from "./parse-dates";

/** One concrete weekly meeting of a section the student already has in Main. */
export type ScheduledMeeting = {
  courseCode: string;
  day: Day;
  startMinutes: number;
  endMinutes: number;
  dates: { start: string | null; end: string | null };
};

/** The narrow slice of a CourseSections response extractScheduled consumes. */
export type SectionListSource = {
  courseCode: string;
  sections: {
    id: string;
    meetings: {
      day: Day | null;
      startMinutes: number | null;
      endMinutes: number | null;
      dates: { start: string | null; end: string | null };
    }[];
  }[];
};

export type ExtractedSchedule = {
  meetings: ScheduledMeeting[];
  /**
   * False when the selected section has any meeting without concrete times:
   * such a meeting could collide, so a clear verdict is not claimable.
   */
  complete: boolean;
};

/**
 * Pulls the selected section's concrete meetings out of a course's sections
 * response. Null when the student's selected section id no longer resolves.
 */
export function extractScheduled(result: SectionListSource, sectionId: string): ExtractedSchedule | null {
  const section = result.sections.find(candidate => candidate.id === sectionId);
  if (!section) return null;
  const meetings: ScheduledMeeting[] = [];
  let complete = true;
  for (const meeting of section.meetings) {
    if (meeting.day === null || meeting.startMinutes === null || meeting.endMinutes === null) {
      complete = false;
      continue;
    }
    meetings.push({
      courseCode: result.courseCode,
      day: meeting.day,
      startMinutes: meeting.startMinutes,
      endMinutes: meeting.endMinutes,
      dates: { start: meeting.dates.start, end: meeting.dates.end },
    });
  }
  return { meetings, complete };
}

/**
 * Whether the row's weekly slot collides with the student's Main schedule.
 * Pure: same inputs, same verdict, no network and no clocks.
 */
export function conflictsWithScheduled(row: ParsedSectionRow, scheduled: readonly ScheduledMeeting[]): ConflictVerdict {
  if (row.isTba || row.isAsync || row.meetings.length === 0) {
    return { kind: "unknown", reason: "row-time-missing" };
  }
  const rowSpan = row.datesRaw ? parsePageDateRange(row.datesRaw) : { startMs: null, endMs: null };
  const hits: ConflictHit[] = [];
  for (const meeting of row.meetings) {
    for (const other of scheduled) {
      if (other.day !== meeting.day) continue;
      // Date ranges are compared when both sides carry them; undecidable
      // ranges stay in the comparison, which can only ever add a conflict.
      const overlap = rangesOverlap(rowSpan, parseIsoDateSpan(other.dates.start, other.dates.end));
      if (overlap === false) continue;
      if (other.startMinutes < meeting.endMinutes && meeting.startMinutes < other.endMinutes) {
        const hit: ConflictHit = {
          courseCode: other.courseCode,
          day: meeting.day,
          startMinutes: other.startMinutes,
          endMinutes: other.endMinutes,
        };
        if (!hits.some(existing => sameHit(existing, hit))) hits.push(hit);
      }
    }
  }
  return hits.length > 0 ? { kind: "conflict", hits } : { kind: "clear" };
}

function sameHit(a: ConflictHit, b: ConflictHit): boolean {
  return a.courseCode === b.courseCode && a.day === b.day && a.startMinutes === b.startMinutes && a.endMinutes === b.endMinutes;
}
