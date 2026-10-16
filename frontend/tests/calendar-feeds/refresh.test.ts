/** Which connected calendars Week reads again, and how a fresh reading lands on the preferences. */
import { describe, expect, test } from "bun:test";
import { CALENDAR_STALE_MS, calendarsToRefresh, withReading } from "@/lib/calendar-busy";
import type { ConnectedCalendar } from "@/lib/types";

const NOW = Date.parse("2026-10-15T18:00:00Z");
const calendar = (id: string, over: Partial<ConnectedCalendar> = {}): ConnectedCalendar => ({
  id,
  name: id,
  sealedUrl: `cf1.k.i.${id}`,
  termId: "spring-2027",
  checkedAt: new Date(NOW - 60_000).toISOString(),
  busy: [{ start: 900, end: 1080, dates: ["2027-01-12"] }],
  ...over,
});

describe("reading calendars again", () => {
  test("only those read long ago or for another term, and each once a visit", () => {
    const fresh = calendar("fresh");
    const old = calendar("old", { checkedAt: new Date(NOW - CALENDAR_STALE_MS - 1).toISOString() });
    const lastTerm = calendar("last-term", { termId: "fall-2026" });
    expect(calendarsToRefresh([fresh, old, lastTerm], "spring-2027", NOW, new Set()).map((c) => c.id)).toEqual(["old", "last-term"]);
    expect(calendarsToRefresh([fresh, old, lastTerm], "spring-2027", NOW, new Set(["old", "last-term"]))).toEqual([]);
    expect(calendarsToRefresh(undefined, "spring-2027", NOW, new Set())).toEqual([]);
  });

  test("a reading lands on the calendar as it is now, keeping a rename made meanwhile", () => {
    const read = calendar("work");
    const reading = { ...read, checkedAt: "2026-10-15T18:00:00.000Z", busy: [{ start: 900, end: 1080, dates: ["2027-01-12", "2027-01-19"] }] };
    const renamed = { calendars: [{ ...read, name: "Night job" }] };
    expect(withReading(renamed, read, reading).calendars).toEqual([{ ...reading, name: "Night job" }]);
  });

  test("a calendar removed or connected again during the read is left alone", () => {
    const read = calendar("work");
    const reading = { ...read, busy: [] };
    expect(withReading({ calendars: [calendar("club")] }, read, reading)).toEqual({ calendars: [calendar("club")] });
    const reconnected = { calendars: [calendar("work", { sealedUrl: "cf1.k.i.new" })] };
    expect(withReading(reconnected, read, reading)).toBe(reconnected);
    const none = {};
    expect(withReading(none, read, reading)).toBe(none);
  });

  test("a guest token the server upgraded for the account replaces the old one", () => {
    const read = calendar("work");
    const reading = { ...read, sealedUrl: "cf1.k.i.account" };
    expect(withReading({ calendars: [read] }, read, reading).calendars?.[0].sealedUrl).toBe("cf1.k.i.account");
  });
});
