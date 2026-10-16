import { describe, expect, test } from "bun:test";
import { examDayOf, examFor, examsOverlap, inWeek, moveToWeek, type ExamClass, type ExamSchedule } from "../src/final-exams";

/** A hand-built schedule: the parse of the real page is tested in packages/ingest. */
const schedule: ExamSchedule = {
  term: "Fall 2026",
  sourceUrl: "https://example.test/",
  capturedAt: "2026-10-16",
  grid: [
    { campus: "main", session: "full", firstDays: ["Mon"], starts: { kind: "between", from: 540, to: 599 }, exam: { date: "2026-12-07", start: 480, end: 600 }, text: "a" },
    { campus: "main", session: "full", firstDays: ["Mon"], starts: { kind: "at", minute: 565 }, exam: { date: "2026-12-09", start: 480, end: 600 }, text: "b" },
    { campus: "main", session: "full", firstDays: ["Sat", "Sun"], starts: { kind: "between", from: 480, to: 659 }, exam: { date: "2026-12-05", start: 480, end: 600 }, text: "c" },
  ],
  bySubject: [{ session: "8w1", subjects: ["CSCE"], exam: { date: "2026-10-10", start: 630, end: 750 }, text: "d" }],
  byCourse: [{ courseCode: "ACCT 2010", exam: { date: "2026-12-09", start: 930, end: 1050 }, text: "e" }],
};
const at = (day: ExamClass["meetings"][number]["day"], start: number) => ({ day, start });
const known = (subject: ExamClass) => {
  const answer = examFor(subject, schedule);
  return answer.kind === "known" ? answer.text : answer.reason;
};
const base: ExamClass = { courseCode: "MATH 1710", session: "full", campus: "main", meetings: [at("Mon", 540), at("Wed", 540)] };

describe("examFor", () => {
  test("a window covers its inclusive start minutes", () => {
    expect(known(base)).toBe("a");
    expect(known({ ...base, meetings: [at("Mon", 599)] })).toBe("a");
    expect(known({ ...base, meetings: [at("Mon", 600)] })).toBe("no-rule");
  });
  test("an exact start beats a window", () => expect(known({ ...base, meetings: [at("Mon", 565)] })).toBe("b"));
  test("the week starts on Monday: a Sunday-and-Monday class goes by Monday", () => {
    expect(known({ ...base, meetings: [at("Sun", 500)] })).toBe("c");
    expect(known({ ...base, meetings: [at("Sun", 545), at("Mon", 540)] })).toBe("a");
  });
  test("the course listing comes first, then site, set time and session", () => {
    expect(known({ ...base, courseCode: "ACCT 2010" })).toBe("e");
    expect(known({ ...base, courseCode: "ACCT 2010", session: "8w1" })).toBe("no-rule");
    expect(known({ ...base, campus: "other" })).toBe("other-site");
    expect(known({ ...base, meetings: [] })).toBe("no-set-time");
    expect(known({ ...base, session: "other" })).toBe("session");
    expect(known({ ...base, courseCode: "CSCE 1030", session: "8w1" })).toBe("d");
    expect(known({ ...base, campus: "discovery-park" })).toBe("no-rule");
  });
});

describe("dates", () => {
  test("touching finals don't overlap; a shared minute does", () => {
    expect(examsOverlap({ date: "2027-05-03", start: 480, end: 600 }, { date: "2027-05-03", start: 600, end: 720 })).toBe(false);
    expect(examsOverlap({ date: "2027-05-03", start: 480, end: 600 }, { date: "2027-05-03", start: 599, end: 720 })).toBe(true);
    expect(examsOverlap({ date: "2027-05-03", start: 480, end: 600 }, { date: "2027-05-04", start: 480, end: 600 })).toBe(false);
  });
  test("weekdays and finals weeks", () => {
    expect(examDayOf("2026-12-05")).toBe("Sat");
    expect(examDayOf("2027-05-03")).toBe("Mon");
    expect(() => examDayOf("2027-02-30")).toThrow("not a real YYYY-MM-DD date");
    expect(inWeek({ date: "2026-12-11", start: 0, end: 1 }, "2026-12-05")).toBe(true);
    expect(inWeek({ date: "2026-12-12", start: 0, end: 1 }, "2026-12-05")).toBe(false);
    expect(moveToWeek({ date: "2026-12-10", start: 480, end: 600 }, "2026-12-05", "2027-05-01")).toEqual({ date: "2027-05-06", start: 480, end: 600 });
  });
});
