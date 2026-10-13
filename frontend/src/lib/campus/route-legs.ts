/**
 * Turns an ordered list of stops into walking legs, one per consecutive pair.
 *
 * Each leg tries the campus walkway graph first. A stop that names a
 * registry building starts or ends at that building's anchor, the same
 * walkway node the walking-time matrix uses, so a leg's minutes match
 * getWalkingSeconds for the pair. A leg the graph cannot connect tries the
 * optional external router (OpenRouteService, only when a key is set) and
 * otherwise becomes a straight-line fallback: distance only, no time. An
 * engine that throws (bad request data) counts as no campus route.
 */
import { haversineMetersBetween, type LatLng } from "@/lib/campus/geo";
import type { CampusEngine } from "@/lib/campus/engine";
import type { MapRouteLeg, MapRouteResponse, MapRouteSource } from "@/lib/types";

export type RouteStopInput = LatLng & { buildingId?: string };

export type ExternalLeg = { geometry: LatLng[]; distanceMeters: number; durationSeconds: number };
export type ExternalRouter = (from: LatLng, to: LatLng) => Promise<ExternalLeg | null>;

function point(value: LatLng): LatLng {
  return { lat: value.lat, lng: value.lng };
}

/**
 * When two stops are the same place: the same building (if named) at the
 * same coordinates to 6 decimals. The server and the map client both use
 * this rule, so they always agree on how many legs a day has.
 */
export function stopIdentity(stop: LatLng, buildingId?: string): string {
  return `${buildingId ?? ""}@${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`;
}

/** Engine calls run on request data; one that throws becomes "no campus route", not a failed request. */
function safely<T>(call: () => T): T | null {
  try {
    return call();
  } catch {
    return null;
  }
}

export async function buildRouteLegs(
  stops: RouteStopInput[],
  engine: CampusEngine,
  external?: ExternalRouter,
): Promise<MapRouteLeg[]> {
  const legs: MapRouteLeg[] = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const fromStop = stops[index];
    const toStop = stops[index + 1];
    const indexes = { fromIndex: index, toIndex: index + 1 };

    // A repeated stop (two classes in one place) is a zero-minute leg, so
    // every pair of stops keeps its own leg and index.
    if (stopIdentity(fromStop, fromStop.buildingId) === stopIdentity(toStop, toStop.buildingId)) {
      legs.push({
        ...indexes,
        source: "campus-network",
        geometry: [point(fromStop), point(toStop)],
        distanceMeters: 0,
        durationSeconds: 0,
      });
      continue;
    }

    const from = (fromStop.buildingId && safely(() => engine.anchorFor(fromStop.buildingId!))) || point(fromStop);
    const to = (toStop.buildingId && safely(() => engine.anchorFor(toStop.buildingId!))) || point(toStop);

    const campus = safely(() => engine.routeBetweenPoints(from, to));
    if (campus) {
      legs.push({
        ...indexes,
        source: "campus-network",
        geometry: campus.geometry.map(point),
        distanceMeters: campus.distanceMeters,
        durationSeconds: campus.durationSeconds,
      });
      continue;
    }

    const routed = external ? await external(from, to).catch(() => null) : null;
    if (routed) {
      legs.push({ ...indexes, source: "ors", ...routed, geometry: routed.geometry.map(point) });
      continue;
    }

    legs.push({
      ...indexes,
      source: "fallback",
      geometry: [point(fromStop), point(toStop)],
      distanceMeters: Math.round(haversineMetersBetween(fromStop, toStop) * 10) / 10,
      durationSeconds: null,
    });
  }
  return legs;
}

const certainty: Record<MapRouteSource, number> = { "campus-network": 0, ors: 1, fallback: 2 };

/** Whole-route totals. The time is null as soon as one leg has no time. */
export function summarizeRoute(legs: MapRouteLeg[]): MapRouteResponse {
  if (legs.length === 0) {
    throw new Error("summarizeRoute needs at least one leg");
  }
  const geometry = legs.flatMap((leg, index) => (index === 0 ? leg.geometry : leg.geometry.slice(1)));
  const distanceMeters = Math.round(legs.reduce((total, leg) => total + leg.distanceMeters, 0) * 10) / 10;
  let durationSeconds: number | null = 0;
  for (const leg of legs) {
    durationSeconds = durationSeconds === null || leg.durationSeconds === null ? null : durationSeconds + leg.durationSeconds;
  }
  const source = legs.reduce<MapRouteSource>(
    (least, leg) => (certainty[leg.source] > certainty[least] ? leg.source : least),
    "campus-network",
  );
  return { legs, geometry, distanceMeters, durationSeconds, source };
}
