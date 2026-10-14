/**
 * One campus, described for the map and the walking engine.
 *
 * Everything campus-specific that the UI or the API reads goes through this
 * shape, so a second campus is a new CampusConfig plus a geodata build
 * (tools/campus-geodata) that writes its walkway graph and walking-time
 * matrix, registered in lib/campus/engine.ts. UNT Denton and UT Austin are registered.
 *
 * This module is safe to import from client code: the heavy geodata (the
 * walkway graph and matrix) is reached only through lib/campus/engine.ts on
 * the server.
 */
import {
  campusBuildings,
  createCampusResolver,
  untCampusBounds,
  untCampusCenter,
  untGeocodeContext,
  type CampusResolver,
  type GeocodeContext,
} from "@/lib/campus-locations";
import {
  SNAP_MAX_METERS,
  STEPS_SPEED_MPS,
  WALKING_SPEED_MPS,
} from "@/lib/campus/speeds";
import utCatalogue from "./data/ut-austin/catalogue.json";
import untDefinition from "../../../../tools/campus-geodata/campuses/unt-denton.json";
import utDefinition from "../../../../tools/campus-geodata/campuses/ut-austin.json";
import type { CampusBuilding } from "@/lib/types";

export type CampusBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type CampusConfig = {
  id: string;
  name: string;
  /** Short label for tight spaces, such as the map's empty state. */
  shortName: string;
  center: { lat: number; lng: number };
  /**
   * Routing bounds: stops outside are off campus. The map lets people pan a
   * little past these, then stops.
   */
  bounds: CampusBounds;
  /** Building registry: ids, names, codes and pins. Off-campus entries are flagged. */
  buildings: readonly CampusBuilding[];
  /** The stated walking-speed model; see lib/campus/speeds.ts for sources. */
  walking: { baseMps: number; stepsMps: number; snapMaxMeters: number };
  /** OSM area the geodata build fetched; the build's bbox, recorded for provenance. */
  osmExtract: { bbox: CampusBounds; builtBy: string };
  /** How building lookup names the campus to an external geocoder. */
  geocode: GeocodeContext;
  nameCleanupWords?: readonly string[];
  allowExternalServices?: boolean;
  /**
   * The campus's own map detail (buildings with heights, trees, entrances,
   * parking, labels), written by tools/campus-geodata/build-map-detail.ts
   * and served from public/. Without it the map extrudes the basemap's
   * merged building shapes and labels the registry's pins.
   */
  mapDetail?: { url: string; attribution: string };
};

export const untDenton: CampusConfig = {
  id: "unt-denton",
  name: "University of North Texas, Denton",
  shortName: "UNT",
  center: untCampusCenter,
  bounds: untCampusBounds,
  buildings: campusBuildings,
  walking: {
    baseMps: WALKING_SPEED_MPS,
    stepsMps: STEPS_SPEED_MPS,
    snapMaxMeters: SNAP_MAX_METERS,
  },
  // Mirrors meta.bbox in data/walkways.json, written by tools/campus-geodata/build.mjs.
  osmExtract: {
    bbox: { south: 33.2025, west: -97.1585, north: 33.2175, east: -97.1345 },
    builtBy: "tools/campus-geodata/build.mjs",
  },
  geocode: untGeocodeContext,
  nameCleanupWords: untDefinition.nameCleanupWords,
  mapDetail: {
    url: "/map/unt-denton/detail.geojson",
    // Overture's licence (ODbL) asks for its credit next to OpenStreetMap's.
    attribution: 'building heights partly from <a href="https://overturemaps.org" target="_blank" rel="noreferrer">Overture Maps Foundation</a>',
  },
};

export const utAustin: CampusConfig = {
  id: "ut-austin",
  name: "University of Texas at Austin",
  shortName: "UT Austin",
  center: { lat: 30.286, lng: -97.737 },
  bounds: utDefinition.bbox,
  buildings: utCatalogue,
  walking: {
    baseMps: WALKING_SPEED_MPS,
    stepsMps: STEPS_SPEED_MPS,
    snapMaxMeters: SNAP_MAX_METERS,
  },
  osmExtract: {
    bbox: utDefinition.bbox,
    builtBy: "tools/campus-geodata/kit.ts",
  },
  geocode: utDefinition.geocode,
  nameCleanupWords: utDefinition.nameCleanupWords,
  allowExternalServices: false,
};
export const campuses: readonly CampusConfig[] = [untDenton, utAustin];
/** Omitted selector means UNT; an unsupported selector is a specific error. */
export function campusById(id: string | null | undefined): CampusConfig {
  if (id === undefined || id === null) return untDenton;
  const campus = campuses.find((c) => c.id === id);
  if (!campus) throw new Error(`Unknown campus "${id}"`);
  return campus;
}
/** The default campus for the UNT planner. */
export const activeCampus: CampusConfig = untDenton;

const resolvers = new WeakMap<CampusConfig, CampusResolver>();

/** Building lookup over this campus's own registry and bounds, built once per config. */
export function campusResolver(campus: CampusConfig): CampusResolver {
  let resolver = resolvers.get(campus);
  if (!resolver) {
    resolver = createCampusResolver(
      campus.buildings,
      campus.bounds,
      campus.nameCleanupWords ?? [],
    );
    resolvers.set(campus, resolver);
  }
  return resolver;
}
