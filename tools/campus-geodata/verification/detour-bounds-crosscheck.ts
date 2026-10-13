/**
 * detour-bounds-crosscheck.ts — hand cross-check of detour outliers.
 *
 * Run: bun tools/campus-geodata/verification/detour-bounds-crosscheck.ts
 *
 * Companion to detour-bounds.ts: it
 *   1. re-runs an independent Dijkstra over walkways.json between the two
 *      matrix anchor nodes and asserts the length equals the matrix's meters
 *      entry (the A* cross-check), plus prints the same-anchor margin —
 *      dijkstra minus the anchor-to-anchor great-circle distance, which is
 *      >= 0 up to float error by the geodesic triangle inequality;
 *   2. maps every path edge back to its OSM way in the raw Overpass snapshot
 *      (tools/campus-geodata/raw/overpass-pedestrian-snapshot.json) so the
 *      route's streets, crossings and steps can be read from source tags,
 *   3. samples the straight lines between registry pins and between walkway
 *      anchors and reports which building outlines they pierce (the "is a
 *      building really in the way?" test),
 *   4. derives the steps share the matrix's own speed model implies:
 *      seconds = base/1.4 + steps/0.6 and meters = base + steps, so
 *      steps = 0.75 * (1.4 * seconds - meters).
 *
 * Subjects (review round 2): the three largest flagged ratios plus every
 * same-anchor floor violator are read from the companion evidence JSON
 * written by detour-bounds.ts — the single source of truth — so a basis
 * change can never leave this script tracing stale pairs. Two supplementary
 * short-crow cluster representatives are hardcoded by name below.
 *
 * Registry pins are hardcoded below from frontend/src/lib/campus-locations.ts
 * (kept in step with that file by hand — this script is a one-off
 * investigation aid, not a build step). All other inputs are the committed
 * JSON artifacts; no frontend module is imported.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

type LL = [number, number];

const walk = JSON.parse(readFileSync(join(ROOT, "frontend/src/lib/campus/data/walkways.json"), "utf8")) as {
  nodes: LL[];
  ways: { i: number; c: number; s: number; n: number[] }[];
  meta: { classes: string[] };
};
const wt = JSON.parse(readFileSync(join(ROOT, "frontend/src/lib/campus/data/walking-times.json"), "utf8")) as {
  anchors: Record<string, { anchor: LL }>;
  meters: Record<string, Record<string, number>>;
  seconds: Record<string, Record<string, number>>;
};
const outlines = (JSON.parse(readFileSync(join(ROOT, "frontend/src/lib/campus/data/buildings.json"), "utf8")) as {
  buildings: { osmId: number; centroid: LL; ring: LL[] }[];
}).buildings;

const R = 6371000;

function hav(a: LL, b: LL): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pointInPolygon(lat: number, lng: number, ring: LL[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    if (lngI > lng !== lngJ > lng && lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI) inside = !inside;
  }
  return inside;
}

type Edge = { to: number; meters: number; wayIdx: number };
const adj: Edge[][] = walk.nodes.map(() => []);
for (let w = 0; w < walk.ways.length; w += 1) {
  const { n } = walk.ways[w];
  for (let k = 0; k + 1 < n.length; k += 1) {
    const a = n[k];
    const b = n[k + 1];
    if (a === b) continue;
    const m = hav(walk.nodes[a], walk.nodes[b]);
    adj[a].push({ to: b, meters: m, wayIdx: w });
    adj[b].push({ to: a, meters: m, wayIdx: w });
  }
}

function nodeIndexByCoords(target: LL): number {
  for (let i = 0; i < walk.nodes.length; i += 1) {
    if (walk.nodes[i][0] === target[0] && walk.nodes[i][1] === target[1]) return i;
  }
  throw new Error(`no walkway node at ${target.join(",")}`);
}

function dijkstra(start: number, goal: number): { dist: number; nodes: number[]; waysUsed: number[] } {
  const dist = new Array(walk.nodes.length).fill(Infinity);
  const prev: (number | null)[] = new Array(walk.nodes.length).fill(null);
  const prevWay: number[] = new Array(walk.nodes.length).fill(-1);
  const visited = new Array(walk.nodes.length).fill(false);
  dist[start] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < dist.length; i += 1) {
      if (!visited[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u === -1 || u === goal) break;
    visited[u] = true;
    for (const e of adj[u]) {
      if (dist[u] + e.meters < dist[e.to]) {
        dist[e.to] = dist[u] + e.meters;
        prev[e.to] = u;
        prevWay[e.to] = e.wayIdx;
      }
    }
  }
  const nodes: number[] = [];
  const ways: number[] = [];
  for (let cur: number | null = goal; cur !== null; cur = prev[cur]) {
    nodes.push(cur);
    if (prevWay[cur] >= 0) ways.push(prevWay[cur]);
  }
  nodes.reverse();
  return { dist: dist[goal], nodes, waysUsed: [...new Set(ways.reverse())] };
}

const rawWays = new Map<number, { tags: Record<string, string> }>();
const rawAll = JSON.parse(
  readFileSync(join(ROOT, "tools/campus-geodata/raw/overpass-pedestrian-snapshot.json"), "utf8"),
) as { elements: { type: string; id: number; tags?: Record<string, string> }[] };
for (const el of rawAll.elements) {
  if (el.type === "way") rawWays.set(el.id, { tags: el.tags ?? {} });
}

function describeWay(osmWayId: number): string {
  const raw = rawWays.get(osmWayId);
  if (!raw) return `osm/${osmWayId} (NOT IN RAW SNAPSHOT)`;
  const t = raw.tags;
  const extras = ["footway", "steps", "indoor", "covered", "tunnel", "bridge"]
    .filter((k) => t[k] !== undefined)
    .map((k) => `, ${k}=${t[k]}`)
    .join("");
  return `osm/${osmWayId} ${t.name ?? "(unnamed)"} [highway=${t.highway ?? "?"}${extras}]`;
}

/**
 * Registry pins and names, parsed at run time from
 * frontend/src/lib/campus-locations.ts — no hand-maintained copy that can go
 * stale when the registry grows (the round-1 hardcoded 8-building list broke
 * the moment the evidence-driven subjects reached other buildings).
 */
