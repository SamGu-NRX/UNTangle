/**
 * detour-bounds.ts — network vs crow-flying detour-factor bounds check.
 *
 * Run: bun tools/campus-geodata/verification/detour-bounds.ts
 *
 * Answers: does every pair in the bundled walking-time matrix stay within a
 * plausible detour factor of the straight-line (great-circle) distance, or
 * could the matrix be smuggling absurd paths?
 *
 * Standalone by design: reads the committed JSON artifacts directly and
 * implements its own haversine. It imports no frontend modules, so it cannot
 * drift into the runtime it is checking. The only repo file it reads beyond
 * data JSON is frontend/src/lib/campus/speeds.ts, whose exported constants
 * must equal the speeds inlined below — a mismatch fails the run rather than
 * silently invalidating the seconds-derived metric.
 *
 * Metrics per unordered building pair {a, b}:
 *   networkMeters   meters[a][b] — the matrix's own routed path length
 *                   (the runtime A* network distance; no speed assumption).
 *   impliedMeters   seconds[a][b] × BASE_SPEED_MPS — the task's
 *                   seconds-times-speed conversion. Steps edges are timed at
 *                   STEPS_SPEED_MPS (0.6 m/s), so this overstates path length
 *                   on any route containing steps; reported separately for
 *                   exactly that reason.
 *   crowCentroidMeters  great-circle between the two buildings' registry
 *                   coordinates: the centroid of the OSM outline each
 *                   registry pin resolved into (buildings.json via the
 *                   anchors' outlineOsmId). Buildings without an outline
 *                   (pin-fallback anchors) use their walkway anchor
 *                   coordinate, which understates crow distance and so
 *                   inflates their ratio — conservative for a bounds check.
 *   crowAnchorMeters    great-circle between the walkway anchor nodes
 *                   themselves (sensitivity: how much the connector snapping
 *                   shortens the straight line).
 *   ratio           networkMeters / crowCentroidMeters — the detour factor.
 *
 * The plan (docs/plan/untangle-plan.md on fleet/untangle-plan) states no
 * detour-factor bound, so the flag threshold is DETOUR_FLAG_RATIO = 2.0, a
 * generous pedestrian-route-directness ceiling: typical campus walkway
 * detours sit near 1.2–1.5, so only genuinely implausible paths (a graph
 * mis-build forcing a chokepoint detour) should exceed 2.0. Flags are
 * findings, not failures: the script exits 0 when the analysis completes.
 *
 * Output:
 *   tools/campus-geodata/verification/detour-bounds-evidence.json
 *   (deterministic — no timestamp — so two runs are byte-identical)
 * and a human-readable summary on stdout.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const WALKING_TIMES_PATH = join(REPO_ROOT, "frontend", "src", "lib", "campus", "data", "walking-times.json");
const BUILDINGS_PATH = join(REPO_ROOT, "frontend", "src", "lib", "campus", "data", "buildings.json");
const SPEEDS_PATH = join(REPO_ROOT, "frontend", "src", "lib", "campus", "speeds.ts");
const OUTPUT_PATH = join(HERE, "detour-bounds-evidence.json");

/** Mirrors frontend/src/lib/campus/speeds.ts (verified against it at run time). */
const BASE_SPEED_MPS = 1.4;
const STEPS_SPEED_MPS = 0.6;
/** Mirrors frontend/src/lib/campus/geo.ts: haversine on a 6,371,000 m sphere. */
const EARTH_RADIUS_M = 6371000;
const DETOUR_FLAG_RATIO = 2.0;

type LatLng = [lat: number, lng: number];

type AnchorMethod = "osm-entrance" | "outline-node" | "pin-fallback";

type AnchorRecord = {
  anchor: LatLng;
  method: AnchorMethod;
  outlineOsmId: number | null;
  connectorMeters: number;
};

type MatrixBundle = {
  meta: { generatedBy: string; speeds: { baseMps: number; stepsMps: number } };
  anchors: Record<string, AnchorRecord>;
  seconds: Record<string, Record<string, number>>;
  meters: Record<string, Record<string, number>>;
};

type BuildingOutline = { osmId: number; centroid: LatLng };

type CoordinateSource = "outline-centroid" | "anchor-fallback";

