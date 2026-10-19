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
  // A zero-length event counts when its instant is, as the feed parser counts it.
  if (!(startMs < toMs && (endMs > fromMs || (endMs === startMs && startMs >= fromMs)))) return false;
  if (query.building !== null && event.buildingId !== query.building) return false;
  if (query.q !== null && query.q !== "") {
    const needle = query.q.toLowerCase();
    const haystack = `${event.title}\n${event.location}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** Serializes within MAX_RESPONSE_BYTES. An event too large to ever fit is dropped and noted on its source's report; the rest halve until the payload fits; `truncated` flags any drop here, and stays true when the caller already dropped events. The loop is bounded: every pass either returns or strictly shrinks the list. */
export function serializeEventsResponse(payload: EventsResponse): { json: string } {
  // An event whose own JSON exceeds the budget can never fit, so dropping it
  // up front keeps the halving loop from stalling on it, and each drop is
  // reported on the source it came from.
  const oversizedDrops = new Map<string, number>();
  let events = payload.events.filter(event => {
    if (Buffer.byteLength(JSON.stringify(event), "utf8") > MAX_RESPONSE_BYTES) {
      oversizedDrops.set(event.sourceId, (oversizedDrops.get(event.sourceId) ?? 0) + 1);
      return false;
    }
    return true;
  });
  for (;;) {
    const truncated = payload.truncated || events.length < payload.events.length;
    const sources = oversizedDrops.size === 0
      ? payload.sources
      : payload.sources.map(report => {
          const dropped = oversizedDrops.get(report.id);
          return dropped === undefined
            ? report
            : { ...report, note: `dropped ${dropped} event${dropped === 1 ? "" : "s"} too large for the response budget` };
        });
    const json = JSON.stringify({ ...payload, events, sources, truncated });
    if (Buffer.byteLength(json, "utf8") <= MAX_RESPONSE_BYTES || events.length === 0) {
      return { json };
    }
    if (events.length === 1) {
      // A single remaining event that still does not fit cannot be halved;
      // drop it, note its source, and serialize the rest.
      const last = events[0]!;
      oversizedDrops.set(last.sourceId, (oversizedDrops.get(last.sourceId) ?? 0) + 1);
      events = [];
    } else {
      events = events.slice(0, Math.floor(events.length / 2));
    }
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
  const { events: allEvents, reports } = await deps.cache.getEvents({ from: parsed.query.from, to: parsed.query.to });
  const matching = allEvents.filter(event => matchesQuery(event, parsed.query));
  // A merged event keeps its cluster's first place but its representative's start, which can be later, so sort again before the cap.
  // Instants, not strings: "10:00:00Z" sorts after "10:00:00.001Z" as text.
  const deduped = dedupeEvents(matching).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));
  const { json } = serializeEventsResponse({
    range: { from: parsed.query.from, to: parsed.query.to },
    building: parsed.query.building,
    q: parsed.query.q,
    events: deduped.slice(0, MAX_EVENTS_IN_RESPONSE),
    sources: reports,
    truncated: deduped.length > MAX_EVENTS_IN_RESPONSE,
  });
  return new Response(json, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
