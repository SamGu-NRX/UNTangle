/** Shared result types for the calendar-feeds library. */

/**
 * One expanded event occurrence. `start` and `end` are ISO 8601 UTC instants;
 * for all-day events they are midnight UTC of the first day and the exclusive
 * end date, so `end - start` is always the event's length.
 */
export type CalendarOccurrence = {
  uid: string;
  summary: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location: string;
  description: string;
};

/**
 * One weekly recurring commitment, in minutes from local midnight in the
 * event's zone. A block never says anything about COUNT or UNTIL; occurrences
 * remain the precise view.
 */
export type WeeklyBusyBlock = {
  uid: string;
  summary: string;
  /** 0 = Sunday through 6 = Saturday. */
  weekday: number;
  startMinutes: number;
  endMinutes: number;
};

/** An event the parser refused. `uid` is null when the event had none. */
export type SkippedEntry = {
  uid: string | null;
  reason: string;
};

/** Half-open parse window; both ends are ISO 8601 UTC instants. */
export type ParseRange = { start: string; end: string };

export type CalendarParseResult = {
  occurrences: CalendarOccurrence[];
  weeklyBusyBlocks: WeeklyBusyBlock[];
  skipped: SkippedEntry[];
};
