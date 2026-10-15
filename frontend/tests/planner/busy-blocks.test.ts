/**
 * Calendar busy time reaches the optimizer as dated blocked times: the
 * pieces from a feed convert to generic, title-free blocks, saved
 * preferences accept the optional date ranges on manual blocks, and
 * buildOptimizeRequest merges the feed's pieces behind the student's own.
 */
import { describe, expect, test } from "bun:test";

import type { FeedOccurrence } from "@untangle/core/occurrences";
import {
  buildOptimizeRequest,
  busyOccurrencesToBlockedTime,
  defaultSchedulePreferences,
  getInitialPlannerState,
  normalizePlannerState,
  parseSchedulePreferences,
} from "@/lib/planner";

/** A busy piece as the busy API returns it (local minutes, one dated piece). */
const piece = (date: string, startMinutes: number, endMinutes: number): FeedOccurrence =>
  ({
    eventId: 0,
    date,
    startMinutes,
    endMinutes,
    start: `${date}T00:00:00.000Z`,
    end: `${date}T00:00:00.000Z`,
    allDay: false,
    busy: true,
  }) as FeedOccurrence;

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

  test("without busy occurrences the request is exactly as before", () => {
    const state = normalizePlannerState({ ...getInitialPlannerState(), courseStatuses: { "SPAN 2040": "inProgress" } });
    const preferences = defaultSchedulePreferences("compact");
    const withOption = buildOptimizeRequest(state, preferences, { courseCodes: ["SPAN 2040"], busyOccurrences: [] });
    const withoutOption = buildOptimizeRequest(state, preferences, { courseCodes: ["SPAN 2040"] });
    expect(withOption.constraints.blocked).toEqual(withoutOption.constraints.blocked);
  });
});
