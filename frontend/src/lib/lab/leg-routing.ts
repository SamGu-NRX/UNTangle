import { normalizeCampusLocationKey } from "@/lib/campus-locations";
import type { MapStop } from "@/lib/types";

export type WalkingRouteSource = "ors" | "campus-network";
export type LegRouteSource = WalkingRouteSource | "fallback";

export type LabLegStatus = "same-building" | "walking" | "approximate" | "unresolved";

export type LabLeg = {
  from: MapStop;
  to: MapStop;
  status: LabLegStatus;
  /** Raw backend source; null when no route request applied. */
  source: LegRouteSource | null;
  geometry: Array<{ lat: number; lng: number }>;
  distanceMeters: number;
  /** null = never present a time for this leg. */
  durationSeconds: number | null;
};

export type DayLegSummary = {
  walkingLegs: number;
  approximateLegs: number;
  sameBuildingLegs: number;
  unresolvedLegs: number;
  totalDistanceMeters: number;
  knownWalkingSeconds: number | null;
};

const FALLBACK_CACHE_TTL_MS = 60_000;
const legCache = new Map<string, { leg: LabLeg; at: number; stable: boolean }>();
let clock = () => Date.now();

export function setLabLegClock(next: () => number) {
  clock = next;
}

export function resetLabLegCache() {
  legCache.clear();
}

/** The route contract: only known walking sources are trusted; everything else is fallback. */
export function normalizeLegSource(value: unknown): LegRouteSource {
  return value === "ors" || value === "campus-network" ? value : "fallback";
}

function positionOf(stop: MapStop): { lat: number; lng: number } | null {
  return typeof stop.lat === "number" && typeof stop.lng === "number"
    ? { lat: stop.lat, lng: stop.lng }
    : null;
}

function campusKey(stop: MapStop): string {
  return normalizeCampusLocationKey(stop.buildingId ?? stop.location);
}

function sameBuilding(a: MapStop, b: MapStop): boolean {
  const key = campusKey(a);
  return key.length > 0 && key === campusKey(b);
}

function pairKey(a: { lat: number; lng: number }, b: { lat: number; lng: number }): string {
  return `${a.lat.toFixed(6)},${a.lng.toFixed(6)}|${b.lat.toFixed(6)},${b.lng.toFixed(6)}`;
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const earthRadiusMeters = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

function fallbackLeg(
  from: MapStop,
  to: MapStop,
  fromPos: { lat: number; lng: number },
  toPos: { lat: number; lng: number },
): LabLeg {
  return {
    from,
    to,
    status: "approximate",
    source: "fallback",
    geometry: [fromPos, toPos],
    distanceMeters: haversineMeters(fromPos, toPos),
    durationSeconds: null,
  };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type FetchDayLegsOptions = { fetchImpl?: FetchLike };
export type DayLegsResult = { legs: LabLeg[]; requestsMade: number };

export async function fetchDayLegs(
  stops: MapStop[],
  options: FetchDayLegsOptions = {},
): Promise<DayLegsResult> {
  const doFetch = options.fetchImpl ?? fetch;
  let requestsMade = 0;
  const legs: LabLeg[] = [];

  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index];
    const to = stops[index + 1];
    const fromPos = positionOf(from);
    const toPos = positionOf(to);

    if (!fromPos || !toPos) {
      legs.push({ from, to, status: "unresolved", source: null, geometry: [], distanceMeters: 0, durationSeconds: null });
      continue;
    }

    if (sameBuilding(from, to)) {
      legs.push({ from, to, status: "same-building", source: null, geometry: [fromPos, toPos], distanceMeters: 0, durationSeconds: null });
      continue;
    }

    const key = pairKey(fromPos, toPos);
    const cached = legCache.get(key);
    if (cached && (cached.stable || clock() - cached.at < FALLBACK_CACHE_TTL_MS)) {
      legs.push(cached.leg);
      continue;
    }

    requestsMade += 1;
    try {
      const response = await doFetch("/api/map/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stops: [
            { lat: fromPos.lat, lng: fromPos.lng },
            { lat: toPos.lat, lng: toPos.lng },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Route request failed: ${response.status}`);
      }
      const payload = (await response.json()) as {
        geometry?: Array<{ lat: number; lng: number }>;
        distanceMeters?: number;
        durationSeconds?: number;
        source?: string;
      };
      const source = normalizeLegSource(payload.source);
      const leg: LabLeg = {
        from,
        to,
        status: source === "fallback" ? "approximate" : "walking",
        source,
        geometry:
          Array.isArray(payload.geometry) && payload.geometry.length >= 2
            ? payload.geometry
            : [fromPos, toPos],
        distanceMeters:
          typeof payload.distanceMeters === "number" ? payload.distanceMeters : haversineMeters(fromPos, toPos),
        durationSeconds:
          source === "fallback" || typeof payload.durationSeconds !== "number" ? null : payload.durationSeconds,
      };
      legCache.set(key, { leg, at: clock(), stable: source !== "fallback" });
      legs.push(leg);
    } catch {
      const leg = fallbackLeg(from, to, fromPos, toPos);
      legCache.set(key, { leg, at: clock(), stable: false });
      legs.push(leg);
    }
  }

  return { legs, requestsMade };
}

export function summarizeDayLegs(legs: LabLeg[]): DayLegSummary {
  const summary: DayLegSummary = {
    walkingLegs: 0,
    approximateLegs: 0,
    sameBuildingLegs: 0,
    unresolvedLegs: 0,
    totalDistanceMeters: 0,
    knownWalkingSeconds: null,
  };
  let knownSeconds = 0;
  let anyDurationKnown = false;
  legs.forEach((leg) => {
    summary.totalDistanceMeters += leg.distanceMeters;
    if (leg.status === "walking") {
      summary.walkingLegs += 1;
      if (leg.durationSeconds !== null) {
        knownSeconds += leg.durationSeconds;
        anyDurationKnown = true;
      }
    } else if (leg.status === "approximate") {
      summary.approximateLegs += 1;
    } else if (leg.status === "same-building") {
      summary.sameBuildingLegs += 1;
    } else {
      summary.unresolvedLegs += 1;
    }
  });
  if (summary.walkingLegs > 0) {
    summary.knownWalkingSeconds = anyDurationKnown ? knownSeconds : null;
  }
  return summary;
}
