import type { CampusBuilding } from "../../frontend/src/lib/types";
import type {
  WalkwaysFile,
  WalkwayGraph,
} from "../../frontend/src/lib/campus/graph";
import {
  haversineMetersBetween,
  pointInPolygon,
} from "../../frontend/src/lib/campus/geo";
import {
  SNAP_MAX_METERS,
  STEPS_SPEED_MPS,
  WALKING_SPEED_MPS,
} from "../../frontend/src/lib/campus/speeds";

export type BuildingOutlines = {
  buildings: {
    osmId: number;
    name: string | null;
    centroid: [number, number];
    ring: [number, number][];
    entrances: [number, number][];
  }[];
};
export function buildMatrix(
  campusBuildings: readonly CampusBuilding[],
  walkwaysJson: WalkwaysFile,
  buildingsJson: BuildingOutlines,
  graph: WalkwayGraph,
  registrySources: string[],
  walkwayHash: string,
  largestComponentOnly = false,
) {
  const { routeBetweenNodes } = graph;
  type Point = [lat: number, lng: number];

  const ENTRANCE_MAX_M = 80;

  const walkwayNodes: Point[] = walkwaysJson.nodes;

  function nearestNodeIndex(point: Point, maxMeters: number) {
    if (largestComponentOnly) {
      const index = graph.nearestWalkwayNode(
        { lat: point[0], lng: point[1] },
        maxMeters,
      );
      return index === null
        ? null
        : {
            index,
            meters: haversineMetersBetween(
              { lat: point[0], lng: point[1] },
              { lat: walkwayNodes[index][0], lng: walkwayNodes[index][1] },
            ),
          };
    }
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < walkwayNodes.length; i += 1) {
      const d = haversineMetersBetween(
        { lat: point[0], lng: point[1] },
        { lat: walkwayNodes[i][0], lng: walkwayNodes[i][1] },
      );
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
    const containing = buildingsJson.buildings
      .filter((b) => pointInPolygon(pin[0], pin[1], b.ring))
      .sort(
        (a, b) =>
          haversineMetersBetween(
            { lat: pin[0], lng: pin[1] },
            { lat: a.centroid[0], lng: a.centroid[1] },
          ) -
          haversineMetersBetween(
            { lat: pin[0], lng: pin[1] },
            { lat: b.centroid[0], lng: b.centroid[1] },
          ),
      );
    const outline = containing[0] ?? null;

    if (outline) {
      let bestEntrance: { point: Point; meters: number } | null = null;
      for (const entrance of outline.entrances) {
        const meters = haversineMetersBetween(
          { lat: pin[0], lng: pin[1] },
          { lat: entrance[0], lng: entrance[1] },
        );
        if (
          meters <= ENTRANCE_MAX_M &&
          (!bestEntrance || meters < bestEntrance.meters)
        ) {
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
            connectorMeters: Number(
              (bestEntrance.meters + snap.meters).toFixed(1),
            ),
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
      throw new Error(
        `no walkway node within ${SNAP_MAX_METERS} m of pin ${pin.join(",")}`,
      );
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

  const methodCounts = {
    "osm-entrance": 0,
    "outline-node": 0,
    "pin-fallback": 0,
  } as Record<string, number>;
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
        throw new Error(
          `no walkway route ${from} -> ${to} (graph fragmented?)`,
        );
      }
      seconds[from][to] = Number(route.durationSeconds.toFixed(1));
      meters[from][to] = Number(route.networkMeters.toFixed(1));
      maxMinutes = Math.max(maxMinutes, route.durationSeconds / 60);
    }
  }

  for (const from of ids) {
    for (const to of ids) {
      if (from < to && Math.abs(seconds[from][to] - seconds[to][from]) > 1)
        asymmetries += 1;
    }
  }
  console.log(
    `matrix: ${ids.length}x${ids.length}, max ${Math.round(maxMinutes)} min, asymmetries(>1s): ${asymmetries}`,
  );

  const anchorEntries = Object.fromEntries(
    [...anchors.entries()].map(([id, a]) => [
      id,
      {
        anchor: a.anchor,
        method: a.method,
        outlineOsmId: a.outlineOsmId,
        connectorMeters: a.connectorMeters,
      },
    ]),
  );

  const output = {
    meta: {
      attribution: walkwaysJson.meta.attribution,
      license: walkwaysJson.meta.license,
      walkwaysSource: walkwaysJson.meta.source,
      walkwaysFetchedAt: walkwaysJson.meta.fetchedAt,
      registrySources,
      speeds: {
        baseMps: WALKING_SPEED_MPS,
        stepsMps: STEPS_SPEED_MPS,
        note: "model assumptions, not UNT measurements",
      },
      generatedBy: "tools/campus-geodata/build-matrix.ts",
      receiptSha256: walkwayHash,
    },
    anchors: anchorEntries,
    seconds,
    meters,
  };

  return {
    output,
    report: {
      buildings: ids.length,
      anchors: anchorEntries,
      maxMinutes,
      asymmetries,
    },
  };
}
