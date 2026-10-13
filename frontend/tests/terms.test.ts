import { describe, expect, test } from "bun:test";
import {
  TERMS,
  allHolidays,
  allSessions,
  daysBetween,
  findOverlappingDisjointSessions,
  formatIsoDate,
  getTermCalendar,
  isIsoDate,
  parseIsoDate,
  rangesOverlap,
} from "@/lib/terms/terms";
import type { Holiday, Session, TermCalendar, TermKey } from "@/lib/terms/terms";

// Strict checks over the UNT term calendars. The data itself must be valid
// before anything downstream plans against it, so a failing check here means
// a transcription error: fix the data, never the check.

const EXPECTED_TERMS: TermKey[] = [
  "Fall 2026",
  "Spring 2027",
  "Summer 2027",
  "Fall 2027",
  "Spring 2028",
];

function dayOfWeek(iso: string): number {
  return parseIsoDate(iso).getUTCDay(); // 0 Sunday through 6 Saturday
}

/** Inclusive list of ISO dates a range covers. */
function enumerateDays(begin: string, end: string): string[] {
  const days: string[] = [];
  for (let offset = 0; offset <= daysBetween(begin, end); offset++) {
    const date = parseIsoDate(begin);
    date.setUTCDate(date.getUTCDate() + offset);
    days.push(formatIsoDate(date));
  }
  return days;
}

