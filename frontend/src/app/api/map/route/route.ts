import { NextResponse } from "next/server";
import { campusById, type CampusConfig } from "@/lib/campus/config";
import { campusEngine } from "@/lib/campus/engine";
import type { LatLng } from "@/lib/campus/geo";
import { buildRouteLegs, summarizeRoute, type ExternalLeg, type RouteStopInput } from "@/lib/campus/route-legs";
import { isInsideBounds } from "@/lib/campus-locations";
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

function parseStops(input: RouteInput, campus: CampusConfig): { stops: RouteStopInput[] } | { error: string } {
  if (!Array.isArray(input.stops)) {
    return { error: "stops must be an array" };
  }

  if (input.stops.length > maxStops) {
    return { error: `Cannot route more than ${maxStops} stops` };
  }

  const stops: RouteStopInput[] = [];
  for (const raw of input.stops) {
    const lat = typeof raw?.lat === "number" ? raw.lat : Number.NaN;
    const lng = typeof raw?.lng === "number" ? raw.lng : Number.NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { error: "All stops must include numeric lat and lng values" };
    }
    if (!isInsideBounds({ lat, lng }, campus.bounds)) {
      return { error: `All stops must be within ${campus.name} routing bounds` };
    }
    if (
      raw.buildingId !== undefined &&
      (typeof raw.buildingId !== "string" || raw.buildingId.length === 0 || raw.buildingId.length > maxBuildingIdLength)
    ) {
      return { error: "buildingId, when given, must be a short non-empty string" };
    }
    // Repeated stops are kept: each pair gets its own leg (zero minutes for a
    // repeat), so leg i always joins stops i and i + 1.
    stops.push({ lat, lng, ...(raw.buildingId ? { buildingId: raw.buildingId as string } : {}) });
  }

  if (stops.length < 2) {
    return { error: "At least two stops are required" };
  }

  return { stops };
}

function orsRouter(apiKey: string, campus: CampusConfig) {
  return async (from: LatLng, to: LatLng): Promise<ExternalLeg | null> => {
    const key = `${campus.id}|${from.lat.toFixed(6)},${from.lng.toFixed(6)}|${to.lat.toFixed(6)},${to.lng.toFixed(6)}`;
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
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && isInsideBounds(p, campus.bounds));
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
  let campus: CampusConfig;
  try { campus = campusById(new URL(request.url).searchParams.get("campus")); }
  catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : "Invalid campus"},{status:400}); }
  const limit = limiter.check(`${campus.id}|${clientIpFromRequest(request)}`);
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

  const parsed = parseStops(body, campus);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const apiKey = campus.allowExternalServices === false ? undefined : process.env.ORS_API_KEY;
  const legs = await buildRouteLegs(parsed.stops, await campusEngine(campus.id), apiKey ? orsRouter(apiKey, campus) : undefined);
  return NextResponse.json(summarizeRoute(legs));
}
