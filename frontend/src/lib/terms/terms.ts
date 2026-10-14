// Typed UNT academic term calendars for Fall 2026 through Spring 2028.
//
// Every date below was transcribed from an official UNT Office of the
// Registrar page; each term records the exact source URL and the date it was
// retrieved. Dates marked tentative or unpublished by the registrar are
// recorded as such instead of being filled in: `classesEnd` and `finalExams`
// are null when the registrar has not yet published them.
//
// Dates use ISO 8601 calendar format (YYYY-MM-DD) in the term's local sense;
// the tests treat them as plain calendar dates via UTC parsing.

/** An ISO 8601 calendar date, e.g. "2026-08-17". Validated by `isIsoDate`. */
export type IsoDate = string;

/** Term labels matching the format used elsewhere in the app ("Fall 2025"). */
export type TermKey =
  | "Fall 2026"
  | "Spring 2027"
  | "Summer 2027"
  | "Fall 2027"
  | "Spring 2028";

/** Session shorthand kinds as used on the registrar calendars. */
export type SessionKind =
  | "full" // full 16-week semester
  | "8w1" // first 8-week session (fall/spring)
  | "8w2" // second 8-week session (fall/spring)
  | "3w1" // 3-week winter intersession (December-January)
  | "3w" // 3-week May session (summer)
  | "5w1" // first 5-week session (summer)
  | "5w2" // second 5-week session (summer)
  | "8w" // 8-week session (summer)
  | "10w"; // 10-week session (summer)

export interface Session {
  /** Unique within the term, e.g. "2026-fall-8w1". */
  id: string;
  term: TermKey;
  kind: SessionKind;
  name: string;
  /** First day of class for this session. */
  classesBegin: IsoDate;
  /**
   * Last regular class meeting, when published. Null for future terms whose
   * detailed calendar the registrar has not yet posted.
   */
  classesEnd: IsoDate | null;
  /** Last day of the session (typically the final-exam day). */
  sessionEnd: IsoDate;
  /** Final-exam window; null when not yet published. */
  finalExams: { begin: IsoDate; end: IsoDate } | null;
}

export interface Holiday {
  term: TermKey;
  name: string;
  /** Inclusive no-class range; single days have begin === end. */
  begin: IsoDate;
  end: IsoDate;
  /**
   * Session ids this no-class day applies to. Omit when the day cancels class
   * for every session of the term whose class dates contain it. Reading days
   * are scoped: the registrar lists them only in the full-term column (N/A
   * for the 8-week sessions), so they must not cancel 8-week classes.
   */
  appliesTo?: readonly string[];
  notes?: string;
}

export interface TermSource {
  /** Official page the dates were transcribed from. */
  url: string;
  /** Date the page was read (ISO 8601). */
  retrievedAt: IsoDate;
  notes?: string;
}

export interface TermCalendar {
  term: TermKey;
  sessions: Session[];
  holidays: Holiday[];
  source: TermSource;
}

const FALL_2026: TermCalendar = {
  term: "Fall 2026",
  sessions: [
    {
      id: "2026-fall-full",
      term: "Fall 2026",
      kind: "full",
      name: "Full Term",
      classesBegin: "2026-08-17",
      classesEnd: "2026-12-03",
      sessionEnd: "2026-12-11",
      finalExams: { begin: "2026-12-05", end: "2026-12-11" },
    },
    {
      id: "2026-fall-8w1",
      term: "Fall 2026",
      kind: "8w1",
      name: "8 Week I Session",
      classesBegin: "2026-08-17",
      classesEnd: "2026-10-08",
      sessionEnd: "2026-10-09",
      finalExams: { begin: "2026-10-09", end: "2026-10-09" },
    },
    {
      id: "2026-fall-8w2",
      term: "Fall 2026",
      kind: "8w2",
      name: "8 Week II Session",
      classesBegin: "2026-10-12",
      classesEnd: "2026-12-10",
      sessionEnd: "2026-12-11",
      finalExams: { begin: "2026-12-11", end: "2026-12-11" },
    },
  ],
  holidays: [
    {
      term: "Fall 2026",
      name: "Labor Day",
      begin: "2026-09-07",
      end: "2026-09-07",
      // The Fall 2026 page's holiday table prints 2025 years (a page typo);
      // the day/month are confirmed by the Future Academic Calendars page.
      notes: "No classes, university closed.",
    },
    {
      term: "Fall 2026",
      name: "Thanksgiving Break",
      begin: "2026-11-23",
      end: "2026-11-29",
      notes: "No classes.",
    },
    {
      term: "Fall 2026",
      name: "Reading Day - No Classes",
      begin: "2026-12-04",
      end: "2026-12-04",
      // The registrar lists the reading day only in the Full Term column
      // (N/A for 8 Week I and II), so it must not cancel 8W2 classes.
      appliesTo: ["2026-fall-full"],
      notes: "Reading day between the last regular class meeting and final exams.",
    },
  ],
  source: {
    url: "https://registrar.unt.edu/registration/fall-academic-calendar.html",
    retrievedAt: "2026-10-13",
    notes:
      "Cross-checked against https://registrar.unt.edu/future-academic-calendar.html.",
  },
};

