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
import {
  buildItinerary,
  lookupKey,
  placementKey,
  pointKey,
  routeBetween,
  routeRuns,
  type Itinerary,
  type ItineraryStop,
  type LegRoute,
  type RunPoint,
  type StartPlace,
} from "@/lib/map-itinerary";
import { isShuttleLeg } from "@/lib/planner-walking";
import type { MapRoutePoint, MapStop } from "@/lib/types";
import type { GapEvent, GapRow } from "@/components/map/gap-events";

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

/**
 * A selected gap event as the map draws it: its pin, and the walks there from
 * the class before and on to the class after, drawn like the day's own walks.
 */
export type EventDetour = {
  key: string;
  /** Null when the event has no building on the map: no pin, nothing to frame. */
  point: MapRoutePoint | null;
  legs: { key: string; route: LegRoute }[];
  /** The two classes' pins, so a framing keeps both ends in view. */
  ends: MapRoutePoint[];
  /** False while either class's building is still being looked up, so the camera waits and moves once. */
  settled: boolean;
};

function classPoint(entry: ItineraryStop): RunPoint | null {
  const { placement } = entry;
  return placement.kind === "mapped" ? { key: placementKey(placement), point: placement.point, buildingId: placement.buildingId } : null;
}

/**
 * The walks to route for a gap event: from the class before and to the class
 * after, each only when both ends are on the map and it isn't the shuttle.
 */
function detourRuns(row: GapRow, event: GapEvent): { there: RunPoint[] | null; back: RunPoint[] | null } {
  const { place } = event;
  if (place.kind !== "building" || place.point === null) return { there: null, back: null };
  const at: RunPoint = { key: pointKey(place.point, place.buildingId), point: place.point, buildingId: place.buildingId };
  const walk = (from: RunPoint | null, to: RunPoint | null): RunPoint[] | null =>
    from && to && from.key !== to.key && !isShuttleLeg(from.buildingId, to.buildingId) ? [from, to] : null;
  return { there: walk(classPoint(row.from), at), back: walk(at, classPoint(row.to)) };
}

/** The selected gap event's pin and walks, routed through the same session cache as the day. */
export function useEventDetour(selected: { row: GapRow; event: GapEvent } | null): EventDetour | null {
  const [revision, setRevision] = useState(0);
  const runs = useMemo(() => (selected ? detourRuns(selected.row, selected.event) : { there: null, back: null }), [selected]);
  const wanted = [runs.there, runs.back].filter((run): run is RunPoint[] => run !== null);
  const runsKey = wanted.map((run) => run.map((point) => point.key).join("|")).join(";");

  useEffect(() => {
    const planned = planRuns(wanted, sessionCache, Date.now());
    if (planned.length === 0) return;
    const controller = new AbortController();
    void Promise.all(planned.map((run) => fetchRun(run, sessionCache, { signal: controller.signal }).catch(() => false))).then(() => {
      if (!controller.signal.aborted) setRevision((value) => value + 1);
    });
    return () => controller.abort();
    // runsKey captures every point of `wanted`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runsKey]);

  return useMemo(() => {
    if (!selected) return null;
    const { row, event } = selected;
    const answers = pairAnswers(wanted, sessionCache);
    const legs = (["there", "back"] as const).flatMap((side) => {
      const run = runs[side];
      return run ? [{ key: `${event.key}>${side}`, route: routeBetween(run[0], run[1], answers) }] : [];
    });
    const ends = [row.from, row.to].flatMap((entry) => (entry.placement.kind === "mapped" ? [entry.placement.point] : []));
    const settled = row.from.placement.kind !== "resolving" && row.to.placement.kind !== "resolving";
    return { key: event.key, point: event.place.kind === "building" ? event.place.point : null, legs, ends, settled };
    // `revision` re-reads the cache; runsKey stands for `wanted`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, runs, runsKey, revision]);
}
