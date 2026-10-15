/** Parsed portal rows and public grade/conflict facts used by adapters. */
import type { Day } from "./api-types";
export type RowId = string;
/** One weekly meeting with concrete times, parsed from a results-row cell. */
export type ParsedMeeting = {
  day: Day;
  startMinutes: number;
  endMinutes: number;
};
/** One visible section row of the myUNT class-search results grid. */
export type ParsedSectionRow = {
  rowId: RowId;
  /** Taken from the page; format verified against the sections route (spring-2027). */
  term: string;
  courseSubject: string;
  courseNumber: string;
  sectionNumber: string;
  /** 4-5 digits; drives class-number resolution for the Add flow. */
  classNumber: string;
  meetings: ParsedMeeting[];
  /** Raw date text from the row, e.g. "01/19/2027 - 05/07/2027"; null when absent. */
  datesRaw: string | null;
  /** Raw instructor cell text; null when the cell is empty. */
  instructorRaw: string | null;
  isAsync: boolean;
  isTba: boolean;
};
/** Where the row's weekly slot meets the student's Main schedule. */
export type ConflictHit = {
  courseCode: string;
  day: Day;
  startMinutes: number;
  endMinutes: number;
};
export type ConflictVerdict = {
  kind: "conflict";
  hits: ConflictHit[];
} | {
  kind: "clear";
} | {
  kind: "unknown";
  reason: "row-time-missing" | "schedule-unavailable" | "schedule-time-missing";
};
export type GradesVerdict = {
  kind: "history";
  instructorName: string;
  courseCode: string;
  gpa: number | null;
  total: number;
  /** Grade letter -> count, e.g. {A: 58, B: 22}. */
  counts: Record<string, number>;
}
/** The instructor matched but has no grade history for this course. */
 | {
  kind: "no-history";
  detail: "no-instructor-history" | "no-course-history";
} | {
  kind: "no-match";
  reason: string;
} | {
  kind: "unavailable";
  message: string;
  retryAfterSeconds?: number;
};
