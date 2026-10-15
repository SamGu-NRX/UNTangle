/**
 * The JSON body of a busy response: the same size cap as a preview, but
 * occurrences carry only `{ date, startMinutes, endMinutes }` and skipped
 * entries carry only `{ index, reason }`. The serializer drops fields
 * explicitly rather than passing values through, so a future field on the
 * internal occurrence or skipped types cannot leak event text into the
 * response by accident — not the event title, not the UID, and not the feed
 * URL (which a Google secret-address URL carries a private token in).
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

export function serializeBusy(payload: {
  range: { start: string; end: string };
  occurrences: ReadonlyArray<SerializedBusyOccurrence>;
  skipped: ReadonlyArray<{ reason: string }>;
}): string | null {
  const body = {
    range: payload.range,
    occurrences: payload.occurrences.map((piece) => ({
      date: piece.date,
      startMinutes: piece.startMinutes,
      endMinutes: piece.endMinutes,
    })),
    skipped: payload.skipped.map((entry, index) => ({
      index,
      reason: entry.reason,
    })),
  };
  const json = JSON.stringify(body);
  return Buffer.byteLength(json, "utf8") > MAX_BUSY_RESPONSE_BYTES ? null : json;
}
