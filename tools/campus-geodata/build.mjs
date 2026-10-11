#!/usr/bin/env node
/**
 * Builds the committed campus routing artifacts from the raw Overpass
 * snapshot in raw/:
 *
 *   frontend/src/lib/campus/data/walkways.json   — walkway graph (nodes + ways)
 *   frontend/src/lib/campus/data/buildings.json  — building outlines, names, refs, entrances
 *   receipt.json                                 — provenance: queries, timestamps, sha256 of
 *                                                  raw inputs and every output
 *
 * Deterministic: the same raw snapshot always produces byte-identical outputs.
 *
 * Usage: node tools/campus-geodata/build.mjs
 *
 * Data (c) OpenStreetMap contributors, ODbL 1.0. See README.md in this directory.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rawDir = join(here, "raw");
const repoRoot = join(here, "..", "..");
const outDir = join(repoRoot, "frontend", "src", "lib", "campus", "data");
const receiptPath = join(here, "receipt.json");

const RAW = {
  pedestrian: join(rawDir, "overpass-pedestrian-snapshot.json"),
  buildings: join(rawDir, "overpass-buildings-snapshot.json"),
};

const ATTRIBUTION = "© OpenStreetMap contributors (data: ODbL 1.0)";
const SOURCE_URLS = {
  pedestrian: "https://overpass-api.de/api/interpreter (mirror: https://overpass.kumi.systems/api/interpreter)",
  buildings: "https://overpass-api.de/api/interpreter (mirror: https://overpass.kumi.systems/api/interpreter)",
};

// Pedestrian-usable way classes (see README "Way filter"). Mirrors the filter
// documented in evals/fixtures/METHOD.md so fixture distances and runtime
// distances are comparable. "crossing" and "sidewalk" are footway subtypes
// promoted to classes (per METHOD.md's edge classification).
const KEEP_HIGHWAY = new Set([
  "footway", "steps", "path", "pedestrian", "corridor", "living_street",
  "service", "residential", "unclassified", "tertiary", "secondary", "primary",
  "tertiary_link", "secondary_link", "primary_link", "track", "road",
]);
const CLASS_LIST = ["crossing", "sidewalk", ...[...KEEP_HIGHWAY].sort()].sort();

const EARTH_RADIUS_M = 6371000;
const NODE_KEY_DP = 8; // node keying only
const OUT_DP = 7; // output coordinates (~1 cm)

function haversine(aLat, aLng, bLat, bLng) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function round(value, dp) {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

function sha256Of(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isFootUsable(tags) {
  if (!tags || typeof tags.highway !== "string" || !KEEP_HIGHWAY.has(tags.highway)) return false;
  if (tags.foot === "no") return false;
  const restrictedAccess = tags.access === "no" || tags.access === "private";
  const footOverride = tags.foot === "yes" || tags.foot === "designated" || tags.foot === "permissive";
  if (restrictedAccess && !footOverride) return false;
  return true;
}

function wayClass(tags) {
  if (tags.footway === "crossing") return { c: "crossing", s: null };
  if (tags.footway === "sidewalk") return { c: "sidewalk", s: null };
  return { c: tags.highway, s: tags.footway && tags.footway !== "crossing" && tags.footway !== "sidewalk" ? tags.footway : null };
}

// Local equirectangular projection around a reference latitude (meters).
function makeProjector(refLat) {
  const latScale = (Math.PI / 180) * EARTH_RADIUS_M;
  const lngScale = latScale * Math.cos((refLat * Math.PI) / 180);
  return {
    toXY: (lat, lng) => [lng * lngScale, lat * latScale],
    fromXY: (x, y) => [y / latScale, x / lngScale],
  };
}

function polygonAreaMeters(coords) {
  // coords: [[lat, lng], ...] closed ring (first == last) or open ring.
  const proj = makeProjector(coords[0][0]);
  const ring = coords.map(([lat, lng]) => proj.toXY(lat, lng));
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

function polygonCentroid(coords) {
  const proj = makeProjector(coords[0][0]);
  const ring = coords.map(([lat, lng]) => proj.toXY(lat, lng));
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    a += cross;
    cx += (ring[i][0] + ring[i + 1][0]) * cross;
    cy += (ring[i][1] + ring[i + 1][1]) * cross;
  }
  if (a === 0) {
    const sum = ring.slice(0, -1).reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
    const n = ring.length - 1 || 1;
    return proj.fromXY(sum[0] / n, sum[1] / n);
  }
  a /= 2;
  return proj.fromXY(cx / (6 * a), cy / (6 * a));
}

function pointInPolygon(lat, lng, ring) {
  // Ray casting; ring is [lat, lng][] (open or closed).
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    const intersects =
      lngI > lng !== lngJ > lng && lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI;
    if (intersects) inside = !inside;
  }
  if (inside) return true;
  // Boundary tolerance: within 1 m of an edge counts as inside.
  const proj = makeProjector(lat);
  const [px, py] = proj.toXY(lat, lng);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, ay] = proj.toXY(ring[j][0], ring[j][1]);
    const [bx, by] = proj.toXY(ring[i][0], ring[i][1]);
    const abx = bx - ax;
    const aby = by - ay;
    const lengthSq = abx * abx + aby * aby;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq));
    const dx = px - (ax + t * abx);
    const dy = py - (ay + t * aby);
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

function segmentDistanceMeters(point, a, b) {
  const proj = makeProjector(point[0]);
  const [px, py] = proj.toXY(point[0], point[1]);
  const [ax, ay] = proj.toXY(a[0], a[1]);
  const [bx, by] = proj.toXY(b[0], b[1]);
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq));
  const dx = px - (ax + t * abx);
  const dy = py - (ay + t * aby);
  return Math.sqrt(dx * dx + dy * dy);
}

function main() {
  for (const path of Object.values(RAW)) {
    if (!existsSync(path)) {
      console.error(`BLOCKER: missing raw snapshot ${path}. Run fetch-osm.mjs first.`);
      process.exitCode = 1;
      return;
    }
  }

  const rawBuffers = {
    pedestrian: readFileSync(RAW.pedestrian),
    buildings: readFileSync(RAW.buildings),
  };
  const raw = {
    pedestrian: JSON.parse(rawBuffers.pedestrian.toString("utf8")),
    buildings: JSON.parse(rawBuffers.buildings.toString("utf8")),
  };

  // ---- walkways ----------------------------------------------------------
  const nodeIndexByKey = new Map();
  const nodes = []; // [lat, lng] pairs, output-rounded
  function nodeIndexFor(lat, lng) {
    const key = `${round(lat, NODE_KEY_DP)},${round(lng, NODE_KEY_DP)}`;
    const existing = nodeIndexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodes.push([round(lat, OUT_DP), round(lng, OUT_DP)]);
    nodeIndexByKey.set(key, index);
    return index;
  }

  const rawWays = raw.pedestrian.elements.filter((el) => el.type === "way" && Array.isArray(el.geometry));
  const usableWays = [];
  // Nodes may be kept only inside the query bbox plus a 0.002° margin:
  // Overpass returns whole ways that merely intersect the bbox, and their far
  // nodes can sit well outside it. Ways split at dropped nodes so no edge is
  // fabricated across the gap.
  const NODE_BOX = { south: 33.2005, west: -97.1605, north: 33.2195, east: -97.1325 };
  for (const way of rawWays) {
    if (!isFootUsable(way.tags ?? {})) continue;
    const coords = way.geometry.map((point) => [point.lat, point.lon ?? point.lng]);
    if (coords.length < 2) continue;
    const c = wayClass(way.tags ?? {});
    const fragments = [];
    let n = [];
    let lastIdx = -2;
    for (let idx = 0; idx < coords.length; idx += 1) {
      const [lat, lng] = coords[idx];
      const usableCoord =
        Number.isFinite(lat) && Number.isFinite(lng) &&
        lat >= NODE_BOX.south && lat <= NODE_BOX.north &&
        lng >= NODE_BOX.west && lng <= NODE_BOX.east;
      if (!usableCoord) {
        if (n.length >= 2) fragments.push(n);
        n = [];
        lastIdx = -2;
        continue;
      }
      if (n.length > 0 && idx !== lastIdx + 1) {
        // Node(s) were skipped between the last kept node and this one:
        // break the fragment instead of fabricating a long edge.
        if (n.length >= 2) fragments.push(n);
        n = [];
      }
      const index = nodeIndexFor(lat, lng);
      if (n.length === 0 || n[n.length - 1] !== index) n.push(index);
      lastIdx = idx;
    }
    if (n.length >= 2) fragments.push(n);
    for (const frag of fragments) usableWays.push({ osmId: way.id, c, n: frag });
  }
  usableWays.sort((a, b) => a.osmId - b.osmId);

  // Unique undirected edges + adjacency for connectivity stats.
  const edgeSet = new Set();
  for (const way of usableWays) {
    for (let i = 0; i < way.n.length - 1; i += 1) {
      const a = way.n[i];
      const b = way.n[i + 1];
      edgeSet.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }
  const adjacency = new Map();
  for (const key of edgeSet) {
    const [a, b] = key.split(":").map(Number);
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }
  // Largest connected component share (union-find over edges).
  const parent = new Array(nodes.length).fill(-1).map((_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  for (const key of edgeSet) {
    const [a, b] = key.split(":").map(Number);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const componentSize = new Map();
  for (let i = 0; i < nodes.length; i += 1) {
    const root = find(i);
    componentSize.set(root, (componentSize.get(root) ?? 0) + 1);
  }
  const componentSizes = [...componentSize.values()].sort((a, b) => b - a);
  const largestShare = componentSizes.length ? componentSizes[0] / nodes.length : 0;

  // Hard validation: a single NaN/undefined coordinate silently poisons every
  // haversine distance downstream (this bit once shipped NaN edge weights),
  // so refuse to emit anything unless every node coordinate is finite and
  // inside the bbox.
  for (const [lat, lng] of nodes) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`non-finite node coordinate produced by extraction: ${lat},${lng}`);
    }
    if (
      lat < 33.15 || lat > 33.25 || lng < -97.21 || lng > -97.08
    ) {
      // Coarse sanity window (~5 km): the real guard against garbage
      // coordinates is the finite test above; anything this far out is a
      // broken extraction, not legitimate way overshoot.
      throw new Error(`node coordinate far outside the campus area: ${lat},${lng}`);
    }
  }
  if (!(largestShare > 0.9)) {
    throw new Error(`walkway graph is too fragmented: largest component covers ${(largestShare * 100).toFixed(2)}% of nodes`);
  }

  const walkways = {
    meta: {
      attribution: ATTRIBUTION,
      source: SOURCE_URLS.pedestrian,
      license: "Open Database License (ODbL) v1.0 — https://opendatacommons.org/licenses/odbl/1-0/",
      bbox: { south: 33.2025, west: -97.1585, north: 33.2175, east: -97.1345 },
      fetchedAt: raw.pedestrian.osm3s?.timestamp_osm ?? null,
      nodeCount: nodes.length,
      wayCount: usableWays.length,
      edgeCount: edgeSet.size,
      classes: CLASS_LIST,
      generatedBy: "tools/campus-geodata/build.mjs",
      wayFilter:
        "highway in {footway, steps, path, pedestrian, corridor, living_street, service, residential, unclassified, tertiary, secondary, primary, tertiary_link, secondary_link, primary_link, track, road}, foot != no, not (access in {no, private} unless foot in {yes, designated, permissive})",
    },
    nodes,
    ways: usableWays.map((way) => ({
      i: way.osmId,
      c: CLASS_LIST.indexOf(way.c),
      s: way.s === "crossing" ? 1 : way.s === "sidewalk" ? 2 : 0,
      n: way.n,
    })),
  };

  // ---- buildings ----------------------------------------------------------
  const buildingWays = raw.buildings.elements
    .filter((el) => el.type === "way" && Array.isArray(el.geometry) && el.geometry.length > 2)
    .filter((el) => el.tags && typeof el.tags.building === "string");
  const buildings = [];
  for (const way of buildingWays) {
    const coords = way.geometry.map((point) => [point.lat, point.lon ?? point.lng]).filter((p) => p[0] !== null && p[1] !== null);
    if (coords.length < 3) continue;
    const closed =
      Math.abs(coords[0][0] - coords[coords.length - 1][0]) < 1e-9 &&
      Math.abs(coords[0][1] - coords[coords.length - 1][1]) < 1e-9;
    if (!closed) continue;
    const ring = coords.slice(0, -1); // drop the duplicate closing vertex
    if (ring.length < 3) continue;
    const centroid = polygonCentroid(ring);
    buildings.push({
      osmId: way.id,
      name: way.tags.name ?? null,
      ref: way.tags.ref ?? null,
      centroid: [round(centroid[0], OUT_DP), round(centroid[1], OUT_DP)],
      areaM2: round(polygonAreaMeters(ring), 1),
      ring: ring.map(([lat, lng]) => [round(lat, OUT_DP), round(lng, OUT_DP)]),
      entrances: [],
    });
  }
  buildings.sort((a, b) => a.osmId - b.osmId);

  // Attach entrance nodes to the building polygon that contains them (or the
  // nearest polygon within 25 m, for entrances mapped just off the outline).
  const entranceNodes = raw.buildings.elements
    .filter((el) => el.type === "node" && el.tags && (el.tags.highway === "entrance" || typeof el.tags.entrance === "string"))
    .map((el) => ({ lat: el.lat, lng: el.lon, kind: el.tags.entrance ?? "yes" }));
  let attached = 0;
  for (const node of entranceNodes) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const building of buildings) {
      if (pointInPolygon(node.lat, node.lng, building.ring)) {
        best = building;
        bestDistance = 0;
        break;
      }
      const distance = Math.min(
        ...building.ring.map((vertex, index) => {
          const next = building.ring[(index + 1) % building.ring.length];
          return segmentDistanceMeters([node.lat, node.lng], vertex, next);
        }),
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = building;
      }
    }
    if (best && bestDistance <= 25) {
      best.entrances.push([round(node.lat, OUT_DP), round(node.lng, OUT_DP)]);
      attached += 1;
    }
  }
  for (const building of buildings) {
    building.entrances.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  const buildingsOut = {
    meta: {
      attribution: ATTRIBUTION,
      source: SOURCE_URLS.buildings,
      license: "Open Database License (ODbL) v1.0 — https://opendatacommons.org/licenses/odbl/1-0/",
      bbox: walkways.meta.bbox,
      fetchedAt: raw.buildings.osm3s?.timestamp_osm ?? null,
      buildingCount: buildings.length,
      entranceNodeCount: attached,
      generatedBy: "tools/campus-geodata/build.mjs",
    },
    buildings,
  };

  // ---- write outputs + receipt -------------------------------------------
  mkdirSync(outDir, { recursive: true });
  const walkwaysJson = JSON.stringify(walkways);
  const buildingsJson = JSON.stringify(buildingsOut);
  writeFileSync(join(outDir, "walkways.json"), walkwaysJson);
  writeFileSync(join(outDir, "buildings.json"), buildingsJson);

  const outputPaths = {
    walkways: join(outDir, "walkways.json"),
    buildings: join(outDir, "buildings.json"),
  };
  const receipt = {
    generatedAt: new Date().toISOString(),
    generator: "tools/campus-geodata/build.mjs",
    commands: {
      fetch: "node tools/campus-geodata/fetch-osm.mjs [--refresh]",
      build: "node tools/campus-geodata/build.mjs",
    },
    attribution: ATTRIBUTION,
    license: "OpenStreetMap data is available under the Open Database License (ODbL) v1.0; this summary does not alter that terms set. Keep the attribution '© OpenStreetMap contributors' with any use of the data.",
    sourceUrls: SOURCE_URLS,
    queries: {
      pedestrian:
        '[out:json][timeout:180];(way["highway"](33.2025,-97.1585,33.2175,-97.1345););out geom qt;',
      buildings:
        '[out:json][timeout:180];(way["building"](33.2025,-97.1585,33.2175,-97.1345);node["entrance"](33.2025,-97.1585,33.2175,-97.1345);node["highway"="entrance"](33.2025,-97.1585,33.2175,-97.1345););out geom qt;',
    },
    raw: Object.fromEntries(
      Object.entries(RAW).map(([kind, path]) => [
        kind,
        { path: relative(repoRoot, path), sha256: sha256Of(rawBuffers[kind]), bytes: rawBuffers[kind].length },
      ]),
    ),
    outputs: Object.fromEntries(
      Object.entries(outputPaths).map(([kind, path]) => [
        kind,
        {
          path: relative(repoRoot, path),
          sha256: sha256Of(kind === "walkways" ? walkwaysJson : buildingsJson),
          bytes: (kind === "walkways" ? walkwaysJson : buildingsJson).length,
        },
      ]),
    ),
    counts: {
      rawPedestrianWays: rawWays.length,
      footUsableWays: usableWays.length,
      graphNodes: nodes.length,
      graphEdges: edgeSet.size,
      buildingOutlines: buildings.length,
      entranceNodes: entranceNodes.length,
      entranceNodesAttached: attached,
    },
    connectivity: {
      largestComponentNodes: componentSizes.length ? componentSizes[0] : 0,
      componentCount: componentSizes.length,
      largestComponentShare: round(largestShare, 4),
    },
  };
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");

  console.log(`walkways: ${nodes.length} nodes, ${edgeSet.size} edges, ${usableWays.length} ways`);
  console.log(`buildings: ${buildings.length} outlines, ${attached} entrance nodes attached`);
  console.log(`largest walkway component: ${receipt.connectivity.largestComponentShare * 100}% of nodes`);
  console.log(`wrote ${relative(repoRoot, outputPaths.walkways)} (${walkwaysJson.length} bytes)`);
  console.log(`wrote ${relative(repoRoot, outputPaths.buildings)} (${buildingsJson.length} bytes)`);
  console.log(`wrote ${relative(repoRoot, receiptPath)}`);
}

main();
