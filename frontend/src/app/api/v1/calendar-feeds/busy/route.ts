import { NextResponse } from "next/server";

import { getServerSession } from "@/lib/auth-server";
import { withRateLimit } from "@/lib/rate-limit/server";
import { parseRangeInstant } from "@/lib/calendar-feeds/datetime";
import { CalendarFetchError, CalendarParseError } from "@/lib/calendar-feeds/errors";
import { fetchCalendarIcs } from "@/lib/calendar-feeds/fetch";
import { parseCalendarFeed } from "@/lib/calendar-feeds/parse";
import { busyFromFeed } from "@/lib/calendar-feeds/busy";
import { serializeBusy } from "@/lib/calendar-feeds/busy-serialize";
import { TOO_MANY_EVENTS_MESSAGE } from "@/lib/calendar-feeds/preview";
import { validateCalendarUrl } from "@/lib/calendar-feeds/ssrf";
import type { ParseRange } from "@/lib/calendar-feeds/types";

// node:dns needs the Node runtime; the Edge runtime has no DNS resolver.
export const runtime = "nodejs";

/** The default busy window: now through now plus 60 days. */
const DEFAULT_RANGE_DAYS = 60;

type BusyBody = { url: unknown; rangeStart?: unknown; rangeEnd?: unknown; termStart?: unknown; termEnd?: unknown };

/**
 * Returns the title-free busy pieces a feed contributes to the planner's
 * dated blocked times. Nothing is stored anywhere: no database, no cache, and
 * no log of feed contents. Feed URLs are validated and fetched through the
 * SSRF-hardened fetcher.
 *
 * Request: `{ url, rangeStart?, rangeEnd?, termStart?, termEnd? }`. The
 * range is half-open and defaults to now through now plus 60 days; termStart
 * and termEnd (inclusive ISO dates) additionally scope the pieces to the
 * planning term. Each instant is an ISO 8601 date-time such as
 * `2026-10-14T09:00:00Z` or `2026-10-14T09:00:00-05:00`; a value without an
 * offset is a floating time and reads as America/Chicago. Floating times
 * inside the feed (no TZID, no Z) also read as America/Chicago, or the
 * feed's own `X-WR-TIMEZONE` when it has one.
 *
 * 200 response: `{ url, range, occurrences, skipped }`. Occurrences are
 * `{ date, startMinutes, endMinutes }` — weekday and minutes are derived by
 * the caller, and no event title, location, or description is included. The
 * id is the generic `ev-<number>`; event text never crosses this boundary.
 * `skipped` lists `{ uid, summary, reason }` warnings for events and series
 * left out of the busy picture; a skipped transparent or free event is
 * reported, not silently dropped.
 *
 * Errors: 401 without a session, 400 for a bad body, range, term, or URL, a
 * blocked or invalid feed, or one that does not parse, 502 for an
 * unreachable or slow feed, and 422 with "This calendar has too many events
 * to preview" when the response would be over 1 MiB. The response is never
 * cut short to fit.
 */
async function busyHandler(request: Request) {
  const session = await getServerSession(request);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: BusyBody | null = null;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed === "object" && parsed !== null && "url" in parsed) {
      body = parsed as BusyBody;
    }
  } catch {
    body = null;
  }
  // A generic message only: request details are never echoed back.
  if (body === null || typeof body.url !== "string" || body.url === "") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const range = resolveRange(body.rangeStart, body.rangeEnd);
  if (range === null) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const term = resolveTerm(body.termStart, body.termEnd);
  if (term === null) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!validateCalendarUrl(body.url).ok) {
    return NextResponse.json({ error: "Invalid calendar feed URL" }, { status: 400 });
  }

  let icsText: string;
  try {
    icsText = await fetchCalendarIcs(body.url);
  } catch (error) {
    if (!(error instanceof CalendarFetchError)) throw error;
    const status = error.kind === "unreachable" || error.kind === "timeout" ? 502 : 400;
    return NextResponse.json({ error: "Could not fetch the calendar feed" }, { status });
  }

  let result;
  try {
    result = parseCalendarFeed(icsText, range);
  } catch (error) {
    if (!(error instanceof CalendarParseError)) throw error;
    return NextResponse.json({ error: "Could not parse the calendar feed" }, { status: 400 });
  }
  const json = serializeBusy({
    range,
    occurrences: busyFromFeed(result, term ?? { start: range.start.slice(0, 10), end: range.end.slice(0, 10) }),
    skipped: result.skipped,
  });
  if (json === null) {
    return NextResponse.json({ error: TOO_MANY_EVENTS_MESSAGE }, { status: 422 });
  }
  return new NextResponse(json, { status: 200, headers: { "content-type": "application/json" } });
}

/** The requested range as UTC instants, or now through now plus 60 days; null when malformed. */
function resolveRange(rangeStart: unknown, rangeEnd: unknown): ParseRange | null {
  if (rangeStart === undefined && rangeEnd === undefined) {
    const startMs = Date.now();
    return {
      start: new Date(startMs).toISOString(),
      end: new Date(startMs + DEFAULT_RANGE_DAYS * 86_400_000).toISOString(),
    };
  }
  if (typeof rangeStart !== "string" || typeof rangeEnd !== "string") return null;
  const startMs = parseRangeInstant(rangeStart);
  const endMs = parseRangeInstant(rangeEnd);
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

/** The requested term as inclusive ISO dates; undefined when absent, null when malformed or inverted. */
function resolveTerm(termStart: unknown, termEnd: unknown): { start: string; end: string } | null | undefined {
  if (termStart === undefined && termEnd === undefined) return undefined;
  if (typeof termStart !== "string" || typeof termEnd !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(termStart) || !/^\d{4}-\d{2}-\d{2}$/.test(termEnd)) return null;
  const startMs = Date.parse(`${termStart}T00:00:00Z`);
  const endMs = Date.parse(`${termEnd}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (new Date(startMs).toISOString().slice(0, 10) !== termStart) return null;
  if (new Date(endMs).toISOString().slice(0, 10) !== termEnd) return null;
  if (endMs < startMs) return null;
  return { start: termStart, end: termEnd };
}

export const POST = withRateLimit("calendarFeedBusy", busyHandler);
