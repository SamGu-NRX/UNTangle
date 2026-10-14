import { describe, expect, test } from "bun:test";
import { parseClock, parseDays, parseMeetingCell } from "../src/lib/parse-meeting";
import { parseIsoDateSpan, parsePageDateRange, rangesOverlap } from "../src/lib/parse-dates";

describe("parseClock", () => {
  test("maps clock text to minutes after midnight", () => {
    expect(parseClock("9:00 AM")).toBe(540);
    expect(parseClock("9:50 am")).toBe(590);
    expect(parseClock("12:00 PM")).toBe(720);
    expect(parseClock("12:00 AM")).toBe(0);
    expect(parseClock("1:50 PM")).toBe(830);
  });

  test("rejects malformed times", () => {
    expect(parseClock("9:00")).toBeNull();
    expect(parseClock("13:00 PM")).toBeNull();
    expect(parseClock("9:60 AM")).toBeNull();
    expect(parseClock("")).toBeNull();
  });
});

describe("parseDays", () => {
  test("expands PeopleSoft day letters", () => {
    expect(parseDays("MWF")).toEqual(["Mon", "Wed", "Fri"]);
    expect(parseDays("TR")).toEqual(["Tue", "Thu"]);
    expect(parseDays("S")).toEqual(["Sat"]);
    expect(parseDays("U")).toEqual(["Sun"]);
  });

  test("rejects unknown letters", () => {
    expect(parseDays("X")).toEqual([]);
    expect(parseDays("")).toEqual([]);
  });
});

describe("parseMeetingCell", () => {
  test("parses the fixture's MWF slot into three meetings", () => {
    const cell = parseMeetingCell("MWF 9:00 AM - 9:50 AM");
    expect(cell.kind).toBe("times");
    if (cell.kind === "times") {
      expect(cell.meetings).toEqual([
        { day: "Mon", startMinutes: 540, endMinutes: 590 },
        { day: "Wed", startMinutes: 540, endMinutes: 590 },
        { day: "Fri", startMinutes: 540, endMinutes: 590 },
      ]);
    }
  });

  test("parses a TR afternoon slot", () => {
    const cell = parseMeetingCell("TR 2:00 PM - 3:20 PM");
    expect(cell.kind).toBe("times");
    if (cell.kind === "times") {
      expect(cell.meetings.map(meeting => meeting.day)).toEqual(["Tue", "Thu"]);
      expect(cell.meetings[0]?.startMinutes).toBe(840);
      expect(cell.meetings[0]?.endMinutes).toBe(920);
    }
  });

  test("a slot ending at 12:00 AM ends at 1440 minutes", () => {
    const cell = parseMeetingCell("M 11:00 PM - 12:00 AM");
    expect(cell.kind).toBe("times");
    if (cell.kind === "times") expect(cell.meetings[0]?.endMinutes).toBe(1440);
  });

  test("TBA and async cells never produce times", () => {
    expect(parseMeetingCell("TBA")).toEqual({ kind: "tba" });
    expect(parseMeetingCell("Async (online)")).toEqual({ kind: "async" });
    expect(parseMeetingCell("ARR Preferred")).toEqual({ kind: "async" });
  });

  test("unreadable cells produce no times", () => {
    expect(parseMeetingCell("")).toEqual({ kind: "none" });
    expect(parseMeetingCell("Online")).toEqual({ kind: "none" });
    expect(parseMeetingCell("MWF 9:00 AM")).toEqual({ kind: "none" });
  });
});

describe("date spans", () => {
  test("page ranges and ISO spans agree on the same weeks", () => {
    const page = parsePageDateRange("01/19/2027 - 05/07/2027");
    const iso = parseIsoDateSpan("2027-01-19", "2027-05-07");
    expect(page.startMs).toBe(iso.startMs);
    expect(page.endMs).toBe(iso.endMs);
  });

  test("overlapping ranges overlap", () => {
    const a = parsePageDateRange("01/19/2027 - 05/07/2027");
    const b = parseIsoDateSpan("2027-01-19", "2027-05-07");
    expect(rangesOverlap(a, b)).toBe(true);
  });

  test("disjoint ranges do not overlap", () => {
    const a = parsePageDateRange("01/19/2027 - 05/07/2027");
    const b = parseIsoDateSpan("2027-08-23", "2027-12-10");
    expect(rangesOverlap(a, b)).toBe(false);
  });

  test("a missing side is undecidable, never false", () => {
    const a = parsePageDateRange("01/19/2027 - 05/07/2027");
    expect(rangesOverlap(a, { startMs: null, endMs: null })).toBeNull();
    expect(rangesOverlap(a, parseIsoDateSpan(null, null))).toBeNull();
  });
});
