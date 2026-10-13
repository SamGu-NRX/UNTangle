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
import { campusEngine, createCampusEngineRegistry, type CampusEngine } from "@/lib/campus/engine";
import { pedestrianDirections } from "../../../tools/campus-geodata/pedestrian-directions.mjs";

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

describe("explicit pedestrian direction restrictions survive the offline kit", () => {
  const cases: { tags: Record<string, string>; forward: boolean; backward: boolean }[] = [
    { tags: { "oneway:foot": "yes" }, forward: true, backward: false },
    { tags: { "oneway:foot": "-1" }, forward: false, backward: true },
    { tags: { "foot:backward": "no" }, forward: true, backward: false },
    { tags: { "foot:forward": "no" }, forward: false, backward: true },
    { tags: { "access:backward": "private" }, forward: true, backward: false },
    { tags: { "access:backward": "private", "foot:backward": "yes" }, forward: true, backward: true },
    { tags: { access: "private", "foot:forward": "yes" }, forward: true, backward: false },
    { tags: { foot: "no", "foot:backward": "yes" }, forward: false, backward: true },
    { tags: { oneway: "yes" }, forward: true, backward: true },
    { tags: { oneway: "yes", "oneway:foot": "no" }, forward: true, backward: true },
  ];
  for (const { tags, forward, backward } of cases) {
    test(JSON.stringify(tags), () => {
      const temporary = mkdtempSync(join(tmpdir(), "campus-kit-direction-"));
      try {
        const definitionPath = join(temporary, "campus.json");
        writeFileSync(definitionPath, JSON.stringify({
          ...readDefinition(join(import.meta.dir, "../../../tools/campus-geodata/campuses/ut-austin.json")),
          id: "fixture-campus",
          catalogue: { kind: "osm-names", sources: ["https://www.openstreetmap.org/copyright"] },
        }));
        const snapshot = {
          osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
          elements: [
            { type: "way", id: 10, tags: { highway: "footway", ...tags }, geometry: [
              { lat: 30.285, lon: -97.737 }, { lat: 30.285, lon: -97.735 },
            ] },
            // A legal detour keeps both catalogue directions reachable.
            { type: "way", id: 11, tags: { highway: "footway" }, geometry: [
              { lat: 30.285, lon: -97.737 }, { lat: 30.286, lon: -97.737 },
              { lat: 30.286, lon: -97.735 }, { lat: 30.285, lon: -97.735 },
            ] },
            { type: "way", id: 20, tags: { building: "yes", name: "Library" }, geometry: [
              { lat: 30.2851, lon: -97.7371 }, { lat: 30.2851, lon: -97.7369 },
              { lat: 30.2853, lon: -97.7369 }, { lat: 30.2853, lon: -97.7371 },
              { lat: 30.2851, lon: -97.7371 },
            ] },
          ],
        };
        for (const kind of ["pedestrian", "buildings"])
          writeFileSync(join(temporary, `fixture-campus-${kind}.json`), JSON.stringify(snapshot));
        const { dataset } = buildCampus(definitionPath, join(temporary, "out"), temporary);
        const feature = dataset.features.features.find(f => f.id.startsWith("w:10:"))!;
        expect(feature.properties.osm_direction_tags).toEqual(Object.fromEntries(Object.entries(tags).filter(([key]) => key !== "access" && key !== "foot")));
        const nodes = dataset.graph.nodes;
        const from = nodes.findIndex(n => n.position[0] === -97.737 && n.position[1] === 30.285);
        const to = nodes.findIndex(n => n.position[0] === -97.735 && n.position[1] === 30.285);
        const edges = dataset.graph.edges.filter(e => e.feature_id === feature.id);
        expect(edges.some(e => e.from === nodes[from].id && e.to === nodes[to].id)).toBe(forward);
        expect(edges.some(e => e.from === nodes[to].id && e.to === nodes[from].id)).toBe(backward);
        const graph = createDatasetGraph(dataset);
        expect(graph.routeBetweenNodes(from, to)!.nodePath).toHaveLength(forward ? 2 : 4);
        expect(graph.routeBetweenNodes(to, from)!.nodePath).toHaveLength(backward ? 2 : 4);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    });
  }

  test("unsupported pedestrian direction values and conditions fail loudly", () => {
    expect(() => pedestrianDirections({ "oneway:foot": "reversible" }, 10)).toThrow("OSM way 10: unsupported oneway:foot=reversible");
    expect(() => pedestrianDirections({ "oneway:foot:conditional": "yes @ (Mo-Fr)" }, 10)).toThrow("unsupported pedestrian direction tag");
    expect(() => pedestrianDirections({ "foot:backward": "destination" }, 10)).toThrow("unsupported foot:backward=destination");
  });

  test("the historical reciprocal exception cannot be enabled for another campus", () => {
    const temporary = mkdtempSync(join(tmpdir(), "campus-kit-policy-"));
    try {
      const path = join(temporary, "campus.json");
      writeFileSync(path, JSON.stringify({
        ...readDefinition(join(import.meta.dir, "../../../tools/campus-geodata/campuses/ut-austin.json")),
        pedestrianDirectionPolicy: "legacy-unt-reciprocal",
      }));
      expect(() => readDefinition(path)).toThrow("Invalid campus definition");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});

test("UNT rebuilds offline from pinned raw bytes and retains every route's tenths of seconds", () => {
  const kit = join(import.meta.dir, "../../../tools/campus-geodata");
  const raw = join(kit, "raw");
  expect(sha(readFileSync(join(raw, "overpass-pedestrian-snapshot.json")))).toBe("078e2a8c44f193a78a45a82a98ea51458206d6a4480631262def3caf7cadffc5");
  expect(sha(readFileSync(join(raw, "overpass-buildings-snapshot.json")))).toBe("f0997a5b389a67ee100f9f65d01e4a2c5ce1a91a5fc7cb436728d77566fdde98");
  const temporary = mkdtempSync(join(tmpdir(), "campus-kit-unt-"));
  try {
    buildCampus(join(kit, "campuses/unt-denton.json"), temporary, raw);
    const emitted = readFileSync(join(temporary, "walking-times.json"));
    // Rebuilt 2026-10-13 after MGYM, WSC2, PACX and SPHS joined the registry.
    expect(sha(emitted)).toBe("02fa5bc125c0609a3b7228832fc83eb90cfdbca735f8680b99b8fb6ae9942908");
    expect(emitted).toEqual(readFileSync(join(import.meta.dir, "../../src/lib/campus/data/walking-times.json")));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  for (const from of matrixBuildingIds())
    for (const to of matrixBuildingIds()) {
      const result = routeBetweenPoints(buildingAnchor(from)!.anchor, buildingAnchor(to)!.anchor);
      const expected = getWalkingSeconds(from, to);
      if (expected.seconds === null) throw new Error(`Missing UNT matrix pair ${from} -> ${to}`);
      expect(result?.durationSeconds).toBe(expected.seconds);
    }
}, 60000);

test("UT accented, decomposed and ASCII building names resolve to the same catalogue entry", () => {
  const resolver = campusResolver(utAustin);
  const accented = resolver.resolveBuilding("Perry-Castañeda Library");
  expect(accented).not.toBeNull();
  expect(resolver.resolveBuilding("Perry-Castaneda Library")?.id).toBe(accented!.id);
  expect(resolver.resolveBuilding("Perry-Castañeda Library".normalize("NFD"))?.id).toBe(accented!.id);
  const cleanup = createCampusResolver(utAustin.buildings, utAustin.bounds, ["Université"]);
  expect(cleanup.resolveBuilding("Universite Perry-Castaneda Library")?.id).toBe(accented!.id);
});

test("engine selection loads only the selected campus and caches concurrent and later selections", async () => {
  const loads = { unt: 0, ut: 0 };
  const unt: CampusEngine = { routeBetweenPoints: () => null, anchorFor: () => null };
  const ut: CampusEngine = { routeBetweenPoints: () => null, anchorFor: () => ({ lat: 30.28, lng: -97.74 }) };
  const select = createCampusEngineRegistry({
    "unt-denton": async () => { loads.unt++; return unt; },
    "ut-austin": async () => { loads.ut++; return ut; },
  });
  expect(loads).toEqual({ unt: 0, ut: 0 });
  expect(await select("unt-denton")).toBe(unt);
  expect(loads).toEqual({ unt: 1, ut: 0 });
  const first = select("ut-austin");
  expect(select("ut-austin")).toBe(first);
  expect(await first).toBe(ut);
  expect(await select("ut-austin")).toBe(ut);
  expect(await select("unt-denton")).toBe(unt);
  expect(loads).toEqual({ unt: 1, ut: 1 });
  expect(() => select("constructor")).toThrow('No walking engine for campus "constructor"');
  expect(loads).toEqual({ unt: 1, ut: 1 });
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

test("UT A* agrees with independent directed Dijkstra for deterministic sampled pairs", async () => {
  const graph = createDatasetGraph(utData);
  const engine = await campusEngine("ut-austin");
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
    const route = engine.routeBetweenPoints(
      engine.anchorFor(from)!,
      engine.anchorFor(to)!,
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

test("route rate limits share a campus's aliases while keeping other campuses independent", async () => {
  const request = (query: string) => new Request(`http://localhost/api/map/route${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": "192.0.2.36" },
    body: JSON.stringify({ stops: [] }),
  });
  for (let i = 0; i < 60; i++) expect((await routePOST(request(""))).status).toBe(400);
  expect((await routePOST(request("?campus=unt-denton"))).status).toBe(429);
  expect((await routePOST(request("?campus=ut-austin"))).status).toBe(400);
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
