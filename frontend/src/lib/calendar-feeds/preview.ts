/**
 * The size limit on a serialized preview response. Event text appears once
 * in the event table, so a feed under the 1 MiB fetch cap only crosses this
 * limit by expanding into many occurrences or busy blocks.
 */

/**
 * Largest preview response body, in bytes: the same 1 MiB as the feed body
 * cap. There is no measurement behind it; it bounds what one request can
 * make the server serialize and send.
 */
export const MAX_PREVIEW_RESPONSE_BYTES = 1024 * 1024;

/** The error message the preview route returns when the response would be over the limit. */
export const TOO_MANY_EVENTS_MESSAGE = "This calendar has too many events to preview";

/** The JSON text of a preview payload, or null when it is over MAX_PREVIEW_RESPONSE_BYTES. */
export function serializePreview(payload: unknown): string | null {
  const json = JSON.stringify(payload);
  return Buffer.byteLength(json, "utf8") > MAX_PREVIEW_RESPONSE_BYTES ? null : json;
}
