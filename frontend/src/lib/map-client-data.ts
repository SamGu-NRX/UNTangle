/**
 * Client side of /map's two lookups: building lookup (/api/map/resolve) and
 * walking routes (/api/map/route), with a session cache.
 *
 * Rules carried over from the PR #11 data layer:
 * - lookup answers are matched to stops by the identity the server echoes
 *   (location + building id), never by array position;
 * - a request that fails, or a lookup the server marks retryable (its
 *   geocoder failed), is remembered only briefly, so an outage can't unmap a
 *   building or erase a route for the rest of the session;
 * - a straight-line fallback answer expires after a minute, so a recovered
 *   router can replace it with a real path;
 * - an aborted request writes nothing, and answers are stored under the key
 *   of the stops they were asked for, so a slow answer for a previous day
 *   can't land on the current one.
 */
import {
  lookupKey,
  pairKey,
  type PairAnswer,
  type StopLookup,
} from "@/lib/map-itinerary";
import type { MapResolvedLocation, MapRouteLeg, MapRoutePoint, MapStop } from "@/lib/types";

export const LOOKUP_FAILURE_TTL_MS = 5_000;
export const ROUTE_FAILURE_TTL_MS = 5_000;
export const FALLBACK_ROUTE_TTL_MS = 60_000;

export type RunPoint = { key: string; point: MapRoutePoint; buildingId?: string };

export type MapDataCache = {
  /** Definitive lookup answers: resolved, or the server said it can't place the stop. */
  lookups: Map<string, Extract<StopLookup, { kind: "resolved" | "unresolved" }>>;
  /** When each failed lookup failed. */
  lookupFailures: Map<string, number>;
  runs: Map<string, { legs: MapRouteLeg[]; cachedAt: number }>;
  runFailures: Map<string, number>;
};

export type FetchOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
};

export function createMapDataCache(): MapDataCache {
  return { lookups: new Map(), lookupFailures: new Map(), runs: new Map(), runFailures: new Map() };
}

function abortError() {
  return new DOMException("The request was aborted", "AbortError");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPoint(value: unknown): value is MapRoutePoint {
  const candidate = value as { lat?: unknown; lng?: unknown } | null;
  return typeof candidate === "object" && candidate !== null && isFiniteNumber(candidate.lat) && isFiniteNumber(candidate.lng);
}

/* ---------- building lookup ---------- */

export function lookupSnapshot(cache: MapDataCache): Map<string, StopLookup> {
  const snapshot = new Map<string, StopLookup>(cache.lookups);
  for (const key of cache.lookupFailures.keys()) {
    if (!snapshot.has(key)) snapshot.set(key, { kind: "failed" });
  }
  return snapshot;
}

/** Stops without coordinates that have no answer yet and aren't waiting out a recent failure. */
export function planLookups(stops: MapStop[], cache: MapDataCache, now: number): MapStop[] {
  const seen = new Set<string>();
  return stops.filter((stop) => {
    if (typeof stop.lat === "number" && typeof stop.lng === "number") return false;
    const key = lookupKey(stop.location, stop.buildingId);
    if (seen.has(key) || cache.lookups.has(key)) return false;
    seen.add(key);
    const failedAt = cache.lookupFailures.get(key);
    return failedAt === undefined || now - failedAt >= LOOKUP_FAILURE_TTL_MS;
  });
}

function parseLookup(value: unknown): Extract<StopLookup, { kind: "resolved" | "unresolved" }> | null {
  const candidate = value as Partial<MapResolvedLocation> | null;
  if (typeof candidate !== "object" || candidate === null || typeof candidate.location !== "string") return null;
  if (typeof candidate.buildingName !== "string" || typeof candidate.shortName !== "string") return null;
  if (candidate.resolutionStatus === "unresolved") {
    // A geocoder outage is not an answer about the building; lookUpStops
    // treats it as a failure that expires.
    if (candidate.retryable === true) return null;
    return { kind: "unresolved", location: candidate as MapResolvedLocation };
  }
  if ((candidate.resolutionStatus === "local" || candidate.resolutionStatus === "geocoded") && isPoint(candidate)) {
    return { kind: "resolved", location: candidate as MapResolvedLocation & { lat: number; lng: number } };
  }
  return null;
}

/**
 * Look up the queued stops and record the answers. A stop with no matching
 * echo is a failure (retried after the TTL), not a guess. Throws on a
 * transport failure after stamping every queued stop as failed; an aborted
 * call throws without writing anything.
 */
export async function lookUpStops(queue: MapStop[], cache: MapDataCache, options: FetchOptions = {}): Promise<void> {
  if (queue.length === 0) return;
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const keys = queue.map((stop) => lookupKey(stop.location, stop.buildingId));
  try {
    const response = await fetchImpl("/api/map/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locations: queue.map((stop) => ({ location: stop.location, buildingId: stop.buildingId })) }),
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`Building lookup returned ${response.status}`);
    const payload = (await response.json().catch(() => null)) as { locations?: unknown } | null;
    if (options.signal?.aborted) throw abortError();
    if (!payload || !Array.isArray(payload.locations)) throw new Error("Building lookup answer is malformed");

    const echoed = new Map<string, Extract<StopLookup, { kind: "resolved" | "unresolved" }>>();
    for (const item of payload.locations) {
      const parsed = parseLookup(item);
      if (!parsed) continue;
      const key = lookupKey(parsed.location.location, parsed.location.buildingId);
      if (!echoed.has(key)) echoed.set(key, parsed);
    }
    for (const key of keys) {
      const answer = echoed.get(key);
      if (answer) {
        cache.lookups.set(key, answer);
        cache.lookupFailures.delete(key);
      } else {
        cache.lookupFailures.set(key, now());
      }
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    for (const key of keys) cache.lookupFailures.set(key, now());
    throw error;
  }
}

/* ---------- walking routes ---------- */

export function runKey(run: RunPoint[]): string {
  return run.map((point) => point.key).join("|");
}

function runIsFresh(entry: { legs: MapRouteLeg[]; cachedAt: number }, now: number): boolean {
  return !entry.legs.some((leg) => leg.source === "fallback") || now - entry.cachedAt < FALLBACK_ROUTE_TTL_MS;
}

/** Runs with no fresh answer that aren't waiting out a recent failure. */
export function planRuns(runs: RunPoint[][], cache: MapDataCache, now: number): RunPoint[][] {
  return runs.filter((run) => {
    const key = runKey(run);
    const cached = cache.runs.get(key);
    if (cached && runIsFresh(cached, now)) return false;
    const failedAt = cache.runFailures.get(key);
    return failedAt === undefined || now - failedAt >= ROUTE_FAILURE_TTL_MS;
  });
}

function parseLeg(value: unknown, pointCount: number): MapRouteLeg | null {
  const leg = value as Partial<MapRouteLeg> | null;
  if (typeof leg !== "object" || leg === null) return null;
  if (!Number.isInteger(leg.fromIndex) || !Number.isInteger(leg.toIndex)) return null;
  const fromIndex = leg.fromIndex as number;
  const toIndex = leg.toIndex as number;
  if (fromIndex < 0 || toIndex !== fromIndex + 1 || toIndex >= pointCount) return null;
  if (!Array.isArray(leg.geometry) || leg.geometry.length < 2 || !leg.geometry.every(isPoint)) return null;
  if (!isFiniteNumber(leg.distanceMeters) || leg.distanceMeters < 0) return null;
  const base = { fromIndex, toIndex, geometry: leg.geometry, distanceMeters: leg.distanceMeters };
  if (leg.source === "fallback") {
    return leg.durationSeconds === null ? { ...base, source: "fallback", durationSeconds: null } : null;
  }
  if ((leg.source === "campus-network" || leg.source === "ors") && isFiniteNumber(leg.durationSeconds) && leg.durationSeconds >= 0) {
    return { ...base, source: leg.source, durationSeconds: leg.durationSeconds };
  }
  return null;
}

/**
 * Route one run and cache its legs. Returns false when routing failed (the
 * caller shows straight lines until the retry). An aborted call throws and
 * writes nothing.
 */
export async function fetchRun(run: RunPoint[], cache: MapDataCache, options: FetchOptions = {}): Promise<boolean> {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const key = runKey(run);
  try {
    const response = await fetchImpl("/api/map/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stops: run.map(({ point, buildingId }) => ({ lat: point.lat, lng: point.lng, ...(buildingId ? { buildingId } : {}) })),
      }),
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`Routing returned ${response.status}`);
    const payload = (await response.json().catch(() => null)) as { legs?: unknown } | null;
    if (options.signal?.aborted) throw abortError();
    const legs = Array.isArray(payload?.legs) ? payload.legs.map((leg) => parseLeg(leg, run.length)) : null;
    // The run was sent with repeats already merged, so the answer must have
    // exactly one valid leg per consecutive pair, in order.
    if (!legs || legs.length !== run.length - 1 || legs.some((leg, index) => !leg || leg.fromIndex !== index)) {
      throw new Error("Routing answer is malformed");
    }
    cache.runs.set(key, { legs: legs as MapRouteLeg[], cachedAt: now() });
    cache.runFailures.delete(key);
    return true;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    cache.runFailures.set(key, now());
    return false;
  }
}