const SPRING_2027: TermCalendar = {
  term: "Spring 2027",
  sessions: [
    {
      id: "2026-winter-3w1",
      term: "Spring 2027",
      kind: "3w1",
      name: "3 Week I Winter Session",
      classesBegin: "2026-12-14",
      classesEnd: "2027-01-07",
      sessionEnd: "2027-01-08",
      finalExams: { begin: "2027-01-08", end: "2027-01-08" },
    },
    {
      id: "2027-spring-full",
      term: "Spring 2027",
      kind: "full",
      name: "Full Semester",
      classesBegin: "2027-01-11",
      classesEnd: "2027-04-29",
      sessionEnd: "2027-05-07",
      finalExams: { begin: "2027-05-01", end: "2027-05-07" },
    },
    {
      id: "2027-spring-8w1",
      term: "Spring 2027",
      kind: "8w1",
      name: "8 Week I Session",
      classesBegin: "2027-01-11",
      classesEnd: "2027-03-04",
      sessionEnd: "2027-03-05",
      finalExams: { begin: "2027-03-05", end: "2027-03-05" },
    },
    {
      id: "2027-spring-8w2",
      term: "Spring 2027",
      kind: "8w2",
      name: "8 Week II Session",
      classesBegin: "2027-03-15",
      classesEnd: "2027-05-06",
      sessionEnd: "2027-05-07",
      finalExams: { begin: "2027-05-07", end: "2027-05-07" },
    },
  ],
  holidays: [
    {
      term: "Spring 2027",
      name: "Winter Break",
      begin: "2026-12-24",
      end: "2027-01-01",
      notes: "No classes; university closed. Listed as tentative.",
    },
    {
      term: "Spring 2027",
      name: "Martin Luther King Jr. Holiday",
      begin: "2027-01-18",
      end: "2027-01-18",
    },
    {
      term: "Spring 2027",
      name: "Spring Break",
      begin: "2027-03-08",
      end: "2027-03-14",
      notes: "No classes.",
    },
    {
      term: "Spring 2027",
      name: "Reading Day - No Classes",
      begin: "2027-04-30",
      end: "2027-04-30",
      // Listed only in the Full Semester column on the registrar's page.
      appliesTo: ["2027-spring-full"],
      notes: "Reading day between the last regular class meeting and final exams.",
    },
  ],
  source: {
    url: "https://registrar.unt.edu/registration/spring-academic-calendar.html",
    retrievedAt: "2026-10-13",
  },
};

const SUMMER_2027: TermCalendar = {
  term: "Summer 2027",
  sessions: [
    {
      id: "2027-summer-3w",
      term: "Summer 2027",
      kind: "3w",
      name: "3 Week Session",
      classesBegin: "2027-05-10",
      classesEnd: "2027-05-27",
      sessionEnd: "2027-05-28",
      finalExams: { begin: "2027-05-28", end: "2027-05-28" },
    },
    {
      id: "2027-summer-5w1",
      term: "Summer 2027",
      kind: "5w1",
      name: "5 Week I Session",
      classesBegin: "2027-05-17",
      classesEnd: "2027-06-17",
      sessionEnd: "2027-06-18",
      finalExams: { begin: "2027-06-18", end: "2027-06-18" },
    },
    {
      id: "2027-summer-10w",
      term: "Summer 2027",
      kind: "10w",
      name: "10 Week Session",
      classesBegin: "2027-05-17",
      classesEnd: "2027-07-22",
      sessionEnd: "2027-07-23",
      finalExams: { begin: "2027-07-23", end: "2027-07-23" },
    },
    {
      id: "2027-summer-8w",
      term: "Summer 2027",
      kind: "8w",
      name: "8 Week Session",
      classesBegin: "2027-06-01",
      classesEnd: "2027-07-22",
      sessionEnd: "2027-07-23",
      finalExams: { begin: "2027-07-23", end: "2027-07-23" },
    },
    {
      id: "2027-summer-5w2",
      term: "Summer 2027",
      kind: "5w2",
      name: "5 Week II Session",
      classesBegin: "2027-06-21",
      classesEnd: "2027-07-22",
      sessionEnd: "2027-07-23",
      finalExams: { begin: "2027-07-23", end: "2027-07-23" },
    },
  ],
  holidays: [
    {
      term: "Summer 2027",
      name: "Memorial Day",
      begin: "2027-05-31",
      end: "2027-05-31",
      notes: "No classes.",
    },
    {
      term: "Summer 2027",
      name: "Juneteenth",
      begin: "2027-06-19",
      end: "2027-06-19",
      notes: "Falls on a Saturday; listed by the registrar as a no-class day.",
    },
    {
      term: "Summer 2027",
      name: "July 4th",
      begin: "2027-07-04",
      end: "2027-07-04",
      notes: "Falls on a Sunday; listed by the registrar as a no-class day.",
    },
  ],
  source: {
    url: "https://registrar.unt.edu/registration/summer-academic-calendar.html",
    retrievedAt: "2026-10-13",
  },
};