function parseRegistry(): { pins: Record<string, LL>; names: Record<string, string> } {
  const source = readFileSync(join(ROOT, "frontend/src/lib/campus-locations.ts"), "utf8");
  const entryRe = /id:\s*"([^"]+)",\s*\n\s*name:\s*"([^"]+)",[\s\S]*?lat:\s*(-?\d+(?:\.\d+)?),\s*lng:\s*(-?\d+(?:\.\d+)?),/g;
  const pins: Record<string, LL> = {};
  const names: Record<string, string> = {};
  for (const match of source.matchAll(entryRe)) {
    const [, id, name, lat, lng] = match;
    pins[id] = [Number(lat), Number(lng)];
    names[id] = name;
  }
  if (Object.keys(pins).length === 0) throw new Error("parsed zero registry entries from campus-locations.ts — parser out of step with the file");
  return { pins, names };
}

const { pins: PINS, names: NAMES } = parseRegistry();

const LINE_SAMPLES = 200;

function piercedOutlines(from: LL, to: LL): number[] {
  const hit = new Set<number>();
  for (let s = 0; s <= LINE_SAMPLES; s += 1) {
    const lat = from[0] + ((to[0] - from[0]) * s) / LINE_SAMPLES;
    const lng = from[1] + ((to[1] - from[1]) * s) / LINE_SAMPLES;
    for (const o of outlines) {
      if (pointInPolygon(lat, lng, o.ring)) hit.add(o.osmId);
    }
  }
  return [...hit].sort((a, b) => a - b);
}

function analyzePair(fromId: string, toId: string, tag: string): void {
  if (!PINS[fromId] || !PINS[toId]) throw new Error(`no registry pin for ${fromId} / ${toId} — is it in campus-locations.ts?`);
  console.log(`\n===== ${fromId} (${NAMES[fromId]}) -> ${toId} (${NAMES[toId]}) [${tag}] =====`);
  const a = nodeIndexByCoords(wt.anchors[fromId].anchor);
  const b = nodeIndexByCoords(wt.anchors[toId].anchor);
  const result = dijkstra(a, b);
  const matrixMeters = wt.meters[fromId][toId];
  const anchorCrow = hav(wt.anchors[fromId].anchor, wt.anchors[toId].anchor);
  const agreement = Math.abs(result.dist - matrixMeters) <= 0.15;
  const sameAnchorMargin = result.dist - anchorCrow;
  console.log(
    `dijkstra ${result.dist.toFixed(4)} m vs matrix meters ${matrixMeters} m ` +
      `(${agreement ? "AGREE" : "MISMATCH"}) over ${result.nodes.length} nodes / ${result.waysUsed.length} ways:`,
  );
  console.log(
    `same-anchor floor margin: dijkstra minus anchor crow ${anchorCrow.toFixed(4)} m = ${sameAnchorMargin.toFixed(4)} m ` +
      `(${sameAnchorMargin >= -1e-9 ? ">= 0 up to float error — geodesic triangle inequality holds" : "NEGATIVE — geometrically impossible, investigate"})`,
  );
  for (const w of result.waysUsed) console.log(`  - ${describeWay(walk.ways[w].i)}`);
  const pinPierced = piercedOutlines(PINS[fromId], PINS[toId]);
  const anchorPierced = piercedOutlines(wt.anchors[fromId].anchor, wt.anchors[toId].anchor);
  console.log(`pin-to-pin line pierces outlines: ${pinPierced.join(", ") || "none"}`);
  console.log(`anchor-to-anchor line pierces outlines: ${anchorPierced.join(", ") || "none"}`);
  const stepsShare = 0.75 * (1.4 * wt.seconds[fromId][toId] - matrixMeters);
  console.log(
    `steps share implied by the matrix speed model: ${stepsShare.toFixed(1)} m of ${matrixMeters} m; ` +
      `crow pins ${hav(PINS[fromId], PINS[toId]).toFixed(1)} m, crow anchors ${anchorCrow.toFixed(1)} m`,
  );
  if (!agreement) process.exitCode = 1;
}

// Primary subjects are read from the companion evidence JSON (single source
// of truth): the three largest flagged ratios plus every same-anchor floor
// violator. Then two supplementary short-crow cluster representatives.
const evidence = JSON.parse(
  readFileSync(join(HERE, "detour-bounds-evidence.json"), "utf8"),
) as {
  enforcement?: { sameAnchorFloor?: { violations?: { from: string; to: string }[] } };
  summary?: { flaggedPairs?: { from: string; to: string; ratio: number }[] };
};

const flagged = evidence.summary?.flaggedPairs ?? [];
if (flagged.length === 0) {
  throw new Error(
    "no flagged pairs in detour-bounds-evidence.json — regenerate the evidence first (bun tools/campus-geodata/verification/detour-bounds.ts)",
  );
}
const topThree = [...flagged]
  .sort((x, y) => y.ratio - x.ratio || (x.from + x.to).localeCompare(y.from + y.to))
  .slice(0, 3)
  .map((p) => ({ pair: [p.from, p.to] as [string, string], tag: "top-flagged" }));
const violators = (evidence.enforcement?.sameAnchorFloor?.violations ?? []).map((v) => ({
  pair: [v.from, v.to] as [string, string],
  tag: "floor-violation",
}));
const supplementary = ([
  ["cury", "lang"],
  ["aud", "cury"],
] as [string, string][]).map((p) => ({ pair: p, tag: "supplementary" }));

const subjects = new Map<string, { pair: [string, string]; tag: string }>();
for (const s of [...topThree, ...violators, ...supplementary]) {
  const key = `${s.pair[0]}->${s.pair[1]}`;
  if (!subjects.has(key)) subjects.set(key, s);
}
console.log(`cross-check subjects (evidence-driven + named supplements): ${[...subjects.keys()].join(", ")}`);
for (const { pair, tag } of subjects.values()) analyzePair(pair[0], pair[1], tag);
