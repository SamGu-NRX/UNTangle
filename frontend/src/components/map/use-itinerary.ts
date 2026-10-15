"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createMapDataCache,
  fetchRun,
  lookUpStops,
  lookupSnapshot,
  nextAttemptDelay,
  pairAnswers,
  planLookups,
  planRuns,
  type MapDataCache,
} from "@/lib/map-client-data";
import { buildItinerary, lookupKey, routeRuns, type Itinerary, type StartPlace } from "@/lib/map-itinerary";
import type { MapStop } from "@/lib/types";

/** One cache for the browser session, shared by every visit to Day. */
const sessionCache: MapDataCache = createMapDataCache();

function itineraryFrom(stops: MapStop[], start: StartPlace | null, cache: MapDataCache): Itinerary {
  const lookups = lookupSnapshot(cache);
  const placed = buildItinerary(stops, lookups, new Map());
  return buildItinerary(stops, lookups, pairAnswers(routeRuns(placed.stops, start), cache), start);
}

/**
 * The day's itinerary, filled in as building lookup and routing answer.
 * Changing the day or the starting point aborts the requests still in
 * flight for the old one.
 */
export function useItinerary(stops: MapStop[], start: StartPlace | null): Itinerary {
  // `revision` re-reads the cache after answers land; `attempt` re-runs the
  // requests once a failure's retry window has passed.
  const [revision, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const stopsKey = useMemo(
    // Dates decide which pairs meet in the same weeks, and so which walks are routed.
    () =>
      stops
        .map((stop) => `${stop.buildingId ?? ""}|${stop.location}|${stop.lat ?? ""},${stop.lng ?? ""}|${stop.dates?.start ?? ""}-${stop.dates?.end ?? ""}`)
        .join(";"),
    [stops],
  );
  const startKey = start ? `${start.point.lat},${start.point.lng}` : "";

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
      const runs = planRuns(routeRuns(placed.stops, start), sessionCache, Date.now());
      if (runs.length > 0) {
        await Promise.all(runs.map((run) => fetchRun(run, sessionCache, { signal }).catch(() => false)));
        if (signal.aborted) return;
        setRevision((value) => value + 1);
      }

      // Come back when something on this day can be asked again.
      const settled = buildItinerary(stops, lookupSnapshot(sessionCache), new Map());
      const delay = nextAttemptDelay(
        stops.map((stop) => lookupKey(stop.location, stop.buildingId)),
        routeRuns(settled.stops, start),
        sessionCache,
        Date.now(),
      );
      if (delay !== null) {
        retry = setTimeout(() => setAttempt((value) => value + 1), delay);
      }
    }

    void load();
    return () => {
      controller.abort();
      if (retry) clearTimeout(retry);
    };
    // stopsKey and startKey capture every field of `stops` and `start` the requests depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, startKey, attempt]);

  // `revision` re-reads the cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => itineraryFrom(stops, start, sessionCache), [stops, start, revision]);
}
