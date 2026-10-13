import { NextResponse } from "next/server";
import { activeCampus } from "@/lib/campus/config";
import { campusEngine } from "@/lib/campus/engine";
import type { LatLng } from "@/lib/campus/geo";
import { buildRouteLegs, summarizeRoute, type ExternalLeg, type RouteStopInput } from "@/lib/campus/route-legs";
import { SlidingWindowRateLimiter, TtlLruCache, clientIpFromRequest } from "@/lib/map-cache";

export const runtime = "nodejs";

const maxStops = 12;
const maxBuildingIdLength = 32;

const failureTtlMs = 5 * 60 * 1000;
const rateLimitWindowMs = 60 * 1000;
const rateLimitMaxRequests = 60;

/** OpenRouteService legs only; campus-network legs are computed locally and cheap to redo. */
const orsLegCache = new TtlLruCache<ExternalLeg | null>({
  maxEntries: 200,
  ttlMs: 6 * 60 * 60 * 1000,
  failureTtlMs,
});
const limiter = new SlidingWindowRateLimiter({
  windowMs: rateLimitWindowMs,
  maxRequests: rateLimitMaxRequests,
});

type RouteInput = {
  stops?: Array<{
    lat?: unknown;
    lng?: unknown;
    buildingId?: unknown;
  }>;
};

type OrsRouteFeature = {
  geometry?: {
    coordinates?: [number, number][];
  };
  properties?: {
    summary?: {
      distance?: number;
      duration?: number;
    };
  };
};

function insideCampus(point: LatLng) {
  const { north, south, east, west } = activeCampus.bounds;
  return point.lat >= south && point.lat <= north && point.lng >= west && point.lng <= east;
}

function samePoint(a: LatLng, b: LatLng) {
  return Math.abs(a.lat - b.lat) < 0.00001 && Math.abs(a.lng - b.lng) < 0.00001;
}

type ParsedStops = {
  stops: RouteStopInput[];
  /** For each merged stop, the first and last request index it stands for. */
  firstIndex: number[];
  lastIndex: number[];
};

function parseStops(input: RouteInput): ParsedStops | { error: string } {
  if (!Array.isArray(input.stops)) {
    return { error: "stops must be an array" };
  }

  if (input.stops.length > maxStops) {
    return { error: `Cannot route more than ${maxStops} stops` };
  }

  const stops: RouteStopInput[] = [];
  const firstIndex: number[] = [];
  const lastIndex: number[] = [];
  for (const [requestIndex, raw] of input.stops.entries()) {
    const lat = typeof raw?.lat === "number" ? raw.lat : Number.NaN;
    const lng = typeof raw?.lng === "number" ? raw.lng : Number.NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { error: "All stops must include numeric lat and lng values" };
    }
    if (!insideCampus({ lat, lng })) {
      return { error: `All stops must be within ${activeCampus.name} routing bounds` };
    }
    if (
      raw.buildingId !== undefined &&
      (typeof raw.buildingId !== "string" || raw.buildingId.length === 0 || raw.buildingId.length > maxBuildingIdLength)
    ) {
      return { error: "buildingId, when given, must be a short non-empty string" };
    }
    const stop: RouteStopInput = { lat, lng, ...(raw.buildingId ? { buildingId: raw.buildingId as string } : {}) };
    // Consecutive repeats are one stop: there is no walk between them.
    if (stops.length === 0 || !samePoint(stops[stops.length - 1], stop)) {
      stops.push(stop);
      firstIndex.push(requestIndex);
    }
    lastIndex[stops.length - 1] = requestIndex;
  }

  if (stops.length < 2) {
    return { error: "At least two distinct stops are required" };
  }

  return { stops, firstIndex, lastIndex };
}

function orsRouter(apiKey: string) {
  return async (from: LatLng, to: LatLng): Promise<ExternalLeg | null> => {
    const key = `${from.lat.toFixed(6)},${from.lng.toFixed(6)}|${to.lat.toFixed(6)},${to.lng.toFixed(6)}`;
    const cached = orsLegCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    let leg: ExternalLeg | null = null;
    try {
      const response = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {
        method: "POST",
        headers: {
          Accept: "application/json, application/geo+json",
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ],
          instructions: false,
          preference: "recommended",
        }),
        cache: "no-store",
      });
      if (response.ok) {
        const payload = (await response.json()) as { features?: OrsRouteFeature[] };
        const feature = payload.features?.[0];
        const geometry = (feature?.geometry?.coordinates ?? [])
          .map(([lng, lat]) => ({ lat, lng }))
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && insideCampus(p));
        const distanceMeters = feature?.properties?.summary?.distance;
        const durationSeconds = feature?.properties?.summary?.duration;
        if (
          geometry.length >= 2 &&
          typeof distanceMeters === "number" &&
          Number.isFinite(distanceMeters) &&
          typeof durationSeconds === "number" &&
          Number.isFinite(durationSeconds)
        ) {
          leg = { geometry, distanceMeters, durationSeconds };
        }
      }
    } catch {
      leg = null;
    }

    orsLegCache.set(key, leg, { failure: leg === null });
    return leg;
  };
}

/**
 * POST { stops: [{ lat, lng, buildingId? }] } -> MapRouteResponse.
 *
 * Every consecutive pair becomes a leg on the offline campus walkway graph
 * (source "campus-network"). No network calls and no key are needed for
 * that. A leg the graph refuses goes to OpenRouteService only when
 * ORS_API_KEY is set, and otherwise is a straight-line fallback with a
 * distance and no walking time.
 */
export async function POST(request: Request) {
  const limit = limiter.check(clientIpFromRequest(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: RouteInput;

  try {
    body = (await request.json()) as RouteInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "stops must be an array" }, { status: 400 });
  }

  const parsed = parseStops(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const apiKey = process.env.ORS_API_KEY;
  const legs = await buildRouteLegs(parsed.stops, campusEngine(activeCampus.id), apiKey ? orsRouter(apiKey) : undefined);
  // Report leg ends in the caller's own indexes, not the merged list's.
  const requestLegs = legs.map((leg) => ({
    ...leg,
    fromIndex: parsed.lastIndex[leg.fromIndex],
    toIndex: parsed.firstIndex[leg.toIndex],
  }));
  return NextResponse.json(summarizeRoute(requestLegs));
}
