/**
 * Public surface of the calendar-feeds library. Import from this module
 * (or from the specific module when a test needs internals like FetchDeps).
 */

export { fetchCalendarIcs, CALENDAR_MAX_BYTES, type DnsEntry, type FetchDeps } from "./fetch";
export { parseCalendarFeed } from "./parse";
export { isBlockedAddress, validateCalendarUrl } from "./ssrf";
export type {
  CalendarOccurrence,
  CalendarParseResult,
  ParseRange,
  SkippedEntry,
  WeeklyBusyBlock,
} from "./types";