type RegistryCoordinate = {
  buildingId: string;
  coordinate: LatLng;
  source: CoordinateSource;
  outlineOsmId: number | null;
};

type PairRow = {
  from: string;
  to: string;
  networkMeters: number;
  seconds: number;
  impliedMeters: number;
  crowCentroidMeters: number;
  crowAnchorMeters: number;
  ratio: number;
  ratioSeconds: number;
  ratioAnchor: number;
  flagged: boolean;
};

type Distribution = {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  max: number;
};

type Symmetry = {
  maxSecondsDelta: number;
  maxMetersDelta: number;
  orderedPairsOver1s: number;
};

// ---- pure helpers -----------------------------------------------------------

function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Same percentile convention as tools/campus-geodata/bench-routing.ts. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: round(sorted[0] ?? 0, 4),
    p25: round(percentile(sorted, 25), 4),
    median: round(percentile(sorted, 50), 4),
    p75: round(percentile(sorted, 75), 4),
    p95: round(percentile(sorted, 95), 4),
    max: round(sorted[sorted.length - 1] ?? 0, 4),
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Verify the speeds inlined above still match frontend/src/lib/campus/speeds.ts.
 * Returns an error message on mismatch, null when they agree.
 */
function speedsDriftError(): string | null {
  let source: string;
  try {
    source = readFileSync(SPEEDS_PATH, "utf8");
  } catch {
    return `cannot read ${SPEEDS_PATH} to verify the inlined speed constants`;
  }
  const base = source.match(/export const WALKING_SPEED_MPS = ([\d.]+);/);
  const steps = source.match(/export const STEPS_SPEED_MPS = ([\d.]+);/);
  if (!base || !steps) return "could not parse WALKING_SPEED_MPS / STEPS_SPEED_MPS from speeds.ts";
  if (Number(base[1]) !== BASE_SPEED_MPS || Number(steps[1]) !== STEPS_SPEED_MPS) {
    return (
      `speeds.ts (${base[1]} / ${steps[1]} m/s) no longer matches the constants inlined in ` +
      `detour-bounds.ts (${BASE_SPEED_MPS} / ${STEPS_SPEED_MPS} m/s) — update them and re-run`
    );
  }
  return null;
}

/**
 * Registry coordinate per matrix building: the centroid of the OSM outline
 * its registry pin resolved into (via the anchor's outlineOsmId), falling
 * back to the walkway anchor coordinate for buildings with no outline.
 */
function resolveRegistryCoordinates(bundle: MatrixBundle, outlines: BuildingOutline[]): Map<string, RegistryCoordinate> {
  const byOsmId = new Map<number, BuildingOutline>(outlines.map((o) => [o.osmId, o]));
  const resolved = new Map<string, RegistryCoordinate>();
  for (const id of sortedMatrixIds(bundle)) {
    const anchor = bundle.anchors[id];
    const outline = anchor.outlineOsmId === null ? undefined : byOsmId.get(anchor.outlineOsmId);
    if (outline) {
      resolved.set(id, {
        buildingId: id,
        coordinate: outline.centroid,
        source: "outline-centroid",
        outlineOsmId: outline.osmId,
      });
    } else {
      resolved.set(id, {
        buildingId: id,
        coordinate: anchor.anchor,
        source: "anchor-fallback",
        outlineOsmId: null,
      });
    }
  }
  return resolved;
}

function sortedMatrixIds(bundle: MatrixBundle): string[] {
  return Object.keys(bundle.anchors).sort();
}

