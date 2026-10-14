import { describe, expect, test } from "bun:test";
import {
  TERMS,
  allHolidays,
  allSessions,
  classDayStatus,
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

/** Sessions whose published last class day touches or crosses their finals begin. */
function classesFinalsBoundaryViolations(terms: readonly TermCalendar[]): string[] {
  const violations: string[] = [];
  for (const term of terms) {
    for (const session of term.sessions) {
      if (session.classesEnd !== null && session.finalExams !== null) {
        if (daysBetween(session.classesEnd, session.finalExams.begin) < 1) {
          violations.push(
            `${session.id}: last class ${session.classesEnd} shares a boundary with finals ${session.finalExams.begin}`,
          );
        }
      }
    }
  }
  return violations;
}

/** Winter intersessions that end on or after their full semester's first class day. */
function winterFullSemesterGaps(terms: readonly TermCalendar[]): string[] {
  const ids: string[] = [];
  for (const term of terms) {
    const winter = term.sessions.find((session) => session.kind === "3w1");
    const full = term.sessions.find((session) => session.kind === "full");
    if (winter && full && daysBetween(winter.sessionEnd, full.classesBegin) < 1) {
      ids.push(winter.id);
    }
  }
  return ids;
}

/** Term pairs where the later term begins on or before the earlier term ends. */
function termLeakViolations(terms: readonly TermCalendar[]): string[] {
  const violations: string[] = [];
  for (let i = 0; i < terms.length - 1; i++) {
    const earlierEnd = terms[i].sessions.map((s) => s.sessionEnd).sort().at(-1) as string;
    const laterBegin = terms[i + 1].sessions.map((s) => s.classesBegin).sort().at(0) as string;
    if (daysBetween(earlierEnd, laterBegin) < 1) {
      violations.push(`${terms[i].term} -> ${terms[i + 1].term}: ${earlierEnd} -> ${laterBegin}`);
    }
  }
  return violations;
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
        if (session.classesEnd !== null) {
          // Inclusive ranges never share a boundary day: the last regular
          // class meeting is strictly before finals begin.
          expect(daysBetween(session.classesEnd, session.finalExams.begin)).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  test("negative: a last class day sharing a boundary with finals is rejected", () => {
    expect(classesFinalsBoundaryViolations(TERMS as TermCalendar[])).toEqual([]);
    // Fall 2026 8W1 finals moved onto the last class day, Oct 8.
    const fall = getTermCalendar("Fall 2026") as TermCalendar;
    const moved = fall.sessions.map((session) =>
      session.id === "2026-fall-8w1"
        ? { ...session, finalExams: { begin: "2026-10-08", end: "2026-10-09" } }
        : session,
    );
    const violations = classesFinalsBoundaryViolations([{ ...fall, sessions: moved }]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("2026-fall-8w1");
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
        if (session.classesEnd !== null) {
          expect(daysBetween(session.classesEnd, session.finalExams.begin)).toBeGreaterThanOrEqual(1);
        }
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
    // Strictly before: inclusive ranges never share a boundary day.
    expect(winterFullSemesterGaps(TERMS as TermCalendar[])).toEqual([]);
  });

  test("negative: a winter session touching the full semester's first class day is rejected", () => {
    const spring = getTermCalendar("Spring 2027") as TermCalendar;
    const touching = spring.sessions.map((session) =>
      session.id === "2026-winter-3w1" ? { ...session, sessionEnd: "2027-01-11" } : session,
    );
    expect(winterFullSemesterGaps([{ ...spring, sessions: touching }])).toEqual([
      "2026-winter-3w1",
    ]);
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
    // Within one academic year the terms are sequential, and inclusive
    // ranges never share a boundary day: the next term begins strictly after
    // the prior term's last session day. The only intentional cross-boundary
    // session is the winter intersession, which belongs to the spring term
    // and starts after the prior fall term ends.
    expect(termLeakViolations(TERMS as TermCalendar[])).toEqual([]);
  });

  test("negative: a term beginning on the prior term's last day is rejected", () => {
    // The Spring 2027 winter session moved up to the day Fall 2026 ends.
    const later = getTermCalendar("Spring 2027") as TermCalendar;
    const touching = later.sessions.map((session) =>
      session.id === "2026-winter-3w1" ? { ...session, classesBegin: "2026-12-11" } : session,
    );
    const violations = termLeakViolations([
      TERMS[0] as TermCalendar,
      { ...later, sessions: touching },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("Fall 2026 -> Spring 2027");
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

  test("every break falls entirely inside the class dates of a session of its term", () => {
    for (const term of TERMS as TermCalendar[]) {
      for (const holiday of term.holidays) {
        // Both endpoints must sit inside the same session. Class dates when
        // published; otherwise the session span, since the registrar has not
        // yet posted last class days for future terms.
        const containing = term.sessions.filter((session) => {
          const end = session.classesEnd ?? session.sessionEnd;
          return (
            daysBetween(session.classesBegin, holiday.begin) >= 0 &&
            daysBetween(holiday.end, end) >= 0
          );
        });
        expect(containing.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test("negative: a break straddling a class-span boundary is rejected", () => {
    // Begins on 8W2's last class day (Dec 10) and ends on its finals day
    // (Dec 11): no single session's class dates contain both endpoints. The
    // old rangesOverlap check against the session span passed this, because
    // 8W2's session span runs through Dec 11.
    const fall = getTermCalendar("Fall 2026") as TermCalendar;
    const straddling: Holiday = {
      term: "Fall 2026",
      name: "Fabricated Straddling Break",
      begin: "2026-12-10",
      end: "2026-12-11",
    };
    const uncovered = ({ ...fall, holidays: [...fall.holidays, straddling] }).holidays.filter(
      (holiday) =>
        !fall.sessions.some((session) => {
          const end = session.classesEnd ?? session.sessionEnd;
          return (
            daysBetween(session.classesBegin, holiday.begin) >= 0 &&
            daysBetween(holiday.end, end) >= 0
          );
        }),
    );
    expect(uncovered).toEqual([straddling]);
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

describe("class day queries", () => {
  // Dates are plain calendar dates in America/Chicago; the query compares
  // YYYY-MM-DD strings only and touches no timestamps.

  test("a regular class day reads class for the term and its sessions", () => {
    expect(classDayStatus("2026-09-09", "2026-fall-full")).toBe("class");
    expect(classDayStatus("2026-09-09", "2026-fall-8w1")).toBe("class");
    expect(classDayStatus("2026-09-09")).toBe("class");
  });

  test("a holiday reads no-class for the sessions it cancels", () => {
    // Labor Day 2026: full and 8W1 are on break; 8W2 has not started.
    expect(classDayStatus("2026-09-07", "2026-fall-full")).toBe("no-class");
    expect(classDayStatus("2026-09-07", "2026-fall-8w1")).toBe("no-class");
    expect(classDayStatus("2026-09-07")).toBe("no-class");
  });

  test("every day of the Spring 2027 break week reads no-class", () => {
    for (const day of enumerateDays("2027-03-08", "2027-03-14")) {
      expect(classDayStatus(day, "2027-spring-full")).toBe("no-class");
      expect(classDayStatus(day)).toBe("no-class");
    }
  });

  test("the reading day cancels full-term classes but not 8W2 classes", () => {
    // The registrar lists the reading day only in the full-term column
    // (N/A for the 8-week sessions), so Dec 4 stays a class day for 8W2.
    expect(classDayStatus("2026-12-04", "2026-fall-full")).toBe("no-class");
    expect(classDayStatus("2026-12-04", "2026-fall-8w2")).toBe("class");
    expect(classDayStatus("2027-04-30", "2027-spring-full")).toBe("no-class");
    expect(classDayStatus("2027-04-30", "2027-spring-8w2")).toBe("class");
    // The union reads class: 8W2 still meets on the full term's reading day.
    expect(classDayStatus("2026-12-04")).toBe("class");
  });

  test("final-exam days read finals", () => {
    expect(classDayStatus("2026-12-09", "2026-fall-full")).toBe("finals");
    expect(classDayStatus("2026-12-11", "2026-fall-8w2")).toBe("finals");
    // 8W2 classes run through Dec 10; Dec 9 is still a class day for it.
    expect(classDayStatus("2026-12-09", "2026-fall-8w2")).toBe("class");
  });

  test("unpublished future dates read unknown, never a guess", () => {
    expect(classDayStatus("2027-10-15", "2027-fall-full")).toBe("unknown");
    expect(classDayStatus("2027-10-15")).toBe("unknown");
    expect(classDayStatus("2028-02-15", "2028-spring-full")).toBe("unknown");
  });

  test("invalid dates and uncovered session ids read unknown", () => {
    expect(classDayStatus("2026-13-45", "2026-fall-full")).toBe("unknown");
    expect(classDayStatus("2026-09-09", "2025-fall-full")).toBe("unknown");
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

describe("published holidays answer before unpublished class dates", () => {
  test("returns no-class for Labor Day 2027 in the full Fall 2027 term", () => {
    expect(classDayStatus("2027-09-06", "2027-fall-full")).toBe("no-class");
  });
  test("returns no-class for Spring Break 2028 in the full Spring 2028 semester", () => {
    expect(classDayStatus("2028-03-08", "2028-spring-full")).toBe("no-class");
  });
  test("still returns unknown for an unpublished ordinary date", () => {
    expect(classDayStatus("2027-10-15", "2027-fall-full")).toBe("unknown");
  });
});
