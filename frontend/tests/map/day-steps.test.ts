import { describe, expect, test } from "bun:test";
import { classDayOf, isoDateOf, meetsOn, minuteOf, nextClassDay, nextClassFrom, stepperDays } from "@/components/map/day-steps";
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

describe("clock", () => {
  test("local day, minute and date", () => {
    const tuesday = new Date(2026, 9, 13, 8, 37);
    expect(classDayOf(tuesday)).toBe("Tue");
    expect(classDayOf(new Date(2026, 9, 18, 12))).toBe("Sun");
    expect(minuteOf(tuesday)).toBe(8 * 60 + 37);
    expect(isoDateOf(new Date(2027, 0, 5, 23, 59))).toBe("2027-01-05");
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

describe("meetsOn", () => {
  const firstHalf = meeting("A 1", "Mon", { start: "2027-01-19", end: "2027-03-12" });
  test("inside the session's dates, ends included", () => {
    expect(meetsOn(firstHalf, "2027-01-19")).toBe(true);
    expect(meetsOn(firstHalf, "2027-03-12")).toBe(true);
  });
  test("outside them", () => {
    expect(meetsOn(firstHalf, "2027-01-18")).toBe(false);
    expect(meetsOn(firstHalf, "2027-03-15")).toBe(false);
  });
  test("unknown dates meet every week", () => {
    expect(meetsOn(meeting("S 1", "Mon", null), "2026-10-12")).toBe(true);
  });
});

describe("nextClassFrom", () => {
  const empty: Record<ClassDay, MapStop[]> = { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] };
  test("tomorrow's first class that meets on tomorrow's date", () => {
    const week = { ...empty, Wed: [meeting("OLD 1", "Wed", { start: "2026-08-24", end: "2026-10-09" }), meeting("NEW 1", "Wed", null)] };
    expect(nextClassFrom(week, new Date(2026, 9, 13, 18))).toEqual({ day: "Wed", ahead: 1, stop: week.Wed[1] });
  });
  test("a term that hasn't started has no next class this week", () => {
    const spring = { ...empty, Mon: [meeting("A 1", "Mon", { start: "2027-01-19", end: "2027-05-07" })] };
    expect(nextClassFrom(spring, new Date(2026, 9, 13))).toBeNull();
  });
  test("looks a full week ahead, to the same weekday", () => {
    const tuesdays = { ...empty, Tue: [meeting("T 1", "Tue", null)] };
    expect(nextClassFrom(tuesdays, new Date(2026, 9, 13))).toMatchObject({ day: "Tue", ahead: 7 });
  });
});
