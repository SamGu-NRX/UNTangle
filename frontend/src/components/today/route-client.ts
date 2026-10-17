/**
 * Walk route client — fetch, cache, and normalize walking routes between
 * two campus buildings. The walk card treats "no route available" as a
 * normal state, so every failure path here resolves to a value instead of
 * throwing, and unknown providers degrade to the honest straight-line
 * fallback rather than being presented as a real routing result.
 */
import {
  haversineMeters,
  normalizeRouteResponse,
  type ResolvedPlace,
  type TodayStop,
  type WalkState,
} from "@/components/today/today-engine";
import type { TodayRoute } from "@/components/map/route-types";

const ROUTE_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { route: TodayRoute; savedAt: number };

let cache: Map<string, CacheEntry> | undefined;

function cacheMap(): Map<string, CacheEntry> {
  if (!cache) {
    cache = new Map();
  }
  return cache;
}

export function clearRouteCacheForTests(): void {
  cache = undefined;
}

export function routeCacheKey(from: ResolvedPlace | null, to: ResolvedPlace | null): string {
  const point = (place: ResolvedPlace | null) =>
    place ? `${place.lat.toFixed(6)},${place.lng.toFixed(6)}` : "?";
  return `walk|${point(from)}|${point(to)}`;
}

/** Cached route still fresh enough to show without a network round-trip? */
function freshEnough(entry: CacheEntry, now: number): boolean {
  return now - entry.savedAt < CACHE_TTL_MS;
}

/**
 * Fetch a walking route between two class stops. Cache hits (10-minute TTL,
 * keyed by resolved coordinates) skip the network entirely; everything that
 * goes wrong downstream — timeout, HTTP error, malformed body, network
 * rejection — resolves to { kind: "unavailable" } and is never cached.
 */
export async function fetchWalk(from: TodayStop, to: TodayStop): Promise<WalkState> {
  const key = routeCacheKey(from.place, to.place);
  const now = Date.now();
  const hit = cacheMap().get(key);
  if (hit && freshEnough(hit, now)) {
    return { kind: "loaded", route: hit.route };
  }

  if (!from.place || !to.place) {
    return { kind: "unavailable" };
  }

  try {
    const response = await fetch("/api/map/route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stops: [
          { lat: from.place.lat, lng: from.place.lng },
          { lat: to.place.lat, lng: to.place.lng },
        ],
      }),
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { kind: "unavailable" };
    }
    const route = normalizeRouteResponse(await response.json());
    if (!route) {
      return { kind: "unavailable" };
    }
    cacheMap().set(key, { route, savedAt: Date.now() });
    return { kind: "loaded", route };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * One-line summary for the walk card. Straight-line fallback routes carry
 * no duration claim — the distance is real, the time is not knowable, and
 * the copy must not pretend otherwise.
 */
export function walkSummary(route: TodayRoute): string {
  const km = route.distanceMeters / 1000;
  if (route.source === "fallback") {
    return `about ${km.toFixed(1)} km straight-line`;
  }
  const minutes = Math.max(1, Math.round(route.durationSeconds / 60));
  return `about ${km.toFixed(1)} km, ${minutes} min walk`;
}

/** Estimated walk time for a stop pair when no route fetch is needed. */
export function walkMinutes(from: TodayStop, to: TodayStop): number | null {
  if (!from.place || !to.place) {
    return null;
  }
  const meters = haversineMeters(from.place, to.place);
  return Math.max(1, Math.round(meters / 80));
}
