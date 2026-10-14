import { expect, test } from "bun:test";
import { MAX_PARSE_OCCURRENCES, parseCalendarFeed } from "@/lib/calendar-feeds/parse";

const OCTOBER = { start: "2026-10-01T00:00:00Z", end: "2026-10-05T00:00:00Z" };
const event = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const calendar = (...events: string[]) => ["BEGIN:VCALENDAR", ...events, "END:VCALENDAR"].join("\r\n");

for (const rule of ["FREQ=WEEKLY;COUNT=1", "FREQ=DAILY;INTERVAL=7;COUNT=1"]) {
  test(`fast-forward does not revive exhausted ${rule}`, () => {
    const result = parseCalendarFeed(calendar(event(
      "UID:expired", "DTSTART:20260101T120000Z", `RRULE:${rule}`,
    )), OCTOBER);
    expect(result.skipped).toEqual([]);
    expect(result.occurrences).toEqual([]);
  });
}

test("a weekly timed span ending in 9999 spends the shared work budget", () => {
  const result = parseCalendarFeed(calendar(
    event("UID:long", "DTSTART;TZID=America/Chicago:20260101T120000",
      "DTEND;TZID=America/Chicago:99990101T120000", "RRULE:FREQ=WEEKLY;COUNT=1"),
    event("UID:after", "DTSTART:20261001T120000Z"),
  ), OCTOBER);
  expect(result.occurrences).toEqual([]);
  expect(result.weeklyBusyBlocks).toEqual([]);
  expect(result.skipped).toEqual([
    { uid: "long", reason: "recurrence expansion budget exceeded" },
    { uid: "after", reason: "recurrence expansion budget exceeded" },
  ]);
});

test("all-day weekly busy blocks cover every day before exclusive DTEND", () => {
  const result = parseCalendarFeed(calendar(event(
    "UID:three-days", "DTSTART;VALUE=DATE:20261012", "DTEND;VALUE=DATE:20261015",
    "RRULE:FREQ=WEEKLY;COUNT=1",
  )), { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" });
  expect(result.skipped).toEqual([]);
  expect(result.weeklyBusyBlocks).toEqual([1, 2, 3].map((weekday) => ({
    uid: "three-days", summary: "", weekday, startMinutes: 0, endMinutes: 1440,
  })));
});

test("all-day multi-week spans cover seven unique weekdays, including BYDAY anchors", () => {
  const result = parseCalendarFeed(calendar(event(
    "UID:long-days", "DTSTART;VALUE=DATE:20261012", "DTEND;VALUE=DATE:20261101",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=1",
  )), OCTOBER);
  expect(result.weeklyBusyBlocks.map((block) => block.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
});

test("the occurrence allowance is shared by two COUNT=15000 events", () => {
  const makeEvent = (uid: string) => event(`UID:${uid}`, "DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=DAILY;COUNT=15000");
  const result = parseCalendarFeed(calendar(makeEvent("first"), makeEvent("second")), {
    start: "2026-01-01T00:00:00Z", end: "2070-01-01T00:00:00Z",
  });
  expect(result.occurrences.length).toBeLessThanOrEqual(MAX_PARSE_OCCURRENCES);
  // An over-budget event is skipped as a whole, not silently truncated.
  expect(result.occurrences).toHaveLength(15000);
  expect(result.occurrences.every((occurrence) => occurrence.uid === "first")).toBe(true);
  expect(result.skipped).toEqual([{ uid: "second", reason: "occurrence budget exceeded" }]);
});

test("an event fitting the exact remaining allowance is retained", () => {
  const result = parseCalendarFeed(calendar(
    event("UID:first", "DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=DAILY;COUNT=15000"),
    event("UID:second", "DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=DAILY;COUNT=5000"),
  ), { start: "2026-01-01T00:00:00Z", end: "2070-01-01T00:00:00Z" });
  expect(result.occurrences).toHaveLength(MAX_PARSE_OCCURRENCES);
  expect(result.skipped).toEqual([]);
});
