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
function harness(sources: EventSourceDef[], options?: { concurrency?: number }) {
  const calls: string[] = [];
  // The cache's parse window follows this clock, so it must sit near the
  // fixture event date (2026-10-20) for events to survive normalization.
  let clock = Date.parse("2026-10-20T20:00:00.000Z");
  const failures = new Set<string>();
  const deps: CacheDeps = {
    fetchIcs: async url => {
      const id = url.split("/group/")[1]?.split("/")[0] ?? url;
      calls.push(id);
      if (failures.has(id)) throw new Error(`fetch failed for ${id}`);
      return ics(id);
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
  await cache.getEvents();
  expect(calls.length).toBe(2);
  await cache.getEvents();
  expect(calls.length).toBe(2);
});

test("after the interval passes, the next call refreshes", async () => {
  const { cache, calls, advance } = harness([source("alpha")]);
  await cache.getEvents();
  advance(INTERVAL + 1000);
  await cache.getEvents();
  expect(calls.length).toBe(2);
});

test("concurrent first calls share one fetch per source", async () => {
  const { cache, calls } = harness([source("alpha")]);
  await Promise.all([cache.getEvents(), cache.getEvents(), cache.getEvents()]);
  expect(calls.length).toBe(1);
});

test("a failed refresh serves stale data and reports status stale with the error", async () => {
  const { cache, calls, failures, advance } = harness([source("alpha")]);
  await cache.getEvents();
  expect(calls.length).toBe(1);
  failures.add("alpha");
  advance(INTERVAL + 1000);
  const { events, reports } = await cache.getEvents();
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
  const { events, reports } = await cache.getEvents();
  expect(events.map(event => event.sourceId)).toEqual(["good"]);
  const badReport = reports.find(report => report.id === "bad")!;
  expect(badReport.status).toBe("error");
  expect(badReport.fetchedAt).toBeNull();
  expect(badReport.error).toContain("fetch failed for bad");
});

test("a source that recovers after failing flips back to ok", async () => {
  const { cache, failures, advance } = harness([source("alpha")]);
  failures.add("alpha");
  const first = await cache.getEvents();
  expect(first.reports[0]!.status).toBe("error");
  failures.delete("alpha");
  advance(INTERVAL + 1000);
  const second = await cache.getEvents();
  expect(second.reports[0]!.status).toBe("ok");
  expect(second.reports[0]!.error).toBeNull();
});

test("normalized events come back sorted by start", async () => {
  const { cache } = harness([source("alpha")], { concurrency: 1 });
  const { events } = await cache.getEvents();
  const starts = events.map(event => event.start);
  expect(starts).toEqual([...starts].sort());
});
