import { normalizeCampusLocationKey } from "@/lib/campus-locations";
import type { MapResolvedLocation, MapStop } from "@/lib/types";

/*
 * Client-side data layer for /map: resolution and routing fetches with
 * identity-based result matching, short-lived failure memory, and
 * abort/stale-response safety.
 *
 * Invariants (M1):
 * - Resolve results are matched by the echoed `location` + `buildingId`
 *   identity, never by array position.
 * - Hard failures (network, non-OK, malformed payloads) are remembered only
 *   for a short TTL so an outage cannot permanently unmap a building.
 * - Definitive answers (a resolved coordinate, or the server saying
 *   "unresolved") persist for the session.
 * - Aborted or superseded requests write nothing into the caches.
 */

export const RESOLVE_FAILURE_TTL_MS = 5_000;
export const ROUTE_FAILURE_TTL_MS = 5_000;

/**
 * How long a server-said fallback (straight-line estimate) may keep serving a
 * route path. Fallback answers are honest-but-degraded; caching them for the
 * session would let a stale estimate outlive an ORS recovery, so they expire
 * quickly and the next request can upgrade the path to a real answer.
 */
export const FALLBACK_ROUTE_TTL_MS = 60_000;

export type ClientRoute = {
  positions: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  source: "ors" | "fallback";
  /** Epoch ms recorded when the answer entered the cache. */
  cachedAt?: number;
};

export type MapStopLocationKey = string;

export type MapDataCaches = {
  /** Definitive results only: a resolved location, or null for a definitive "unresolved". */
  resolutions: Map<MapStopLocationKey, MapResolvedLocation | null>;
  /** Epoch ms of the last hard resolve failure per key; retried after the TTL. */
  resolveFailures: Map<MapStopLocationKey, number>;
  /** Successful route lookups keyed by the stop coordinate path. */
  routes: Map<string, ClientRoute>;
  /** Epoch ms of the last hard route failure per route key. */
  routeFailures: Map<string, number>;
};

export function createMapDataCaches(): MapDataCaches {
  return {
    resolutions: new Map(),
    resolveFailures: new Map(),
    routes: new Map(),
    routeFailures: new Map(),
  };
}

export type MapDataFetchOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
};

export function stopLocationKey(stop: Pick<MapStop, "location" | "buildingId">): MapStopLocationKey {
  return `${stop.buildingId ?? ""}|${normalizeCampusLocationKey(stop.location)}`;
}

export function routeKeyForStops(stops: Array<{ lat: number; lng: number }>): string {
  return stops.map((stop) => `${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`).join("|");
}

function isAborted(options: MapDataFetchOptions) {
  return options.signal?.aborted === true;
}

export function planResolveQueue(stops: MapStop[], caches: MapDataCaches, now: number): MapStop[] {
  return stops.filter((stop) => {
    if (typeof stop.lat === "number" && typeof stop.lng === "number") {
      return false;
    }

    const key = stopLocationKey(stop);
    if (caches.resolutions.has(key)) {
      return false;
    }

    const failedAt = caches.resolveFailures.get(key);
    if (typeof failedAt === "number" && now - failedAt < RESOLVE_FAILURE_TTL_MS) {
      return false;
    }

    return true;
  });
}

function echoIdentityKey(item: Pick<MapResolvedLocation, "location" | "buildingId">): MapStopLocationKey {
  return `${item.buildingId ?? ""}|${normalizeCampusLocationKey(item.location)}`;
}

function isValidCoordinatePair(value: unknown): value is { lat: number; lng: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { lat?: unknown; lng?: unknown };
  return (
    typeof candidate.lat === "number" &&
    Number.isFinite(candidate.lat) &&
    typeof candidate.lng === "number" &&
    Number.isFinite(candidate.lng)
  );
}

function isValidResolution(value: unknown): value is MapResolvedLocation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<MapResolvedLocation>;
  if (typeof candidate.location !== "string" || candidate.location.length === 0) {
    return false;
  }

  if (candidate.resolutionStatus !== "local" && candidate.resolutionStatus !== "geocoded" && candidate.resolutionStatus !== "unresolved") {
    return false;
  }

  if (candidate.resolutionStatus === "unresolved") {
    return true;
  }

  return isValidCoordinatePair(candidate);
}

/**
 * POST the queued stops to /api/map/resolve and match each echoed result back
 * to the requesting stop by identity. Throws on transport failure so the
 * caller can decide caching; per-stop validation problems surface as null
 * results that are NOT definitive (retryable) instead of corrupted matches.
 */
export type ResolveOutcome = {
  /** One entry per queued stop: the echoed resolution, or null. */
  results: Map<MapStopLocationKey, MapResolvedLocation | null>;
  /** Keys whose echo definitively said "unresolved" — safe to cache. */
  definitiveUnresolved: Set<MapStopLocationKey>;
};

