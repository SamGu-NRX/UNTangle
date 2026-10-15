/**
 * GET /api/v1/events — one normalized, deduplicated list of UNT campus
 * events. Query: `from` and `to` (required, ISO 8601 date-times, at most 14
 * days apart), `building` (optional catalogue building id, exact), `q`
 * (optional case-insensitive substring over title and location). The
 * response carries the events plus a status report per source; one failing
 * source degrades its own report instead of failing the response.
 */

import { withRateLimit } from "@/lib/rate-limit/server";
import { EventSourceCache, defaultCacheDeps } from "@/lib/campus-events/cache";
import { eventsHandler } from "@/lib/campus-events/handler";
import { loadEventSources } from "@/lib/campus-events/sources";

// node:dns needs the Node runtime; the Edge runtime has no DNS resolver.
export const runtime = "nodejs";

/** One shared per-process cache; feeds refresh at most once per interval. */
const sharedCache = new EventSourceCache(loadEventSources(), defaultCacheDeps);

function get(request: Request): Promise<Response> {
  return eventsHandler(request, { cache: sharedCache });
}

export const GET = withRateLimit("campusEvents", get);
