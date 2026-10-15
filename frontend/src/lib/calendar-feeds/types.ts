/** Shared result types for the calendar-feeds library. */

/**
 * One event's text and flags, listed once however many times it occurs.
 * Occurrences and busy blocks point here by `id`. A recurrence override
 * (a VEVENT with RECURRENCE-ID) is its own entry, because it can change the
 * summary, location, or description of the one occurrence it replaces.
 */
export type CalendarEvent = {
  /** The entry's index in `events`, starting at 0. */
  id: number;
  /** The feed's UID; null when the event had none. Overrides share their series' UID. */
  uid: string | null;
  summary: string;
  location: string;
  /** At most MAX_DESCRIPTION_CHARS characters; a cut description ends with an ellipsis. */
  description: string;
  /** The event's URL property (typically the event's page on the host calendar); null when absent. */
  url: string | null;
  /** CATEGORIES values, in feed order; empty when the event had none. */
  categories: string[];
  isAllDay: boolean;
  /** TRANSP:TRANSPARENT. The event still occurs but never counts as busy time. */
  transparent: boolean;
};

/**
 * One expanded occurrence. `start` and `end` are ISO 8601 UTC instants; for
 * all-day events they are midnight UTC of the first day and the exclusive end
 * date, so `end - start` is always the occurrence's length.
 */
export type CalendarOccurrence = {
  eventId: number;
  start: string;
  end: string;
  /** STATUS:TENTATIVE reads "tentative"; CONFIRMED, a missing STATUS, and unknown values read "confirmed". */
  status: "confirmed" | "tentative";
};

/**
 * One weekly recurring commitment, in minutes from local midnight in the
 * event's zone. A block never says anything about COUNT or UNTIL; occurrences
 * remain the precise view.
 */
export type WeeklyBusyBlock = {
  eventId: number;
  /** 0 = Sunday through 6 = Saturday. */
  weekday: number;
  startMinutes: number;
  endMinutes: number;
};

/**
 * An event or recurring series the parser refused, as a warning the caller
 * can show. `uid` and `summary` are null when the event had none.
 */
export type SkippedEntry = {
  uid: string | null;
  summary: string | null;
  reason: string;
};

/**
 * Half-open parse window. Each end is an ISO 8601 date-time; one without a
 * UTC offset reads as America/Chicago (see FLOATING_TIME_ZONE).
 */
export type ParseRange = { start: string; end: string };

export type CalendarParseResult = {
  events: CalendarEvent[];
  occurrences: CalendarOccurrence[];
  weeklyBusyBlocks: WeeklyBusyBlock[];
  skipped: SkippedEntry[];
};
