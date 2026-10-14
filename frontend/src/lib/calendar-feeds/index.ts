/**
 * Public surface of the calendar-feeds library. Import from this module
 * (or from the specific module when a test needs internals like FetchDeps).
 */

export { fetchCalendarIcs, CALENDAR_MAX_BYTES, type DnsEntry, type FetchDeps } from "./fetch";
export { FLOATING_TIME_ZONE } from "./datetime";
export { parseCalendarFeed } from "./parse";
export { MAX_PREVIEW_RESPONSE_BYTES, serializePreview } from "./preview";
export { isBlockedAddress, validateCalendarUrl } from "./ssrf";
export type {
  CalendarEvent,
  CalendarOccurrence,
  CalendarParseResult,
  ParseRange,
  SkippedEntry,
  WeeklyBusyBlock,
} from "./types";
