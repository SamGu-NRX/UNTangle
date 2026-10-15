import { NextResponse } from "next/server";

import { getServerSession } from "@/lib/auth-server";
import { withRateLimit } from "@/lib/rate-limit/server";
import { calendarDateOfInstant, parseRangeInstant, FLOATING_TIME_ZONE } from "@/lib/calendar-feeds/datetime";
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

/** The default busy window without a term: now through now plus 60 days. */
const DEFAULT_RANGE_DAYS = 60;

type BusyBody = { url: unknown; rangeStart?: unknown; rangeEnd?: unknown; termStart?: unknown; termEnd?: unknown };

/**
 * Returns the title-free busy pieces a feed contributes to the planner's
 * dated blocked times. Nothing is stored anywhere: no database, no cache, and
 * no log of feed contents. Feed URLs are validated and fetched through the
 * SSRF-hardened fetcher.
 *
 * Request: `{ url, rangeStart?, rangeEnd?, termStart?, termEnd? }`. The
 * range is half-open. termStart and termEnd (inclusive ISO dates) scope the
 * pieces to the planning term; with a term and no range, the range is the
 * whole term in America/Chicago, and a given range must cover the term.
 * Without either, the range is now through now plus 60 days. Each instant
 * is an ISO 8601 date-time such as
 * `2026-10-14T09:00:00Z` or `2026-10-14T09:00:00-05:00`; a value without an
 * offset is a floating time and reads as America/Chicago. Floating times
 * inside the feed (no TZID, no Z) also read as America/Chicago, or the
 * feed's own `X-WR-TIMEZONE` when it has one.
 *
 * 200 response: `{ range, occurrences, skipped }`. Occurrences are
 * `{ date, startMinutes, endMinutes }` — weekday and minutes are derived by
 * the caller, and no event title, location, or description is included;
 * event text never crosses this boundary. `skipped` lists `{ index, reason }`
 * warnings for events and series left out of the busy picture; a skipped
 * transparent or free event is reported, not silently dropped.
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
  const term = resolveTerm(body.termStart, body.termEnd);
  if (term === null) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const range = resolveRange(body.rangeStart, body.rangeEnd, term);
  if (range === null) {
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
    occurrences: busyFromFeed(result, term ?? { start: zonedDateOf(range.start), end: zonedDateOf(range.end) }),
    skipped: result.skipped,
  });
  if (json === null) {
    return NextResponse.json({ error: TOO_MANY_EVENTS_MESSAGE }, { status: 422 });
  }
  return new NextResponse(json, { status: 200, headers: { "content-type": "application/json" } });
}

/**
 * The instant's calendar date in the floating zone (America/Chicago), not UTC:
 * a 02:00Z range start is the previous evening in Denton, and the fallback
 * term window must not start a day late.
 */
function zonedDateOf(instant: string): string {
  const epochMs = parseRangeInstant(instant);
  if (epochMs === null) return instant.slice(0, 10);
  const date = calendarDateOfInstant(epochMs, FLOATING_TIME_ZONE);
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${String(date.year).padStart(4, "0")}-${month}-${day}`;
}

/**
 * The requested range as UTC instants; null when malformed, or when a term is
 * given and the range does not cover it, since the parse drops every
 * occurrence outside the range. Without a range: the term's own window, else
 * now through now plus 60 days.
 */
function resolveRange(rangeStart: unknown, rangeEnd: unknown, term: { start: string; end: string } | undefined): ParseRange | null {
  const window = term ? termWindow(term) : undefined;
  if (window === null) return null;
  if (rangeStart === undefined && rangeEnd === undefined) {
    if (window) return { start: new Date(window.startMs).toISOString(), end: new Date(window.endMs).toISOString() };
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
  if (window && (startMs > window.startMs || endMs < window.endMs)) return null;
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

/**
 * The term as a half-open range: midnight at its start to midnight after its
 * end, in America/Chicago. Null when that falls outside what the range parser
 * reads, such as the day after 9999-12-31.
 */
function termWindow(term: { start: string; end: string }): { startMs: number; endMs: number } | null {
  const dayAfterEnd = new Date(Date.parse(`${term.end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  // parseRangeInstant reads a time without an offset as America/Chicago.
  const startMs = parseRangeInstant(`${term.start}T00:00:00`);
  const endMs = parseRangeInstant(`${dayAfterEnd}T00:00:00`);
  return startMs === null || endMs === null ? null : { startMs, endMs };
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
