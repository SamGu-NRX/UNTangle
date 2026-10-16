import { describe, expect, test } from "bun:test";
import { EXAM_DAYS, examFor, moveToWeek, type ExamClass, type ExamDay } from "@untangle/core/final-exams";
import { parseUntExamPage } from "../src/exam-schedule";
import { currentModule, expectedModule, fixtureMeta, MODULE, parseFixture } from "./build-exam-module";

/**
 * The fixture is the registrar's Fall 2026 final-exam page, saved once on
 * 2026-10-16 (fixtures/unt-exams/SOURCES.md). Tests never fetch.
 */
const parsed = parseFixture();
const { schedule } = parsed;

const clock = (text: string) => {
  const [, h, m, half] = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(text)!;
  return ((Number(h) % 12) + (half === "PM" ? 12 : 0)) * 60 + Number(m);
};
const slot = (date: string, from: string, to: string) => ({ date, start: clock(from), end: clock(to) });
const timed = (days: ExamDay[], start: string) => days.map((day) => ({ day, start: clock(start) }));
const full = (meetings: ExamClass["meetings"], campus: ExamClass["campus"] = "main", courseCode = "CSCE 2110"): ExamClass => ({
  courseCode,
  session: "full",
  campus,
  meetings,
});

describe("parseUntExamPage on the Fall 2026 page", () => {
  test("reads the term and the source from SOURCES.md", () => {
    expect(schedule.term).toBe("Fall 2026");
    expect(schedule.sourceUrl).toBe("https://registrar.unt.edu/exams/final-exam-schedule/fall.html");
    expect(schedule.capturedAt).toBe(fixtureMeta().capturedAt);
  });

  test("reads every first-day table on both campuses and both eight-week tables", () => {
    const count = (campus: string, session: string, days: string) =>
      schedule.grid.filter((row) => row.campus === campus && row.session === session && row.firstDays.join("") === days).length;
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      expect(count("main", "full", day)).toBe(12);
      expect(count("discovery-park", "full", day)).toBe(12);
    }
    // Four rows printed; the main campus's second row is a typo (below).
    expect(count("main", "full", "SatSun")).toBe(3);
    expect(count("discovery-park", "full", "SatSun")).toBe(4);
    for (const campus of ["main", "discovery-park"]) {
      expect(count(campus, "8w2", "MonWedFri")).toBe(6);
      expect(count(campus, "8w2", "TueThu")).toBe(6);
    }
    expect(schedule.grid).toHaveLength(151);
  });

  test("reports the one row UNT printed backwards instead of guessing", () => {
    expect(parsed.invalid).toEqual([
      {
        panel: "Classes Meeting on the Main Denton Campus",
        table: "First Class Meeting on Saturday or Sunday (Sa, Su, etc.)",
        text: "11:00 a.m. and 1:59 a.m. | Saturday, Dec. 5 from 10:30 a.m. – 12:30 p.m.",
        reason: "the range ends (1:59 am) before it starts (11:00 am)",
      },
    ]);
  });

  test("names the panels it has no rule for", () => {
    expect(parsed.ignored).toEqual(["Classes Meeting at UNT at Frisco", "Online Classes"]);
  });

  test("never reads the Fall 2022 grid kept in an HTML comment", () => {
    const dates = new Set([...schedule.grid, ...schedule.bySubject, ...schedule.byCourse].map((entry) => entry.exam.date));
    expect([...dates].sort()).toEqual(["2026-10-10", "2026-12-05", "2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10"]);
  });

  test("reads a misspelled weekday and a doubled 'from' by the date", () => {
    const row = schedule.grid.find((entry) => entry.text.startsWith("4:00 p.m. and 4:59 p.m. | Wedneday"))!;
    expect(row.exam).toEqual(slot("2026-12-09", "1:00 PM", "3:00 PM"));
  });

  test("reads the first eight-week subjects and the departmental finals", () => {
    expect(schedule.bySubject.map((row) => [row.subjects, row.exam])).toEqual([
      [["ACCT", "BCIS"], slot("2026-10-10", "8:00 AM", "10:00 AM")],
      [["BUSI", "CSCE"], slot("2026-10-10", "10:30 AM", "12:30 PM")],
      [["COUN", "LTEC"], slot("2026-10-10", "1:00 PM", "3:00 PM")],
      [["EDLE"], slot("2026-10-10", "3:30 PM", "5:30 PM")],
      [["SPAN", "PHIL"], slot("2026-10-10", "6:00 PM", "8:00 PM")],
    ]);
    expect(schedule.byCourse.map((row) => [row.courseCode, row.exam])).toEqual([
      ["ACCT 2010", slot("2026-12-09", "3:30 PM", "5:30 PM")],
      ["ACCT 2020", slot("2026-12-07", "3:30 PM", "5:30 PM")],
    ]);
  });

  test("no two windows of one table cover the same start", () => {
    for (const day of EXAM_DAYS) {
      for (const campus of ["main", "discovery-park"] as const) {
        for (const session of ["full", "8w2"] as const) {
          const windows = schedule.grid
            .filter((row) => row.campus === campus && row.session === session && row.firstDays.includes(day) && row.starts.kind === "between")
            .map((row) => row.starts as { from: number; to: number })
            .sort((a, b) => a.from - b.from);
          for (let i = 1; i < windows.length; i += 1) expect(windows[i].from).toBeGreaterThan(windows[i - 1].to);
        }
      }
    }
  });

  test("refuses a page that isn't a final-exam schedule", () => {
    expect(() => parseUntExamPage("<html><h3>Registrar</h3></html>", fixtureMeta())).toThrow("no \"<term> Final Exam Schedule\" heading");
  });

  test("reports a weekday that contradicts its date", () => {
    const page = `<h3>Fall 2026 Final Exam Schedule</h3><div class="js-accordion__header">Classes Meeting on the Main Denton Campus</div>
      <table><caption>First Class Meeting on Monday</caption><tr><td>8:00 a.m. and 8:59 a.m.</td><td>Sunday, Dec. 5 from 8 – 10 a.m.</td></tr>
      <tr><td>9:00 a.m. and 9:59 a.m.</td><td>Monday, Dec. 7 from 8 – 10 a.m.</td></tr></table>`;
    const result = parseUntExamPage(page, fixtureMeta());
    expect(result.invalid.map((row) => row.reason)).toEqual(["Sunday doesn't match 2026-12-05, a Sat"]);
    expect(result.schedule.grid).toHaveLength(1);
  });
});

