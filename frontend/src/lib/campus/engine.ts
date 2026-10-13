/**
 * Server-side walking engine per campus: the walkway router and the
 * building anchors (the walkway node each registry building joins the
 * network at). Keyed by CampusConfig.id; a new campus adds one entry here
 * once its geodata build has written its files.
 */
import utDataset from "./data/ut-austin/campus-map.json";
import utMatrix from "./data/ut-austin/walking-times.json";
import { createDatasetGraph, routeBetweenPoints } from "@/lib/campus/graph";
import type { LatLng } from "@/lib/campus/geo";
import { buildingAnchor } from "@/lib/campus/walking-times";
import type { CampusRouteGeometry } from "@/lib/campus/graph";

export type CampusEngine = {
  routeBetweenPoints: (a: LatLng, b: LatLng) => CampusRouteGeometry | null;
  /** Where a building joins the walkway graph, or null if it is not in the matrix. */
  anchorFor: (buildingId: string) => LatLng | null;
};

const utGraph = createDatasetGraph(utDataset);
const utAnchors = new Map(Object.entries(utMatrix.anchors));

const engines: Record<string, CampusEngine> = {
  "ut-austin": {
    routeBetweenPoints: utGraph.routeBetweenPoints,
    anchorFor: (id) => {
      const a = utAnchors.get(id.toLowerCase());
      return a ? { lat: a.anchor[0], lng: a.anchor[1] } : null;
    },
  },
  "unt-denton": {
    routeBetweenPoints,
    anchorFor: (buildingId) => buildingAnchor(buildingId)?.anchor ?? null,
  },
};

export function campusEngine(campusId: string): CampusEngine {
  const engine = Object.hasOwn(engines, campusId)
    ? engines[campusId]
    : undefined;
  if (!engine) {
    throw new Error(
      `No walking engine for campus "${campusId}". Build its geodata and register it in lib/campus/engine.ts.`,
    );
  }
  return engine;
}
