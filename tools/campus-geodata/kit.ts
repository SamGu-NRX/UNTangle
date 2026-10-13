import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { campusBuildings } from "../../frontend/src/lib/campus-locations";
import type { CampusBuilding } from "../../frontend/src/lib/types";
import {
  createWalkwayGraph,
  type WalkwaysFile,
} from "../../frontend/src/lib/campus/graph";
import { buildMatrix, type BuildingOutlines } from "./build-matrix";
import { canonicalJson } from "../../frontend/src/lib/campus/contract/canonical";
import { toDataset, hash } from "./contract-build";

const here = import.meta.dir;
export type CampusDefinition = {
  id: string;
  bbox: { south: number; west: number; north: number; east: number };
  queries: { pedestrian: string; buildings: string };
  osmQuery: string;
  catalogue: {
    kind: "unt-registry" | "osm-names";
    sources: string[];
    includeOsmIds?: number[];
  };
  nodeMarginDegrees?: number;
  pedestrianDirectionPolicy?: "legacy-unt-reciprocal";
  geocode: { suffix: string; names: string[] };
  nameCleanupWords: string[];
};
export function readDefinition(path: string): CampusDefinition {
  const d = JSON.parse(readFileSync(path, "utf8"));
  if (
    !d ||
    typeof d.id !== "string" ||
    !/^[a-z][a-z0-9-]+$/.test(d.id) ||
    !d.bbox ||
    !["south", "west", "north", "east"].every((k) =>
      Number.isFinite(d.bbox[k]),
    ) ||
    d.bbox.south >= d.bbox.north ||
    d.bbox.west >= d.bbox.east ||
    d.bbox.south < -90 ||
    d.bbox.north > 90 ||
    d.bbox.west < -180 ||
    d.bbox.east > 180 ||
    typeof d.osmQuery !== "string" ||
    !d.osmQuery.length ||
    (d.pedestrianDirectionPolicy !== undefined &&
      (d.id !== "unt-denton" || d.pedestrianDirectionPolicy !== "legacy-unt-reciprocal")) ||
    (d.nodeMarginDegrees !== undefined &&
      (!Number.isFinite(d.nodeMarginDegrees) ||
        d.nodeMarginDegrees < 0)) ||
    (d.catalogue?.includeOsmIds !== undefined &&
      (!Array.isArray(d.catalogue.includeOsmIds) ||
        !d.catalogue.includeOsmIds.every(
          (id: unknown) => Number.isSafeInteger(id) && Number(id) > 0,
        ) ||
        new Set(d.catalogue.includeOsmIds).size !==
          d.catalogue.includeOsmIds.length)) ||
    !d.queries ||
    !["pedestrian", "buildings"].every(
      (k) => typeof d.queries[k] === "string" && d.queries[k].length,
    ) ||
    !["unt-registry", "osm-names"].includes(d.catalogue?.kind) ||
    !Array.isArray(d.catalogue.sources) ||
    !d.catalogue.sources.every((s: unknown) => typeof s === "string") ||
    typeof d.geocode?.suffix !== "string" ||
    !Array.isArray(d.geocode.names) ||
    !d.geocode.names.every((s: unknown) => typeof s === "string") ||
    !Array.isArray(d.nameCleanupWords) ||
    !d.nameCleanupWords.every(
      (s: unknown) => typeof s === "string" && s.length > 0,
    )
  )
    throw new Error(
      "Invalid campus definition: expected id, WGS84 bbox, OSM queries, catalogue source, geocode context and cleanup words",
    );
  return d;
}
export async function fetchCampus(d: CampusDefinition) {
  const raw = join(here, "raw");
  mkdirSync(raw, { recursive: true });
  const paths =
    d.id === "unt-denton"
      ? [
          "overpass-pedestrian-snapshot.json",
          "overpass-buildings-snapshot.json",
        ]
      : [`${d.id}-pedestrian.json`, `${d.id}-buildings.json`];
  if (paths.every((p) => existsSync(join(raw, p)))) return;
  // One combined query, at most two endpoint attempts. Cached replies are never refreshed implicitly.
  const query = d.osmQuery;
  for (const endpoint of [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ]) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "User-Agent":
          "UNTangle-campus-kit/1.0 (offline UNT and UT Austin walking research; https://github.com/SamGu-NRX/UNTangle)",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(240000),
    });
    if (!response.ok) {
      console.error(`Overpass ${endpoint}: HTTP ${response.status}`);
      continue;
    }
    const bytes = await response.text();
    const parsed = JSON.parse(bytes);
    if (!Array.isArray(parsed.elements) || parsed.remark)
      throw new Error(
        `Incomplete Overpass response: ${parsed.remark ?? "missing elements"}`,
      );
    for (const path of paths) writeFileSync(join(raw, path), bytes);
    writeFileSync(
      join(raw, `${d.id}-fetch.json`),
      JSON.stringify({
        endpoint,
        query,
        retrieved_at: new Date().toISOString(),
        osm_base_at:
          parsed.osm3s?.timestamp_osm_base ??
          parsed.osm3s?.timestamp_osm ??
          null,
        sha256: hash(bytes),
      }),
    );
    return;
  }
  throw new Error(
    "Overpass failed at both endpoints; cached inputs remain unchanged",
  );
}
export function buildCampus(
  definitionPath: string,
  outputDir?: string,
  rawDir = join(here, "raw"),
) {
  const d = readDefinition(definitionPath);
  const temporary = mkdtempSync(join(tmpdir(), "untangle-kit-"));
  try {
    const extraction = spawnSync(
      "node",
      [join(here, "build.mjs"), resolve(definitionPath), temporary, rawDir],
      { encoding: "utf8" },
    );
    if (extraction.status !== 0)
      throw new Error(extraction.stderr || extraction.stdout);
    const legacy: WalkwaysFile = JSON.parse(
      readFileSync(join(temporary, "walkways.json"), "utf8"),
    );
    const outlines: BuildingOutlines = JSON.parse(
      readFileSync(join(temporary, "buildings.json"), "utf8"),
    );
    const receipt = JSON.parse(
      readFileSync(join(temporary, "receipt.json"), "utf8"),
    );
    const fetchPath = join(rawDir, `${d.id}-fetch.json`);
    const fetchRecord = existsSync(fetchPath)
      ? JSON.parse(readFileSync(fetchPath, "utf8"))
      : null;
    const rawPedestrian = JSON.parse(
      readFileSync(
        join(
          rawDir,
          d.id === "unt-denton"
            ? "overpass-pedestrian-snapshot.json"
            : `${d.id}-pedestrian.json`,
        ),
        "utf8",
      ),
    );
    const dataset = toDataset(
      d.id,
      legacy,
      outlines,
      hash(
        JSON.stringify({
          definition: hash(readFileSync(definitionPath)),
          pedestrian: receipt.raw.pedestrian.sha256,
          buildings: receipt.raw.buildings.sha256,
        }),
      ),
      {
        retrievedAt: fetchRecord?.retrieved_at ?? null,
        osmBaseAt:
          rawPedestrian.osm3s?.timestamp_osm_base ??
          rawPedestrian.osm3s?.timestamp_osm ??
          null,
      },
      d.pedestrianDirectionPolicy,
    );
    const graph = createWalkwayGraph({ ...dataset, walking: legacy.meta });
    const catalogue: CampusBuilding[] =
      d.catalogue.kind === "unt-registry"
        ? campusBuildings
        : outlines.buildings
            .filter(
              (b) =>
                b.name &&
                (!d.catalogue.includeOsmIds ||
                  d.catalogue.includeOsmIds.includes(b.osmId)) &&
                graph.nearestWalkwayNode({
                  lat: b.centroid[0],
                  lng: b.centroid[1],
                }) !== null &&
                b.centroid[0] >= d.bbox.south &&
                b.centroid[0] <= d.bbox.north &&
                b.centroid[1] >= d.bbox.west &&
                b.centroid[1] <= d.bbox.east,
            )
            .map((b) => ({
              id: `osm-${b.osmId}`,
              name: b.name!,
              shortName: b.name!,
              lat: b.centroid[0],
              lng: b.centroid[1],
              aliases: [],
            }));
    if (catalogue.length === 0) throw new Error(`Campus "${d.id}" has no named, in-bounds, routable catalogue buildings`);
    if (d.catalogue.includeOsmIds) {
      const missing = d.catalogue.includeOsmIds.filter(
        (id) => !catalogue.some((b) => b.id === `osm-${id}`),
      );
      if (missing.length)
        throw new Error(
          `Catalogue selections lack an in-bounds routable OSM outline: ${missing.join(", ")}`,
        );
    }
    // UNT uses its historical walkway hash so the entire matrix stays byte-identical.
    const matrix = buildMatrix(
      catalogue,
      legacy,
      outlines,
      graph,
      d.catalogue.sources,
      receipt.outputs.walkways.sha256,
      d.id !== "unt-denton",
    );
    const artifacts = {
      "campus-map.json": JSON.stringify(JSON.parse(canonicalJson(dataset))),
      "catalogue.json": JSON.stringify(catalogue),
      "walking-times.json": JSON.stringify(matrix.output, null, 2) + "\n",
    };
    const verification = {
      campus: d.id,
      definitionSha256: hash(readFileSync(definitionPath)),
      raw: Object.fromEntries(
        Object.entries(
          receipt.raw as Record<
            string,
            { path: string; sha256: string; bytes: number }
          >,
        ).map(([kind, record]) => [
          kind,
          { ...record, path: `raw/${record.path.split("/").at(-1)}` },
        ]),
      ),
      queries: fetchRecord?.query ?? d.queries,
      source: fetchRecord,
      osmBaseAt: rawPedestrian.osm3s?.timestamp_osm_base ?? null,
      stats: {
        nodes: dataset.graph.nodes.length,
        edges: dataset.graph.edges.length,
        buildings: catalogue.length,
        named: dataset.features.features.filter((f) => f.properties.name)
          .length,
        widthKnown: dataset.graph.edges.filter((e) => e.width_m !== null)
          .length,
        slopeKnown: dataset.graph.edges.filter((e) => e.slope !== null).length,
        largestComponentShare: graph.walkwayGraphStats().largestComponentShare,
      },
      matrix: matrix.report,
      outputs: Object.fromEntries(
        Object.entries(artifacts).map(([name, bytes]) => [
          name,
          { sha256: hash(bytes), bytes: Buffer.byteLength(bytes) },
        ]),
      ),
    };
    const target =
      outputDir ??
      join(
        here,
        "../../frontend/src/lib/campus/data",
        d.id === "unt-denton" ? "" : d.id,
      );
    mkdirSync(target, { recursive: true });
    for (const [name, bytes] of Object.entries(artifacts))
      writeFileSync(join(target, name), bytes);
    writeFileSync(
      join(target, "verification.json"),
      JSON.stringify(verification, null, 2) + "\n",
    );
    return { dataset, catalogue, matrix, verification };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (import.meta.main) {
  const path = process.argv[2];
  if (!path)
    throw new Error(
      "Usage: bun --no-env-file tools/campus-geodata/kit.ts <campus-definition.json> [--fetch]",
    );
  const definition = readDefinition(path);
  if (process.argv.includes("--fetch")) await fetchCampus(definition);
  console.log(JSON.stringify(buildCampus(path).verification.stats));
}
