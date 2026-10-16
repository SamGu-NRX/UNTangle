/**
 * The JSON body of a busy response: the same size cap as a preview, but
 * occurrences carry only `{ date, startMinutes, endMinutes, allDay }` and skipped
 * entries carry only `{ index, reason }`, where `reason` is a fixed code
 * (SKIP_CODES), never the parser's text. The serializer drops fields
 * explicitly rather than passing values through, so a future field on the
 * internal occurrence or skipped types cannot leak event text into the
 * response by accident — not the event title, not the UID, and not the feed
 * URL (which a Google secret-address URL carries a private token in). The
 * one form of the address it may carry is the sealed token the caller asked
 * for, which only this server can open.
 */

/** Largest busy response body, in bytes: the same 1 MiB as the preview cap. */
export const MAX_BUSY_RESPONSE_BYTES = 1024 * 1024;

/**
 * One occurrence in the busy route's 200 response: exactly the wire shape, so
 * a consumer can pass parsed route data straight to the planner. Carries no
 * event text.
 */
export type SerializedBusyOccurrence = {
  /** Inclusive ISO calendar date (America/Chicago) the piece falls on. */
  date: string;
  /** Wall-clock minutes after local midnight, 0 <= startMinutes < endMinutes <= 1440. */
  startMinutes: number;
  endMinutes: number;
};

/**
 * One piece as the busy route sends it: the occurrence, and whether it came
 * from an all-day event. A connected calendar keeps all-day pieces apart and
 * counts them as busy only when the student says so (lib/calendar-busy.ts),
 * since all-day entries are mostly deadlines, holidays and reminders.
 */
export type SerializedBusyPiece = SerializedBusyOccurrence & { allDay: boolean };

/**
 * Why an event was left out, as one of a fixed set of codes. The parser's
 * own reasons quote values from the feed (a TZID, a VALUE parameter), and a
 * feed controls those, so they could carry an address, a token or event text
 * into the response. Only the fixed parts of the reason are matched, and only
 * a code from this list is ever sent.
 */
export const SKIP_CODES = [
  "budget",
  "unsupported-duration",
  "unsupported-rdate",
  "unsupported-rrule",
  "unsupported-range",
  "unmatched-override",
  "shared-uid",
  "missing-start",
  "year-out-of-bounds",
  "unknown-time-zone",
  "invalid-date",
  "unsupported",
] as const;
export type SkipCode = (typeof SKIP_CODES)[number];

export function skipCode(reason: string): SkipCode {
  if (reason.endsWith("budget exceeded")) return "budget";
  if (reason.startsWith("DURATION is not supported")) return "unsupported-duration";
  if (reason === "RDATE is not supported" || reason.endsWith("with its own RRULE or RDATE is not supported")) return "unsupported-rdate";
  if (reason === "unsupported or malformed RRULE") return "unsupported-rrule";
  if (reason.startsWith("RECURRENCE-ID with RANGE=")) return "unsupported-range";
  if (reason === "RECURRENCE-ID override has no matching recurring event") return "unmatched-override";
  if (reason === "several events share this UID and it has RECURRENCE-ID overrides") return "shared-uid";
  if (reason === "event has no DTSTART") return "missing-start";
  if (reason.startsWith("event dates fall outside the years")) return "year-out-of-bounds";
  if (reason.includes("unknown time zone")) return "unknown-time-zone";
  if (/(malformed|VALUE=|out of range|did not resolve|not an iCalendar)/.test(reason)) return "invalid-date";
  return "unsupported";
}

export function serializeBusy(payload: {
  range: { start: string; end: string };
  occurrences: ReadonlyArray<SerializedBusyOccurrence & { allDay?: boolean }>;
  skipped: ReadonlyArray<{ reason: string }>;
  /** The feed's address sealed for the caller (lib/calendar-feeds/seal.ts), when the request asked for it. */
  sealedUrl?: string;
  /** A keyed fingerprint of the address (seal.ts, feedIdOf), when it was sealed. */
  feedId?: string;
}): string | null {
  const body = {
    range: payload.range,
    occurrences: payload.occurrences.map((piece) => ({
      date: piece.date,
      startMinutes: piece.startMinutes,
      endMinutes: piece.endMinutes,
      allDay: piece.allDay === true,
    })),
    skipped: payload.skipped.map((entry, index) => ({
      index,
      reason: skipCode(entry.reason),
    })),
    ...(payload.sealedUrl ? { sealedUrl: payload.sealedUrl } : {}),
    ...(payload.feedId ? { feedId: payload.feedId } : {}),
  };
  const json = JSON.stringify(body);
  return Buffer.byteLength(json, "utf8") > MAX_BUSY_RESPONSE_BYTES ? null : json;
}
