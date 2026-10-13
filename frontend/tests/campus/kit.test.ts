import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { buildCampus, readDefinition } from "../../../tools/campus-geodata/kit";
import { checkDataset } from "@/lib/campus/contract/check";
import { createDatasetGraph, routeBetweenPoints } from "@/lib/campus/graph";
import { buildingAnchor, getWalkingSeconds, matrixBuildingIds } from "@/lib/campus/walking-times";
import { campusById, campusResolver, utAustin, untDenton } from "@/lib/campus/config";
import { createCampusResolver } from "@/lib/campus-locations";
import { POST as routePOST } from "@/app/api/map/route/route";
import { POST as resolvePOST } from "@/app/api/map/resolve/route";
import utData from "@/lib/campus/data/ut-austin/campus-map.json";
import utMatrix from "@/lib/campus/data/ut-austin/walking-times.json";
import { campusEngine } from "@/lib/campus/engine";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

test("kit builds identical artifacts from fixed raw inputs, independently of destination", () => {
  const temporary = mkdtempSync(join(tmpdir(), "campus-kit-test-"));
  try {
    const raw = join(temporary, "raw");
    mkdirSync(raw);
    const definition = {
      ...readDefinition(join(import.meta.dir, "../../../tools/campus-geodata/campuses/ut-austin.json")),
      id: "fixture-campus",
      bbox: { south: 30.28, west: -97.74, north: 30.29, east: -97.73 },
      catalogue: {
        kind: "osm-names",
        sources: ["https://www.openstreetmap.org/copyright"],
      },
    };
    const path = join(temporary, "campus.json");
    writeFileSync(path, JSON.stringify(definition));
    const snapshot = {
      osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
      elements: [
        {
          type: "way",
          id: 10,
          tags: { highway: "footway" },
          geometry: [
            { lat: 30.285, lon: -97.737 },
            { lat: 30.285, lon: -97.735 },
            { lat: 30.285, lon: -97.733 },
          ],
        },
        ...[
          [-97.737, 20, "Library"],
          [-97.733, 21, "Science Hall"],
        ].map(([lng, id, name]) => ({
          type: "way",
          id,
          tags: { building: "yes", name },
          geometry: [
            { lat: 30.2851, lon: Number(lng) - 0.0001 },
            { lat: 30.2851, lon: Number(lng) + 0.0001 },
            { lat: 30.2853, lon: Number(lng) + 0.0001 },
            { lat: 30.2853, lon: Number(lng) - 0.0001 },
            { lat: 30.2851, lon: Number(lng) - 0.0001 },
          ],
        })),
      ],
    };
    for (const kind of ["pedestrian", "buildings"])
      writeFileSync(join(raw, `fixture-campus-${kind}.json`), JSON.stringify(snapshot));
    const first = join(temporary, "first"),
      second = join(temporary, "second");
    buildCampus(path, first, raw);
    buildCampus(path, second, raw);
    for (const file of readdirSync(first))
      expect(readFileSync(join(first, file))).toEqual(readFileSync(join(second, file)));
    const matrix = JSON.parse(readFileSync(join(first, "walking-times.json"), "utf8"));
    expect(matrix.seconds["osm-20"]["osm-21"]).toBe(274.3);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("UNT matrix retains the alpha 73800b0 bytes and every route's tenths of seconds", () => {
  expect(sha(readFileSync(join(import.meta.dir, "../../src/lib/campus/data/walking-times.json")))).toBe(
    "76e57546e166aa68b6a7d27d7932b67dea8ce9b063e7cb22d28b39e5573ad08b",
  );
  for (const from of matrixBuildingIds())
    for (const to of matrixBuildingIds()) {
      const result = routeBetweenPoints(buildingAnchor(from)!.anchor, buildingAnchor(to)!.anchor);
      const expected = getWalkingSeconds(from, to);
      if (expected.seconds === null) throw new Error(`Missing UNT matrix pair ${from} -> ${to}`);
      expect(result?.durationSeconds).toBe(expected.seconds);
    }
});

test("per-campus cleanup keeps foreign campus words and regex punctuation literal", () => {
  const building = {
    id: "denton-hall",
    name: "Denton Hall",
    shortName: "Denton Hall",
    lat: 30.285,
    lng: -97.735,
  };
  const resolver = createCampusResolver([building], utAustin.bounds, utAustin.nameCleanupWords);
  expect(resolver.resolveBuilding("UT Austin Denton Hall 101")?.id).toBe("denton-hall");
  expect(resolver.resolveBuilding("Hall")).toBeNull();
  expect(campusResolver(untDenton).resolveBuilding("UNT Denton Life Sciences Complex 101")?.id).toBe("life");
  const literal = createCampusResolver([building], utAustin.bounds, ["x.y"]);
  expect(literal.resolveBuilding("x.y Denton Hall")?.id).toBe("denton-hall");
  expect(literal.resolveBuilding("xay Denton Hall")).toBeNull();
});

describe("campus-map-v0 malformed fixtures", () => {
  for (const file of readdirSync(join(import.meta.dir, "malformed")))
    test(file, () => {
      const input = JSON.parse(readFileSync(join(import.meta.dir, "malformed", file), "utf8"));
      expect(checkDataset(input).dataset).toBeNull();
      expect(() => createDatasetGraph(input)).toThrow("Invalid campus-map-v0");
      expect(checkDataset(utData).dataset?.dataset_id).toBe("ut-austin");
    });
});

// Independent O(V²) Dijkstra, over the directed contract, with no A* helper.
function dijkstra(start: string, goal: string): number {
  const distances = new Map(utData.graph.nodes.map((n) => [n.id, Infinity]));
  distances.set(start, 0);
  const remaining = new Set(distances.keys());
  const adjacency = new Map<string, { to: string; length_m: number }[]>();
  for (const edge of utData.graph.edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge);
    adjacency.set(edge.from, list);
  }
  while (remaining.size) {
    let next: string | null = null,
      best = Infinity;
    for (const id of remaining)
      if (distances.get(id)! < best) {
        next = id;
        best = distances.get(id)!;
      }
    if (next === null) return Infinity;
    if (next === goal) return best;
    remaining.delete(next);
    for (const e of adjacency.get(next) ?? [])
      if (remaining.has(e.to)) distances.set(e.to, Math.min(distances.get(e.to)!, best + e.length_m));
  }
  return Infinity;
}

test("UT A* agrees with independent directed Dijkstra for deterministic sampled pairs", () => {
  const graph = createDatasetGraph(utData);
  const anchors: Record<string, { anchor: number[] }> = utMatrix.anchors;
  const ids = Object.keys(anchors);
  for (let i = 0; i < 12; i++) {
    const from = ids[i],
      to = ids[(i * 7 + 13) % ids.length];
    const a = graph.nearestWalkwayNode({
      lat: anchors[from].anchor[0],
      lng: anchors[from].anchor[1],
    })!;
    const b = graph.nearestWalkwayNode({
      lat: anchors[to].anchor[0],
      lng: anchors[to].anchor[1],
    })!;
    const oracle = dijkstra(utData.graph.nodes[a].id, utData.graph.nodes[b].id);
    expect(Number.isFinite(oracle)).toBe(true);
    expect(graph.routeBetweenNodes(a, b)?.networkMeters).toBeCloseTo(oracle, 7);
    const route = campusEngine("ut-austin").routeBetweenPoints(
      campusEngine("ut-austin").anchorFor(from)!,
      campusEngine("ut-austin").anchorFor(to)!,
    );
    const seconds: Record<string, Record<string, number>> = utMatrix.seconds;
    expect(route?.durationSeconds).toBe(seconds[from][to]);
  }
}, 30000);

test("selected APIs route UT without keyed services and reject unknown campuses", async () => {
  expect(campusById(null).id).toBe("unt-denton");
  expect(() => campusById("constructor")).toThrow('Unknown campus "constructor"');
  const selected = utAustin.buildings.slice(0, 2);
  const resolved = await resolvePOST(
    new Request("http://localhost/api/map/resolve?campus=ut-austin", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.217" },
      body: JSON.stringify({
        locations: selected.map((b) => ({ location: b.name })),
      }),
    }),
  );
  expect(resolved.status).toBe(200);
  expect((await resolved.json()).locations.map((b: { resolutionStatus: string }) => b.resolutionStatus)).toEqual([
    "local",
    "local",
  ]);
  const response = await routePOST(
    new Request("http://localhost/api/map/route?campus=ut-austin", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.217" },
      body: JSON.stringify({
        stops: selected.map((b) => ({
          lat: b.lat,
          lng: b.lng,
          buildingId: b.id,
        })),
      }),
    }),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).legs[0].source).toBe("campus-network");
  const bad = await resolvePOST(
    new Request("http://localhost/api/map/resolve?campus=bad", {
      method: "POST",
      body: JSON.stringify({ locations: [] }),
    }),
  );
  expect(bad.status).toBe(400);
});

