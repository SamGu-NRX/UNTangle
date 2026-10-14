import { NextResponse } from "next/server";

import { getServerSession } from "@/lib/auth-server";
import { withRateLimit } from "@/lib/rate-limit/server";
import { CalendarFetchError, CalendarParseError } from "@/lib/calendar-feeds/errors";
import { fetchCalendarIcs } from "@/lib/calendar-feeds/fetch";
import { parseCalendarFeed } from "@/lib/calendar-feeds/parse";
import { validateCalendarUrl } from "@/lib/calendar-feeds/ssrf";
import type { ParseRange } from "@/lib/calendar-feeds/types";

// node:dns needs the Node runtime; the Edge runtime has no DNS resolver.
export const runtime = "nodejs";

/** The default preview window: now through now plus 60 days. */
const DEFAULT_RANGE_DAYS = 60;

type PreviewBody = { url: unknown; rangeStart?: unknown; rangeEnd?: unknown };

/**
 * Previews what a calendar feed would contribute to the planner: occurrences
 * and weekly busy blocks over a range. Nothing is stored anywhere: no
 * database, no cache, and no log of feed contents. Feed URLs are validated
 * and fetched through the SSRF-hardened fetcher.
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
  return NextResponse.json({ url: body.url, range, ...result });
}

/** The requested range, or now through now plus 60 days; null when malformed. */
function resolveRange(rangeStart: unknown, rangeEnd: unknown): ParseRange | null {
  if (rangeStart === undefined && rangeEnd === undefined) {
    const startMs = Date.now();
    return {
      start: new Date(startMs).toISOString(),
      end: new Date(startMs + DEFAULT_RANGE_DAYS * 86_400_000).toISOString(),
    };
  }
  if (typeof rangeStart !== "string" || typeof rangeEnd !== "string") return null;
  const startMs = Date.parse(rangeStart);
  const endMs = Date.parse(rangeEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

export const POST = withRateLimit("calendarFeedPreview", previewHandler);
