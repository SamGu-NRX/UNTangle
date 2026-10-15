/**
 * Parser audit fixtures for the shapes real Google, Outlook and iCloud feeds
 * use. The synthetic fixtures here are hand-written, modeled on the "secret
 * address in iCal format" body Google serves (checked against the feed shape
 * described in Google Calendar's help docs on 2026-10-15); no live site was
 * fetched to record them. Each test pins one behavior the calendar-busy
 * feature relies on; the X-WR-TIMEZONE tests captured a real gap.
 */

import { describe, expect, test } from "bun:test";

import { parseCalendarFeed } from "@/lib/calendar-feeds/parse";
import type { ParseRange } from "@/lib/calendar-feeds/types";

const RANGE: ParseRange = { start: "2026-03-01T00:00:00Z", end: "2026-04-01T00:00:00Z" };

function ics(body: string): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
}

describe("calendar feeds a Google secret address serves", () => {
  test("floating times inside the calendar read in the X-WR-TIMEZONE zone", () => {
    // Google writes timed events with TZID, but events synced from clients
    // without one arrive floating, and X-WR-TIMEZONE is then the only zone
    // statement the feed makes. A New York 09:00 shift is 13:00Z in March,
    // not America/Chicago's 14:00Z.
    const feed = ics(
      "X-WR-TIMEZONE:America/New_York\r\nBEGIN:VEVENT\r\nUID:ny@t\r\nSUMMARY:NY shift\r\nDTSTART:20260316T090000\r\nDTEND:20260316T170000\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT",
    );
    const result = parseCalendarFeed(feed, RANGE);
    expect(result.skipped).toEqual([]);
    expect(result.occurrences[0]?.start).toBe("2026-03-16T13:00:00.000Z");
    expect(result.occurrences[0]?.end).toBe("2026-03-16T21:00:00.000Z");
  });

  test("an X-WR-TIMEZONE weekly block carries minutes in that zone", () => {
    const feed = ics(
      "X-WR-TIMEZONE:America/New_York\r\nBEGIN:VEVENT\r\nUID:ny2@t\r\nSUMMARY:NY shift\r\nDTSTART:20260316T090000\r\nDTEND:20260316T170000\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT",
    );
    const result = parseCalendarFeed(feed, RANGE);
    expect(result.weeklyBusyBlocks).toEqual([{ eventId: 0, weekday: 1, startMinutes: 540, endMinutes: 1020 }]);
  });

  test("an X-WR-TIMEZONE that names no IANA zone falls back to America/Chicago", () => {
    // Windows zone names show up in feeds exported by Outlook clients.
    const feed = ics(
      'X-WR-TIMEZONE:"Central Standard Time"\r\nBEGIN:VEVENT\r\nUID:win@t\r\nSUMMARY:Floating\r\nDTSTART:20260316T090000\r\nDTEND:20260316T100000\r\nEND:VEVENT',
    );
    const result = parseCalendarFeed(feed, RANGE);
    expect(result.skipped).toEqual([]);
    expect(result.occurrences[0]?.start).toBe("2026-03-16T14:00:00.000Z");
  });

  test("a feed without X-WR-TIMEZONE still reads floating times as America/Chicago", () => {
    const feed = ics(
      "BEGIN:VEVENT\r\nUID:chi@t\r\nSUMMARY:Chicago\r\nDTSTART:20260316T090000\r\nDTEND:20260316T100000\r\nEND:VEVENT",
    );
    const result = parseCalendarFeed(feed, RANGE);
    expect(result.occurrences[0]?.start).toBe("2026-03-16T14:00:00.000Z");
  });
});