// Fall 2027 and Spring 2028 appear only on the Future Academic Calendars page,
// which publishes session spans and holidays but not finals or detailed
// deadlines. Fields the registrar has not published stay null.
const FALL_2027: TermCalendar = {
  term: "Fall 2027",
  sessions: [
    {
      id: "2027-fall-full",
      term: "Fall 2027",
      kind: "full",
      name: "Full Term",
      classesBegin: "2027-08-16",
      classesEnd: null,
      sessionEnd: "2027-12-10",
      finalExams: null,
    },
    {
      id: "2027-fall-8w1",
      term: "Fall 2027",
      kind: "8w1",
      name: "8 Week I Session",
      classesBegin: "2027-08-16",
      classesEnd: null,
      sessionEnd: "2027-10-08",
      finalExams: null,
    },
    {
      id: "2027-fall-8w2",
      term: "Fall 2027",
      kind: "8w2",
      name: "8 Week II Session",
      classesBegin: "2027-10-11",
      classesEnd: null,
      sessionEnd: "2027-12-10",
      finalExams: null,
    },
  ],
  holidays: [
    {
      term: "Fall 2027",
      name: "Labor Day",
      begin: "2027-09-06",
      end: "2027-09-06",
      notes: "No classes, university closed.",
    },
    {
      term: "Fall 2027",
      name: "Thanksgiving Break",
      begin: "2027-11-22",
      end: "2027-11-28",
      notes: "No classes.",
    },
  ],
  source: {
    url: "https://registrar.unt.edu/future-academic-calendar.html",
    retrievedAt: "2026-10-13",
    notes:
      "Planning dates only; the registrar marks these as subject to change. Detailed deadlines and finals not yet published.",
  },
};

const SPRING_2028: TermCalendar = {
  term: "Spring 2028",
  sessions: [
    {
      id: "2027-winter-3w1",
      term: "Spring 2028",
      kind: "3w1",
      name: "3 Week I Winter Session",
      classesBegin: "2027-12-13",
      classesEnd: null,
      sessionEnd: "2028-01-07",
      finalExams: null,
    },
    {
      id: "2028-spring-full",
      term: "Spring 2028",
      kind: "full",
      name: "Full Semester",
      classesBegin: "2028-01-10",
      classesEnd: null,
      sessionEnd: "2028-05-05",
      finalExams: null,
    },
    {
      id: "2028-spring-8w1",
      term: "Spring 2028",
      kind: "8w1",
      name: "8 Week I Session",
      classesBegin: "2028-01-10",
      classesEnd: null,
      sessionEnd: "2028-03-03",
      finalExams: null,
    },
    {
      id: "2028-spring-8w2",
      term: "Spring 2028",
      kind: "8w2",
      name: "8 Week II Session",
      classesBegin: "2028-03-13",
      classesEnd: null,
      sessionEnd: "2028-05-05",
      finalExams: null,
    },
  ],
  holidays: [
    {
      term: "Spring 2028",
      name: "Martin Luther King Jr. Holiday",
      begin: "2028-01-17",
      end: "2028-01-17",
    },
    {
      term: "Spring 2028",
      name: "Spring Break",
      begin: "2028-03-06",
      end: "2028-03-12",
      notes: "No classes.",
    },
  ],
  source: {
    url: "https://registrar.unt.edu/future-academic-calendar.html",
    retrievedAt: "2026-10-13",
    notes:
      "Planning dates only; the registrar marks these as subject to change. Detailed deadlines and finals not yet published.",
  },
};

/** The five terms this module covers, in chronological order. */
export const TERMS: readonly TermCalendar[] = [
  FALL_2026,
  SPRING_2027,
  SUMMER_2027,
  FALL_2027,
  SPRING_2028,
];

const TERM_INDEX = new Map(TERMS.map((term) => [term.term, term]));

/** Returns the calendar for a term key, or undefined if not covered. */
export function getTermCalendar(term: TermKey): TermCalendar | undefined {
  return TERM_INDEX.get(term);
}

/** All sessions across all covered terms, flattened. */
export function allSessions(): readonly Session[] {
  return TERMS.flatMap((term) => term.sessions);
}

