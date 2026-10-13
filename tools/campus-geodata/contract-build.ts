import { createHash } from "node:crypto";
import type {
  Dataset,
  GraphEdge,
  MapFeature,
} from "../../frontend/src/lib/campus/contract/model";
import type { WalkwaysFile } from "../../frontend/src/lib/campus/graph";
import { haversineMeters } from "../../frontend/src/lib/campus/geo";
import { checkDataset } from "../../frontend/src/lib/campus/contract/check";
import type { BuildingOutlines } from "./build-matrix";

export const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

// Coordinate IDs preserve UNT's historical coordinate-based joins. They do not
// claim that separate OSM nodes at one position are physically connected.
export function toDataset(
  id: string,
  walkways: WalkwaysFile,
  outlines: BuildingOutlines,
  rawHash: string,
  provenance: { retrievedAt: string | null; osmBaseAt: string | null },
): Dataset {
  const nodeIds = walkways.nodes.map(
    ([lat, lng]) => `n:${hash(`${lng},${lat}`).slice(0, 12)}`,
  );
  const nodeFeatures = new Map<number, string>();
  const features: MapFeature[] = [];
  const best = new Map<
    string,
    { a: number; b: number; wayId: number; edge: GraphEdge }
  >();
  const properties = (kind: string, name: string | null) => ({
    kind,
    name,
    source_ids: ["osm"],
    observed_at: provenance.osmBaseAt,
    evidence: "source" as const,
  });
  for (const way of walkways.ways) {
    const featureId = `w:${way.i}:${hash(way.n.map((n) => nodeIds[n]).join("|")).slice(0, 12)}`;
    const cls = walkways.meta.classes[way.c];
    features.push({
      type: "Feature",
      id: featureId,
      properties: { ...properties(cls, null), crossing: cls === "crossing" },
      geometry: {
        type: "LineString",
        coordinates: way.n.map((n) => [
          walkways.nodes[n][1],
          walkways.nodes[n][0],
        ]),
      },
    });
    for (const n of way.n)
      if (!nodeFeatures.has(n)) nodeFeatures.set(n, featureId);
    for (let i = 0; i < way.n.length - 1; i++) {
      const a = way.n[i],
        b = way.n[i + 1];
      if (a === b) continue;
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const length = haversineMeters(
        ...walkways.nodes[a],
        ...walkways.nodes[b],
      );
      if (best.has(key) && best.get(key)!.edge.length_m <= length) continue;
      best.set(key, {
        a,
        b,
        wayId: way.i,
        edge: {
          id: `e:${hash(`${way.i}:${nodeIds[a]}:${nodeIds[b]}`).slice(0, 12)}`,
          feature_id: featureId,
          from: nodeIds[a],
          to: nodeIds[b],
          kind: cls === "steps" ? "stairs" : "path",
          length_m: length,
          width_m: null,
          slope: null,
          cross_slope: null,
          step_height_m: null,
          surface: null,
          access: "unknown",
          evidence: "source",
          observed_at: provenance.osmBaseAt,
        },
      });
    }
  }
  for (const b of outlines.buildings)
    features.push({
      type: "Feature",
      id: `osm:building:${b.osmId}`,
      properties: properties("building", b.name),
      geometry: {
        type: "Polygon",
        coordinates: [[...b.ring, b.ring[0]].map(([lat, lng]) => [lng, lat])],
      },
    });
  for (let i = 0; i < nodeIds.length; i++) {
    if (nodeFeatures.has(i)) continue;
    const featureId = `point:${nodeIds[i]}`;
    nodeFeatures.set(i, featureId);
    features.push({
      type: "Feature",
      id: featureId,
      properties: properties("path-node", null),
      geometry: {
        type: "Point",
        coordinates: [walkways.nodes[i][1], walkways.nodes[i][0]],
      },
    });
  }
  const dataset: Dataset = {
    schema_version: "0.1",
    dataset_id: id,
    revision: rawHash,
    demo: false,
    sources: [
      {
        id: "osm",
        url: "https://www.openstreetmap.org/copyright",
        license: "ODbL 1.0; © OpenStreetMap contributors",
        retrieved_at: provenance.retrievedAt,
        notes:
          "Offline Overpass snapshot. Coordinates WGS84. Physical attributes not imported or surveyed; null means unknown. Reciprocal pedestrian travel preserves the legacy UNT walking topology.",
      },
    ],
    features: { type: "FeatureCollection", features },
    graph: {
      nodes: walkways.nodes.map(([lat, lng], i) => ({
        id: nodeIds[i],
        feature_id: nodeFeatures.get(i)!,
        position: [lng, lat],
        building_id: null,
        level_id: "outdoor",
      })),
      edges: [...best.values()].flatMap(({ edge, wayId }) => [
        edge,
        {
          ...edge,
          id: `e:${hash(`${wayId}:${edge.to}:${edge.from}`).slice(0, 12)}`,
          from: edge.to,
          to: edge.from,
          slope: edge.slope === null ? null : -edge.slope,
        },
      ]),
    },
  };
  const checked = checkDataset(dataset);
  if (!checked.dataset)
    throw new Error(
      `Invalid campus-map-v0 dataset: ${JSON.stringify(checked.errors)}`,
    );
  return dataset;
}
