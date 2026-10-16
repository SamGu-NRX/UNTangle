/**
 * The browser's side of connecting a calendar: check a feed address through
 * the preview route, connect it through the busy route (which returns the
 * address sealed), and refresh a connected calendar from its sealed address.
 *
 * The address the student pastes lives only in memory here. What is kept is
 * the sealed token and the title-free busy slots (ConnectedCalendar); event
 * titles are shown while checking, to pick one event, and are never stored
 * except as the name of the one busy time the student makes from an event.
 */
import { busyFromFeed, OccurrenceBudgetError } from "./busy";
import type { CalendarEvent, CalendarParseResult } from "./types";
import { busyCount, readingOf, weekdayOf, type BusyPiece, type CheckedFeed, type FeedEvent, type FeedProblem, type FeedTerm, type Outcome } from "@/lib/calendar-busy";
import type { ConnectedCalendar, WeekDay } from "@/lib/types";
import { CalendarSchema, MAX_CALENDAR_BUSY_DATES } from "../../../../packages/contracts/src/documents";

export { eventBusyTime, type CheckedFeed, type FeedEvent, type FeedProblem, type FeedTerm, type Outcome } from "@/lib/calendar-busy";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const WEEKDAYS: readonly string[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** The term as the preview route's half-open range: midnight before its first day to midnight after its last, in Denton. */
export function termRange(term: Pick<FeedTerm, "start" | "end">): { rangeStart: string; rangeEnd: string } {
  const dayAfter = new Date(Date.parse(`${term.end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  // A time without an offset reads as America/Chicago (calendar-feeds/datetime.ts).
  return { rangeStart: `${term.start}T00:00:00`, rangeEnd: `${dayAfter}T00:00:00` };
}

async function problemOf(response: Response, route: "preview" | "busy"): Promise<FeedProblem> {
  let code: string | null = null;
  let error: string | null = null;
  try {
    const body = (await response.json()) as { code?: unknown; error?: unknown };
    code = typeof body.code === "string" ? body.code : null;
    error = typeof body.error === "string" ? body.error : null;
  } catch {
    // The status alone says enough.
  }
  if (response.status === 429) return { kind: "busy", message: "Too many calendar checks from this network. Try again in a few minutes." };
  if (response.status === 503 || code === "CALENDARS_UNAVAILABLE") {
    return { kind: "unavailable", message: "Calendars can't be connected right now. Add busy times by hand for now." };
  }
  if (code === "CALENDAR_RECONNECT") return { kind: "reconnect", message: "Paste this calendar's address again to refresh it." };
  if (code === "CALENDAR_SIGN_IN") return { kind: "sign-in", message: "Sign in again to refresh this calendar." };
  if (response.status === 502) return { kind: "unreachable", message: "UNTangle couldn't reach that calendar. Check the address, or try again in a minute." };
  if (response.status === 422) return { kind: "too-big", message: "This calendar has too many events to read. Try a smaller one." };
  if (error === "Invalid calendar feed URL") {
    return { kind: "address", message: "Use the calendar's full address. It starts with https:// and often ends in .ics." };
  }
  if (error === "Could not parse the calendar feed" || error === "Could not fetch the calendar feed") {
    return { kind: "address", message: "That address didn't return a calendar. Copy the iCal or .ics address and try again." };
  }
  return { kind: "unreachable", message: route === "preview" ? "That calendar couldn't be checked. Try again." : "That calendar couldn't be read. Try again." };
}

const OFFLINE: FeedProblem = { kind: "offline", message: "Couldn't reach UNTangle. Check your connection and try again." };

async function post(fetchImpl: FetchLike, path: string, body: unknown): Promise<Response | null> {
  try {
    return await fetchImpl(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  } catch {
    return null;
  }
}

/** Reads a feed over the term, through the preview route: how much busy time it holds, and its events. */
export async function checkFeed(url: string, term: FeedTerm, fetchImpl: FetchLike = globalThis.fetch): Promise<Outcome<CheckedFeed>> {
  const trimmed = url.trim();
  if (!/^https:\/\/\S+$/i.test(trimmed)) {
    return { ok: false, problem: { kind: "address", message: "Use the calendar's full address. It starts with https:// and often ends in .ics." } };
  }
  const response = await post(fetchImpl, "/api/calendar-feeds/preview", { url: trimmed, ...termRange(term) });
  if (!response) return { ok: false, problem: OFFLINE };
  if (!response.ok) return { ok: false, problem: await problemOf(response, "preview") };
  const feed = (await response.json()) as CalendarParseResult;
  // The same pipeline the busy route runs, so the count is what connecting stores.
  let pieces: ReturnType<typeof busyFromFeed>;
  try {
    pieces = busyFromFeed(feed, { start: term.start, end: term.end });
  } catch (error) {
    if (error instanceof OccurrenceBudgetError) return { ok: false, problem: TOO_MANY };
    throw error;
  }
  const summaries = new Map<number, CalendarEvent>(feed.events.map((event) => [event.id, event]));
  const events = pieces
    .filter((piece) => !piece.allDay && WEEKDAYS.includes(weekdayOf(piece.date)))
    .map((piece): FeedEvent => ({
      key: `${piece.eventId}-${piece.date}-${piece.startMinutes}`,
      summary: summaries.get(piece.eventId)?.summary.trim() || "Event",
      date: piece.date,
      day: weekdayOf(piece.date) as WeekDay,
      start: piece.startMinutes,
      end: piece.endMinutes,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  // Counted as connecting stores them: one per slot and date, so two events at one time on one date count once.
  const reading = readingOf(pieces, term);
  if (busyCount(reading) + reading.allDayDates.length > MAX_CALENDAR_BUSY_DATES) return { ok: false, problem: TOO_MANY };
  const allDayEvents = new Set(pieces.filter((piece) => piece.allDay).map((piece) => piece.eventId)).size;
  return { ok: true, value: { busyCount: busyCount(reading), allDayEvents, events } };
}

type BusyResponse = { occurrences: BusyPiece[]; sealedUrl?: string; feedId?: string };

async function readBusy(fetchImpl: FetchLike, body: Record<string, unknown>, term: FeedTerm): Promise<Outcome<BusyResponse>> {
  const response = await post(fetchImpl, "/api/v1/calendar-feeds/busy", { ...body, termStart: term.start, termEnd: term.end });
  if (!response) return { ok: false, problem: OFFLINE };
  if (!response.ok) return { ok: false, problem: await problemOf(response, "busy") };
  return { ok: true, value: (await response.json()) as BusyResponse };
}

const TOO_MANY: FeedProblem = {
  kind: "too-big",
  message: `This calendar has more than ${MAX_CALENDAR_BUSY_DATES.toLocaleString("en-US")} busy times this term, more than UNTangle keeps. Try a smaller one.`,
};

/**
 * The calendar as the preferences document will hold it. A feed that grew
 * past the document's limit is refused here, with words, rather than
 * producing preferences no device can save. Anything else the schema
 * refuses is a bug in this file, so it throws.
 */
function kept(calendar: ConnectedCalendar): Outcome<ConnectedCalendar> {
  if (busyCount(calendar) + calendar.allDayDates.length > MAX_CALENDAR_BUSY_DATES) return { ok: false, problem: TOO_MANY };
  return { ok: true, value: CalendarSchema.parse(calendar) };
}

/** A new calendar id. */
export const newCalendarId = () => `cal-${crypto.randomUUID().slice(0, 18)}`;

/** Connects a feed: its busy time over the term and its address sealed by the server. Nothing is kept yet; the caller saves it. */
export async function connectFeed(
  url: string,
  name: string,
  term: FeedTerm,
  options: { fetchImpl?: FetchLike; id?: string; now?: () => Date; countAllDay?: boolean } = {},
): Promise<Outcome<ConnectedCalendar>> {
  const read = await readBusy(options.fetchImpl ?? globalThis.fetch, { url: url.trim(), seal: true }, term);
  if (!read.ok) return read;
  if (!read.value.sealedUrl || !read.value.feedId) throw new Error("The busy route didn't return the sealed address and feed id it was asked for.");
  return kept({
    id: options.id ?? newCalendarId(),
    name: name.trim().slice(0, 40) || "Calendar",
    sealedUrl: read.value.sealedUrl,
    feedId: read.value.feedId,
    termId: term.id,
    checkedAt: (options.now ?? (() => new Date()))().toISOString(),
    ...readingOf(read.value.occurrences, term),
    countAllDay: options.countAllDay ?? false,
  });
}

/** The calendar read again over `term` from its sealed address. */
export async function refreshCalendar(
  calendar: ConnectedCalendar,
  term: FeedTerm,
  options: { fetchImpl?: FetchLike; now?: () => Date } = {},
): Promise<Outcome<ConnectedCalendar>> {
  const read = await readBusy(options.fetchImpl ?? globalThis.fetch, { sealedUrl: calendar.sealedUrl }, term);
  if (!read.ok) return read;
  return kept({
    ...calendar,
    // The server can hand back a new token: a guest's sealed again with a new issue time, or one sealed for the account that refreshed it.
    sealedUrl: read.value.sealedUrl ?? calendar.sealedUrl,
    termId: term.id,
    checkedAt: (options.now ?? (() => new Date()))().toISOString(),
    ...readingOf(read.value.occurrences, term),
  });
}

/**
 * Ends this browser's guest calendars: the server drops the HttpOnly cookie
 * their tokens are sealed to, so any copy of them opens nothing. Called
 * wherever the app discards a guest's work on this browser. It never throws;
 * a failure leaves the cookie to run out with its tokens' 90 days.
 */
export function forgetGuestCalendars(fetchImpl: FetchLike = globalThis.fetch): Promise<void> {
  return fetchImpl("/api/v1/calendar-feeds/forget", { method: "POST", keepalive: true, cache: "no-store" }).then(
    () => undefined,
    () => undefined,
  );
}
