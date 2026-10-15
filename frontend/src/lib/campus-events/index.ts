/**
 * Public surface of the campus-events library: the allowed UNT event
 * sources, the ICS adapter, deduplication, the gap fitter, the TTL cache,
 * and the /api/v1/events handler.
 */

export { DEFAULT_SOURCE_INTERVAL_MS, loadEventSources, sourceIdForUrl, type EventSourceDef } from "./sources";
export { defaultAdapterDeps, fetchSourceEvents, normalizeIcsFeed, type AdapterDeps } from "./adapter";
export { resolveEventBuilding } from "./buildings";
export { DEDUPE_START_WINDOW_MS, dedupeEvents, normalizeEventTitle, placeKey } from "./dedupe";
export { eventsInGaps } from "./gaps";
export { EventSourceCache, defaultCacheDeps, type CacheDeps } from "./cache";
export {
  MAX_EVENTS_IN_RESPONSE,
  MAX_RANGE_DAYS,
  MAX_RESPONSE_BYTES,
  eventsHandler,
  parseEventsQuery,
  serializeEventsResponse,
  type EventsHandlerDeps,
  type EventsQuery,
  type EventsResponse,
} from "./handler";
export type { DayClass, EventGapPlacement, NormalizedEvent, SourceReport, SourceStatus } from "./types";
