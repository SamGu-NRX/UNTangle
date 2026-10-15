import { expect, test } from "bun:test";
import { parseCalendarFeed } from "@/lib/calendar-feeds/parse";
import { blocksWithEvents, withEvents } from "./joined";

const OCTOBER = { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" };
const event = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const calendar = (...events: string[]) => ["BEGIN:VCALENDAR", ...events, "END:VCALENDAR"].join("\r\n");

/** Mondays Oct 5, 12, 19, 26 at 18:00-19:00 Chicago (23:00Z, CDT). */
const MASTER = event(
  "UID:club@t",
  "SUMMARY:Club",
  "DTSTART;TZID=America/Chicago:20261005T180000",
  "DTEND;TZID=America/Chicago:20261005T190000",
  "RRULE:FREQ=WEEKLY;COUNT=4",
);

const summariesAndStarts = (result: ReturnType<typeof parseCalendarFeed>) =>
  withEvents(result).map((o) => `${o.summary} ${o.start}`);

test("a canceled override removes its occurrence and a modified one replaces it with its own time and summary", () => {
  const result = parseCalendarFeed(
    calendar(
      MASTER,
      event(
        "UID:club@t",
        "RECURRENCE-ID;TZID=America/Chicago:20261012T180000",
        "STATUS:CANCELLED",
        "DTSTART;TZID=America/Chicago:20261012T180000",
      ),
      event(
        "UID:club@t",
        "RECURRENCE-ID;TZID=America/Chicago:20261019T180000",
        "SUMMARY:Club (moved to Tuesday)",
        "STATUS:TENTATIVE",
        "DTSTART;TZID=America/Chicago:20261020T170000",
        "DTEND;TZID=America/Chicago:20261020T180000",
      ),
    ),
    OCTOBER,
  );
  expect(result.skipped).toEqual([]);
  expect(summariesAndStarts(result)).toEqual([
    "Club 2026-10-05T23:00:00.000Z",
    "Club (moved to Tuesday) 2026-10-20T22:00:00.000Z",
    "Club 2026-10-26T23:00:00.000Z",
  ]);
  expect(result.occurrences.map((o) => o.status)).toEqual(["confirmed", "tentative", "confirmed"]);
  expect(result.events.map((e) => e.summary)).toEqual(["Club", "Club (moved to Tuesday)"]);
  // The series still meets weekly on Mondays; one moved instance does not change its block.
  expect(blocksWithEvents(result)).toEqual([
    { uid: "club@t", summary: "Club", weekday: 1, startMinutes: 1080, endMinutes: 1140 },
  ]);
});

test("a RECURRENCE-ID written in UTC matches the zoned instance it names", () => {
  const result = parseCalendarFeed(
    calendar(MASTER, event("UID:club@t", "RECURRENCE-ID:20261012T230000Z", "STATUS:CANCELLED")),
    OCTOBER,
  );
  expect(result.occurrences.map((o) => o.start)).toEqual([
    "2026-10-05T23:00:00.000Z",
    "2026-10-19T23:00:00.000Z",
    "2026-10-26T23:00:00.000Z",
  ]);
});

test("an override moved into the range appears, and one moved out of the range takes its instance with it", () => {
  const result = parseCalendarFeed(
    calendar(
      MASTER,
      // Oct 19 moves to Nov 2, outside the range.
      event(
        "UID:club@t",
        "RECURRENCE-ID;TZID=America/Chicago:20261019T180000",
        "DTSTART;TZID=America/Chicago:20261102T180000",
        "DTEND;TZID=America/Chicago:20261102T190000",
      ),
      // Oct 26, outside the range, moves to Oct 22 with no SUMMARY or DTEND of its own.
      event("UID:club@t", "RECURRENCE-ID;TZID=America/Chicago:20261026T180000", "DTSTART;TZID=America/Chicago:20261022T120000"),
    ),
    { start: "2026-10-15T00:00:00Z", end: "2026-10-25T00:00:00Z" },
  );
  expect(result.skipped).toEqual([]);
  // The summary and the one-hour length come from the series.
  expect(withEvents(result).map((o) => [o.summary, o.start, o.end])).toEqual([
    ["Club", "2026-10-22T17:00:00.000Z", "2026-10-22T18:00:00.000Z"],
  ]);
});

test("a canceled all-day instance named by a DATE RECURRENCE-ID is removed", () => {
  const result = parseCalendarFeed(
    calendar(
      event("UID:fair@t", "SUMMARY:Fair", "DTSTART;VALUE=DATE:20261003", "RRULE:FREQ=WEEKLY;COUNT=3"),
      event("UID:fair@t", "RECURRENCE-ID;VALUE=DATE:20261010", "STATUS:CANCELLED"),
    ),
    OCTOBER,
  );
  expect(result.occurrences.map((o) => o.start)).toEqual(["2026-10-03T00:00:00.000Z", "2026-10-17T00:00:00.000Z"]);
});

test("RANGE=THISANDFUTURE skips the whole series with a warning naming it", () => {
  const result = parseCalendarFeed(
    calendar(
      MASTER,
      event(
        "UID:club@t",
        "RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=America/Chicago:20261019T180000",
        "DTSTART;TZID=America/Chicago:20261019T190000",
        "DTEND;TZID=America/Chicago:20261019T200000",
      ),
      event("UID:other@t", "SUMMARY:Other", "DTSTART:20261014T150000Z"),
    ),
    OCTOBER,
  );
  expect(summariesAndStarts(result)).toEqual(["Other 2026-10-14T15:00:00.000Z"]);
  expect(result.weeklyBusyBlocks).toEqual([]);
  expect(result.skipped).toEqual([
    { uid: "club@t", summary: "Club", reason: "RECURRENCE-ID with RANGE=THISANDFUTURE is not supported" },
  ]);
});

test("overrides with no matching series are skipped with a warning, canceled or not", () => {
  const result = parseCalendarFeed(
    calendar(
      event(
        "UID:orphan@t",
        "SUMMARY:Lone instance",
        "RECURRENCE-ID:20261012T230000Z",
        "DTSTART:20261013T230000Z",
      ),
      event("UID:orphan@t", "SUMMARY:Lone instance", "RECURRENCE-ID:20261019T230000Z", "STATUS:CANCELLED"),
      event("SUMMARY:No uid", "RECURRENCE-ID:20261019T230000Z", "DTSTART:20261019T230000Z"),
    ),
    OCTOBER,
  );
  expect(result.occurrences).toEqual([]);
  expect(result.skipped).toEqual([
    { uid: "orphan@t", summary: "Lone instance", reason: "RECURRENCE-ID override has no matching recurring event" },
    { uid: null, summary: "No uid", reason: "RECURRENCE-ID override has no matching recurring event" },
  ]);
});

test("overrides on a UID shared by two events skip both, since the series is ambiguous", () => {
  const result = parseCalendarFeed(
    calendar(MASTER, MASTER, event("UID:club@t", "RECURRENCE-ID:20261012T230000Z", "STATUS:CANCELLED")),
    OCTOBER,
  );
  expect(result.occurrences).toEqual([]);
  expect(result.skipped).toEqual([
    { uid: "club@t", summary: "Club", reason: "several events share this UID and it has RECURRENCE-ID overrides" },
  ]);
});
