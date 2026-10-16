/**
 * Cache tests with an injected fetchIcs: TTL behavior, in-flight
 * deduplication, stale-after-error, and per-source reports. No network.
 */

import { expect, test } from "bun:test";

import { EventSourceCache, type CacheDeps } from "@/lib/campus-events/cache";
import type { EventSourceDef } from "@/lib/campus-events/sources";

const INTERVAL = 30 * 60 * 1000;

function source(id: string): EventSourceDef {
  return {
    id,
    name: `Source ${id}`,
    url: `https://calendar.unt.edu/group/${id}/calendar/ics`,
    category: "student-life",
    refreshIntervalMs: INTERVAL,
  };
}

function ics(uid: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VEVENT",
    `UID:${uid}@test`,
    "DTSTAMP:20261015T120000Z",
    "DTSTART:20261020T233000Z",
    "DTEND:20261021T003000Z",
    "SUMMARY:Event",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** A controllable fetchIcs plus a movable clock, set near the fixture events. */
/** A range the API would accept, covering the fixture events (2026-10-20). */
const RANGE = { from: "2026-10-18T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" };

function harness(sources: EventSourceDef[], options?: { concurrency?: number; ics?: (id: string) => string }) {
  const calls: string[] = [];
  // The clock drives refresh timing; the requested range (RANGE below) pins
  // the fixture event dates (2026-10-20).
  let clock = Date.parse("2026-10-20T20:00:00.000Z");
  const failures = new Set<string>();
  const deps: CacheDeps = {
    fetchIcs: async url => {
      const id = url.split("/group/")[1]?.split("/")[0] ?? url;
      calls.push(id);
      if (failures.has(id)) throw new Error(`fetch failed for ${id}`);
      return options?.ics !== undefined ? options.ics(id) : ics(id);
    },
    now: () => clock,
    concurrency: options?.concurrency ?? 2,
  };
  const cache = new EventSourceCache(sources, deps);
  return { cache, calls, failures, advance: (ms: number) => (clock += ms) };
}

test("first call fetches every source; second call inside the TTL fetches nothing", async () => {
  const a = source("alpha");
  const b = source("beta");
  const { cache, calls } = harness([a, b]);
  await cache.getEvents(RANGE);
  expect(calls.length).toBe(2);
  await cache.getEvents(RANGE);
  expect(calls.length).toBe(2);
});

test("after the interval passes, the next call refreshes", async () => {
  const { cache, calls, advance } = harness([source("alpha")]);
  await cache.getEvents(RANGE);
  advance(INTERVAL + 1000);
  await cache.getEvents(RANGE);
  expect(calls.length).toBe(2);
});

test("concurrent first calls share one fetch per source", async () => {
  const { cache, calls } = harness([source("alpha")]);
  await Promise.all([cache.getEvents(RANGE), cache.getEvents(RANGE), cache.getEvents(RANGE)]);
  expect(calls.length).toBe(1);
});

test("a failed refresh serves stale data and reports status stale with the error", async () => {
  const { cache, calls, failures, advance } = harness([source("alpha")]);
  await cache.getEvents(RANGE);
  expect(calls.length).toBe(1);
  failures.add("alpha");
  advance(INTERVAL + 1000);
  const { events, reports } = await cache.getEvents(RANGE);
  expect(events.length).toBe(1);
  expect(reports.length).toBe(1);
  expect(reports[0]!.status).toBe("stale");
  expect(reports[0]!.error).toContain("fetch failed for alpha");
  expect(reports[0]!.eventCount).toBe(1);
  expect(reports[0]!.fetchedAt).not.toBeNull();
});

test("a source that has never fetched reports error and contributes no events", async () => {
  const good = source("good");
  const bad = source("bad");
  const { cache, failures } = harness([good, bad]);
  failures.add("bad");
  const { events, reports } = await cache.getEvents(RANGE);
  expect(events.map(event => event.sourceId)).toEqual(["good"]);
  const badReport = reports.find(report => report.id === "bad")!;
  expect(badReport.status).toBe("error");
  expect(badReport.fetchedAt).toBeNull();
  expect(badReport.error).toContain("fetch failed for bad");
});

test("a source that recovers after failing flips back to ok", async () => {
  const { cache, failures, advance } = harness([source("alpha")]);
  failures.add("alpha");
  const first = await cache.getEvents(RANGE);
  expect(first.reports[0]!.status).toBe("error");
  failures.delete("alpha");
  advance(INTERVAL + 1000);
  const second = await cache.getEvents(RANGE);
  expect(second.reports[0]!.status).toBe("ok");
  expect(second.reports[0]!.error).toBeNull();
});

test("normalized events come back sorted by start", async () => {
  const { cache } = harness([source("alpha")], { concurrency: 1 });
  const { events } = await cache.getEvents(RANGE);
  const starts = events.map(event => event.start);
  expect(starts).toEqual([...starts].sort());
});

test("a failed refresh backs off for the interval instead of retrying every request", async () => {
  const { cache, calls, failures, advance } = harness([source("alpha")]);
  await cache.getEvents(RANGE);
  expect(calls.length).toBe(1);
  failures.add("alpha");
  advance(INTERVAL + 1000);
  const stale = await cache.getEvents(RANGE);
  expect(stale.reports[0]!.status).toBe("stale");
  expect(calls.length).toBe(2); // the failed attempt happened
  advance(60 * 1000); // far inside the interval
  const again = await cache.getEvents(RANGE);
  expect(calls.length).toBe(2); // backoff honored: no third attempt yet
  expect(again.events.length).toBe(1); // last good data still served
  expect(again.reports[0]!.status).toBe("stale");
  expect(again.reports[0]!.error).toContain("fetch failed for alpha");
});

test("a request range the cached window does not cover still returns its events", async () => {
  // Two events: one six hours before the fetch (the old parse window started
  // one hour before the fetch) and one after it. A 14-day range starting at
  // 13:00 reaches past the old window in both directions.
  const wide = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VEVENT",
    "UID:early@test",
    "DTSTAMP:20261015T120000Z",
    "DTSTART:20261020T150000Z",
    "DTEND:20261020T160000Z",
    "SUMMARY:Early event",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:late@test",
    "DTSTAMP:20261015T120000Z",
    "DTSTART:20261020T233000Z",
    "DTEND:20261021T003000Z",
    "SUMMARY:Late event",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const { cache, calls } = harness([source("alpha")], { ics: () => wide });
  await cache.getEvents(RANGE); // warm the cache with one fetch
  expect(calls.length).toBe(1);
  const { events } = await cache.getEvents({
    from: "2026-10-20T13:00:00.000Z",
    to: "2026-11-03T13:00:00.000Z",
  });
  expect(calls.length).toBe(1); // served from the cached fetch, no refetch
  expect(events.map(event => event.title).sort()).toEqual(["Early event", "Late event"]);
});
