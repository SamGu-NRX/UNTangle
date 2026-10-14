import { NextResponse } from "next/server";

import { getServerSession } from "@/lib/auth-server";
import { withRateLimit } from "@/lib/rate-limit/server";
import { parseRangeInstant } from "@/lib/calendar-feeds/datetime";
import { CalendarFetchError, CalendarParseError } from "@/lib/calendar-feeds/errors";
import { fetchCalendarIcs } from "@/lib/calendar-feeds/fetch";
import { parseCalendarFeed } from "@/lib/calendar-feeds/parse";
import { serializePreview, TOO_MANY_EVENTS_MESSAGE } from "@/lib/calendar-feeds/preview";
import { validateCalendarUrl } from "@/lib/calendar-feeds/ssrf";
import type { ParseRange } from "@/lib/calendar-feeds/types";

// node:dns needs the Node runtime; the Edge runtime has no DNS resolver.
export const runtime = "nodejs";

/** The default preview window: now through now plus 60 days. */
const DEFAULT_RANGE_DAYS = 60;

type PreviewBody = { url: unknown; rangeStart?: unknown; rangeEnd?: unknown };

/**
 * Previews what a calendar feed would contribute to the planner. Nothing is
 * stored anywhere: no database, no cache, and no log of feed contents. Feed
 * URLs are validated and fetched through the SSRF-hardened fetcher.
 *
 * Request: `{ url, rangeStart?, rangeEnd? }`. The range is half-open and
 * defaults to now through now plus 60 days. Each end is an ISO 8601
 * date-time such as `2026-10-14T09:00:00Z` or `2026-10-14T09:00:00-05:00`; a
 * value without an offset is a floating time and reads as America/Chicago.
 * Floating times inside the feed (no TZID, no Z) also read as
 * America/Chicago.
 *
 * 200 response: `{ url, range, events, occurrences, weeklyBusyBlocks,
 * skipped }`. Each event's text (`summary`, `location`, `description`, the
 * last capped at 2,000 characters) appears once in `events`, with `uid`,
 * `isAllDay`, and `transparent`. Occurrences are `{ eventId, start, end,
 * status }` and busy blocks are `{ eventId, weekday, startMinutes,
 * endMinutes }`, both pointing into `events` by id. `skipped` lists
 * `{ uid, summary, reason }` warnings for events and series left out.
 *
 * Errors: 401 without a session, 400 for a bad body, range, or URL, a
 * blocked or invalid feed, or one that does not parse, 502 for an
 * unreachable or slow feed, and 422 with "This calendar has too many events
 * to preview" when the response would be over 1 MiB. The response is never
 * cut short to fit.
 */
async function previewHandler(request: Request) {
  const session = await getServerSession(request);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PreviewBody | null = null;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed === "object" && parsed !== null && "url" in parsed) {
      body = parsed as PreviewBody;
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
  const json = serializePreview({ url: body.url, range, ...result });
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

export const POST = withRateLimit("calendarFeedPreview", previewHandler);