function directedFixture(lengths: { from: number; to: number; length: number }[]) {
  return {
    schema_version: "0.1",
    dataset_id: "directed-fixture",
    revision: "1",
    demo: true,
    sources: [],
    features: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "f",
          geometry: null,
          properties: { kind: "path", name: null, source_ids: [], observed_at: null, evidence: "synthetic" },
        },
      ],
    },
    graph: {
      nodes: [
        [0, 0],
        [0.001, 0],
        [0.0001, 0],
      ].map((position, i) => ({ id: String(i), feature_id: "f", position, building_id: null, level_id: "outdoor" })),
      edges: lengths.map((e, i) => ({
        id: String(i),
        feature_id: "f",
        from: String(e.from),
        to: String(e.to),
        kind: "path",
        length_m: e.length,
        width_m: null,
        slope: null,
        cross_slope: null,
        step_height_m: null,
        surface: null,
        access: "allowed",
        evidence: "synthetic",
        observed_at: null,
      })),
    },
  };
}
test("directed routing uses the selected parallel edge and never creates a reverse edge", () => {
  const graph = createDatasetGraph(
    directedFixture([
      { from: 0, to: 1, length: 100 },
      { from: 0, to: 1, length: 2 },
    ]),
  );
  expect(graph.routeBetweenNodes(0, 1)).toEqual({
    nodePath: [0, 1],
    networkMeters: 2,
    durationSeconds: 2 / 1.4,
    stepsMeters: 0,
    roadCrossings: 0,
  });
  expect(graph.routeBetweenNodes(1, 0)).toBeNull();
});
test("accepted contract lengths shorter than geographic distance retain shortest-path correctness", () => {
  const graph = createDatasetGraph(
    directedFixture([
      { from: 0, to: 2, length: 10 },
      { from: 0, to: 1, length: 1 },
      { from: 1, to: 2, length: 1 },
    ]),
  );
  expect(graph.routeBetweenNodes(0, 2)).toEqual({
    nodePath: [0, 1, 2],
    networkMeters: 2,
    durationSeconds: 2 / 1.4,
    stepsMeters: 0,
    roadCrossings: 0,
  });
});

test("campus definition errors identify the boundary before extraction", () => {
  const temporary = mkdtempSync(join(tmpdir(), "campus-definition-test-"));
  const path = join(temporary, "definition.json");
  try {
    const valid = readDefinition(join(import.meta.dir, "../../../tools/campus-geodata/campuses/ut-austin.json"));
    for (const patch of [{bbox: {south: 91, north: 92, west: -97, east: -96}}, {osmQuery: null}, {nameCleanupWords: [42]}, {catalogue: {kind: "guess", sources: []}}]) {
      writeFileSync(path, JSON.stringify({...valid, ...patch}));
      expect(() => readDefinition(path)).toThrow("Invalid campus definition");
    }
    writeFileSync(path, JSON.stringify(valid));
    expect(readDefinition(path).id).toBe("ut-austin");
  } finally { rmSync(temporary, {recursive: true, force: true}); }
});
