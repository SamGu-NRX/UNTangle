import { expect, test } from "bun:test";
import { MAX_PARSE_OCCURRENCES, parseCalendarFeed } from "@/lib/calendar-feeds/parse";
import { blocksWithEvents, withEvents } from "./joined";

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

test("a weekly timed span ending in 2200 on every weekday spends the shared work budget", () => {
  // About 63,500 days per weekday anchor times seven anchors is well past the 100,000 budget.
  const result = parseCalendarFeed(calendar(
    event("UID:long", "DTSTART;TZID=America/Chicago:20260101T120000",
      "DTEND;TZID=America/Chicago:22000101T120000", "RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA;COUNT=1"),
    event("UID:after", "DTSTART:20261001T120000Z"),
  ), OCTOBER);
  expect(result.occurrences).toEqual([]);
  expect(result.weeklyBusyBlocks).toEqual([]);
  expect(result.skipped).toEqual([
    { uid: "long", summary: null, reason: "recurrence expansion budget exceeded" },
    { uid: "after", summary: null, reason: "recurrence expansion budget exceeded" },
  ]);
});

test("all-day weekly busy blocks cover every day before exclusive DTEND", () => {
  const result = parseCalendarFeed(calendar(event(
    "UID:three-days", "DTSTART;VALUE=DATE:20261012", "DTEND;VALUE=DATE:20261015",
    "RRULE:FREQ=WEEKLY;COUNT=1",
  )), { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" });
  expect(result.skipped).toEqual([]);
  expect(blocksWithEvents(result)).toEqual([1, 2, 3].map((weekday) => ({
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
  expect(withEvents(result).every((occurrence) => occurrence.uid === "first")).toBe(true);
  expect(result.skipped).toEqual([{ uid: "second", summary: null, reason: "occurrence budget exceeded" }]);
});

test("an event fitting the exact remaining allowance is retained", () => {
  const result = parseCalendarFeed(calendar(
    event("UID:first", "DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=DAILY;COUNT=15000"),
    event("UID:second", "DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=DAILY;COUNT=5000"),
  ), { start: "2026-01-01T00:00:00Z", end: "2070-01-01T00:00:00Z" });
  expect(result.occurrences).toHaveLength(MAX_PARSE_OCCURRENCES);
  expect(result.skipped).toEqual([]);
});

test("each event's text appears once, and occurrences point at it by id", () => {
  const description = "Agenda and links. ".repeat(50);
  const result = parseCalendarFeed(calendar(event(
    "UID:weekly", "SUMMARY:Weekly sync", "LOCATION:Union 333", `DESCRIPTION:${description}`,
    "DTSTART:20261001T150000Z", "DTEND:20261001T160000Z", "RRULE:FREQ=DAILY;COUNT=10",
  )), { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" });
  expect(result.events).toEqual([{
    id: 0, uid: "weekly", summary: "Weekly sync", location: "Union 333", description, isAllDay: false, transparent: false,
  }]);
  expect(result.occurrences).toHaveLength(10);
  for (const occurrence of result.occurrences) {
    expect(Object.keys(occurrence).sort()).toEqual(["end", "eventId", "start", "status"]);
    expect(occurrence.eventId).toBe(0);
  }
  expect(JSON.stringify(result).split(description).length - 1).toBe(1);
});

test("descriptions are capped at 2,000 characters, ending in an ellipsis and never splitting a surrogate pair", () => {
  const long = "a".repeat(5000);
  // 1,998 letters then an emoji: the cut at 1,999 code units lands inside the emoji's surrogate pair.
  const emojiAtCut = `${"b".repeat(1998)}\u{1F4C5}${"c".repeat(100)}`;
  const result = parseCalendarFeed(calendar(
    event("UID:long", "DTSTART:20261001T150000Z", `DESCRIPTION:${long}`),
    event("UID:emoji", "DTSTART:20261002T150000Z", `DESCRIPTION:${emojiAtCut}`),
    event("UID:exact", "DTSTART:20261003T150000Z", `DESCRIPTION:${"d".repeat(2000)}`),
  ), OCTOBER);
  const [longEvent, emojiEvent, exactEvent] = result.events;
  expect(longEvent?.description).toBe(`${"a".repeat(1999)}…`);
  expect(emojiEvent?.description).toBe(`${"b".repeat(1998)}…`);
  expect(exactEvent?.description).toBe("d".repeat(2000));
});

test("a TRANSP:TRANSPARENT weekly event still occurs but adds no busy block", () => {
  const result = parseCalendarFeed(calendar(event(
    "UID:reminder", "SUMMARY:Office hours reminder", "TRANSP:transparent",
    "DTSTART;TZID=America/Chicago:20261001T090000", "DTEND;TZID=America/Chicago:20261001T100000", "RRULE:FREQ=WEEKLY",
  )), OCTOBER);
  expect(result.occurrences.map((o) => o.start)).toEqual(["2026-10-01T14:00:00.000Z"]);
  expect(result.events[0]?.transparent).toBe(true);
  expect(result.weeklyBusyBlocks).toEqual([]);
});

test("weekly busy blocks come only from INTERVAL=1; wider intervals still list their dated occurrences", () => {
  const weekly = (uid: string, interval: string) => event(
    `UID:${uid}`, "DTSTART;TZID=America/Chicago:20261005T100000", "DTEND;TZID=America/Chicago:20261005T110000",
    `RRULE:FREQ=WEEKLY${interval}`,
  );
  const result = parseCalendarFeed(
    calendar(weekly("every", ";INTERVAL=1"), weekly("other", ";INTERVAL=2")),
    { start: "2026-10-01T00:00:00Z", end: "2026-10-27T00:00:00Z" },
  );
  expect(blocksWithEvents(result)).toEqual([{ uid: "every", summary: "", weekday: 1, startMinutes: 600, endMinutes: 660 }]);
  expect(withEvents(result).filter((o) => o.uid === "other").map((o) => o.start)).toEqual([
    "2026-10-05T15:00:00.000Z",
    "2026-10-19T15:00:00.000Z",
  ]);
});

test("RRULE part names and values are case-insensitive", () => {
  const result = parseCalendarFeed(calendar(
    event("UID:lower", "DTSTART:20261001T150000Z", "RRULE:freq=daily;count=2"),
    event("UID:mixed", "DTSTART:20261001T160000Z", "RRULE:Freq=Weekly;ByDay=th,Fr;Until=20261003t000000z"),
  ), OCTOBER);
  expect(result.skipped).toEqual([]);
  expect(withEvents(result).map((o) => `${o.uid} ${o.start}`)).toEqual([
    "lower 2026-10-01T15:00:00.000Z",
    "mixed 2026-10-01T16:00:00.000Z",
    "lower 2026-10-02T15:00:00.000Z",
    "mixed 2026-10-02T16:00:00.000Z",
  ]);
});

test("years are read literally and event dates outside 1900 to 2200 are skipped with a warning", () => {
  const allDay = (uid: string, date: string) => event(`UID:${uid}`, `DTSTART;VALUE=DATE:${date}`);
  const result = parseCalendarFeed(calendar(
    allDay("year-1", "00010101"), // Date.UTC would read this as 1901
    allDay("year-1899", "18991231"),
    allDay("year-1900", "19000101"),
    allDay("year-2200", "22001231"),
    allDay("year-2201", "22010101"),
    event("UID:end-2201", "DTSTART:20261001T150000Z", "DTEND:22010101T000000Z"),
  ), { start: "1899-01-01T00:00:00Z", end: "2202-01-01T00:00:00Z" });
  expect(withEvents(result).map((o) => `${o.uid} ${o.start}`)).toEqual([
    "year-1900 1900-01-01T00:00:00.000Z",
    "year-2200 2200-12-31T00:00:00.000Z",
  ]);
  const reason = "event dates fall outside the years 1900 to 2200";
  expect(result.skipped).toEqual(["year-1", "year-1899", "year-2201", "end-2201"].map((uid) => ({ uid, summary: null, reason })));
});

test("floating times read as America/Chicago whatever the server zone", () => {
  const savedZone = process.env.TZ;
  process.env.TZ = "Asia/Tokyo";
  try {
    const result = parseCalendarFeed(calendar(event(
      "UID:floating", "DTSTART:20261014T090000", "DTEND:20261014T100000", "RRULE:FREQ=WEEKLY;COUNT=1",
    )), { start: "2026-10-14T00:00:00", end: "2026-10-15T00:00:00" });
    // 09:00 CDT is 14:00Z; the busy block is 09:00 local, Wednesday.
    expect(result.occurrences.map((o) => o.start)).toEqual(["2026-10-14T14:00:00.000Z"]);
    expect(result.weeklyBusyBlocks).toEqual([{ eventId: 0, weekday: 3, startMinutes: 540, endMinutes: 600 }]);
  } finally {
    process.env.TZ = savedZone;
  }
});
