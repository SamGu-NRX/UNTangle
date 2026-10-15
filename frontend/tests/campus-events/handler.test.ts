/**
 * Handler tests over a stub cache: query validation, range cap, filtering,
 * deduplication of the served list, per-source reports, and bounds. No
 * network and no real catalogue dependency beyond ids used in fixtures.
 */

import { expect, test } from "bun:test";

import { eventsHandler, MAX_EVENTS_IN_RESPONSE, parseEventsQuery, serializeEventsResponse } from "@/lib/campus-events/handler";
import type { EventSourceCache } from "@/lib/campus-events/cache";
import type { NormalizedEvent, SourceReport } from "@/lib/campus-events/types";

function event(overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    sourceId: "unt-events-all",
    url: null,
    title: "Club Meeting",
    start: "2026-10-20T23:30:00.000Z",
    end: "2026-10-21T00:30:00.000Z",
    isAllDay: false,
    location: "University Union, Room 226",
    buildingId: "uu",
    tags: ["university-events"],
    ...overrides,
  };
}

function report(id: string, status: SourceReport["status"]): SourceReport {
  return { id, name: `Source ${id}`, status, fetchedAt: status === "error" ? null : "2026-10-15T12:00:00.000Z", eventCount: 1, error: status === "error" ? "down" : null };
}

function cacheWith(events: NormalizedEvent[], reports: SourceReport[]): EventSourceCache {
  return { getEvents: async () => ({ events, reports }) } as unknown as EventSourceCache;
}

function request(query: string): Request {
  return new Request(`http://localhost/api/v1/events${query}`);
}

test("missing or invalid from/to are 400", async () => {
  expect((await eventsHandler(request(""), { cache: cacheWith([], []) })).status).toBe(400);
  expect((await eventsHandler(request("?from=nope&to=2026-10-21T00:00:00Z"), { cache: cacheWith([], []) })).status).toBe(400);
});

test("an empty range or a range over 14 days is 400", async () => {
  const same = "?from=2026-10-20T00:00:00Z&to=2026-10-20T00:00:00Z";
  expect((await eventsHandler(request(same), { cache: cacheWith([], []) })).status).toBe(400);
  const long = "?from=2026-10-01T00:00:00Z&to=2026-10-16T00:00:00Z";
  expect((await eventsHandler(request(long), { cache: cacheWith([], []) })).status).toBe(400);
});

test("an unknown building id is 400", async () => {
  const url = "?from=2026-10-20T00:00:00Z&to=2026-10-21T00:00:00Z&building=not-a-building";
  expect((await eventsHandler(request(url), { cache: cacheWith([], []) })).status).toBe(400);
});

test("events outside the range or at the wrong building are excluded", async () => {
  const inside = event({});
  // Ends exactly at the range start: the half-open overlap excludes it.
  const before = event({ title: "Early", start: "2026-10-19T23:30:00.000Z", end: "2026-10-20T00:00:00.000Z" });
  const elsewhere = event({ title: "Elsewhere", buildingId: "blb", location: "Business Leadership Building, 070" });
  const cache = cacheWith([before, inside, elsewhere], [report("unt-events-all", "ok")]);
  const response = await eventsHandler(
    request("?from=2026-10-20T00:00:00Z&to=2026-10-21T00:00:00Z&building=uu"),
    { cache },
  );
  const body = (await response.json()) as { events: NormalizedEvent[] };
  expect(body.events.map(item => item.title)).toEqual(["Club Meeting"]);
});

test("an event overlapping the range boundary by a minute counts as inside", async () => {
  const straddles = event({ start: "2026-10-20T23:30:00.000Z", end: "2026-10-21T00:00:30.000Z" });
  const response = await eventsHandler(
    request("?from=2026-10-20T00:00:00Z&to=2026-10-21T00:00:00Z"),
    { cache: cacheWith([straddles], []) },
  );
  const body = (await response.json()) as { events: NormalizedEvent[] };
  expect(body.events.length).toBe(1);
});

test("q filters case-insensitively over title and location", async () => {
  const cache = cacheWith([event({}), event({ title: "Movie Night", location: "Art Building" })], []);
  const response = await eventsHandler(
    request("?from=2026-10-20T00:00:00Z&to=2026-10-21T00:00:00Z&q=movie"),
    { cache },
  );
  const body = (await response.json()) as { events: NormalizedEvent[] };
  expect(body.events.map(item => item.title)).toEqual(["Movie Night"]);
});

test("the response carries per-source reports, including failures", async () => {
  const cache = cacheWith([event({})], [report("unt-events-all", "ok"), report("group-athletics", "error")]);
  const response = await eventsHandler(
    request("?from=2026-10-20T00:00:00Z&to=2026-10-21T00:00:00Z"),
    { cache },
  );
  const body = (await response.json()) as { sources: SourceReport[] };
  expect(body.sources.map(source => source.status)).toEqual(["ok", "error"]);
});

test("duplicate events collapse in the response", async () => {
  const cache = cacheWith([event({}), event({ sourceId: "group-recreational_sports", tags: ["recreation"] })], []);
  const response = await eventsHandler(
    request("?from=2026-10-20T00:00:00Z&to=2026-10-21T00:00:00Z"),
    { cache },
  );
  const body = (await response.json()) as { events: NormalizedEvent[] };
  expect(body.events.length).toBe(1);
});

test("the event list is capped at MAX_EVENTS_IN_RESPONSE", async () => {
  // Distinct titles: the dedupe key is title + place + start, so same-title
  // fixtures would collapse before the cap ever applied.
  const many = Array.from({ length: MAX_EVENTS_IN_RESPONSE + 5 }, (_, index) =>
    event({ title: `Event ${index}` }),
  );
  const response = await eventsHandler(
    request("?from=2026-10-20T00:00:00Z&to=2026-10-21T00:00:00Z"),
    { cache: cacheWith(many, []) },
  );
  const body = (await response.json()) as { events: NormalizedEvent[] };
  expect(body.events.length).toBe(MAX_EVENTS_IN_RESPONSE);
});

test("parseEventsQuery normalizes the building filter and trims q", () => {
  const parsed = parseEventsQuery(
    new URL("http://x/api/v1/events?from=2026-10-20T00:00:00Z&to=2026-10-21T00:00:00Z&building=UU&q=%20pickleball%20"),
  );
  if (!("query" in parsed)) throw new Error("expected a parsed query");
  expect(parsed.query.building).toBe("uu");
  expect(parsed.query.q).toBe("pickleball");
});

test("serializeEventsResponse halves oversized payloads and flags truncation", () => {
  const oneBig = event({ title: "x".repeat(5000) });
  const payload = {
    range: { from: "2026-10-20T00:00:00Z", to: "2026-10-21T00:00:00Z" },
    building: null,
    q: null,
    events: Array.from({ length: 1000 }, () => oneBig),
    sources: [],
  };
  const { json } = serializeEventsResponse(payload);
  const body = JSON.parse(json) as { truncated: boolean; events: NormalizedEvent[] };
  expect(json.length).toBeLessThan(1024 * 1024);
  expect(body.truncated).toBe(true);
  expect(body.events.length).toBeLessThan(1000);
  expect(body.events.length).toBeGreaterThan(0);
});