/** All holidays across all covered terms, flattened. */
export function allHolidays(): readonly Holiday[] {
  return TERMS.flatMap((term) => term.holidays);
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** Parses an ISO date as a UTC-midnight Date, keeping calendar-day arithmetic exact. */
export function parseIsoDate(value: IsoDate): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Formats a UTC-midnight Date back to an ISO date string. */
export function formatIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/** Inclusive day count between two ISO dates (end - begin, in days). */
export function daysBetween(begin: IsoDate, end: IsoDate): number {
  return Math.round(
    (parseIsoDate(end).getTime() - parseIsoDate(begin).getTime()) / 86_400_000,
  );
}

/** True when two inclusive date ranges share at least one day. */
export function rangesOverlap(
  aBegin: IsoDate,
  aEnd: IsoDate,
  bBegin: IsoDate,
  bEnd: IsoDate,
): boolean {
  return daysBetween(aBegin, bEnd) >= 0 && daysBetween(bBegin, aEnd) >= 0;
}

/**
 * Session kinds that are alternatives to each other within one term and must
 * never overlap: 8W1 and 8W2 partition the semester, and the winter
 * intersession precedes both. The full term intentionally spans them (students
 * mix full-term and 8-week courses on one schedule), and summer sessions
 * intentionally overlap (10W contains 5W1, and so on), so neither the full
 * kind nor summer kinds take part in the disjointness check.
 */
const DISJOINT_KINDS = new Set<SessionKind>(["8w1", "8w2", "3w1"]);

/** The alternative-track sessions of a term must partition it: no overlaps. */
export function findOverlappingDisjointSessions(term: TermCalendar): [Session, Session][] {
  const overlapping: [Session, Session][] = [];
  const sessions = term.sessions.filter((session) =>
    DISJOINT_KINDS.has(session.kind),
  );
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      if (
        rangesOverlap(
          sessions[i].classesBegin,
          sessions[i].sessionEnd,
          sessions[j].classesBegin,
          sessions[j].sessionEnd,
        )
      ) {
        overlapping.push([sessions[i], sessions[j]]);
      }
    }
  }
  return overlapping;
}

/** What the calendar says a session does on a date. */
export type ClassDayStatus = "class" | "no-class" | "finals" | "unknown";

/** True when a no-class day covers a date for a given session. */
function holidayCancelsSession(holiday: Holiday, session: Session, date: IsoDate): boolean {
  if (holiday.appliesTo !== undefined && !holiday.appliesTo.includes(session.id)) {
    return false;
  }
  return rangesOverlap(date, date, holiday.begin, holiday.end);
}

/** The status of one date for one session. */
function sessionDayStatus(session: Session, date: IsoDate): ClassDayStatus {
  const inSpan =
    daysBetween(session.classesBegin, date) >= 0 &&
    daysBetween(date, session.sessionEnd) >= 0;
  if (!inSpan) return "no-class";
  if (
    session.finalExams !== null &&
    rangesOverlap(date, date, session.finalExams.begin, session.finalExams.end)
  ) {
    return "finals";
  }
  // A published holiday answers even when the session's class dates are not
  // published yet (Labor Day, Spring Break in future terms).
  const cancelled = (getTermCalendar(session.term)?.holidays ?? []).some((holiday) =>
    holidayCancelsSession(holiday, session, date),
  );
  if (cancelled) return "no-class";
  // Class dates the registrar has not published stay unknown.
  if (session.classesEnd === null) return "unknown";
  // After the last regular class meeting, before finals: the reading-day gap.
  if (daysBetween(date, session.classesEnd) < 0) return "no-class";
  return "class";
}

/**
 * Whether a date is a class day, a no-class day, or a final-exam day.
 *
 * Dates are plain calendar dates in the America/Chicago time zone, the time
 * zone all UNT campuses schedule in. The query compares YYYY-MM-DD strings
 * only; no timestamps are involved.
 *
 * With a session id, the answer is for that session alone; a date outside the
 * session's span is "no-class" (the session does not meet). Without one, the
 * answer unions every covered session: the most specific published answer
 * wins in the order class, finals, unknown, no-class, so a full-term reading
 * day that falls inside an 8-week session's class dates still reads "class".
 *
 * "unknown" means the calendar cannot answer without guessing: the date is
 * not a valid ISO date, the session id is not covered, or the session's class
 * dates or finals are not yet published (null fields).
 */
export function classDayStatus(date: IsoDate, sessionId?: string): ClassDayStatus {
  if (!isIsoDate(date)) return "unknown";
  const sessions =
    sessionId === undefined
      ? allSessions()
      : allSessions().filter((session) => session.id === sessionId);
  if (sessions.length === 0) return "unknown";
  const statuses = sessions.map((session) => sessionDayStatus(session, date));
  for (const status of ["class", "finals", "unknown", "no-class"] as const) {
    if (statuses.includes(status)) return status;
  }
  return "no-class";
}
