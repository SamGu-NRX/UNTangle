import { expect, test } from "bun:test";
import { calendarDateToUtcMs, parseRangeInstant } from "@/lib/calendar-feeds/datetime";

test("calendar dates in years 0 through 99 keep their literal year", () => {
  expect(new Date(calendarDateToUtcMs({ year: 1, month: 1, day: 1 })).toISOString()).toBe("0001-01-01T00:00:00.000Z");
  expect(new Date(calendarDateToUtcMs({ year: 99, month: 12, day: 31 })).toISOString()).toBe("0099-12-31T00:00:00.000Z");
});

test("parseRangeInstant reads offsets exactly and floating values as America/Chicago", () => {
  const iso = (value: string) => {
    const ms = parseRangeInstant(value);
    return ms === null ? null : new Date(ms).toISOString();
  };
  expect(iso("2026-10-14T09:00:00Z")).toBe("2026-10-14T09:00:00.000Z");
  expect(iso("2026-10-14T09:00:00.25z")).toBe("2026-10-14T09:00:00.250Z");
  expect(iso("2026-10-14T09:00:00+02:00")).toBe("2026-10-14T07:00:00.000Z");
  expect(iso("2026-10-14T09:00-05:30")).toBe("2026-10-14T14:30:00.000Z");
  expect(iso("2026-10-14T09:00:00")).toBe("2026-10-14T14:00:00.000Z"); // CDT
  expect(iso("2026-01-14T09:00:00")).toBe("2026-01-14T15:00:00.000Z"); // CST
  expect(iso("2026-11-01T01:30:00")).toBe("2026-11-01T06:30:00.000Z"); // ambiguous: the earlier offset
  for (const bad of ["Oct 14 2026", "2026-10-14", "2026-10-14 09:00:00Z", "2026-02-30T00:00:00Z", "2026-10-14T24:00:00Z", "2026-10-14T09:00:60Z", "2026-10-14T09:00:00+24:00", ""]) {
    expect(iso(bad)).toBeNull();
  }
});