describe("examFor against the Fall 2026 rule", () => {
  const exam = (subject: ExamClass) => {
    const answer = examFor(subject, schedule);
    return answer.kind === "known" ? answer.exam : answer.reason;
  };

  test("first meeting day and start time pick the row", () => {
    expect(exam(full(timed(["Mon", "Wed", "Fri"], "9:00 AM")))).toEqual(slot("2026-12-07", "8:00 AM", "10:00 AM"));
    expect(exam(full(timed(["Tue", "Thu"], "9:30 AM")))).toEqual(slot("2026-12-10", "8:00 AM", "10:00 AM"));
    expect(exam(full(timed(["Wed", "Fri"], "10:00 AM")))).toEqual(slot("2026-12-09", "8:00 AM", "10:00 AM"));
    expect(exam(full(timed(["Thu"], "6:30 PM")))).toEqual(slot("2026-12-05", "6:30 PM", "8:30 PM"));
  });

  test("the earliest start of the week counts, not the first day's", () => {
    expect(exam(full([...timed(["Mon", "Wed"], "11:00 AM"), ...timed(["Fri"], "9:00 AM")]))).toEqual(slot("2026-12-07", "8:00 AM", "10:00 AM"));
  });

  test("a 'Starts at' row beats the range that also covers it", () => {
    // Wednesday 2:00 to 2:59 is Saturday 1 to 3; a 2:25 start is listed apart, Wednesday 1 to 3.
    expect(exam(full(timed(["Wed"], "2:00 PM")))).toEqual(slot("2026-12-05", "1:00 PM", "3:00 PM"));
    expect(exam(full(timed(["Wed"], "2:25 PM")))).toEqual(slot("2026-12-09", "1:00 PM", "3:00 PM"));
    expect(exam(full(timed(["Thu"], "2:25 PM")))).toEqual(slot("2026-12-07", "3:30 PM", "5:30 PM"));
  });

  test("Discovery Park has its own windows, and their gap stays unknown", () => {
    expect(exam(full(timed(["Mon", "Wed"], "9:30 AM"), "discovery-park"))).toEqual(slot("2026-12-09", "8:00 AM", "10:00 AM"));
    expect(exam(full(timed(["Mon", "Wed"], "9:30 AM"), "main"))).toEqual(slot("2026-12-07", "8:00 AM", "10:00 AM"));
    // UNT printed 9:30 to 10:20, then 10:30: a 10:25 start has no row.
    expect(exam(full(timed(["Mon"], "10:25 AM"), "discovery-park"))).toBe("no-rule");
  });

  test("the dropped weekend row leaves its starts unknown", () => {
    expect(exam(full(timed(["Sat"], "9:00 AM")))).toEqual(slot("2026-12-05", "8:00 AM", "10:00 AM"));
    expect(exam(full(timed(["Sat"], "12:00 PM")))).toBe("no-rule");
    expect(exam(full(timed(["Mon"], "7:30 AM")))).toBe("no-rule");
  });

  test("second eight-week classes use their own table", () => {
    expect(exam({ ...full(timed(["Tue", "Thu"], "2:00 PM")), session: "8w2" })).toEqual(slot("2026-12-07", "3:30 PM", "5:30 PM"));
    expect(exam({ ...full(timed(["Sat"], "9:00 AM")), session: "8w2" })).toBe("no-rule");
  });

  test("first eight-week classes go by subject", () => {
    expect(exam({ ...full(timed(["Mon", "Wed"], "1:00 PM"), "main", "CSCE 1030"), session: "8w1" })).toEqual(slot("2026-10-10", "10:30 AM", "12:30 PM"));
    expect(exam({ ...full(timed(["Mon", "Wed"], "1:00 PM"), "main", "MATH 1710"), session: "8w1" })).toBe("no-rule");
  });

  test("a departmental final overrides the grid, online sections included", () => {
    expect(exam(full(timed(["Mon", "Wed"], "9:00 AM"), "main", "ACCT 2010"))).toEqual(slot("2026-12-09", "3:30 PM", "5:30 PM"));
    expect(exam(full([], "main", "ACCT 2020"))).toEqual(slot("2026-12-07", "3:30 PM", "5:30 PM"));
    expect(exam(full(timed(["Mon"], "9:00 AM"), "other", "ACCT 2010"))).toBe("other-site");
  });

  test("says why a class has no known final", () => {
    expect(exam(full([]))).toBe("no-set-time");
    expect(exam(full(timed(["Mon"], "9:00 AM"), "other"))).toBe("other-site");
    expect(exam({ ...full(timed(["Mon"], "9:00 AM")), session: "other" })).toBe("session");
  });

  test("moves a Fall 2026 slot into Spring 2027's finals week by weekday", () => {
    // Both finals weeks start on a Saturday: 2026-12-05 and 2027-05-01.
    expect(moveToWeek(slot("2026-12-07", "8:00 AM", "10:00 AM"), "2026-12-05", "2027-05-01")).toEqual(slot("2027-05-03", "8:00 AM", "10:00 AM"));
    expect(() => moveToWeek(slot("2026-10-10", "8:00 AM", "10:00 AM"), "2026-12-05", "2027-05-01")).toThrow("outside the finals week");
    expect(() => moveToWeek(slot("2026-12-07", "8:00 AM", "10:00 AM"), "2026-12-05", "2027-05-03")).toThrow("different weekdays");
  });
});

test(`${MODULE} matches the parse of the saved page`, () => {
  // On failure, run `bun packages/ingest/tests/build-exam-module.ts --write` from the repo root.
  expect(currentModule()).toBe(expectedModule());
});
