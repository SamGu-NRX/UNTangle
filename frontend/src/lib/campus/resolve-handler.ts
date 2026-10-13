import { NextResponse } from "next/server";
import { campusResolver, type CampusConfig } from "@/lib/campus/config";
import { geocodeQuery, isInsideBounds } from "@/lib/campus-locations";
import { TtlLruCache } from "@/lib/map-cache";
import type { MapResolvedLocation } from "@/lib/types";

const maxLocations = 20;

const failureTtlMs = 5 * 60 * 1000;

type ResolveInput = {
  locations?: Array<{
    location?: unknown;
    buildingId?: unknown;
  }>;
};

type OrsGeocodeFeature = {
  geometry?: {
    coordinates?: [number, number];
  };
  properties?: {
    label?: string;
    name?: string;
  };
};

/**
 * POST /api/map/resolve for one campus: each location is looked up in that
 * campus's own building registry and bounds, then (with an ORS key) the
 * geocoder, boxed to the same bounds. The route file builds it for the
 * active campus; tests build it for a replacement campus.
 */
export function createResolveHandler(campus: CampusConfig) {
  const resolver = campusResolver(campus);
  const geocodeCache = new TtlLruCache<MapResolvedLocation>({
    maxEntries: 500,
    ttlMs: 24 * 60 * 60 * 1000,
    failureTtlMs,
  });

  function unresolved(
    location: string,
    buildingId?: string,
    metadata?: Partial<Pick<MapResolvedLocation, "buildingName" | "shortName" | "unsupportedReason" | "retryable">>,
  ): MapResolvedLocation {
    return {
      location,
      buildingId,
      buildingName: metadata?.buildingName ?? location,
      shortName: metadata?.shortName ?? location,
      resolutionStatus: "unresolved",
      geocodeQuery: geocodeQuery(location, campus.geocode),
      unsupportedReason: metadata?.unsupportedReason,
      ...(metadata?.retryable ? { retryable: true as const } : {}),
    };
  }

  /**
   * The geocoder failed (network, error status, unreadable reply). That says
   * nothing about the building, so the client is told to ask again later
   * instead of remembering "unresolved" for the session.
   */
  function lookupFailed(location: string, buildingId?: string) {
    return unresolved(location, buildingId, { retryable: true });
  }

  function localResolution(location: string, buildingId?: string): MapResolvedLocation | null {
    const matchedBuilding = resolver.resolveBuilding(location, buildingId);
    // Off campus by flag, or by coordinates outside this campus's bounds.
    if (matchedBuilding && (matchedBuilding.isOffCampus || !isInsideBounds(matchedBuilding, campus.bounds))) {
      return unresolved(location, matchedBuilding.id, {
        buildingName: matchedBuilding.name,
        shortName: matchedBuilding.shortName,
        unsupportedReason: `Outside ${campus.name} routing bounds`,
      });
    }

    const building = resolver.resolveLocation(location, buildingId);
    if (!building) {
      return null;
    }

    return {
      location,
      buildingId: building.id,
      buildingName: building.name,
      shortName: building.shortName,
      lat: building.lat,
      lng: building.lng,
      resolutionStatus: "local",
      geocodeQuery: geocodeQuery(location, campus.geocode),
    };
  }

  function cacheKey(location: string, buildingId?: string) {
    return `${buildingId ?? ""}|${location}`.toLowerCase();
  }

  async function geocodeWithOpenRouteService(location: string, buildingId: string | undefined, apiKey: string) {
    const query = geocodeQuery(location, campus.geocode);
    const { bounds } = campus;
    const params = new URLSearchParams({
      api_key: apiKey,
      text: query,
      size: "5",
      "boundary.rect.min_lon": String(bounds.west),
      "boundary.rect.min_lat": String(bounds.south),
      "boundary.rect.max_lon": String(bounds.east),
      "boundary.rect.max_lat": String(bounds.north),
    });

    let response: Response;
    try {
      response = await fetch(`https://api.openrouteservice.org/geocode/search?${params}`, {
        cache: "no-store",
      });
    } catch {
      return lookupFailed(location, buildingId);
    }

    if (!response.ok) {
      return lookupFailed(location, buildingId);
    }

    const payload = (await response.json().catch(() => null)) as { features?: OrsGeocodeFeature[] } | null;
    if (!payload) {
      return lookupFailed(location, buildingId);
    }
    const candidates = payload?.features
      ?.map((feature) => {
        const [lng, lat] = feature.geometry?.coordinates ?? [];
        return {
          lat,
          lng,
          label: feature.properties?.label ?? feature.properties?.name,
        };
      })
      .filter(
        (candidate): candidate is { lat: number; lng: number; label: string | undefined } =>
          Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng),
      );
    const match = candidates?.find((candidate) => isInsideBounds(candidate, campus.bounds));

    if (!match) {
      return unresolved(location, buildingId);
    }

    return {
      location,
      buildingId,
      buildingName: match.label ?? location,
      shortName: location,
      lat: match.lat,
      lng: match.lng,
      resolutionStatus: "geocoded",
      geocodeQuery: query,
    } satisfies MapResolvedLocation;
  }

  async function POST(request: Request) {
    let body: ResolveInput;

    try {
      body = (await request.json()) as ResolveInput;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const locations = body.locations;
    if (!Array.isArray(locations)) {
      return NextResponse.json({ error: "locations must be an array" }, { status: 400 });
    }

    if (locations.length > maxLocations) {
      return NextResponse.json({ error: `Cannot resolve more than ${maxLocations} locations` }, { status: 400 });
    }

    const resolved = await Promise.all(
      locations.map(async (entry) => {
        const location = typeof entry.location === "string" ? entry.location.trim() : "";
        const buildingId = typeof entry.buildingId === "string" ? entry.buildingId.trim() : undefined;

        if (!location) {
          return unresolved("Unknown location", buildingId);
        }

        const local = localResolution(location, buildingId);
        if (local) {
          return local;
        }

        const key = cacheKey(location, buildingId);
        const cached = geocodeCache.get(key);
        if (cached) {
          return cached;
        }

        const apiKey = campus.allowExternalServices === false ? undefined : process.env.ORS_API_KEY;
        if (!apiKey) {
          return unresolved(location, buildingId);
        }

        const geocoded = await geocodeWithOpenRouteService(location, buildingId, apiKey);
        geocodeCache.set(key, geocoded, { failure: geocoded.resolutionStatus !== "geocoded" });
        return geocoded;
      }),
    );

    return NextResponse.json({ locations: resolved });
  }

  return POST;
}
