/**
 * Busy dated occurrences from a parsed feed: the same dated pieces the events
 * API serves, with every title and free-text field dropped, over the term's
 * real date range. The optimizer consumes these as dated blocked times.
 */

import { feedOccurrences, type FeedOccurrence, type ParsedFeed } from "@untangle/core/occurrences";

import { FLOATING_TIME_ZONE } from "./datetime";
import type { CalendarParseResult } from "./types";

/** The inclusive ISO-date range busy times are computed over — the term's real dates. */
export type BusyTermRange = { start: string; end: string };

/** One dated busy piece of one event; carries no title or description. */
export type BusyOccurrence = FeedOccurrence;

/**
 * Expand a parsed feed into busy dated pieces across `termRange`.
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
  return feedOccurrences(parsed, { first: termRange.start, last: termRange.end }, timeZone).filter(
    (piece) => piece.busy,
  );
}
