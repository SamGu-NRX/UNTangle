/**
 * When a class's final exam is, from a registrar's published exam schedule.
 *
 * UNT doesn't list a final for every class. Its registrar publishes a rule
 * (https://registrar.unt.edu/exams/final-exam-schedule/): a class's final
 * follows from the first weekday it meets and its earliest start time, in
 * separate tables for the main campus and Discovery Park and for the
 * full-term and second eight-week sessions. First eight-week classes are
 * listed by subject, and a few courses (ACCT 2010's departmental final) by
 * name. `ExamSchedule` holds one published page in that shape;
 * `@untangle/ingest/exam-schedule` builds it from the saved page.
 *
 * `examFor` applies a schedule to one class. It never guesses: a class the
 * rule doesn't place gets an `unknown` answer with the reason, so the caller
 * can say so instead of treating the class as clash-free.
 *
 * Pure, with no data of its own: the caller passes the schedule in.
 */

export type ExamDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

/** Monday first, the order "first meeting day" is read in. */
export const EXAM_DAYS: readonly ExamDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** One exam sitting: an ISO calendar date, and minutes after midnight, half-open [start, end). */
export type ExamSlot = { date: string; start: number; end: number };

export type ExamCampus = "main" | "discovery-park";

/**
 * The class start times a grid row covers. `between` is inclusive at both
 * ends, as the page prints it ("8:00 a.m. and 8:59 a.m."); `at` is one start
 * minute ("Starts at 2:25 p.m.") and wins over a `between` row that also
 * covers it, because the page lists it as the exception to that row.
 */
export type StartWindow = { kind: "between"; from: number; to: number } | { kind: "at"; minute: number };

/** A row of the grid by first meeting day and earliest start. */
export type ExamGridRow = {
  campus: ExamCampus;
  session: "full" | "8w2";
  /** The class's first meeting day must be one of these. */
  firstDays: ExamDay[];
  starts: StartWindow;
  exam: ExamSlot;
  /** The row as the page prints it, for a reader checking the parse. */
  text: string;
};

/** First eight-week classes: one exam day, a time per subject. */
export type ExamSubjectRow = { session: "8w1"; subjects: string[]; exam: ExamSlot; text: string };

/** A course whose final is set by name, such as a departmental final. It overrides the grid. */
export type ExamCourseListing = { courseCode: string; exam: ExamSlot; text: string };

export type ExamSchedule = {
  /** The term the page publishes, "Fall 2026". */
  term: string;
  sourceUrl: string;
  /** The day the page was saved, ISO. */
  capturedAt: string;
  grid: ExamGridRow[];
  bySubject: ExamSubjectRow[];
  byCourse: ExamCourseListing[];
};

/** What the rule needs to know about one class. */
export type ExamClass = {
  /** "ACCT 2010" */
  courseCode: string;
  /** "other" for a session the page has no rule for (a three-week session, say). */
  session: "full" | "8w1" | "8w2" | "other";
  /** "other" for a site with its own exam list, such as Frisco. */
  campus: ExamCampus | "other";
  /** The class's own timed meetings (its primary component). Empty when it has no set time. */
  meetings: ReadonlyArray<{ day: ExamDay; start: number }>;
};

/**
 * - no-set-time: online with no meeting time; the syllabus sets the final.
 * - other-site: a site with its own list (Frisco).
 * - session: the page has no rule for the class's session.
 * - no-rule: the rule has no row for this day and start time.
 */
export type ExamUnknownReason = "no-set-time" | "other-site" | "session" | "no-rule";

export type ExamAnswer =
  | { kind: "known"; exam: ExamSlot; basis: "course" | "subject" | "grid"; text: string }
  | { kind: "unknown"; reason: ExamUnknownReason };

/** The class's final under `schedule`, or why the schedule doesn't place it. */
export function examFor(subject: ExamClass, schedule: ExamSchedule): ExamAnswer {
  const listed = schedule.byCourse.find((entry) => entry.courseCode === subject.courseCode);
  // A departmental final covers the course's sections in the grid's sessions; other sites keep their own list.
  if (listed && subject.campus !== "other" && (subject.session === "full" || subject.session === "8w2")) {
    return { kind: "known", exam: listed.exam, basis: "course", text: listed.text };
  }
  if (subject.campus === "other") return { kind: "unknown", reason: "other-site" };
  if (subject.meetings.length === 0) return { kind: "unknown", reason: "no-set-time" };
  if (subject.session === "other") return { kind: "unknown", reason: "session" };
  if (subject.session === "8w1") {
    const prefix = subject.courseCode.split(" ")[0];
    const row = schedule.bySubject.find((entry) => entry.subjects.includes(prefix));
    return row ? { kind: "known", exam: row.exam, basis: "subject", text: row.text } : { kind: "unknown", reason: "no-rule" };
  }
  const firstDay = EXAM_DAYS.find((day) => subject.meetings.some((meeting) => meeting.day === day))!;
  const start = Math.min(...subject.meetings.map((meeting) => meeting.start));
  const rows = schedule.grid.filter((row) => row.campus === subject.campus && row.session === subject.session && row.firstDays.includes(firstDay));
  const row =
    rows.find((entry) => entry.starts.kind === "at" && entry.starts.minute === start) ??
    rows.find((entry) => entry.starts.kind === "between" && entry.starts.from <= start && start <= entry.starts.to);
  return row ? { kind: "known", exam: row.exam, basis: "grid", text: row.text } : { kind: "unknown", reason: "no-rule" };
}

/** Two sittings that share any minute on the same date. Touching ends (3:00 and 3:00) don't. */
export function examsOverlap(a: ExamSlot, b: ExamSlot): boolean {
  return a.date === b.date && a.start < b.end && b.start < a.end;
}

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const value = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
  if (!match || !Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== iso) {
    throw new Error(`final-exams: ${JSON.stringify(iso)} is not a real YYYY-MM-DD date`);
  }
  return value / DAY_MS;
}

/** The weekday of an ISO date. */
export function examDayOf(iso: string): ExamDay {
  // Epoch day 0, 1970-01-01, was a Thursday: index 3 in EXAM_DAYS.
  return EXAM_DAYS[(dayNumber(iso) + 3) % 7];
}

/** Whether the slot falls in the seven days starting `weekStart`. */
export function inWeek(slot: ExamSlot, weekStart: string): boolean {
  const offset = dayNumber(slot.date) - dayNumber(weekStart);
  return offset >= 0 && offset <= 6;
}

/**
 * Moves a slot from one finals week to another by its place in the week:
 * the Monday of one finals week becomes the Monday of the other. Both weeks
 * must start on the same weekday, and the slot must fall in the first week's
 * seven days; anything else throws, because the move would be a guess.
 */
export function moveToWeek(slot: ExamSlot, fromWeekStart: string, toWeekStart: string): ExamSlot {
  if (examDayOf(fromWeekStart) !== examDayOf(toWeekStart)) {
    throw new Error(`final-exams: finals weeks starting ${fromWeekStart} and ${toWeekStart} start on different weekdays`);
  }
  if (!inWeek(slot, fromWeekStart)) throw new Error(`final-exams: ${slot.date} is outside the finals week starting ${fromWeekStart}`);
  const offset = dayNumber(slot.date) - dayNumber(fromWeekStart);
  const date = new Date((dayNumber(toWeekStart) + offset) * DAY_MS).toISOString().slice(0, 10);
  return { ...slot, date };
}
