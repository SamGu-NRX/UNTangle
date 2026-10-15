/**
 * The GET /api/v1/events handler: one normalized, deduplicated list of UNT
 * events with times, places, and source links. Plain Request/Response; the
 * route file adds rate limiting and Next wiring.
 *
 * The endpoint is public and reads only the fixed, verified source
 * directory, so no session is required; the caller is rate-limited like the
 * map routes. Range is capped at 14 days, the response is bounded by event
 * count and bytes, and a failing source degrades the response instead of
 * failing it.
 */

import { parseRangeInstant } from "@/lib/calendar-feeds/datetime";
import { dedupeEvents } from "./dedupe";
import type { EventSourceCache } from "./cache";
import { campusBuildings } from "@/lib/campus-locations";
import type { NormalizedEvent, SourceReport } from "./types";

/** The largest from-to window the API accepts, in days. */
export const MAX_RANGE_DAYS = 14;
/** Hard cap on events in one response, before the byte bound. */
export const MAX_EVENTS_IN_RESPONSE = 500;
/** The largest response body, in bytes; oversized responses drop events until they fit. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;
/** Longest accepted q value; longer input is cut, not rejected. */
const MAX_Q_CHARS = 200;

export type EventsQuery = {
  from: string;
  to: string;
  building: string | null;
  q: string | null;
};

export type EventsResponse = {
  range: { from: string; to: string };
  building: string | null;
  q: string | null;
  events: NormalizedEvent[];
  sources: SourceReport[];
  /** True when events were dropped to fit the bounds. */
  truncated: boolean;
};

const knownBuildingIds = new Set(campusBuildings.map(building => building.id));

/** Parses and validates the query string; returns the error message, or the query. */
export function parseEventsQuery(url: URL): { error: string } | { query: EventsQuery } {
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  if (fromRaw === null || fromRaw === "" || toRaw === null || toRaw === "") {
    return { error: "from and to are required ISO 8601 date-times" };
  }
  const fromMs = parseRangeInstant(fromRaw);
  const toMs = parseRangeInstant(toRaw);
  if (fromMs === null || toMs === null) {
    return { error: "from and to must be ISO 8601 date-times" };
  }
  if (toMs <= fromMs) {
    return { error: "to must be after from" };
  }
  if (toMs - fromMs > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    return { error: `the range is capped at ${MAX_RANGE_DAYS} days` };
  }
  const buildingRaw = url.searchParams.get("building");
  let building: string | null = null;
  if (buildingRaw !== null && buildingRaw !== "") {
    building = buildingRaw.trim().toLowerCase();
    if (!knownBuildingIds.has(building)) {
      return { error: "unknown building" };
    }
  }
  const qRaw = url.searchParams.get("q");
  const q = qRaw === null ? null : qRaw.trim().slice(0, MAX_Q_CHARS);
  return { query: { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), building, q } };
}

function matchesQuery(event: NormalizedEvent, query: EventsQuery): boolean {
  const startMs = Date.parse(event.start);
  const endMs = Date.parse(event.end);
  const fromMs = Date.parse(query.from);
  const toMs = Date.parse(query.to);
  // Half-open overlap: an event counts when any part of it is inside the range.
  if (!(startMs < toMs && endMs > fromMs)) return false;
  if (query.building !== null && event.buildingId !== query.building) return false;
  if (query.q !== null && query.q !== "") {
    const needle = query.q.toLowerCase();
    const haystack = `${event.title}\n${event.location}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** Serializes within MAX_RESPONSE_BYTES by halving the event list until it fits, setting `truncated` on the payload. */
export function serializeEventsResponse(payload: Omit<EventsResponse, "truncated">): { json: string } {
  let events = payload.events;
  for (;;) {
    const truncated = events.length < payload.events.length;
    const json = JSON.stringify({ ...payload, events, truncated });
    if (Buffer.byteLength(json, "utf8") <= MAX_RESPONSE_BYTES || events.length === 0) {
      return { json };
    }
    events = events.slice(0, Math.max(1, Math.floor(events.length / 2)));
  }
}

export type EventsHandlerDeps = {
  cache: EventSourceCache;
};

/**
 * The handler. A failing source never fails the response: the cache reports
 * per-source status, and only sources with data contribute events.
 */
export async function eventsHandler(request: Request, deps: EventsHandlerDeps): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parseEventsQuery(url);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const { events: allEvents, reports } = await deps.cache.getEvents();
  const matching = allEvents.filter(event => matchesQuery(event, parsed.query));
  const deduped = dedupeEvents(matching).slice(0, MAX_EVENTS_IN_RESPONSE);
  const { json } = serializeEventsResponse({
    range: { from: parsed.query.from, to: parsed.query.to },
    building: parsed.query.building,
    q: parsed.query.q,
    events: deduped,
    sources: reports,
  });
  return new Response(json, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