describe("term calendar integrity", () => {
  test("covers exactly the five assigned terms in chronological order", () => {
    expect(TERMS.map((term) => term.term)).toEqual(EXPECTED_TERMS);
  });

  test("every term names an official source with a retrieval date", () => {
    for (const term of TERMS) {
      expect(term.source.url).toMatch(/^https:\/\/registrar\.unt\.edu\//);
      expect(isIsoDate(term.source.retrievedAt)).toBe(true);
    }
  });

  test("every session id is unique across all terms", () => {
    const ids = allSessions().map((session) => session.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every session is well formed and ordered in time", () => {
    for (const session of allSessions() as Session[]) {
      expect(isIsoDate(session.classesBegin)).toBe(true);
      expect(isIsoDate(session.sessionEnd)).toBe(true);
      expect(daysBetween(session.classesBegin, session.sessionEnd)).toBeGreaterThanOrEqual(0);
      if (session.classesEnd !== null) {
        expect(daysBetween(session.classesBegin, session.classesEnd)).toBeGreaterThanOrEqual(0);
        expect(daysBetween(session.classesEnd, session.sessionEnd)).toBeGreaterThanOrEqual(0);
      }
      if (session.finalExams !== null) {
        expect(daysBetween(session.finalExams.begin, session.finalExams.end)).toBeGreaterThanOrEqual(0);
        expect(daysBetween(session.finalExams.end, session.sessionEnd)).toBe(0);
      }
    }
  });

  test("class days and final-exam windows are weekday-sane", () => {
    // Sessions never begin on a weekend. A finals window may span a weekend
    // (the Fall 2026 window starts Saturday, Dec 5), so only its end must be
    // a weekday, and it must sit at the close of the session.
    for (const session of allSessions() as Session[]) {
      const beginDay = dayOfWeek(session.classesBegin);
      expect(beginDay).toBeGreaterThanOrEqual(1);
      expect(beginDay).toBeLessThanOrEqual(5);
      if (session.classesEnd !== null) {
        const endDay = dayOfWeek(session.classesEnd);
        expect(endDay).toBeGreaterThanOrEqual(1);
        expect(endDay).toBeLessThanOrEqual(5);
      }
      if (session.finalExams !== null) {
        expect(daysBetween(session.classesBegin, session.finalExams.begin)).toBeGreaterThanOrEqual(0);
        expect(daysBetween(session.finalExams.begin, session.sessionEnd)).toBeGreaterThanOrEqual(0);
        expect(daysBetween(session.finalExams.begin, session.finalExams.end)).toBeLessThanOrEqual(7);
        const endDay = dayOfWeek(session.finalExams.end);
        expect(endDay).toBeGreaterThanOrEqual(1);
        expect(endDay).toBeLessThanOrEqual(5);
      }
    }
  });

  test("full semesters begin on a Monday", () => {
    for (const session of allSessions() as Session[]) {
      if (session.kind === "full" || session.kind === "8w1") {
        expect(dayOfWeek(session.classesBegin)).toBe(1);
      }
    }
  });
});

describe("session overlap rules", () => {
  test("alternative-track sessions of a term never overlap", () => {
    for (const term of TERMS) {
      expect(findOverlappingDisjointSessions(term)).toEqual([]);
    }
  });

  test("winter intersessions end before their full semester begins", () => {
    for (const term of TERMS) {
      const winter = term.sessions.find((session) => session.kind === "3w1");
      const full = term.sessions.find((session) => session.kind === "full");
      if (winter && full) {
        expect(daysBetween(winter.sessionEnd, full.classesBegin)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("summer sessions overlap by design; everything else does not", () => {
    const summer = getTermCalendar("Summer 2027");
    expect(summer).toBeDefined();
    if (!summer) return;
    // Exactly the registrar's nesting: the 10-week session contains every
    // other summer session, and the 3-week May session precedes 5W2 and 8W.
    const sessions = Object.fromEntries(
      summer.sessions.map((session) => [session.kind, session]),
    );
    const tenWeek = sessions["10w"] as Session;
    for (const other of summer.sessions) {
      if (other.kind === "10w") continue;
      expect(rangesOverlap(other.classesBegin, other.sessionEnd, tenWeek.classesBegin, tenWeek.sessionEnd)).toBe(true);
    }
    expect(rangesOverlap(
      (sessions["3w"] as Session).sessionEnd,
      (sessions["3w"] as Session).sessionEnd,
      (sessions["5w2"] as Session).classesBegin,
      (sessions["5w2"] as Session).sessionEnd,
    )).toBe(false);
    expect(rangesOverlap(
      (sessions["5w1"] as Session).sessionEnd,
      (sessions["5w1"] as Session).sessionEnd,
      (sessions["5w2"] as Session).classesBegin,
      (sessions["5w2"] as Session).sessionEnd,
    )).toBe(false);
  });

  test("terms do not leak into each other", () => {
    // Within one academic year the terms are sequential; the only intentional
    // cross-boundary session is the winter intersession, which belongs to the
    // spring term and starts after the prior fall term ends.
    for (let i = 0; i < TERMS.length - 1; i++) {
      const earlier = TERMS[i];
      const later = TERMS[i + 1];
      const earlierEnd = earlier.sessions
        .map((session) => session.sessionEnd)
        .sort()
        .at(-1) as string;
      const laterBegin = later.sessions
        .map((session) => session.classesBegin)
        .sort()
        .at(0) as string;
      expect(daysBetween(earlierEnd, laterBegin)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("holidays and breaks", () => {
  test("every holiday belongs to a covered term and has a valid range", () => {
    const keys = new Set(TERMS.map((term) => term.term));
    for (const holiday of allHolidays() as Holiday[]) {
      expect(keys.has(holiday.term)).toBe(true);
      expect(isIsoDate(holiday.begin)).toBe(true);
      expect(isIsoDate(holiday.end)).toBe(true);
      expect(daysBetween(holiday.begin, holiday.end)).toBeGreaterThanOrEqual(0);
    }
  });

  test("every break falls inside the span of at least one session of its term", () => {
    for (const term of TERMS as TermCalendar[]) {
      for (const holiday of term.holidays) {
        const covered = term.sessions.some((session) =>
          rangesOverlap(holiday.begin, holiday.end, session.classesBegin, session.sessionEnd),
        );
        expect(covered).toBe(true);
      }
    }
  });

  test("holidays never fall on a first or last class day", () => {
    for (const term of TERMS as TermCalendar[]) {
      for (const holiday of term.holidays) {
        const holidayDays = new Set(enumerateDays(holiday.begin, holiday.end));
        for (const session of term.sessions) {
          expect(holidayDays.has(session.classesBegin)).toBe(false);
          if (session.classesEnd !== null) {
            expect(holidayDays.has(session.classesEnd)).toBe(false);
          }
        }
      }
    }
  });

  test("known fixed-weekday holidays land on the right weekday", () => {
    // Labor Day and MLK Day are Mondays; Memorial Day is a Monday;
    // Thanksgiving week contains a Thursday; the winter break contains
    // December 25 and January 1.
    const byTerm = (term: TermKey) => getTermCalendar(term)?.holidays ?? [];
    const named = (holidays: Holiday[], name: string) =>
      holidays.find((holiday) => holiday.name === name);

    expect(dayOfWeek((named(byTerm("Fall 2026"), "Labor Day") as Holiday).begin)).toBe(1);
    expect(dayOfWeek((named(byTerm("Fall 2027"), "Labor Day") as Holiday).begin)).toBe(1);
    expect(dayOfWeek((named(byTerm("Spring 2027"), "Martin Luther King Jr. Holiday") as Holiday).begin)).toBe(1);
    expect(dayOfWeek((named(byTerm("Spring 2028"), "Martin Luther King Jr. Holiday") as Holiday).begin)).toBe(1);
    expect(dayOfWeek((named(byTerm("Summer 2027"), "Memorial Day") as Holiday).begin)).toBe(1);

    const thanksgiving = named(byTerm("Fall 2026"), "Thanksgiving Break") as Holiday;
    expect(enumerateDays(thanksgiving.begin, thanksgiving.end).map(dayOfWeek)).toContain(4);

    const winterBreak = named(byTerm("Spring 2027"), "Winter Break") as Holiday;
    expect(winterBreak.begin.endsWith("-12-24")).toBe(true);
    expect(winterBreak.end.endsWith("-01-01")).toBe(true);
  });
});

describe("Spring 2027 reconciliation against the official calendar", () => {
  // The registrar publishes two pages for Spring 2027: the detailed
  // "Spring Academic Calendar and Key Dates" page and the summary
  // "Future Academic Calendars" page. The literals below were read from the
  // detailed page and must agree with the Future Calendars summary.
  test("session dates match the detailed Spring 2027 calendar", () => {
    const spring = getTermCalendar("Spring 2027");
    expect(spring).toBeDefined();
    if (!spring) return;
    const byKind = Object.fromEntries(
      spring.sessions.map((session) => [session.kind, session]),
    );

    const winter = byKind["3w1"] as Session;
    expect(winter.classesBegin).toBe("2026-12-14");
    expect(winter.sessionEnd).toBe("2027-01-08");

    const full = byKind["full"] as Session;
    expect(full.classesBegin).toBe("2027-01-11");
    expect(full.sessionEnd).toBe("2027-05-07");

    const eightWeekOne = byKind["8w1"] as Session;
    expect(eightWeekOne.classesBegin).toBe("2027-01-11");
    expect(eightWeekOne.sessionEnd).toBe("2027-03-05");

    const eightWeekTwo = byKind["8w2"] as Session;
    expect(eightWeekTwo.classesBegin).toBe("2027-03-15");
    expect(eightWeekTwo.sessionEnd).toBe("2027-05-07");
  });

  test("finals and last class days match the detailed Spring 2027 calendar", () => {
    const spring = getTermCalendar("Spring 2027");
    if (!spring) return;
    const full = spring.sessions.find((session) => session.kind === "full") as Session;
    expect(full.classesEnd).toBe("2027-04-29"); // last regular class meeting
    expect(full.finalExams).toEqual({ begin: "2027-05-01", end: "2027-05-07" });

    const eightWeekOne = spring.sessions.find((session) => session.kind === "8w1") as Session;
    expect(eightWeekOne.finalExams).toEqual({ begin: "2027-03-05", end: "2027-03-05" });

    const eightWeekTwo = spring.sessions.find((session) => session.kind === "8w2") as Session;
    expect(eightWeekTwo.finalExams).toEqual({ begin: "2027-05-07", end: "2027-05-07" });
  });

  test("holidays match the detailed Spring 2027 calendar", () => {
    const spring = getTermCalendar("Spring 2027");
    if (!spring) return;
    const holiday = (name: string) => spring?.holidays.find((h) => h.name === name);
    expect(holiday("Martin Luther King Jr. Holiday")).toEqual({
      term: "Spring 2027",
      name: "Martin Luther King Jr. Holiday",
      begin: "2027-01-18",
      end: "2027-01-18",
    });
    expect(holiday("Spring Break")).toEqual({
      term: "Spring 2027",
      name: "Spring Break",
      begin: "2027-03-08",
      end: "2027-03-14",
      notes: "No classes.",
    });
  });

  test("future terms leave unpublished details null instead of guessing", () => {
    for (const key of ["Fall 2027", "Spring 2028"] as TermKey[]) {
      const term = getTermCalendar(key) as TermCalendar;
      for (const session of term.sessions) {
        expect(session.classesEnd).toBeNull();
        expect(session.finalExams).toBeNull();
      }
    }
  });
});
