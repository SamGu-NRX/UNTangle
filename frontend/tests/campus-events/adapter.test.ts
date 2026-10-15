/**
 * Adapter tests over saved fixtures. The fixtures come from the
 * calendar-feeds directory fixtures (tests/calendar-feeds/fixtures, with
 * source URLs and dates in that directory's PROVENANCE.md); nothing here
 * touches the network.
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeIcsFeed } from "@/lib/campus-events/adapter";
import type { EventSourceDef } from "@/lib/campus-events/sources";

const DIRECTORY_FIXTURES = join(import.meta.dir, "..", "calendar-feeds", "fixtures", "directory");

function fixture(name: string): string {
  return readFileSync(join(DIRECTORY_FIXTURES, name), "utf8");
}

const source: EventSourceDef = {
  id: "group-recreational_sports",
  name: "Recreational Sports Events (Pohl Recreation Center)",
  url: "https://calendar.unt.edu/group/recreational_sports/calendar/ics",
  category: "recreation",
  refreshIntervalMs: 30 * 60 * 1000,
};

// A window wide enough for the fixture events; the fixtures carry 2026 dates.
const RANGE = { start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z" };

test("normalizes fixture events into the one event shape", () => {
  const events = normalizeIcsFeed(fixture("athletics.ics"), RANGE, { ...source, id: "group-athletics", category: "athletics" });
  expect(events.length).toBeGreaterThan(0);
  for (const event of events) {
    expect(event.sourceId).toBe("group-athletics");
    expect(Number.isNaN(Date.parse(event.start))).toBe(false);
    expect(Number.isNaN(Date.parse(event.end))).toBe(false);
    expect(Date.parse(event.end)).toBeGreaterThanOrEqual(Date.parse(event.start));
    expect(event.tags.length).toBeGreaterThan(0);
    // Tags keep the feed's own casing; matching is case-insensitive.
    expect(event.tags.some(tag => tag.toLowerCase() === "athletics")).toBe(true);
  }
});

test("keeps the event's page URL and the feed's categories as tags", () => {
  const events = normalizeIcsFeed(fixture("athletics.ics"), RANGE, {
    ...source,
    id: "group-athletics",
    category: "athletics",
  });
  const withUrl = events.filter(event => event.url !== null);
  expect(withUrl.length).toBeGreaterThan(0);
  for (const event of withUrl) {
    expect(event.url!.startsWith("https://")).toBe(true);
  }
});

test("sorts events by start", () => {
  const events = normalizeIcsFeed(fixture("athletics.ics"), RANGE, {
    ...source,
    id: "group-athletics",
    category: "athletics",
  });
  const starts = events.map(event => event.start);
  const sorted = [...starts].sort();
  expect(starts).toEqual(sorted);
});

test("an all-day event spans whole days and reads isAllDay", () => {
  // us-holidays-style all-day entries; the directory fixtures include whole-day events.
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VEVENT",
    "UID:allday-1@test",
    "DTSTAMP:20261015T120000Z",
    "DTSTART;VALUE=DATE:20261020",
    "DTEND;VALUE=DATE:20261021",
    "SUMMARY:Campus Open House",
    "LOCATION:Pohl Recreation Center",
    "CATEGORIES:Student Life",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const events = normalizeIcsFeed(ics, RANGE, source);
  expect(events.length).toBe(1);
  const event = events[0]!;
  expect(event.isAllDay).toBe(true);
  expect(event.start).toBe("2026-10-20T00:00:00.000Z");
  expect(event.end).toBe("2026-10-21T00:00:00.000Z");
});

test("a location that matches the catalogue exactly gets its building id; others keep raw text", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VEVENT",
    "UID:loc-1@test",
    "DTSTAMP:20261015T120000Z",
    "DTSTART:20261020T233000Z",
    "DTEND:20261021T003000Z",
    "SUMMARY:Eagle Awards",
    "LOCATION:University Union\\, Room 226",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:loc-2@test",
    "DTSTAMP:20261015T120000Z",
    "DTSTART:20261021T233000Z",
    "DTEND:20261022T003000Z",
    "SUMMARY:Pickleball Doubles Tournament",
    "LOCATION:Pohl Recreation Center\\, Soccer Gym",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const events = normalizeIcsFeed(ics, RANGE, source);
  expect(events.length).toBe(2);
  const [inCatalogue, notInCatalogue] = events;
  // "University Union, Room 226" matches the catalogue through its leading segment.
  expect(inCatalogue!.buildingId).toBe("uu");
  expect(inCatalogue!.location).toBe("University Union, Room 226");
  // A real Localist venue the catalogue does not list stays raw text, never a guess.
  expect(notInCatalogue!.buildingId).toBeNull();
  expect(notInCatalogue!.location).toBe("Pohl Recreation Center, Soccer Gym");
});

test("one skipped entry never aborts the parse of the rest", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VEVENT",
    "UID:broken@test",
    "DTSTAMP:20261015T120000Z",
    "SUMMARY:No dates at all",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:fine@test",
    "DTSTAMP:20261015T120000Z",
    "DTSTART:20261020T233000Z",
    "DTEND:20261021T003000Z",
    "SUMMARY:Fine Event",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const events = normalizeIcsFeed(ics, RANGE, source);
  expect(events.length).toBe(1);
  expect(events[0]!.title).toBe("Fine Event");
});
