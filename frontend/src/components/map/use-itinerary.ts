"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FALLBACK_ROUTE_TTL_MS,
  LOOKUP_FAILURE_TTL_MS,
  ROUTE_FAILURE_TTL_MS,
  createMapDataCache,
  fetchRun,
  lookUpStops,
  lookupSnapshot,
  pairAnswers,
  planLookups,
  planRuns,
  runKey,
  type MapDataCache,
} from "@/lib/map-client-data";
import { buildItinerary, lookupKey, routeRuns, type Itinerary } from "@/lib/map-itinerary";
import type { MapStop } from "@/lib/types";

/** One cache for the browser session, shared by every visit to /map. */
const sessionCache: MapDataCache = createMapDataCache();

function itineraryFrom(stops: MapStop[], cache: MapDataCache): Itinerary {
  const lookups = lookupSnapshot(cache);
  const placed = buildItinerary(stops, lookups, new Map());
  return buildItinerary(stops, lookups, pairAnswers(routeRuns(placed.stops), cache));
}

/**
 * The day's itinerary, filled in as building lookup and routing answer.
 * Changing the day aborts the requests still in flight for the old one.
 */
export function useItinerary(stops: MapStop[]): Itinerary {
  // `revision` re-reads the cache after answers land; `attempt` re-runs the
  // requests once a failure's retry window has passed.
  const [revision, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const stopsKey = useMemo(
    () => stops.map((stop) => `${stop.buildingId ?? ""}|${stop.location}|${stop.lat ?? ""},${stop.lng ?? ""}`).join(";"),
    [stops],
  );

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      const lookups = planLookups(stops, sessionCache, Date.now());
      if (lookups.length > 0) {
        await lookUpStops(lookups, sessionCache, { signal }).catch(() => undefined);
        if (signal.aborted) return;
        setRevision((value) => value + 1);
      }

      const placed = buildItinerary(stops, lookupSnapshot(sessionCache), new Map());
      const runs = planRuns(routeRuns(placed.stops), sessionCache, Date.now());
      if (runs.length > 0) {
        await Promise.all(runs.map((run) => fetchRun(run, sessionCache, { signal }).catch(() => false)));
        if (signal.aborted) return;
        setRevision((value) => value + 1);
      }

      // Come back when something on this day can be asked again: a failure's
      // retry window, or a straight-line answer's expiry.
      const settled = buildItinerary(stops, lookupSnapshot(sessionCache), new Map());
      const settledRuns = routeRuns(settled.stops);
      const waits: number[] = [];
      if (
        stops.some((stop) => sessionCache.lookupFailures.has(lookupKey(stop.location, stop.buildingId))) ||
        settledRuns.some((run) => sessionCache.runFailures.has(runKey(run)))
      ) {
        waits.push(Math.max(LOOKUP_FAILURE_TTL_MS, ROUTE_FAILURE_TTL_MS));
      }
      for (const run of settledRuns) {
        const cached = sessionCache.runs.get(runKey(run));
        if (cached?.legs.some((leg) => leg.source === "fallback")) {
          waits.push(Math.max(0, cached.cachedAt + FALLBACK_ROUTE_TTL_MS - Date.now()));
        }
      }
      if (waits.length > 0) {
        retry = setTimeout(() => setAttempt((value) => value + 1), Math.min(...waits));
      }
    }

    void load();
    return () => {
      controller.abort();
      if (retry) clearTimeout(retry);
    };
    // stopsKey captures every field of `stops` the requests depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, attempt]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => itineraryFrom(stops, sessionCache), [stops, revision]);
}