export async function resolveStopLocations(
  queue: MapStop[],
  options: MapDataFetchOptions = {},
): Promise<ResolveOutcome> {
  if (queue.length === 0) {
    return { results: new Map(), definitiveUnresolved: new Set() };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("/api/map/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: queue.map((stop) => ({
        location: stop.location,
        buildingId: stop.buildingId,
      })),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Resolution unavailable (status ${response.status})`);
  }

  const payload = (await response.json().catch(() => null)) as { locations?: unknown } | null;
  if (!payload || !Array.isArray(payload.locations)) {
    throw new Error("Resolution response is malformed");
  }

  const echoedByKey = new Map<MapStopLocationKey, MapResolvedLocation>();
  for (const item of payload.locations) {
    if (!isValidResolution(item)) {
      continue;
    }

    const key = echoIdentityKey(item);
    // First valid echo wins; duplicates for the same identity are ignored.
    if (!echoedByKey.has(key)) {
      echoedByKey.set(key, item);
    }
  }

  const results = new Map<MapStopLocationKey, MapResolvedLocation | null>();
  const definitiveUnresolved = new Set<MapStopLocationKey>();
  for (const stop of queue) {
    const key = stopLocationKey(stop);
    const echo = echoedByKey.get(key);

    if (!echo) {
      // No trustworthy echo for this stop: treat as a retryable miss, not a
      // definitive answer.
      results.set(key, null);
      continue;
    }

    if (echo.resolutionStatus === "unresolved") {
      // Definitive answer from the server: cache it so we do not re-ask.
      results.set(key, null);
      definitiveUnresolved.add(key);
      continue;
    }

    results.set(key, echo);
  }

  return { results, definitiveUnresolved };
}

/**
 * Resolve every stop that needs coordinates and merge the outcome into the
 * caches. Returns the definitive snapshot for ALL requested stops (not just
 * the queued ones). Throws on hard failure after stamping the failure TTL;
 * aborted calls rethrow without touching the caches.
 */
export async function resolveStopsWithCache(
  stops: MapStop[],
  caches: MapDataCaches,
  options: MapDataFetchOptions = {},
): Promise<Record<MapStopLocationKey, MapResolvedLocation | null>> {
  const now = options.now ?? Date.now;
  const queue = planResolveQueue(stops, caches, now());

  if (queue.length === 0) {
    return Object.fromEntries(caches.resolutions);
  }

  try {
    const { results, definitiveUnresolved } = await resolveStopLocations(queue, options);

    if (isAborted(options)) {
      throw new DOMException("Aborted", "AbortError");
    }

    for (const stop of queue) {
      const key = stopLocationKey(stop);
      const result = results.get(key);

      if (result === undefined) {
        continue;
      }

      if (result === null) {
        if (definitiveUnresolved.has(key)) {
          caches.resolutions.set(key, null);
        } else {
          // Validation miss: retryable, stamped with the failure TTL.
          caches.resolveFailures.set(key, now());
        }
        continue;
      }

      caches.resolutions.set(key, result);
      caches.resolveFailures.delete(key);
    }

    return Object.fromEntries(caches.resolutions);
  } catch (error) {
    if (isAborted(options)) {
      throw error;
    }

    for (const stop of queue) {
      caches.resolveFailures.set(stopLocationKey(stop), now());
    }
    throw error;
  }
}

/**
 * Fetch a walking route for the stop path. Returns the cached or fetched
 * route, or null when routing is unavailable right now (the caller should use
 * its uncached fallback). Only server responses are cached — a client-side
 * fallback is computed fresh each time so an outage recovers on its own.
 * ORS answers persist for the session; a server-said fallback answer is
 * cached only for FALLBACK_ROUTE_TTL_MS so an ORS recovery upgrades the path
 * instead of being blocked by a stale estimate.
 */
export async function fetchRouteWithCache(
  stops: Array<{ lat: number; lng: number }>,
  caches: MapDataCaches,
  options: MapDataFetchOptions = {},
): Promise<ClientRoute | null> {
  if (stops.length < 2) {
    return null;
  }

  const now = options.now ?? Date.now;
  const key = routeKeyForStops(stops);

  const cached = caches.routes.get(key);
  if (cached) {
    const fresh =
      cached.source === "ors" || now() - (cached.cachedAt ?? now()) < FALLBACK_ROUTE_TTL_MS;

    if (fresh) {
      return cached;
    }

    // A stale fallback answer must not block the upgrade the next request
    // can deliver; drop it and re-ask.
    caches.routes.delete(key);
  }

  const failedAt = caches.routeFailures.get(key);
  if (typeof failedAt === "number" && now() - failedAt < ROUTE_FAILURE_TTL_MS) {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl("/api/map/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stops: stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`Route unavailable (status ${response.status})`);
    }

    const payload = (await response.json().catch(() => null)) as {
      geometry?: unknown;
      distanceMeters?: unknown;
      durationSeconds?: unknown;
      source?: unknown;
    } | null;

    if (isAborted(options)) {
      throw new DOMException("Aborted", "AbortError");
    }

    const geometry = Array.isArray(payload?.geometry) ? payload.geometry : null;
    const distance = payload?.distanceMeters;
    const duration = payload?.durationSeconds;
    const source = payload?.source;

    if (
      !geometry ||
      geometry.length < 2 ||
      !geometry.every(isValidCoordinatePair) ||
      typeof distance !== "number" ||
      !Number.isFinite(distance) ||
      typeof duration !== "number" ||
      !Number.isFinite(duration) ||
      (source !== "ors" && source !== "fallback")
    ) {
      throw new Error("Route response is malformed");
    }

    const route: ClientRoute = {
      positions: geometry.map((point) => [point.lat, point.lng]),
      distanceMeters: distance,
      durationSeconds: duration,
      source,
    };

    caches.routes.set(key, { ...route, cachedAt: now() });
    caches.routeFailures.delete(key);
    return route;
  } catch (error) {
    if (isAborted(options)) {
      throw error;
    }

    caches.routeFailures.set(key, now());
    return null;
  }
}
