/**
 * Busy dated occurrences from a parsed feed: the same dated pieces the events
 * API serves, with every title and free-text field dropped, over the term's
 * real date range. The optimizer consumes these as dated blocked times.
 */

import { feedOccurrences, type FeedOccurrence, type ParsedFeed } from "@untangle/core/occurrences";

export { OccurrenceBudgetError } from "@untangle/core/occurrences";

/**
 * Most busy pieces one feed may expand into. A busy response near the 1 MiB
 * cap holds about 15,000 pieces, so past this the response would be refused
 * anyway; checking during expansion refuses a feed built to expand into
 * millions of pieces (long or overlapping multi-day events) before it costs
 * that work. No measurement of real feeds is behind the exact number.
 */
export const MAX_BUSY_PIECES = 20_000;

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
