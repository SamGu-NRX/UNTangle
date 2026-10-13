/**
 * One campus, described for the map and the walking engine.
 *
 * Everything campus-specific that the UI or the API reads goes through this
 * shape, so a second campus is a new CampusConfig plus a geodata build
 * (tools/campus-geodata) that writes its walkway graph and walking-time
 * matrix, registered in lib/campus/engine.ts. UNT Denton is the only campus
 * implemented.
 *
 * This module is safe to import from client code: the heavy geodata (the
 * walkway graph and matrix) is reached only through lib/campus/engine.ts on
 * the server.
 */
import {
  campusBuildings,
  untCampusBounds,
  untCampusCenter,
  untGeocodeContext,
  type GeocodeContext,
} from "@/lib/campus-locations";
import { SNAP_MAX_METERS, STEPS_SPEED_MPS, WALKING_SPEED_MPS } from "@/lib/campus/speeds";
import type { CampusBuilding } from "@/lib/types";

export type CampusBounds = { north: number; south: number; east: number; west: number };

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
};

export const untDenton: CampusConfig = {
  id: "unt-denton",
  name: "University of North Texas, Denton",
  shortName: "UNT",
  center: untCampusCenter,
  bounds: untCampusBounds,
  buildings: campusBuildings,
  walking: { baseMps: WALKING_SPEED_MPS, stepsMps: STEPS_SPEED_MPS, snapMaxMeters: SNAP_MAX_METERS },
  // Mirrors meta.bbox in data/walkways.json, written by tools/campus-geodata/build.mjs.
  osmExtract: {
    bbox: { south: 33.2025, west: -97.1585, north: 33.2175, east: -97.1345 },
    builtBy: "tools/campus-geodata/build.mjs",
  },
  geocode: untGeocodeContext,
};

/** The campus this deployment serves. */
export const activeCampus: CampusConfig = untDenton;
