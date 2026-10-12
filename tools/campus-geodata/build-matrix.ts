/**
 * build-matrix.ts — building-anchor matching + all-pairs walking-time matrix.
 *
 * Run: bun tools/campus-geodata/build-matrix.ts
 *
 * Consumes:
 *   frontend/src/lib/campus-locations.ts        (registry, source of truth)
 *   frontend/src/lib/campus/graph.ts            (offline walkway graph + A*)
 *   frontend/src/lib/campus/geo.ts              (point-in-polygon, haversine)
 *   frontend/src/lib/campus/data/{walkways,buildings}.json
 *
 * Produces:
 *   frontend/src/lib/campus/data/walking-times.json
 *   tools/campus-geodata/matrix-report.json
 *
 * Anchors (per routable building):
 *   1. "osm-entrance" — the building outline containing the registry pin
 *      (geo.pointInPolygon, 1 m boundary tolerance) has an attached OSM
 *      entrance node within ENTRANCE_MAX_M of the pin; anchor the nearest
 *      walkway node to that entrance.
 *   2. "outline-node" — pin inside an outline without a suitable entrance
 *      node; anchor the nearest walkway node to the pin (SNAP_MAX_METERS).
 *   3. "pin-fallback" — no outline contains the pin; nearest walkway node to
 *      the pin (SNAP_MAX_METERS).
 * A building with no anchor under these rules fails the build.
 *
 * The matrix uses the runtime's own routeBetweenNodes, so its duration model
 * (1.4 m/s base, 0.6 m/s steps) can never drift from this offline snapshot.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { campusBuildings } from "../../frontend/src/lib/campus-locations";
import { routeBetweenNodes } from "../../frontend/src/lib/campus/graph";
import { haversineMetersBetween, pointInPolygon } from "../../frontend/src/lib/campus/geo";
import { SNAP_MAX_METERS, STEPS_SPEED_MPS, WALKING_SPEED_MPS } from "../../frontend/src/lib/campus/speeds";
import walkwaysJson from "../../frontend/src/lib/campus/data/walkways.json";
import buildingsJson from "../../frontend/src/lib/campus/data/buildings.json";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DATA_DIR = join(ROOT, "frontend", "src", "lib", "campus", "data");

type Point = [lat: number, lng: number];

const ENTRANCE_MAX_M = 80;

const walkwayNodes: Point[] = walkwaysJson.nodes as Point[];

function nearestNodeIndex(point: Point, maxMeters: number) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < walkwayNodes.length; i += 1) {
    const d = haversineMetersBetween({ lat: point[0], lng: point[1] }, { lat: walkwayNodes[i][0], lng: walkwayNodes[i][1] });
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return bestDist <= maxMeters ? { index: best, meters: bestDist } : null;
}

type Anchor = {
  nodeIndex: number;
  anchor: Point;
  method: "osm-entrance" | "outline-node" | "pin-fallback";
  outlineOsmId: number | null;
  connectorMeters: number;
};

function resolveAnchor(pin: Point): Anchor {
  const containing = (buildingsJson.buildings as {
    osmId: number;
    centroid: Point;
    ring: [number, number][];
    entrances: Point[];
  }[])
    .filter((b) => pointInPolygon(pin[0], pin[1], b.ring))
    .sort(
      (a, b) =>
        haversineMetersBetween({ lat: pin[0], lng: pin[1] }, { lat: a.centroid[0], lng: a.centroid[1] }) -
        haversineMetersBetween({ lat: pin[0], lng: pin[1] }, { lat: b.centroid[0], lng: b.centroid[1] }),
    );
  const outline = containing[0] ?? null;

  if (outline) {
    let bestEntrance: { point: Point; meters: number } | null = null;
    for (const entrance of outline.entrances) {
      const meters = haversineMetersBetween({ lat: pin[0], lng: pin[1] }, { lat: entrance[0], lng: entrance[1] });
      if (meters <= ENTRANCE_MAX_M && (!bestEntrance || meters < bestEntrance.meters)) {
        bestEntrance = { point: entrance, meters };
      }
    }
    if (bestEntrance) {
      const snap = nearestNodeIndex(bestEntrance.point, SNAP_MAX_METERS);
      if (snap) {
        return {
          nodeIndex: snap.index,
          anchor: walkwayNodes[snap.index],
          method: "osm-entrance",
          outlineOsmId: outline.osmId,
          connectorMeters: Number((bestEntrance.meters + snap.meters).toFixed(1)),
        };
      }
    }
    const outlineSnap = nearestNodeIndex(pin, SNAP_MAX_METERS);
    if (outlineSnap) {
      return {
        nodeIndex: outlineSnap.index,
        anchor: walkwayNodes[outlineSnap.index],
        method: "outline-node",
        outlineOsmId: outline.osmId,
        connectorMeters: Number(outlineSnap.meters.toFixed(1)),
      };
    }
  }

  const fallback = nearestNodeIndex(pin, SNAP_MAX_METERS);
  if (!fallback) {
    throw new Error(`no walkway node within ${SNAP_MAX_METERS} m of pin ${pin.join(",")}`);
  }
  return {
    nodeIndex: fallback.index,
    anchor: walkwayNodes[fallback.index],
    method: "pin-fallback",
    outlineOsmId: null,
    connectorMeters: Number(fallback.meters.toFixed(1)),
  };
}

const routable = campusBuildings.filter((b) => !b.isOffCampus);
const anchors = new Map<string, Anchor>();
for (const building of routable) {
  const pin: Point = [building.lat, building.lng];
  anchors.set(building.id, resolveAnchor(pin));
}

const methodCounts = { "osm-entrance": 0, "outline-node": 0, "pin-fallback": 0 } as Record<string, number>;
for (const anchor of anchors.values()) methodCounts[anchor.method] += 1;
console.log("anchor methods:", methodCounts);

// All-pairs walking times (seconds) + distances (meters).
const ids = routable.map((b) => b.id);
const seconds: Record<string, Record<string, number>> = {};
const meters: Record<string, Record<string, number>> = {};
let maxMinutes = 0;
let asymmetries = 0;

for (const from of ids) {
  seconds[from] = {};
  meters[from] = {};
  for (const to of ids) {
    if (from === to) {
      seconds[from][to] = 0;
      meters[from][to] = 0;
      continue;
    }
    const a = anchors.get(from)!;
    const b = anchors.get(to)!;
    const route = routeBetweenNodes(a.nodeIndex, b.nodeIndex);
    if (!route) {
      throw new Error(`no walkway route ${from} -> ${to} (graph fragmented?)`);
    }
    seconds[from][to] = Number(route.durationSeconds.toFixed(1));
    meters[from][to] = Number(route.networkMeters.toFixed(1));
    maxMinutes = Math.max(maxMinutes, route.durationSeconds / 60);
  }
}

for (const from of ids) {
  for (const to of ids) {
    if (from < to && Math.abs(seconds[from][to] - seconds[to][from]) > 1) asymmetries += 1;
  }
}
console.log(`matrix: ${ids.length}x${ids.length}, max ${Math.round(maxMinutes)} min, asymmetries(>1s): ${asymmetries}`);

const anchorEntries = Object.fromEntries(
  [...anchors.entries()].map(([id, a]) => [
    id,
    { anchor: a.anchor, method: a.method, outlineOsmId: a.outlineOsmId, connectorMeters: a.connectorMeters },
  ]),
);

const receipt = JSON.parse(readFileSync(join(HERE, "receipt.json"), "utf8"));
const output = {
  meta: {
    attribution: walkwaysJson.meta.attribution,
    license: walkwaysJson.meta.license,
    walkwaysSource: walkwaysJson.meta.source,
    walkwaysFetchedAt: walkwaysJson.meta.fetchedAt,
    registrySources: [
      "https://facilities.unt.edu/resources/building-information.html",
      "UNT GIS Building_Cartographic_Shape (services.arcgis.com, public)",
    ],
    speeds: { baseMps: WALKING_SPEED_MPS, stepsMps: STEPS_SPEED_MPS, note: "model assumptions, not UNT measurements" },
    generatedBy: "tools/campus-geodata/build-matrix.ts",
    receiptSha256: receipt.outputs?.walkways?.sha256 ?? null,
  },
  anchors: anchorEntries,
  seconds,
  meters,
};

const outFile = join(DATA_DIR, "walking-times.json");
writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`);

const report = {
  generatedAt: new Date().toISOString(),
  buildings: ids.length,
  anchors: anchorEntries,
  maxMinutes,
  asymmetries,
};
writeFileSync(join(HERE, "matrix-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${outFile.replace(`${ROOT}/`, "")} (${output.meta.receiptSha256 ? "receipt linked" : "no receipt"})`);