/** Every pair's answer for the given runs. A pair with neither an answer nor a failure is still loading. */
export function pairAnswers(runs: RunPoint[][], cache: MapDataCache): Map<string, PairAnswer> {
  const answers = new Map<string, PairAnswer>();
  for (const run of runs) {
    const key = runKey(run);
    const cached = cache.runs.get(key);
    if (cached) {
      for (const leg of cached.legs) {
        answers.set(pairKey(run[leg.fromIndex].key, run[leg.toIndex].key), leg);
      }
      continue;
    }
    if (cache.runFailures.has(key)) {
      for (let index = 0; index < run.length - 1; index += 1) {
        answers.set(pairKey(run[index].key, run[index + 1].key), "failed");
      }
    }
  }
  return answers;
}

/**
 * How long to wait before asking again for this day's stops and runs, or
 * null when nothing needs asking. A failure waits out its cooldown. A
 * straight-line answer waits for its expiry, unless its re-ask has already
 * failed, in which case the failure's cooldown wins; and anything already due
 * waits one cooldown, so an outage can never spin a zero-delay loop.
 */
export function nextAttemptDelay(stopKeys: string[], runs: RunPoint[][], cache: MapDataCache, now: number): number | null {
  const dueAt: number[] = [];
  for (const key of stopKeys) {
    const failedAt = cache.lookupFailures.get(key);
    if (failedAt !== undefined) dueAt.push(failedAt + LOOKUP_FAILURE_TTL_MS);
  }
  for (const run of runs) {
    const key = runKey(run);
    const failedAt = cache.runFailures.get(key);
    if (failedAt !== undefined) {
      dueAt.push(failedAt + ROUTE_FAILURE_TTL_MS);
      continue;
    }
    const cached = cache.runs.get(key);
    if (cached?.legs.some((leg) => leg.source === "fallback")) dueAt.push(cached.cachedAt + FALLBACK_ROUTE_TTL_MS);
  }
  if (dueAt.length === 0) return null;
  const wait = Math.min(...dueAt) - now;
  return wait > 0 ? wait : ROUTE_FAILURE_TTL_MS;
}
