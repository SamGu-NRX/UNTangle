import { NextResponse } from "next/server";

import { getServerSession } from "@/lib/auth-server";
import { withRateLimit } from "@/lib/rate-limit/server";
import { calendarDateOfInstant, parseRangeInstant, zoneWallTime, FLOATING_TIME_ZONE } from "@/lib/calendar-feeds/datetime";
import { CalendarFetchError, CalendarParseError } from "@/lib/calendar-feeds/errors";
import { fetchCalendarIcs } from "@/lib/calendar-feeds/fetch";
import { parseCalendarFeed } from "@/lib/calendar-feeds/parse";
import { busyFromFeed, OccurrenceBudgetError, type BusyOccurrence } from "@/lib/calendar-feeds/busy";
import { serializeBusy } from "@/lib/calendar-feeds/busy-serialize";
import { TOO_MANY_EVENTS_MESSAGE } from "@/lib/calendar-feeds/preview";
import {
  feedKeyFromEnv,
  FeedSealError,
  guestCookie,
  guestIdFrom,
  newGuestId,
  openFeedToken,
  sealFeedUrl,
  tokenKind,
} from "@/lib/calendar-feeds/seal";
import { validateCalendarUrl } from "@/lib/calendar-feeds/ssrf";
import type { ParseRange } from "@/lib/calendar-feeds/types";

// node:dns needs the Node runtime; the Edge runtime has no DNS resolver.
export const runtime = "nodejs";

/** The default busy window without a term: now through now plus 60 days. */
const DEFAULT_RANGE_DAYS = 60;

/**
 * The widest range or term the route reads: a little over a year, wide
 * enough for any academic term or a whole year's plan, and narrow enough
 * that a long all-day event can't expand into centuries of pieces. A
 * starting value; nothing is measured behind it.
 */
const MAX_RANGE_DAYS = 400;

type BusyBody = {
  url?: unknown;
  sealedUrl?: unknown;
  seal?: unknown;
  rangeStart?: unknown;
  rangeEnd?: unknown;
  termStart?: unknown;
  termEnd?: unknown;
};

/**
 * Returns the title-free busy pieces a feed contributes to the planner's
 * dated blocked times. Nothing is stored anywhere: no database, no cache, and
 * no log of feed contents. Feed URLs are validated and fetched through the
 * SSRF-hardened fetcher.
 *
 * Guests may call it too, counted by address: a guest keeps connected
 * calendars on the device (docs/architecture/README.md, "Guests").
 *
 * Request: `{ url | sealedUrl, seal?, rangeStart?, rangeEnd?, termStart?,
 * termEnd? }`. `sealedUrl` is a token this route returned earlier for the
 * same account (for a guest, the same browser: its HttpOnly guest cookie),
 * and refreshes a connected calendar without its address ever leaving the
 * server again. A guest's refresh, and a guest token sent by a student who
 * signed in on that browser, come back sealed again as `sealedUrl`. `seal:
 * true` with a `url` adds `sealedUrl` to the response, sealed for the caller
 * (lib/calendar-feeds/seal.ts); for a guest the response sets the guest
 * cookie when the browser has none. The
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
 * 200 response: `{ range, occurrences, skipped }`, plus `sealedUrl` when
 * asked to seal. Occurrences are
 * `{ date, startMinutes, endMinutes, allDay }` — weekday and minutes are
 * derived by the caller, `allDay` marks a piece of an all-day event, and no
 * event title, location, or description is included;
 * event text never crosses this boundary. `skipped` lists `{ index, reason }`
 * warnings for events and series left out of the busy picture, `reason`
 * being a fixed code (SKIP_CODES in busy-serialize.ts), never feed text; a skipped
 * transparent or free event is reported, not silently dropped.
 *
 * Errors: 400 for a bad body, range, term, or URL (a range or term over 400
 * days included), a blocked or invalid feed, or one that does not parse, 502
 * for an unreachable or slow feed, and 422 with "This calendar has too many
 * events to preview" when the feed expands past MAX_BUSY_PIECES or the
 * response would be over 1 MiB. The response is never
 * cut short to fit. A sealed address this server can't open for the caller
 * answers 422 with code `CALENDAR_RECONNECT`, or, without a session, 401
 * with code `CALENDAR_SIGN_IN`; with no sealing key
 * configured, sealing or opening answers 503 with code
 * `CALENDARS_UNAVAILABLE`.
 */
