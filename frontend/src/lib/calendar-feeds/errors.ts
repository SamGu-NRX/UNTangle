/**
 * Feed-level errors. Per-event problems never throw; they become `skipped`
 * entries in the parse result.
 */

/** The document is not a calendar at all, or the caller's range is unusable. */
export class CalendarParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarParseError";
  }
}

/** Why a feed could not be fetched. The kind decides the preview route's status code. */
export type CalendarFetchErrorKind = "blocked" | "invalid" | "unreachable" | "timeout";

export class CalendarFetchError extends Error {
  readonly kind: CalendarFetchErrorKind;

  constructor(kind: CalendarFetchErrorKind, message: string) {
    super(message);
    this.name = "CalendarFetchError";
    this.kind = kind;
  }
}
