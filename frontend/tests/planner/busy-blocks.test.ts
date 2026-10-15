/**
 * Calendar busy time reaches the optimizer as dated blocked times: the
 * pieces from a feed convert to generic, title-free blocks, saved
 * preferences accept the optional date ranges on manual blocks, and
 * buildOptimizeRequest merges the feed's pieces behind the student's own.
 */
import { describe, expect, test } from "bun:test";

import {
  serializeBusy,
  type SerializedBusyOccurrence,
} from "@/lib/calendar-feeds/busy-serialize";
import {
  buildOptimizeRequest,
  busyOccurrencesToBlockedTime,
  defaultSchedulePreferences,
  getInitialPlannerState,
  normalizePlannerState,
  parseSchedulePreferences,
} from "@/lib/planner";

/** A busy piece exactly as the busy route's JSON response carries it. */
const piece = (date: string, startMinutes: number, endMinutes: number): SerializedBusyOccurrence => ({
  date,
  startMinutes,
  endMinutes,
});

describe("busyOccurrencesToBlockedTime", () => {
  test("pieces become dated blocks with no event text", () => {
    const blocks = busyOccurrencesToBlockedTime([piece("2027-01-11", 540, 600)]);
    expect(blocks).toEqual([
      { id: "cal-0", label: "Calendar busy", day: "Mon", start: 540, end: 600, dates: [{ start: "2027-01-11", end: "2027-01-11" }] },
    ]);
    expect(JSON.stringify(blocks)).not.toContain("Secret");
  });

  test("same weekday and slot group into one block; other slots and days stand alone", () => {
    const blocks = busyOccurrencesToBlockedTime([
      piece("2027-01-11", 540, 600), // Mon
      piece("2027-01-25", 540, 600), // Mon, two weeks later: same block, second date
      piece("2027-01-13", 540, 600), // Wed, same slot: its own block
      piece("2027-01-11", 600, 660), // Mon, later slot: its own block
    ]);
    expect(blocks.map((block) => [block.day, block.start, block.end, block.dates?.length])).toEqual([
      ["Mon", 540, 600, 2],
      ["Wed", 540, 600, 1],
      ["Mon", 600, 660, 1],
    ]);
  });

  test("a malformed piece date is dropped rather than throwing", () => {
    expect(busyOccurrencesToBlockedTime([piece("not a date", 540, 600)])).toEqual([]);
  });

  test("with a term, pieces dated before its start and after its end drop and one inside stays", () => {
    const term = { start: "2027-01-11", end: "2027-05-07" }; // spring 2027, the planner's term
    const blocks = busyOccurrencesToBlockedTime(
      [
        piece("2026-11-17", 540, 600), // Tue, before the term
        piece("2027-02-09", 540, 600), // Tue, inside the term
        piece("2027-06-15", 540, 600), // Tue, after the term
      ],
      term,
    );
    // All three share the Tuesday slot; only the inside date may survive.
    expect(blocks).toEqual([
      { id: "cal-0", label: "Calendar busy", day: "Tue", start: 540, end: 600, dates: [{ start: "2027-02-09", end: "2027-02-09" }] },
    ]);
  });
});

describe("saved preferences accept dated blocks", () => {
  const withBlocked = (blocked: unknown) => {
    const preferences = structuredClone(defaultSchedulePreferences("compact"));
    return parseSchedulePreferences({ ...preferences, constraints: { ...preferences.constraints, blocked } });
  };

  test("a block with real date ranges parses", () => {
    const parsed = withBlocked([{ id: "b1", label: "trip", day: "Fri", start: 540, end: 600, dates: [{ start: "2027-02-12", end: "2027-02-13" }] }]);
    expect(parsed?.constraints.blocked).toEqual([
      { id: "b1", label: "trip", day: "Fri", start: 540, end: 600, dates: [{ start: "2027-02-12", end: "2027-02-13" }] },
    ]);
  });

  test.each([
    ["an impossible date", [{ id: "b1", label: "x", day: "Fri", start: 540, end: 600, dates: [{ start: "2027-02-30", end: "2027-02-28" }] }]],
    ["a reversed range", [{ id: "b1", label: "x", day: "Fri", start: 540, end: 600, dates: [{ start: "2027-02-20", end: "2027-02-10" }] }]],
    ["a non-date string", [{ id: "b1", label: "x", day: "Fri", start: 540, end: 600, dates: ["2027-02-10"] }]],
    ["a number where the ranges go", [{ id: "b1", label: "x", day: "Fri", start: 540, end: 600, dates: 42 }]],
  ])("%s rejects the whole preference object", (_name, blocked) => {
    expect(withBlocked(blocked)).toBeNull();
  });
});

describe("buildOptimizeRequest carries busy time", () => {
  test("feed pieces are merged behind the student's own blocked times", () => {
    const state = normalizePlannerState({ ...getInitialPlannerState(), courseStatuses: { "SPAN 2040": "inProgress" } });
    const preferences = structuredClone(defaultSchedulePreferences("compact"));
    const own = { id: "job", label: "Work shift", day: "Tue" as const, start: 540, end: 720 };
    preferences.constraints.blocked = [own];
    const request = buildOptimizeRequest(state, preferences, {
      courseCodes: ["SPAN 2040"],
      busyOccurrences: [piece("2027-02-09", 480, 540)],
    });
    // The saved block first, then the generic dated ones.
    expect(request.constraints.blocked).toEqual([
      own,
      { id: "cal-0", label: "Calendar busy", day: "Tue", start: 480, end: 540, dates: [{ start: "2027-02-09", end: "2027-02-09" }] },
    ]);
  });

  test("pieces dated outside the planning term add no calendar block", () => {
    const state = normalizePlannerState({ ...getInitialPlannerState(), courseStatuses: { "SPAN 2040": "inProgress" } });
    const preferences = defaultSchedulePreferences("compact");
    const baseline = buildOptimizeRequest(state, preferences, { courseCodes: ["SPAN 2040"] });
    const request = buildOptimizeRequest(state, preferences, {
      courseCodes: ["SPAN 2040"],
      busyOccurrences: [piece("2026-11-17", 480, 540), piece("2027-06-15", 480, 540)], // fall 2026 and summer 2027
    });
    expect(request.constraints.blocked).toEqual(baseline.constraints.blocked);
    expect(request.constraints.blocked.filter((block) => block.id.startsWith("cal-"))).toEqual([]);
  });

  test("without busy occurrences the request is exactly as before", () => {
    const state = normalizePlannerState({ ...getInitialPlannerState(), courseStatuses: { "SPAN 2040": "inProgress" } });
    const preferences = defaultSchedulePreferences("compact");
    const withOption = buildOptimizeRequest(state, preferences, { courseCodes: ["SPAN 2040"], busyOccurrences: [] });
    const withoutOption = buildOptimizeRequest(state, preferences, { courseCodes: ["SPAN 2040"] });
    expect(withOption.constraints.blocked).toEqual(withoutOption.constraints.blocked);
  });
});
