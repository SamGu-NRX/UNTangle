/**
 * The JSON body of a busy response: the same shape and size cap as a preview,
 * but occurrences carry only `{ date, startMinutes, endMinutes }`. The
 * serializer drops fields explicitly rather than passing values through, so a
 * future field on the internal occurrence type cannot leak event text into
 * the response by accident.
 */

/** Largest busy response body, in bytes: the same 1 MiB as the preview cap. */
export const MAX_BUSY_RESPONSE_BYTES = 1024 * 1024;

/** The JSON text of a busy payload, or null when it is over MAX_BUSY_RESPONSE_BYTES. */
export function serializeBusy(payload: {
  url: string;
  range: { start: string; end: string };
  occurrences: ReadonlyArray<{ date: string; startMinutes: number; endMinutes: number }>;
  skipped: unknown;
}): string | null {
  const body = {
    url: payload.url,
    range: payload.range,
    occurrences: payload.occurrences.map((piece) => ({
      date: piece.date,
      startMinutes: piece.startMinutes,
      endMinutes: piece.endMinutes,
    })),
    skipped: payload.skipped,
  };
  const json = JSON.stringify(body);
  return Buffer.byteLength(json, "utf8") > MAX_BUSY_RESPONSE_BYTES ? null : json;
}
