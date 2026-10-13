/**
 * independent-remeasure.ts — independent re-measurement of verification-report.md §2.
 *
 * Run: bun tools/campus-geodata/verification/independent-remeasure.ts
 *
 * Standalone on purpose: this script imports NOTHING from frontend/src (no
 * graph.ts, geo.ts, speeds.ts, campus-locations, no app module). It
 * reconstructs the walkway graph directly from the raw Overpass snapshot in
 * ../raw/ by re-implementing the pipeline documented in tools/campus-geodata
 * (build.mjs, README.md) and frontend/src/lib/campus/graph.ts, then re-routes
 * the 20 building-pair routes recorded in verification-evidence.json and
 * compares.
 *
 * What this verifies: that the report's §2 numbers are faithfully reproducible
 * from the raw OSM snapshot through the documented policy, with an
 * independent implementation. What it does NOT verify: that the policy's
 * speeds match real-world walking (they are stated model assumptions —
 * see README.md "Walking-speed model").
 *
 * Policies replicated (from the build scripts, re-implemented here):
 *   1. Way filter (build.mjs isFootUsable / README "Way filter"):
 *      highway ∈ {footway, steps, path, pedestrian, corridor, living_street,
 *      service, residential, unclassified, tertiary, secondary, primary,
 *      tertiary_link, secondary_link, primary_link, track, road};
 *      foot != "no"; not (access ∈ {no, private} unless foot ∈
 *      {yes, designated, permissive}).
 *   2. Node clipping (build.mjs): keep nodes inside NODE_BOX (query bbox plus
 *      a 0.002° margin); split a way into fragments at dropped nodes so no
 *      edge is fabricated across the gap.
 *   3. Node dedup (build.mjs nodeIndexFor): merge nodes whose lat/lng agree
 *      at 8 decimal places; store coordinates rounded to 7 decimals.
 *   4. Edge dedup (graph.ts buildGraph): undirected edges keyed by node pair;
 *      when several ways share a pair, keep the SHORTEST one together with
 *      its class flags (steps / crossing). Class precedence (build.mjs
 *      wayClass): footway=crossing → "crossing", footway=sidewalk →
 *      "sidewalk", else the highway tag.
 *   5. Snapping (graph.ts nearestWalkwayNode): nearest node in the LARGEST
 *      connected component only, within 250 m (speeds.ts SNAP_MAX_METERS).
 *   6. Routing (graph.ts astarPath): A* minimizing HAVERSINE METERS with an
 *      admissible/consistent haversine heuristic (on a 6,371,000 m sphere).
 *      Duration is computed afterwards along the distance-optimal path:
 *      per edge, meters / (0.6 if steps-class else 1.4) (speeds.ts).
 *   7. Route assembly (graph.ts routeBetweenPoints): straight connectors from
 *      each registry pin to its snap node are added to distance and to time
 *      at the base speed; outputs rounded exactly as the runtime rounds them.
 *
 * Data (c) OpenStreetMap contributors, ODbL 1.0. See ../README.md.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = join(HERE, "..");
const ROOT = join(TOOL_DIR, "..", "..");

const RAW_PEDESTRIAN = join(TOOL_DIR, "raw", "overpass-pedestrian-snapshot.json");
const COMMITTED_WALKWAYS = join(ROOT, "frontend", "src", "lib", "campus", "data", "walkways.json");
const REGISTRY_TS = join(ROOT, "frontend", "src", "lib", "campus-locations.ts");
const EVIDENCE_JSON = join(TOOL_DIR, "verification-evidence.json");
const OUT_JSON = join(HERE, "remeasure-results.json");

// ---- replicated policy constants (sources cited inline) --------------------

const KEEP_HIGHWAY = new Set([
  "footway", "steps", "path", "pedestrian", "corridor", "living_street",
  "service", "residential", "unclassified", "tertiary", "secondary", "primary",
  "tertiary_link", "secondary_link", "primary_link", "track", "road",
]); // build.mjs KEEP_HIGHWAY

// build.mjs NODE_BOX — query bbox + 0.002° margin.
const NODE_BOX = { south: 33.2005, west: -97.1605, north: 33.2195, east: -97.1325 };

const EARTH_RADIUS_M = 6371000; // geo.ts EARTH_RADIUS_M
const NODE_KEY_DP = 8; // build.mjs node keying
const STORE_DP = 7; // build.mjs output coordinates
const WALK_SPEED_MPS = 1.4; // speeds.ts WALKING_SPEED_MPS
const STEPS_SPEED_MPS = 0.6; // speeds.ts STEPS_SPEED_MPS
const SNAP_MAX_METERS = 250; // speeds.ts SNAP_MAX_METERS

// This is a reproduction check, not an accuracy check: it rebuilds the same
// model from the same raw data, so an honest pipeline reproduces every number
// up to the runtime's output rounding (seconds to the whole second, meters to
// 0.1 m). Anything larger is a defect. Accuracy against hand-measured routes
// is judged only by spot-check-fixture.ts on the independent eval fixture.
const REPRODUCE_SECONDS_TOLERANCE = 1;
const REPRODUCE_METERS_TOLERANCE = 0.1 + 1e-9;

// The 20 pairs, in report §2 order (bench-routing.ts MEASURED_PAIRS).
const MEASURED_PAIRS: Array<[string, string]> = [
  ["sage", "blb"], ["sage", "gab"], ["sage", "wh"], ["sage", "gate"], ["sage", "col"],
  ["chem", "art"], ["chem", "phys"], ["chem", "lang"], ["chem", "musi"], ["chem", "musa"],
  ["life", "blb"], ["life", "aud"], ["life", "hick"], ["life", "peb"], ["life", "pac"],
  ["matt", "dath"], ["matt", "symr"], ["gab", "life"], ["wh", "env"], ["uu", "gate"],
];

// ---- shared math (re-implemented; identical formulas to geo.ts) ------------

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

// ---- 1. reconstruct the walkway graph from the raw snapshot ---------------

type WayClass = "crossing" | "sidewalk" | string;

function isFootUsable(tags: Record<string, string>): boolean {
  if (!tags || typeof tags.highway !== "string" || !KEEP_HIGHWAY.has(tags.highway)) return false;
  if (tags.foot === "no") return false;
  const restrictedAccess = tags.access === "no" || tags.access === "private";
  const footOverride =
    tags.foot === "yes" || tags.foot === "designated" || tags.foot === "permissive";
  if (restrictedAccess && !footOverride) return false;
  return true;
}

function wayClass(tags: Record<string, string>): WayClass {
  if (tags.footway === "crossing") return "crossing";
  if (tags.footway === "sidewalk") return "sidewalk";
  return tags.highway;
}

type Reconstructed = {
  nodes: [number, number][];
  wayCount: number; // usable fragments (build.mjs usableWays)
  edgeCount: number; // unique undirected node pairs
  adjacency: Map<number, Array<{ to: number; meters: number; steps: boolean; crossing: boolean }>>;
  largestComponent: number[];
  largestComponentShare: number;
};

function reconstructGraph(): Reconstructed {
  const raw = JSON.parse(readFileSync(RAW_PEDESTRIAN, "utf8")) as {
    elements: Array<{ type: string; id: number; tags?: Record<string, string>; geometry?: Array<{ lat: number | null; latLng?: never; lon?: number | null; lng?: number | null }> }>;
  };

  // Node dedup by 8-dp key; stored coords rounded to 7 dp (build.mjs).
  const nodeIndexByKey = new Map<string, number>();
  const nodes: [number, number][] = [];
  function nodeIndexFor(lat: number, lng: number): number {
    const key = `${round(lat, NODE_KEY_DP)},${round(lng, NODE_KEY_DP)}`;
    const existing = nodeIndexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodes.push([round(lat, STORE_DP), round(lng, STORE_DP)]);
    nodeIndexByKey.set(key, index);
    return index;
  }

  type Fragment = { osmId: number; steps: boolean; crossing: boolean; n: number[] };
  const fragments: Fragment[] = [];

  const rawWays = raw.elements.filter((el) => el.type === "way" && Array.isArray(el.geometry));
  for (const way of rawWays) {
    const tags = way.tags ?? {};
    if (!isFootUsable(tags)) continue;
    const cls = wayClass(tags);
    const isSteps = cls === "steps";
    const isCrossing = cls === "crossing";
    const coords = way.geometry!.map((p) => [p.lat, p.lon ?? (p as { lng?: number | null }).lng] as [number | null, number | null]);
    if (coords.length < 2) continue;

    // Clip to NODE_BOX; fragment at dropped/skipped nodes (build.mjs).
    const pieces: number[][] = [];
    let n: number[] = [];
    let lastIdx = -2;
    for (let idx = 0; idx < coords.length; idx += 1) {
      const [lat, lng] = coords[idx];
      const usable =
        lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) &&
        lat >= NODE_BOX.south && lat <= NODE_BOX.north &&
        lng >= NODE_BOX.west && lng <= NODE_BOX.east;
      if (!usable) {
        if (n.length >= 2) pieces.push(n);
        n = [];
        lastIdx = -2;
        continue;
      }
      if (n.length > 0 && idx !== lastIdx + 1) {
        if (n.length >= 2) pieces.push(n);
        n = [];
      }
      const index = nodeIndexFor(lat as number, lng as number);
      if (n.length === 0 || n[n.length - 1] !== index) n.push(index);
      lastIdx = idx;
    }
    if (n.length >= 2) pieces.push(n);
    for (const piece of pieces) fragments.push({ osmId: way.id, steps: isSteps, crossing: isCrossing, n: piece });
  }
  fragments.sort((a, b) => a.osmId - b.osmId); // same order graph.ts sees via walkways.json

  // Unique undirected edges; keep the SHORTEST way's flags per node pair
  // (graph.ts buildGraph). Iterate fragments in osmId order so tie-breaking
  // (strictly-less) matches the runtime.
  const nodeCount = nodes.length;
  const bestEdge = new Map<number, { meters: number; steps: boolean; crossing: boolean }>();
  for (const frag of fragments) {
    for (let i = 0; i < frag.n.length - 1; i += 1) {
      const a = frag.n[i];
      const b = frag.n[i + 1];
      if (a === b) continue;
      const [aLat, aLng] = nodes[a];
      const [bLat, bLng] = nodes[b];
      const meters = haversine(aLat, aLng, bLat, bLng);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * nodeCount + hi;
      const existing = bestEdge.get(key);
      if (!existing || meters < existing.meters) {
        bestEdge.set(key, { meters, steps: frag.steps, crossing: frag.crossing });
      }
    }
  }

  const adjacency = new Map<number, Array<{ to: number; meters: number; steps: boolean; crossing: boolean }>>();
  for (let i = 0; i < nodeCount; i += 1) adjacency.set(i, []);
  for (const [key, edge] of bestEdge) {
    const a = Math.floor(key / nodeCount);
    const b = key % nodeCount;
    adjacency.get(a)!.push({ to: b, ...edge });
    adjacency.get(b)!.push({ to: a, ...edge });
  }

  // Largest connected component (union-find over edges).
  const parent = Int32Array.from({ length: nodeCount }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const key of bestEdge.keys()) {
    const a = Math.floor(key / nodeCount);
    const b = key % nodeCount;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const size = new Map<number, number>();
  for (let i = 0; i < nodeCount; i += 1) {
    const root = find(i);
    size.set(root, (size.get(root) ?? 0) + 1);
  }
  let largestRoot = 0;
  let largestSize = 0;
  for (const [root, count] of size) {
    if (count > largestSize) {
      largestSize = count;
      largestRoot = root;
    }
  }
  const largestComponent: number[] = [];
  for (let i = 0; i < nodeCount; i += 1) if (find(i) === largestRoot) largestComponent.push(i);

  return {
    nodes,
    wayCount: fragments.length,
    edgeCount: bestEdge.size,
    adjacency,
    largestComponent,
    largestComponentShare: nodeCount === 0 ? 0 : largestSize / nodeCount,
  };
}

// ---- 2. registry pins (parsed from the registry source, NOT imported) ------

type Pin = { id: string; lat: number; lng: number; isOffCampus: boolean };

function parseRegistryPins(): Map<string, Pin> {
  // The registry is plain exported data (frontend/src/lib/campus-locations.ts).
  // Reading the file text and extracting the id/lat/lng/isOffCampus fields
  // keeps this script import-free while using the exact pins the report used.
  const text = readFileSync(REGISTRY_TS, "utf8");
  const pins = new Map<string, Pin>();
  const entryRe = /id:\s*"([a-z0-9]+)"([\s\S]*?)(?=\n  \{|^\];)/g;
  for (const match of text.matchAll(entryRe)) {
    const id = match[1];
    const body = match[2];
    const lat = body.match(/lat:\s*(-?\d+(?:\.\d+)?)/);
    const lng = body.match(/lng:\s*(-?\d+(?:\.\d+)?)/);
    if (!lat || !lng) throw new Error(`registry entry ${id}: missing lat/lng`);
    pins.set(id, { id, lat: Number(lat[1]), lng: Number(lng[1]), isOffCampus: /isOffCampus:\s*true/.test(body) });
  }
  return pins;
}

// ---- 3. A* on meters (re-implemented; same objective as graph.ts) ----------

function astarMeters(graph: Reconstructed, start: number, goal: number): number[] | null {
  const { nodes, adjacency } = graph;
  const nodeCount = nodes.length;
  const [goalLat, goalLng] = nodes[goal];
  const gScore = new Float64Array(nodeCount).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(nodeCount).fill(-1);
  const closed = new Uint8Array(nodeCount);
  const h = (index: number): number => {
    const [lat, lng] = nodes[index];
    return haversine(lat, lng, goalLat, goalLng);
  };
  // Binary min-heap of (index, priority).
  const heap: Array<{ index: number; priority: number }> = [];
  const push = (index: number, priority: number): void => {
    heap.push({ index, priority });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].priority <= heap[i].priority) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): { index: number; priority: number } | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < heap.length && heap[l].priority < heap[smallest].priority) smallest = l;
        if (r < heap.length && heap[r].priority < heap[smallest].priority) smallest = r;
        if (smallest === i) break;
        [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
        i = smallest;
      }
    }
    return top;
  };

  gScore[start] = 0;
  push(start, h(start));
  while (heap.length > 0) {
    const current = pop()!;
    if (current.index === goal) break;
    if (closed[current.index]) continue;
    closed[current.index] = 1;
    for (const edge of adjacency.get(current.index)!) {
      if (closed[edge.to]) continue;
      const tentative = gScore[current.index] + edge.meters;
      if (tentative < gScore[edge.to]) {
        gScore[edge.to] = tentative;
        cameFrom[edge.to] = current.index;
        push(edge.to, tentative + h(edge.to));
      }
    }
  }
  if (gScore[goal] === Number.POSITIVE_INFINITY) return null;
  const path: number[] = [];
  for (let at = goal; at !== -1; at = cameFrom[at]) {
    path.push(at);
    if (at === start) break;
  }
  path.reverse();
  return path[0] === start ? path : null;
}

// ---- 4. route a pin pair exactly as routeBetweenPoints reports it ----------

function snapToLargestComponent(graph: Reconstructed, pin: Pin): { index: number; meters: number } {
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const index of graph.largestComponent) {
    const [lat, lng] = graph.nodes[index];
    const d = haversine(pin.lat, pin.lng, lat, lng);
    if (d < bestDist) {
      bestDist = d;
      best = index;
    }
  }
  if (best === -1 || bestDist > SNAP_MAX_METERS) {
    throw new Error(`pin ${pin.id}: no largest-component walkway node within ${SNAP_MAX_METERS} m`);
  }
  return { index: best, meters: bestDist };
}

type Remeasured = {
  from: string;
  to: string;
  networkMeters: number; // round(x,1), as routeBetweenPoints reports
  connectorMeters: number; // round(x,1)
  distanceMeters: number; // round(x,1)
  durationSeconds: number; // Math.round of float sum, as routeBetweenPoints reports
  stepsMeters: number; // round(x,1)
  roadCrossings: number;
  snapFrom: { index: number; meters: number };
  snapTo: { index: number; meters: number };
};

function routePinPair(graph: Reconstructed, from: Pin, to: Pin): Remeasured {
  const snapA = snapToLargestComponent(graph, from);
  const snapB = snapToLargestComponent(graph, to);
  const path = astarMeters(graph, snapA.index, snapB.index);
  if (!path) throw new Error(`no walkway route ${from.id} -> ${to.id}`);

  let meters = 0;
  let seconds = 0;
  let stepsMeters = 0;
  let crossings = 0;
  const adj = graph.adjacency;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const edge = adj.get(a)!.find((candidate) => candidate.to === b);
    if (!edge) throw new Error(`route ${from.id} -> ${to.id}: missing edge ${a}->${b}`);
    meters += edge.meters;
    seconds += edge.meters / (edge.steps ? STEPS_SPEED_MPS : WALK_SPEED_MPS);
    if (edge.steps) stepsMeters += edge.meters;
    if (edge.crossing) crossings += 1;
  }
  const connectorMeters = snapA.meters + snapB.meters;
  return {
    from: from.id,
    to: to.id,
    networkMeters: round(meters, 1),
    connectorMeters: round(connectorMeters, 1),
    distanceMeters: round(meters + connectorMeters, 1),
    durationSeconds: Math.round(seconds + connectorMeters / WALK_SPEED_MPS),
    stepsMeters: round(stepsMeters, 1),
    roadCrossings: crossings,
    snapFrom: { index: snapA.index, meters: round(snapA.meters, 1) },
    snapTo: { index: snapB.index, meters: round(snapB.meters, 1) },
  };
}

// ---- 5. comparison ----------------------------------------------------------

function relDeltaPct(remeasured: number, recorded: number): number {
  if (recorded === 0) return remeasured === 0 ? 0 : Number.POSITIVE_INFINITY;
  return Number((((remeasured - recorded) / recorded) * 100).toFixed(2));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---- main -------------------------------------------------------------------

function main() {
  const warnings: string[] = [];

  // 1. Reconstruct from raw.
  const graph = reconstructGraph();

  // 2. Integrity: does the reconstruction match the committed artifact's
  //    counts and node array? (Committed data used as a read-only reference —
  //    the re-measured routes below come only from the raw snapshot.)
  let matchesCommitted: boolean | null = null;
  try {
    const committed = JSON.parse(readFileSync(COMMITTED_WALKWAYS, "utf8")) as {
      meta: { nodeCount: number; edgeCount: number; wayCount: number };
      nodes: [number, number][];
    };
    const nodeArrayEqual =
      committed.nodes.length === graph.nodes.length &&
      committed.nodes.every((p, i) => p[0] === graph.nodes[i][0] && p[1] === graph.nodes[i][1]);
    matchesCommitted =
      nodeArrayEqual &&
      committed.meta.nodeCount === graph.nodes.length &&
      committed.meta.edgeCount === graph.edgeCount &&
      committed.meta.wayCount === graph.wayCount;
    if (!nodeArrayEqual) warnings.push("node array differs from committed walkways.json");
    if (committed.meta.edgeCount !== graph.edgeCount) {
      warnings.push(`edge count differs: committed ${committed.meta.edgeCount} vs reconstructed ${graph.edgeCount}`);
    }
  } catch (error) {
    warnings.push(`integrity check skipped: ${(error as Error).message}`);
  }

  // 3. Registry pins + recorded values.
  const pins = parseRegistryPins();
  const evidence = JSON.parse(readFileSync(EVIDENCE_JSON, "utf8")) as {
    measuredRoutes: Array<{
      from: string;
      to: string;
      distanceMeters: number;
      networkMeters: number;
      durationSeconds: number;
      stepsMeters: number;
      roadCrossings: number;
    }>;
  };
  const recordedByPair = new Map(evidence.measuredRoutes.map((r) => [`${r.from}->${r.to}`, r]));

  // 4. Re-measure the 20 pairs.
  const rows = MEASURED_PAIRS.map(([fromId, toId]) => {
    const from = pins.get(fromId);
    const to = pins.get(toId);
    if (!from) throw new Error(`registry pin not found: ${fromId}`);
    if (!to) throw new Error(`registry pin not found: ${toId}`);
    if (from.isOffCampus || to.isOffCampus) throw new Error(`pair ${fromId}->${toId}: registry marks an endpoint off-campus`);
    const recorded = recordedByPair.get(`${fromId}->${toId}`);
    if (!recorded) throw new Error(`no recorded §2 row for ${fromId}->${toId}`);
    const mine = routePinPair(graph, from, to);
    const deltaSeconds = Number((mine.durationSeconds - recorded.durationSeconds).toFixed(1));
    const deltaSecondsPct = relDeltaPct(mine.durationSeconds, recorded.durationSeconds);
    const deltaMetersPct = relDeltaPct(mine.networkMeters, recorded.networkMeters);
    return {
      from: fromId,
      to: toId,
      recorded: {
        networkMeters: recorded.networkMeters,
        durationSeconds: recorded.durationSeconds,
        stepsMeters: recorded.stepsMeters,
        roadCrossings: recorded.roadCrossings,
      },
      remeasured: {
        networkMeters: mine.networkMeters,
        durationSeconds: mine.durationSeconds,
        stepsMeters: mine.stepsMeters,
        roadCrossings: mine.roadCrossings,
        connectorMeters: mine.connectorMeters,
        snapFrom: mine.snapFrom,
        snapTo: mine.snapTo,
      },
      deltaSeconds,
      deltaSecondsPct,
      deltaMetersPct,
      reproduced:
        Math.abs(mine.durationSeconds - recorded.durationSeconds) <= REPRODUCE_SECONDS_TOLERANCE &&
        Math.abs(mine.networkMeters - recorded.networkMeters) <= REPRODUCE_METERS_TOLERANCE,
    };
  });

  // 5. Reproduction gate: every pair, seconds AND meters, within rounding.
  const absSecondPcts = rows.map((r) => Math.abs(r.deltaSecondsPct));
  const absMeterPcts = rows.map((r) => Math.abs(r.deltaMetersPct));
  const secondsSummary = {
    n: rows.length,
    exact: rows.filter((r) => r.deltaSeconds === 0).length,
    within10Pct: absSecondPcts.filter((p) => p <= 10).length,
    within20Pct: absSecondPcts.filter((p) => p <= 20).length,
    medianAbsDeltaPct: Number(median(absSecondPcts).toFixed(2)),
    maxAbsDeltaPct: Number(Math.max(...absSecondPcts).toFixed(2)),
  };
  const metersSummary = {
    exact: rows.filter((r) => r.deltaMetersPct === 0).length,
    medianAbsDeltaPct: Number(median(absMeterPcts).toFixed(2)),
    maxAbsDeltaPct: Number(Math.max(...absMeterPcts).toFixed(2)),
  };
  const mismatched = rows.filter((r) => !r.reproduced);
  // A reconstruction that no longer matches the committed graph, or could not
  // be compared at all, means the rows above were not produced by the
  // committed pipeline, so the check cannot pass.
  const reproduced = mismatched.length === 0 && matchesCommitted === true;

  const results = {
    generatedAt: new Date().toISOString(),
    script: "tools/campus-geodata/verification/independent-remeasure.ts",
    standalone: true,
    importsFromFrontend: false,
    policy: {
      rawSource: "tools/campus-geodata/raw/overpass-pedestrian-snapshot.json",
      wayFilter: "highway in {footway, steps, path, pedestrian, corridor, living_street, service, residential, unclassified, tertiary, secondary, primary, tertiary_link, secondary_link, primary_link, track, road}, foot != no, not (access in {no, private} unless foot in {yes, designated, permissive}) — per tools/campus-geodata/README.md and build.mjs",
      nodeClipping: "keep nodes in NODE_BOX {33.2005, -97.1605, 33.2195, -97.1325}; fragment ways at dropped nodes",
      nodeDedup: "8-dp key, 7-dp stored coordinates",
      edgeDedup: "shortest way per node pair keeps its class flags (crossing/sidewalk take precedence over the highway tag)",
      snapping: "nearest node in largest connected component, 250 m cap",
      routing: "A* minimizing haversine meters (R = 6,371,000 m); duration computed along the path per edge: meters / (0.6 steps | 1.4 base) m/s; connectors added at base speed",
      rounding: "as routeBetweenPoints: seconds Math.round; meters round to 0.1",
    },
    reconstruction: {
      nodes: graph.nodes.length,
      edges: graph.edgeCount,
      usableWayFragments: graph.wayCount,
      largestComponentShare: Number(graph.largestComponentShare.toFixed(4)),
      matchesCommittedWalkwaysJson: matchesCommitted,
    },
    reproductionGate: {
      kind: "reproduction of the same model from the same raw snapshot; this is not plan accuracy",
      accuracyIsJudgedBy: "tools/campus-geodata/spot-check-fixture.ts against the independent eval fixture",
      secondsTolerance: REPRODUCE_SECONDS_TOLERANCE,
      metersTolerance: 0.1,
      alsoRequires: "reconstruction matches the committed walkways.json",
    },
    comparison: {
      bySeconds: secondsSummary,
      byNetworkMeters: metersSummary,
      reproduced,
      mismatchedPairs: mismatched.map((r) => `${r.from}->${r.to}`),
    },
    rows,
    warnings,
  };

  // Digest over the timestamp-free payload (reproducibility check).
  const { generatedAt: _generatedAt, ...payload } = results;
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
  const withDigest = { ...results, digest };

  writeFileSync(OUT_JSON, `${JSON.stringify(withDigest, null, 2)}\n`);

  // Console table (also what the markdown report is hand-assembled from).
  console.log(`reconstructed graph: ${graph.nodes.length} nodes, ${graph.edgeCount} edges, ${graph.wayCount} usable way fragments, largest component ${(graph.largestComponentShare * 100).toFixed(2)}%`);
  console.log(`matches committed walkways.json: ${matchesCommitted}`);
  for (const w of warnings) console.log(`warning: ${w}`);
  console.log("");
  console.log("pair        rec_s  rem_s  Δs    Δ%      rec_m   rem_m   Δm%     steps_m  cross");
  for (const r of rows) {
    const id = `${r.from}->${r.to}`.padEnd(11);
    const ds = (r.deltaSeconds >= 0 ? "+" : "") + r.deltaSeconds.toFixed(1);
    const dps = (r.deltaSecondsPct >= 0 ? "+" : "") + r.deltaSecondsPct.toFixed(2) + "%";
    const dpm = (r.deltaMetersPct >= 0 ? "+" : "") + r.deltaMetersPct.toFixed(2) + "%";
    console.log(
      `${id} ${String(r.recorded.durationSeconds).padStart(5)} ${String(r.remeasured.durationSeconds).padStart(5)} ${ds.padStart(6)} ${dps.padStart(8)} ${String(r.recorded.networkMeters).padStart(7)} ${String(r.remeasured.networkMeters).padStart(7)} ${dpm.padStart(8)} ${String(r.remeasured.stepsMeters).padStart(7)} ${String(r.remeasured.roadCrossings).padStart(5)}`,
    );
  }
  console.log("");
  console.log(`seconds: exact ${secondsSummary.exact}/${secondsSummary.n}, median |Δ| ${secondsSummary.medianAbsDeltaPct}%, max |Δ| ${secondsSummary.maxAbsDeltaPct}%`);
  console.log(`network meters: exact ${metersSummary.exact}/${secondsSummary.n}, median |Δ| ${metersSummary.medianAbsDeltaPct}%, max |Δ| ${metersSummary.maxAbsDeltaPct}%`);
  console.log(
    `reproduction (|Δs| ≤ ${REPRODUCE_SECONDS_TOLERANCE} s and |Δm| ≤ 0.1 m on every pair, graph matches committed): ${reproduced ? "PASS" : "FAIL"}`,
  );
  if (mismatched.length > 0) {
    console.log(
      `not reproduced: ${mismatched.map((r) => `${r.from}->${r.to} (Δs ${r.deltaSeconds}, Δm ${r.deltaMetersPct}%)`).join(", ")}`,
    );
  }
  if (matchesCommitted !== true) console.log("reconstruction does not match the committed walkways.json");
  console.log("accuracy is not judged here; see spot-check-fixture.ts");
  console.log(`digest: ${digest}`);
  console.log(`wrote ${OUT_JSON}`);
  return reproduced ? 0 : 1;
}

process.exit(main());
