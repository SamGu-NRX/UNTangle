/**
 * busyFromFeed: dated busy pieces from a parsed feed, without titles, over
 * the term's real date range. Fixtures are synthetic.
 */

import { describe, expect, test } from "bun:test";

import { busyFromFeed } from "@/lib/calendar-feeds/busy";
import { parseCalendarFeed } from "@/lib/calendar-feeds/parse";
import type { ParseRange } from "@/lib/calendar-feeds/types";

const PARSE_RANGE: ParseRange = { start: "2026-03-01T00:00:00Z", end: "2026-04-01T00:00:00Z" };
const TERM = { start: "2026-03-01", end: "2026-03-31" };

function parse(ics: string) {
  return parseCalendarFeed(ics, PARSE_RANGE);
}

function ics(body: string): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
}

describe("busyFromFeed", () => {
  test("a timed weekly event yields dated busy pieces and no titles", () => {
    const feed = parse(
      ics(
        "BEGIN:VEVENT\r\nUID:w@t\r\nSUMMARY:Secret club meeting\r\nLOCATION:Somewhere private\r\nDTSTART;TZID=America/Chicago:20260302T090000\r\nDTEND;TZID=America/Chicago:20260302T100000\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT",
      ),
    );
    const busy = busyFromFeed(feed, TERM);
    expect(busy).toHaveLength(5);
    expect(busy[0]).toEqual({
      eventId: 0,
      date: "2026-03-02",
      startMinutes: 540,
      endMinutes: 600,
      start: "2026-03-02T15:00:00.000Z",
      end: "2026-03-02T16:00:00.000Z",
      allDay: false,
      busy: true,
    });
    // No title, location or description survives.
    expect(JSON.stringify(busy)).not.toContain("Secret");
  });

  test("transparent and canceled events produce no busy time", () => {
    const feed = parse(
      ics(
        "BEGIN:VEVENT\r\nUID:t@t\r\nSUMMARY:Free\r\nTRANSP:TRANSPARENT\r\nDTSTART;TZID=America/Chicago:20260303T090000\r\nDTEND;TZID=America/Chicago:20260303T100000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:c@t\r\nSUMMARY:Cancelled\r\nSTATUS:CANCELLED\r\nDTSTART;TZID=America/Chicago:20260303T100000\r\nDTEND;TZID=America/Chicago:20260303T110000\r\nEND:VEVENT",
      ),
    );
    expect(busyFromFeed(feed, TERM)).toEqual([]);
  });

  test("pieces stop at the term's last date and never leak outside it", () => {
    const feed = parse(
      ics(
        "BEGIN:VEVENT\r\nUID:d@t\r\nSUMMARY:Daily\r\nDTSTART;TZID=America/Chicago:20260301T090000\r\nDTEND;TZID=America/Chicago:20260301T093000\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT",
      ),
    );
    const busy = busyFromFeed(feed, TERM);
    expect(busy).toHaveLength(31);
    expect(busy.every((piece) => piece.date >= TERM.start && piece.date <= TERM.end)).toBe(true);
  });

  test("an overnight event splits into per-day busy pieces", () => {
    const feed = parse(
      ics(
        "BEGIN:VEVENT\r\nUID:o@t\r\nSUMMARY:Overnight\r\nDTSTART;TZID=America/Chicago:20260310T220000\r\nDTEND;TZID=America/Chicago:20260311T020000\r\nEND:VEVENT",
      ),
    );
    const busy = busyFromFeed(feed, TERM);
    expect(busy.map((piece) => [piece.date, piece.startMinutes, piece.endMinutes])).toEqual([
      ["2026-03-10", 1320, 1440],
      ["2026-03-11", 0, 120],
    ]);
  });

  test("an all-day event marks every piece allDay", () => {
    const feed = parse(
      ics(
        "BEGIN:VEVENT\r\nUID:a@t\r\nSUMMARY:All day\r\nDTSTART;VALUE=DATE:20260312\r\nDTEND;VALUE=DATE:20260313\r\nEND:VEVENT",
      ),
    );
    const busy = busyFromFeed(feed, TERM);
    expect(busy.map((piece) => [piece.date, piece.allDay, piece.startMinutes, piece.endMinutes])).toEqual([
      ["2026-03-12", true, 0, 1440],
    ]);
  });
});
