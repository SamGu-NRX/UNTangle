/**
 * Server-side walking engine per campus: the walkway router and the
 * building anchors (the walkway node each registry building joins the
 * network at). Keyed by CampusConfig.id; a new campus adds one entry here
 * once its geodata build has written its files.
 */
import { routeBetweenPoints } from "@/lib/campus/graph";
import type { LatLng } from "@/lib/campus/geo";
import { buildingAnchor } from "@/lib/campus/walking-times";
import type { CampusRouteGeometry } from "@/lib/campus/graph";

export type CampusEngine = {
  routeBetweenPoints: (a: LatLng, b: LatLng) => CampusRouteGeometry | null;
  /** Where a building joins the walkway graph, or null if it is not in the matrix. */
  anchorFor: (buildingId: string) => LatLng | null;
};

const engines: Record<string, CampusEngine> = {
  "unt-denton": {
    routeBetweenPoints,
    anchorFor: (buildingId) => buildingAnchor(buildingId)?.anchor ?? null,
  },
};

export function campusEngine(campusId: string): CampusEngine {
  const engine = engines[campusId];
  if (!engine) {
    throw new Error(`No walking engine for campus "${campusId}". Build its geodata and register it in lib/campus/engine.ts.`);
  }
  return engine;
}
