import { NextResponse } from "next/server";
import {
  buildCampusGeocodeQuery,
  isInsideUntBounds,
  resolveCampusBuilding,
  resolveCampusLocation,
  untCampusBounds,
} from "@/lib/campus-locations";
import type { MapResolvedLocation } from "@/lib/types";

export const runtime = "nodejs";

const maxLocations = 20;
const geocodeCache = new Map<string, MapResolvedLocation>();

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

function unresolved(
  location: string,
  buildingId?: string,
  metadata?: Pick<MapResolvedLocation, "buildingName" | "shortName" | "unsupportedReason">,
): MapResolvedLocation {
  return {
    location,
    buildingId,
    buildingName: metadata?.buildingName ?? location,
    shortName: metadata?.shortName ?? location,
    resolutionStatus: "unresolved",
    geocodeQuery: buildCampusGeocodeQuery(location),
    unsupportedReason: metadata?.unsupportedReason,
  };
}

function localResolution(location: string, buildingId?: string): MapResolvedLocation | null {
  const matchedBuilding = resolveCampusBuilding(location, buildingId);
  if (matchedBuilding?.isOffCampus) {
    return unresolved(location, matchedBuilding.id, {
      buildingName: matchedBuilding.name,
      shortName: matchedBuilding.shortName,
      unsupportedReason: "Outside UNT Denton main-campus routing bounds",
    });
  }

  const building = resolveCampusLocation(location, buildingId);
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
    geocodeQuery: buildCampusGeocodeQuery(location),
  };
}

function cacheKey(location: string, buildingId?: string) {
  return `${buildingId ?? ""}|${location}`.toLowerCase();
}

async function geocodeWithOpenRouteService(location: string, buildingId?: string) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return unresolved(location, buildingId);
  }

  const query = buildCampusGeocodeQuery(location);
  const params = new URLSearchParams({
    api_key: apiKey,
    text: query,
    size: "5",
    "boundary.rect.min_lon": String(untCampusBounds.west),
    "boundary.rect.min_lat": String(untCampusBounds.south),
    "boundary.rect.max_lon": String(untCampusBounds.east),
    "boundary.rect.max_lat": String(untCampusBounds.north),
  });

  let response: Response;
  try {
    response = await fetch(`https://api.openrouteservice.org/geocode/search?${params}`, {
      cache: "no-store",
    });
  } catch {
    return unresolved(location, buildingId);
  }

  if (!response.ok) {
    return unresolved(location, buildingId);
  }

  const payload = (await response.json().catch(() => null)) as { features?: OrsGeocodeFeature[] } | null;
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
  const match = candidates?.find((candidate) => isInsideUntBounds(candidate));

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

export async function POST(request: Request) {
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

      const geocoded = await geocodeWithOpenRouteService(location, buildingId);
      geocodeCache.set(key, geocoded);
      return geocoded;
    }),
  );

  return NextResponse.json({ locations: resolved });
}
