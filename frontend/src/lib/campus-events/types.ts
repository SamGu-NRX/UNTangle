/**
 * Shared types for the campus-events pipeline: one normalized event shape
 * that every source's adapter produces, the per-source status the API
 * reports, and the class-day input the gap fitter takes.
 */

/**
 * One event, normalized across sources. `buildingId` is set only when the
 * location text matches the campus building catalogue exactly (the whole
 * text, or the part before the first comma, equal to a catalogue name,
 * short name, mnemonic, or alias, case-insensitively); otherwise it is null
 * and `location` keeps the source's raw text. A building is never guessed.
 */
export type NormalizedEvent = {
  /** The id of the source the event came from (see sources.ts). */
  sourceId: string;
  /** The event's page on the host calendar, when the source gave one. */
  url: string | null;
  /** The event title as the source wrote it. */
  title: string;
  /** ISO 8601 UTC instant. */
  start: string;
  /** ISO 8601 UTC instant; for all-day events the exclusive end of the last day. */
  end: string;
  isAllDay: boolean;
  /** The source's raw location text; empty when the source gave none. */
  location: string;
  /** A campus catalogue building id, or null when the location did not match exactly. */
  buildingId: string | null;
  /** Tags from the source (iCalendar CATEGORIES); deduplicated, feed order first. */
  tags: string[];
};

/** One class meeting on the day the gap fitter looks at. */
export type DayClass = {
  /** ISO 8601 UTC instant the class starts. */
  start: string;
  /** ISO 8601 UTC instant the class ends. */
  end: string;
  /** Catalogue building id, or null when the class has no known building. */
  buildingId: string | null;
};

/**
 * One event that fits a gap between two consecutive classes. The walking
 * seconds are null when either endpoint building is unknown, which also
 * means no walking time was counted (never a guessed 0).
 */
export type EventGapPlacement = {
  event: NormalizedEvent;
  /** The gap this event fits: end of the earlier class to start of the later one. */
  gapStart: string;
  gapEnd: string;
  /** Walk from the earlier class's building to the event's building; null when unknown. */
  walkToSeconds: number | null;
  /** Walk from the event's building to the later class's building; null when unknown. */
  walkFromSeconds: number | null;
};

/** Per-source health, reported by the API alongside the events. */
export type SourceStatus = "ok" | "stale" | "error";

export type SourceReport = {
  id: string;
  name: string;
  /** ok: fresh fetch; stale: serving the last good data after a failed refresh; error: never fetched. */
  status: SourceStatus;
  /** When the served data was fetched; null when there is none. */
  fetchedAt: string | null;
  /** How many normalized events the source currently holds. */
  eventCount: number;
  /** The last error message; null when the source is ok. */
  error: string | null;
  /** Set when events from this source were dropped to fit the response budget. */
  note?: string;
};