/** Structurally invalid bundles must fail the run rather than produce ratios. */
function validateBundle(bundle: MatrixBundle): string | null {
  const ids = Object.keys(bundle.seconds);
  if (ids.length === 0) return "walking-times.json has no seconds matrix";
  if (!bundle.anchors || !bundle.meters) return "walking-times.json is missing anchors or meters";
  for (const a of ids) {
    if (!(a in bundle.anchors)) return `matrix id ${a} has no anchor`;
    if (!(a in bundle.meters)) return `matrix id ${a} has no meters row`;
    if (Object.keys(bundle.seconds[a]).length !== ids.length) return `seconds row ${a} is not ${ids.length} wide`;
    for (const b of ids) {
      const s = bundle.seconds[a][b];
      const m = bundle.meters[a]?.[b];
      if (typeof s !== "number" || !Number.isFinite(s) || s < 0) return `seconds[${a}][${b}] is not a finite non-negative number`;
      if (typeof m !== "number" || !Number.isFinite(m) || m < 0) return `meters[${a}][${b}] is not a finite non-negative number`;
      if (a === b && (s !== 0 || m !== 0)) return `diagonal [${a}][${a}] must be zero`;
      if (a !== b && (s === 0 || m === 0)) return `off-diagonal [${a}][${b}] is zero — unroutable pairs must not be silently zero`;
    }
    const anchor = bundle.anchors[a];
    if (anchor.outlineOsmId !== null && anchor.outlineOsmId !== undefined && typeof anchor.anchor[0] !== "number") {
      return `anchor ${a} has a non-numeric coordinate`;
    }
  }
  return null;
}

function checkSymmetry(bundle: MatrixBundle): Symmetry {
  const ids = sortedMatrixIds(bundle);
  let maxSecondsDelta = 0;
  let maxMetersDelta = 0;
  let orderedPairsOver1s = 0;
  for (const a of ids) {
    for (const b of ids) {
      if (a >= b) continue;
      const ds = Math.abs(bundle.seconds[a][b] - bundle.seconds[b][a]);
      const dm = Math.abs(bundle.meters[a][b] - bundle.meters[b][a]);
      maxSecondsDelta = Math.max(maxSecondsDelta, ds);
      maxMetersDelta = Math.max(maxMetersDelta, dm);
      if (ds > 1) orderedPairsOver1s += 2; // both orderings of the unordered pair
    }
  }
  return { maxSecondsDelta: round(maxSecondsDelta, 2), maxMetersDelta: round(maxMetersDelta, 2), orderedPairsOver1s };
}

function buildPairRows(bundle: MatrixBundle, registry: Map<string, RegistryCoordinate>): PairRow[] {
  const ids = sortedMatrixIds(bundle);
  const rows: PairRow[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      const networkMeters = bundle.meters[a][b];
      const seconds = bundle.seconds[a][b];
      const crowCentroid = haversineMeters(registry.get(a)!.coordinate, registry.get(b)!.coordinate);
      const crowAnchor = haversineMeters(bundle.anchors[a].anchor, bundle.anchors[b].anchor);
      const ratio = networkMeters / crowCentroid;
      rows.push({
        from: a,
        to: b,
        networkMeters: round(networkMeters, 1),
        seconds: round(seconds, 1),
        impliedMeters: round(seconds * BASE_SPEED_MPS, 1),
        crowCentroidMeters: round(crowCentroid, 1),
        crowAnchorMeters: round(crowAnchor, 1),
        ratio: round(ratio, 4),
        ratioSeconds: round((seconds * BASE_SPEED_MPS) / crowCentroid, 4),
        ratioAnchor: round(networkMeters / crowAnchor, 4),
        flagged: ratio > DETOUR_FLAG_RATIO,
      });
    }
  }
  return rows;
}

function connectorStats(bundle: MatrixBundle): { max: number; mean: number } {
  const values = Object.values(bundle.anchors).map((a) => a.connectorMeters);
  const max = Math.max(...values);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return { max: round(max, 1), mean: round(mean, 1) };
}

// ---- side effects (main only) ----------------------------------------------

