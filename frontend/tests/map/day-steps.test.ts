import { describe, expect, test } from "bun:test";
import { campusNow, firstWeekAhead, meetsOn, nextClassDay, nextClassFrom, sessionOf, shortDate, shownDate, stepperDays } from "@/components/map/day-steps";
import type { ClassDay, MapStop } from "@/lib/types";

const none: Record<ClassDay, number> = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
const mwf = { ...none, Mon: 3, Wed: 3, Fri: 2 };

describe("stepperDays", () => {
  test("the weekdays, Monday first", () => {
    expect(stepperDays(mwf, "Tue")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });
  test("a weekend day joins when the plan meets on it", () => {
    expect(stepperDays({ ...mwf, Sat: 1 }, "Mon")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });
  test("today joins on a weekend with no classes, so Today is reachable", () => {
    expect(stepperDays(mwf, "Sun")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sun"]);
  });
});

describe("nextClassDay", () => {
  test("the next day with classes, and how far ahead", () => {
    expect(nextClassDay(mwf, "Mon")).toEqual({ day: "Wed", ahead: 2 });
    expect(nextClassDay(mwf, "Tue")).toEqual({ day: "Wed", ahead: 1 });
  });
  test("goes round the weekend to Monday", () => {
    expect(nextClassDay(mwf, "Fri")).toEqual({ day: "Mon", ahead: 3 });
  });
  test("a week with one class day comes back to it a week later", () => {
    expect(nextClassDay({ ...none, Thu: 1 }, "Thu")).toEqual({ day: "Thu", ahead: 7 });
  });
  test("null with no classes at all", () => {
    expect(nextClassDay(none, "Mon")).toBeNull();
  });
});

describe("campusNow", () => {
  test("reads the date, weekday and minute in campus time, whatever the device's zone", () => {
    // 04:30 UTC on Tuesday is 23:30 Monday in Denton (CDT, UTC-5).
    expect(campusNow(new Date(Date.UTC(2026, 9, 13, 4, 30)))).toEqual({ iso: "2026-10-12", day: "Mon", minute: 23 * 60 + 30 });
    // In January Denton is on CST, UTC-6.
    expect(campusNow(new Date(Date.UTC(2027, 0, 19, 14, 37)))).toEqual({ iso: "2027-01-19", day: "Tue", minute: 8 * 60 + 37 });
  });
});

const meeting = (courseCode: string, day: ClassDay, dates: MapStop["dates"]): MapStop => ({
  courseCode,
  title: courseCode,
  location: "GAB 105",
  buildingName: "General Academic Building",
  shortName: "GAB",
  resolutionStatus: "local",
  geocodeQuery: "",
  day,
  start: "09:00",
  end: "09:50",
  dates,
});

describe("sessionOf", () => {
  test("matches a meeting's dates to its calendar session", () => {
    expect(sessionOf({ start: "2027-01-11", end: "2027-05-07" })).toBe("2027-spring-full");
    expect(sessionOf({ start: "2027-03-15", end: "2027-05-07" })).toBe("2027-spring-8w2");
    expect(sessionOf({ start: "2027-01-19", end: "2027-03-12" })).toBeUndefined();
    expect(sessionOf(null)).toBeUndefined();
  });
});

describe("meetsOn", () => {
  const springFull = meeting("F 1", "Fri", { start: "2027-01-11", end: "2027-05-07" });
  const secondHalf = meeting("S 2", "Fri", { start: "2027-03-15", end: "2027-05-07" });
  test("not on its session's reading day, though another session still meets", () => {
    expect(meetsOn(springFull, "2027-04-30")).toBe(false);
    expect(meetsOn(secondHalf, "2027-04-30")).toBe(true);
  });
  test("not during finals", () => {
    expect(meetsOn(springFull, "2027-05-07")).toBe(false);
    expect(meetsOn(secondHalf, "2027-05-07")).toBe(false);
  });
  const firstHalf = meeting("A 1", "Mon", { start: "2027-01-11", end: "2027-03-05" });
  test("from its first class day to its last", () => {
    expect(meetsOn(firstHalf, "2027-01-11")).toBe(true);
    expect(meetsOn(firstHalf, "2027-03-04")).toBe(true);
  });
  test("not outside its dates", () => {
    expect(meetsOn(firstHalf, "2027-01-08")).toBe(false);
    expect(meetsOn(firstHalf, "2027-03-15")).toBe(false);
  });
  test("unknown dates meet on every class day, but not on a holiday", () => {
    expect(meetsOn(meeting("S 1", "Mon", null), "2026-10-12")).toBe(true);
    expect(meetsOn(meeting("S 1", "Thu", null), "2026-11-26")).toBe(false);
  });
});

describe("nextClassFrom", () => {
  const empty: Record<ClassDay, MapStop[]> = { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] };
  test("tomorrow's first class that meets on tomorrow's date", () => {
    const week = { ...empty, Wed: [meeting("OLD 1", "Wed", { start: "2026-08-24", end: "2026-10-09" }), meeting("NEW 1", "Wed", null)] };
    expect(nextClassFrom(week, "2026-10-13")).toEqual({ day: "Wed", ahead: 1, stop: week.Wed[1] });
  });
  test("a term that hasn't started has no next class this week", () => {
    const spring = { ...empty, Mon: [meeting("A 1", "Mon", { start: "2027-01-19", end: "2027-05-07" })] };
    expect(nextClassFrom(spring, "2026-10-13")).toBeNull();
  });
  test("skips a holiday: Thanksgiving's Thursday class isn't next", () => {
    const thursdays = { ...empty, Thu: [meeting("T 1", "Thu", null)] };
    expect(nextClassFrom(thursdays, "2026-11-18")).toMatchObject({ day: "Thu", ahead: 1 });
    expect(nextClassFrom(thursdays, "2026-11-25")).toBeNull();
  });
  test("looks a full week ahead, to the same weekday", () => {
    const tuesdays = { ...empty, Tue: [meeting("T 1", "Tue", null)] };
    expect(nextClassFrom(tuesdays, "2026-10-13")).toMatchObject({ day: "Tue", ahead: 7 });
  });
});

describe("firstWeekAhead", () => {
  const empty: Record<ClassDay, MapStop[]> = { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] };
  const spring = { start: "2027-01-11", end: "2027-05-07" };
  test("planning Spring in October: the first date the plan holds class", () => {
    const plan = { ...empty, Tue: [meeting("ENGL 1310", "Tue", spring)], Thu: [meeting("ENGL 1310", "Thu", spring)] };
    // Spring 2027 begins Monday 11 January; this plan's first class is that Tuesday.
    expect(firstWeekAhead(plan, "2026-10-16")).toEqual({ iso: "2027-01-12", day: "Tue" });
  });
  test("skips a holiday in the first weeks: MLK Day isn't a first class", () => {
    const mondays = { ...empty, Mon: [meeting("MATH 1710", "Mon", { start: "2027-01-12", end: "2027-05-07" })] };
    // The first Monday on or after 12 January is the 18th, Martin Luther King Jr. Day.
    expect(firstWeekAhead(mondays, "2026-10-16")).toEqual({ iso: "2027-01-25", day: "Mon" });
  });
  test("null once any dated meeting has started", () => {
    const plan = { ...empty, Mon: [meeting("A 1", "Mon", spring)], Wed: [meeting("B 1", "Wed", { start: "2026-08-24", end: "2026-12-11" })] };
    expect(firstWeekAhead(plan, "2026-10-16")).toBeNull();
    expect(firstWeekAhead({ ...empty, Mon: [meeting("A 1", "Mon", spring)] }, "2027-01-11")).toBeNull();
  });
  test("null without dated meetings, as with samples", () => {
    expect(firstWeekAhead({ ...empty, Mon: [meeting("S 1", "Mon", null)] }, "2026-10-16")).toBeNull();
    expect(firstWeekAhead(empty, "2026-10-16")).toBeNull();
  });
});

describe("shortDate", () => {
  test("a calendar date, whatever the device's zone", () => {
    expect(shortDate("2027-01-11")).toBe("Jan 11");
  });
});

describe("shownDate", () => {
  // Spring 2027's first class in this plan is Tuesday 12 January (firstWeekAhead).
  const ahead = { iso: "2027-01-12", day: "Tue" as const };
  test("before the term, each day is dated in the first class week, Monday included", () => {
    // Not the 18th: that is the next week, and Martin Luther King Jr. Day.
    expect(shownDate("Mon", { todayIso: null, ahead })).toBe("2027-01-11");
    expect(shownDate("Tue", { todayIso: null, ahead })).toBe("2027-01-12");
    expect(shownDate("Fri", { todayIso: null, ahead })).toBe("2027-01-15");
    expect(shownDate("Sun", { todayIso: null, ahead })).toBe("2027-01-17");
  });
  test("today is today's date; with no week ahead another day is undated", () => {
    expect(shownDate("Fri", { todayIso: "2026-10-16", ahead: null })).toBe("2026-10-16");
    expect(shownDate("Mon", { todayIso: null, ahead: null })).toBeNull();
  });
});