describe("audit: recurrence exclusion and override shapes real feeds use", () => {
  test("a date-form EXDATE drops the whole local day of a timed series", () => {
    // Outlook writes EXDATE;VALUE=DATE for a day a series does not meet.
    const feed = ics(
      "BEGIN:VEVENT\r\nUID:wk@t\r\nSUMMARY:Weekly\r\nDTSTART;TZID=America/Chicago:20260302T090000\r\nDTEND;TZID=America/Chicago:20260302T100000\r\nRRULE:FREQ=WEEKLY\r\nEXDATE;VALUE=DATE:20260309\r\nEXDATE;VALUE=DATE:20260316\r\nEND:VEVENT",
    );
    const result = parseCalendarFeed(feed, RANGE);
    expect(result.skipped).toEqual([]);
    expect(result.occurrences.map((o) => o.start)).toEqual([
      "2026-03-02T15:00:00.000Z",
      "2026-03-23T14:00:00.000Z",
      "2026-03-30T14:00:00.000Z",
    ]);
  });

  test("a multi-day all-day recurring event expands with an EXDATE on one date", () => {
    const feed = ics(
      "BEGIN:VEVENT\r\nUID:conf@t\r\nSUMMARY:Conference\r\nDTSTART;VALUE=DATE:20260302\r\nDTEND;VALUE=DATE:20260304\r\nRRULE:FREQ=WEEKLY\r\nEXDATE;VALUE=DATE:20260316\r\nEND:VEVENT",
    );
    const result = parseCalendarFeed(feed, RANGE);
    expect(result.skipped).toEqual([]);
    expect(result.occurrences.map((o) => [o.start, o.end])).toEqual([
      ["2026-03-02T00:00:00.000Z", "2026-03-04T00:00:00.000Z"],
      ["2026-03-09T00:00:00.000Z", "2026-03-11T00:00:00.000Z"],
      ["2026-03-23T00:00:00.000Z", "2026-03-25T00:00:00.000Z"],
      ["2026-03-30T00:00:00.000Z", "2026-04-01T00:00:00.000Z"],
    ]);
    expect(result.weeklyBusyBlocks).toEqual([
      { eventId: 0, weekday: 1, startMinutes: 0, endMinutes: 1440 },
      { eventId: 0, weekday: 2, startMinutes: 0, endMinutes: 1440 },
    ]);
  });

  test("an override whose RECURRENCE-ID names no generated instance appears beside the series", () => {
    // A strict-instant match that misses keeps both the original instance and
    // the override, so the result never hides real busy time. Documented in
    // the calendar-feeds README ("Recurrence overrides").
    const feed = ics(
      "BEGIN:VEVENT\r\nUID:tz@t\r\nSUMMARY:Chicago weekly\r\nDTSTART;TZID=America/Chicago:20260302T090000\r\nDTEND;TZID=America/Chicago:20260302T100000\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:tz@t\r\nSUMMARY:Moved\r\nRECURRENCE-ID;TZID=America/New_York:20260309T090000\r\nDTSTART;TZID=America/Chicago:20260309T120000\r\nDTEND;TZID=America/Chicago:20260309T130000\r\nEND:VEVENT",
    );
    const result = parseCalendarFeed(feed, RANGE);
    expect(result.skipped).toEqual([]);
    const ninth = result.occurrences.filter((o) => o.start.startsWith("2026-03-09"));
    // Both the 14:00Z series instance and the 17:00Z override survive.
    expect(ninth.map((o) => o.start).sort()).toEqual(["2026-03-09T14:00:00.000Z", "2026-03-09T17:00:00.000Z"]);
  });

  test("a TZID on DTSTART works without any VTIMEZONE block", () => {
    // Google and Outlook feeds carry full VTIMEZONE blocks; feeds from other
    // generators do not, and the zone names are IANA all the same.
    const feed = ics(
      "BEGIN:VEVENT\r\nUID:noVT@t\r\nSUMMARY:No VTIMEZONE\r\nDTSTART;TZID=America/Chicago:20260310T090000\r\nDTEND;TZID=America/Chicago:20260310T100000\r\nEND:VEVENT",
    );
    const result = parseCalendarFeed(feed, RANGE);
    expect(result.skipped).toEqual([]);
    expect(result.occurrences).toEqual([
      { eventId: 0, start: "2026-03-10T14:00:00.000Z", end: "2026-03-10T15:00:00.000Z", status: "confirmed" },
    ]);
  });
});
