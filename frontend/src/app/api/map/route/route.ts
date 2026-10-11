import { NextResponse } from "next/server";
import { isInsideUntBounds } from "@/lib/campus-locations";
import { routeBetweenPoints } from "@/lib/campus/graph";
import { SlidingWindowRateLimiter, TtlLruCache, clientIpFromRequest } from "@/lib/map-cache";
import type { MapRoutePoint, MapRouteResponse } from "@/lib/types";

export const runtime = "nodejs";

const maxStops = 12;

const failureTtlMs = 5 * 60 * 1000;
const rateLimitWindowMs = 60 * 1000;
const rateLimitMaxRequests = 60;

const routeCache = new TtlLruCache<MapRouteResponse>({
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

function samePoint(a: MapRoutePoint, b: MapRoutePoint) {
  return Math.abs(a.lat - b.lat) < 0.00001 && Math.abs(a.lng - b.lng) < 0.00001;
}

function collapseConsecutiveStops(stops: MapRoutePoint[]) {
  return stops.filter((stop, index) => index === 0 || !samePoint(stop, stops[index - 1]));
}

function cacheKey(stops: MapRoutePoint[]) {
  return stops.map((stop) => `${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`).join("|");
}

function haversineMeters(a: MapRoutePoint, b: MapRoutePoint) {
  const earthRadiusMeters = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

function fallbackRoute(stops: MapRoutePoint[]) {
  return {
    geometry: stops,
    distanceMeters: stops.reduce(
      (total, stop, index) => total + (index === 0 ? 0 : haversineMeters(stops[index - 1], stop)),
      0,
    ),
    durationSeconds: 0,
    source: "fallback",
  } satisfies MapRouteResponse;
}

function parseStops(input: RouteInput) {
  if (!Array.isArray(input.stops)) {
    return { error: "stops must be an array" };
  }

  if (input.stops.length > maxStops) {
    return { error: `Cannot route more than ${maxStops} stops` };
  }

  const stops = input.stops.map((stop) => ({
    lat: typeof stop.lat === "number" ? stop.lat : Number.NaN,
    lng: typeof stop.lng === "number" ? stop.lng : Number.NaN,
  }));

  if (stops.some((stop) => !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng))) {
    return { error: "All stops must include numeric lat and lng values" };
  }

  if (stops.some((stop) => !isInsideUntBounds(stop))) {
    return { error: "All stops must be within UNT main campus bounds" };
  }

  const collapsed = collapseConsecutiveStops(stops);
  if (collapsed.length < 2) {
    return { error: "At least two distinct stops are required" };
  }

  return { stops: collapsed };
}

/**
 * Offline walkway routing (source: "walkway"): each consecutive stop pair is
 * routed over the committed OSM walkway graph (A*, steps-aware durations).
 * No network calls, no API key. Returns null when any leg cannot be routed on
 * the graph, letting the caller fall back to ORS, then straight-line.
 */
function walkwayRoute(stops: MapRoutePoint[]): MapRouteResponse | null {
  const geometry: MapRoutePoint[] = [];
  let distanceMeters = 0;
  let durationSeconds = 0;

  for (let index = 0; index < stops.length - 1; index += 1) {
    const leg = routeBetweenPoints(stops[index], stops[index + 1]);
    if (!leg) return null;
    const points = index === 0 ? leg.geometry : leg.geometry.slice(1);
    for (const point of points) {
      geometry.push({ lat: point.lat, lng: point.lng });
    }
    distanceMeters += leg.distanceMeters;
    durationSeconds += leg.durationSeconds;
  }

  if (geometry.length < 2) return null;
  return { geometry, distanceMeters, durationSeconds, source: "walkway" };
}

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

  const parsed = parseStops(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Primary: the offline campus walkway graph. It is campus-tuned (steps and
  // crossings included), needs no external service, and its data covers the
  // same bounds parseStops enforces. ORS below is only a safety net for legs
  // the graph refuses; the straight-line fallback stays the last resort.
  const walkway = walkwayRoute(parsed.stops);
  if (walkway) {
    return NextResponse.json(walkway);
  }

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(fallbackRoute(parsed.stops));
  }

  const key = cacheKey(parsed.stops);
  const cached = routeCache.get(key);
  if (cached) {
    return NextResponse.json(cached);
  }

  let response: Response;
  try {
    response = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {
      method: "POST",
      headers: {
        Accept: "application/json, application/geo+json",
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates: parsed.stops.map((stop) => [stop.lng, stop.lat]),
        instructions: false,
        preference: "recommended",
      }),
      cache: "no-store",
    });
  } catch {
    const fallback = fallbackRoute(parsed.stops);
    routeCache.set(key, fallback, { failure: true });
    return NextResponse.json(fallback);
  }

  if (!response.ok) {
    const fallback = fallbackRoute(parsed.stops);
    routeCache.set(key, fallback, { failure: true });
    return NextResponse.json(fallback);
  }

  const payload = (await response.json()) as { features?: OrsRouteFeature[] };
  const feature = payload.features?.[0];
  const coordinates = feature?.geometry?.coordinates ?? [];
  const geometry = coordinates
    .map(([lng, lat]) => ({ lat, lng }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && isInsideUntBounds(point));

  if (geometry.length < 2) {
    const fallback = fallbackRoute(parsed.stops);
    routeCache.set(key, fallback, { failure: true });
    return NextResponse.json(fallback);
  }

  const route = {
    geometry,
    distanceMeters: feature?.properties?.summary?.distance ?? 0,
    durationSeconds: feature?.properties?.summary?.duration ?? 0,
    source: "ors",
  } satisfies MapRouteResponse;

  routeCache.set(key, route);
  return NextResponse.json(route);
}