function main(): number {
  const drift = speedsDriftError();
  if (drift) {
    console.error(`FAIL: ${drift}`);
    return 2;
  }

  const bundle = readJson<MatrixBundle>(WALKING_TIMES_PATH);
  const outlinesFile = readJson<{ buildings: BuildingOutline[] }>(BUILDINGS_PATH);

  const invalid = validateBundle(bundle);
  if (invalid) {
    console.error(`FAIL: ${invalid}`);
    return 2;
  }

  const registry = resolveRegistryCoordinates(bundle, outlinesFile.buildings);
  const rows = buildPairRows(bundle, registry);
  const ratios = rows.map((r) => r.ratio);
  const ratioSecondsValues = rows.map((r) => r.ratioSeconds);
  const flagged = rows.filter((r) => r.flagged);
  const stepsDriven = rows.filter((r) => !r.flagged && r.ratioSeconds > DETOUR_FLAG_RATIO);
  const symmetry = checkSymmetry(bundle);

  const methodCounts: Record<string, number> = {};
  for (const id of sortedMatrixIds(bundle)) {
    methodCounts[bundle.anchors[id].method] = (methodCounts[bundle.anchors[id].method] ?? 0) + 1;
  }
  const fallbackBuildings = sortedMatrixIds(bundle).filter((id) => registry.get(id)!.source === "anchor-fallback");

  const payload = {
    threshold: DETOUR_FLAG_RATIO,
    inputs: {
      walkingTimes: "frontend/src/lib/campus/data/walking-times.json",
      buildingOutlines: "frontend/src/lib/campus/data/buildings.json",
      speeds: "frontend/src/lib/campus/speeds.ts (verified equal to the inlined constants)",
      matrixDim: `${sortedMatrixIds(bundle).length}x${sortedMatrixIds(bundle).length}`,
      generatedBy: bundle.meta.generatedBy,
    },
    method: {
      networkMeters: "matrix meters — the runtime A* path length recorded at matrix build time",
      impliedMeters: "matrix seconds x 1.4 m/s base speed (steps legs timed at 0.6 m/s inflate this)",
      crowCentroidMeters:
        "inline haversine (R=6371000 m) between outline centroids matched by the anchors' outlineOsmId; anchor coordinate for pin-fallback buildings",
      ratio: "networkMeters / crowCentroidMeters",
      pairSet: "unordered pairs (matrix verified symmetric); diagonal excluded",
    },
    summary: {
      orderedPairsOffDiagonal: sortedMatrixIds(bundle).length * (sortedMatrixIds(bundle).length - 1),
      unorderedPairs: rows.length,
      ratio: distribution(ratios),
      ratioSeconds: distribution(ratioSecondsValues),
      flaggedCount: flagged.length,
      flaggedPairs: flagged.map((r) => ({ from: r.from, to: r.to, ratio: r.ratio, networkMeters: r.networkMeters, crowCentroidMeters: r.crowCentroidMeters })),
      stepsDrivenFlags: stepsDriven.map((r) => ({ from: r.from, to: r.to, ratioSeconds: r.ratioSeconds, ratio: r.ratio })),
      maxStepsInflationMeters: rows.reduce(
        (best, r) => (r.impliedMeters - r.networkMeters > best.delta ? { pair: `${r.from}->${r.to}`, delta: round(r.impliedMeters - r.networkMeters, 1) } : best),
        { pair: "", delta: 0 },
      ),
      symmetry,
      anchors: {
        count: sortedMatrixIds(bundle).length,
        methodCounts,
        connectorMeters: connectorStats(bundle),
        registryCoordinateFallbacks: fallbackBuildings,
      },
    },
    registryCoordinates: sortedMatrixIds(bundle).map((id) => registry.get(id)),
    pairs: rows,
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`detour-bounds: ${sortedMatrixIds(bundle).length}x${sortedMatrixIds(bundle).length} matrix -> ${rows.length} unordered pairs`);
  console.log(`ratio (network / crow) over unordered pairs: ${JSON.stringify(payload.summary.ratio)}`);
  console.log(`ratio via seconds x 1.4 m/s: ${JSON.stringify(payload.summary.ratioSeconds)}`);
  console.log(`symmetry: max |Δseconds| ${symmetry.maxSecondsDelta}, max |Δmeters| ${symmetry.maxMetersDelta}, ordered pairs over 1 s: ${symmetry.orderedPairsOver1s}`);
  console.log(`flagged pairs (ratio > ${DETOUR_FLAG_RATIO}): ${flagged.length}`);
  for (const pair of flagged) {
    console.log(`  FLAG ${pair.from} -> ${pair.to}: ratio ${pair.ratio} (network ${pair.networkMeters} m vs crow ${pair.crowCentroidMeters} m)`);
  }
  for (const pair of stepsDriven) {
    console.log(`  STEPS-DRIVEN ${pair.from} -> ${pair.to}: ratio ${pair.ratio} but ${pair.ratioSeconds} via seconds x 1.4 (steps legs timed at 0.6 m/s)`);
  }
  console.log(`evidence written to ${OUTPUT_PATH}`);
  return 0;
}

process.exit(main());