async function busyHandler(request: Request) {
  const session = await getServerSession(request);
  const userId = session?.user?.id ?? null;
  // The browser's guest id, from its HttpOnly cookie: what a guest's token is sealed to.
  const cookieGuest = guestIdFrom(request.headers.get("cookie"));

  let body: BusyBody | null = null;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      body = parsed as BusyBody;
    }
  } catch {
    body = null;
  }
  // A generic message only: request details are never echoed back.
  const plain = typeof body?.url === "string" && body.url !== "";
  const sealed = typeof body?.sealedUrl === "string" && body.sealedUrl !== "";
  if (body === null || plain === sealed || (body.seal !== undefined && typeof body.seal !== "boolean") || (body.seal && !plain)) {
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
  // A pasted address is checked before it is sealed, so a token never holds one the fetcher refuses.
  if (plain && !validateCalendarUrl(body.url as string).ok) {
    return NextResponse.json({ error: "Invalid calendar feed URL" }, { status: 400 });
  }
  let url: string;
  let sealedUrl: string | undefined;
  // Set when this response names the browser's guest id: a new one, or the same one with its lifetime renewed.
  let guestId: string | null = null;
  try {
    const key = sealed || body.seal ? feedKeyFromEnv() : null;
    if (sealed) {
      const opened = openForCaller(body.sealedUrl as string, userId, cookieGuest, key);
      url = opened.url;
      sealedUrl = opened.sealedUrl;
      guestId = opened.guestId;
    } else {
      url = body.url as string;
      if (body.seal) {
        if (userId) sealedUrl = sealFeedUrl(url, { kind: "user", id: userId }, key);
        else {
          guestId = cookieGuest ?? newGuestId();
          sealedUrl = sealFeedUrl(url, { kind: "guest", id: guestId }, key);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof FeedSealError)) throw error;
    if (error.kind === "not-configured") {
      return NextResponse.json({ error: "Calendars can't be connected on this server", code: "CALENDARS_UNAVAILABLE" }, { status: 503 });
    }
    // Without a session, an account's token most likely means the session ended: signing in again opens it,
    // while pasting the address as a guest would seal it for the wrong owner.
    if (!userId && tokenKind(body.sealedUrl as string) === "user") {
      return NextResponse.json({ error: "Sign in to refresh this calendar", code: "CALENDAR_SIGN_IN" }, { status: 401 });
    }
    return NextResponse.json({ error: "Connect this calendar again", code: "CALENDAR_RECONNECT" }, { status: 422 });
  }
  if (!validateCalendarUrl(url).ok) {
    return NextResponse.json({ error: "Invalid calendar feed URL" }, { status: 400 });
  }

  let icsText: string;
  try {
    icsText = await fetchCalendarIcs(url);
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
  let pieces: BusyOccurrence[];
  try {
    pieces = clipToRange(busyFromFeed(result, term ?? { start: zonedDateOf(range.start), end: zonedDateOf(range.end) }), range);
  } catch (error) {
    if (!(error instanceof OccurrenceBudgetError)) throw error;
    return NextResponse.json({ error: TOO_MANY_EVENTS_MESSAGE }, { status: 422 });
  }
  const json = serializeBusy({
    range,
    occurrences: pieces,
    skipped: result.skipped,
    sealedUrl,
  });
  if (json === null) {
    return NextResponse.json({ error: TOO_MANY_EVENTS_MESSAGE }, { status: 422 });
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (guestId) headers["set-cookie"] = guestCookie(guestId);
  return new NextResponse(json, { status: 200, headers });
}

/**
 * The address in a sealed token, for whoever is asking, and the token to keep
 * from here on.
 *
 * - An account's token opens for its account only.
 * - A guest's token opens only on the browser it was sealed to (the request
 *   carries that browser's guest cookie), within its lifetimes. A guest's
 *   refresh hands back a fresh token with the same first issue time, so the
 *   90-day lifetime holds however often it is refreshed.
 * - A signed-in student on that same browser may hold a guest token, carried
 *   over from guest preferences at sign-in. It opens with the cookie, within
 *   its lifetimes, and comes back sealed for the account. A copy of the
 *   token sent from any other browser opens for nobody.
 */
function openForCaller(
  token: string,
  userId: string | null,
  cookieGuest: string | null,
  key: Buffer | null,
): { url: string; sealedUrl?: string; guestId: string | null } {
  if (tokenKind(token) === "user") {
    if (!userId) throw new FeedSealError("unreadable");
    return { url: openFeedToken(token, { kind: "user", id: userId }, key).url, guestId: null };
  }
  if (!cookieGuest) throw new FeedSealError("unreadable");
  const guest = { kind: "guest" as const, id: cookieGuest };
  const opened = openFeedToken(token, guest, key);
  if (userId) return { url: opened.url, sealedUrl: sealFeedUrl(opened.url, { kind: "user", id: userId }, key), guestId: null };
  return { url: opened.url, sealedUrl: sealFeedUrl(opened.url, guest, key, Date.now(), opened.firstIssued), guestId: cookieGuest };
}

/**
 * Each piece cut to the half-open range, dropping pieces left empty. The
 * pieces cover whole local dates of the term, so an event straddling either
 * end of the range would otherwise come back uncut. Pieces are local
 * (America/Chicago) dates and minutes, so the range ends are compared as
 * local dates and minutes too.
 */
function clipToRange(pieces: BusyOccurrence[], range: ParseRange): BusyOccurrence[] {
  const local = (instant: string) => {
    const wall = zoneWallTime(Date.parse(instant), FLOATING_TIME_ZONE);
    return { date: zonedDateOf(instant), minutes: wall.hour * 60 + wall.minute };
  };
  const from = local(range.start);
  const to = local(range.end);
  return pieces.flatMap((piece) => {
    if (piece.date < from.date || piece.date > to.date) return [];
    const startMinutes = piece.date === from.date ? Math.max(piece.startMinutes, from.minutes) : piece.startMinutes;
    const endMinutes = piece.date === to.date ? Math.min(piece.endMinutes, to.minutes) : piece.endMinutes;
    return startMinutes < endMinutes ? [{ ...piece, startMinutes, endMinutes }] : [];
  });
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
 * The requested range as UTC instants; null when malformed, wider than
 * MAX_RANGE_DAYS, or when a term is given and the range does not cover it, since the parse drops every
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
  if (endMs - startMs > MAX_RANGE_DAYS * 86_400_000) return null;
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
  if (endMs - startMs >= MAX_RANGE_DAYS * 86_400_000) return null;
  return { start: termStart, end: termEnd };
}

export const POST = withRateLimit("calendarFeedBusy", busyHandler);
