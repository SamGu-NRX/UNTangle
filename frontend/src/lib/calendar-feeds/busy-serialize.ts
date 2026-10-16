/**
 * The JSON body of a busy response: the same size cap as a preview, but
 * occurrences carry only `{ date, startMinutes, endMinutes, allDay }` and skipped
 * entries carry only `{ index, reason }`. The serializer drops fields
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

export function serializeBusy(payload: {
  range: { start: string; end: string };
  occurrences: ReadonlyArray<SerializedBusyOccurrence & { allDay?: boolean }>;
  skipped: ReadonlyArray<{ reason: string }>;
  /** The feed's address sealed for the caller (lib/calendar-feeds/seal.ts), when the request asked for it. */
  sealedUrl?: string;
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
      reason: entry.reason,
    })),
    ...(payload.sealedUrl ? { sealedUrl: payload.sealedUrl } : {}),
  };
  const json = JSON.stringify(body);
  return Buffer.byteLength(json, "utf8") > MAX_BUSY_RESPONSE_BYTES ? null : json;
}
