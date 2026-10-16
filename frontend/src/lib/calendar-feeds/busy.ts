/**
 * Busy dated occurrences from a parsed feed: the same dated pieces the events
 * API serves, with every title and free-text field dropped, over the term's
 * real date range. The optimizer consumes these as dated blocked times.
 */

import { feedOccurrences, type FeedOccurrence, type ParsedFeed } from "@untangle/core/occurrences";

export { OccurrenceBudgetError } from "@untangle/core/occurrences";

/**
 * Most busy pieces one feed may expand into, checked during expansion so a
 * feed built to expand into millions of pieces (long or overlapping
 * multi-day events) is refused before it costs that work. A connected
 * calendar keeps at most 1,500 busy dates (MAX_CALENDAR_BUSY_DATES), so a
 * feed past 4,000 pieces could never be kept anyway. Expansion costs about
 * 40 microseconds a piece (timed on an Apple M4 Pro, DST-crossing worst
 * case, 2026-10-16): about 0.8 s at the earlier 20,000, about 0.16 s here,
 * which bounds what one anonymous request can make the server do.
 */
export const MAX_BUSY_PIECES = 4_000;

import { FLOATING_TIME_ZONE } from "./datetime";
import type { CalendarParseResult } from "./types";

/** The inclusive ISO-date range busy times are computed over — the term's real dates. */
export type BusyTermRange = { start: string; end: string };

/** One dated busy piece of one event; carries no title or description. */
export type BusyOccurrence = FeedOccurrence;

/**
 * Expand a parsed feed into busy dated pieces across `termRange`. Throws
 * OccurrenceBudgetError past MAX_BUSY_PIECES.
 *
 * This is the occurrence pipeline the events API uses (core's
 * `feedOccurrences`), so recurring series, canceled instances and
 * transparent events behave identically in both places. Only busy pieces
 * survive here.
 */
export function busyFromFeed(
  feed: CalendarParseResult,
  termRange: BusyTermRange,
  timeZone: string = FLOATING_TIME_ZONE,
): BusyOccurrence[] {
  const parsed: ParsedFeed = {
    events: feed.events.map((event) => ({
      id: event.id,
      isAllDay: event.isAllDay,
      transparent: event.transparent,
    })),
    occurrences: feed.occurrences,
  };
  // Transparent events are left out before expanding, so they never count toward the budget.
  const transparent = new Set(feed.events.filter((event) => event.transparent).map((event) => event.id));
  const busyOnly: ParsedFeed = { ...parsed, occurrences: parsed.occurrences.filter((occurrence) => !transparent.has(occurrence.eventId)) };
  return feedOccurrences(busyOnly, { first: termRange.start, last: termRange.end }, timeZone, { maxPieces: MAX_BUSY_PIECES }).filter(
    (piece) => piece.busy,
  );
}
