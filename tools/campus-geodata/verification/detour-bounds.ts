/**
 * detour-bounds.ts — network vs same-anchor great-circle detour-factor check.
 *
 * Run: bun tools/campus-geodata/verification/detour-bounds.ts
 *
 * Answers: does every pair in the bundled walking-time matrix stay within a
 * plausible detour factor of the straight-line distance between the SAME two
 * points the network route connects, or could the matrix be smuggling absurd
 * paths?
 *
 * Anchor definition (review round 2): a matrix anchor is the walkway graph
 * node that a building's registry pin resolved to at matrix build time
 * (build-matrix.ts resolveAnchor: osm-entrance, outline-node or pin-fallback;
 * the anchor coordinate is walkways.json's node coordinate). The router
 * routes between exactly these nodes — build-matrix.ts calls
 * routeBetweenNodes(anchorA.nodeIndex, anchorB.nodeIndex) — so for every
 * unordered pair {a, b} the routed path's endpoint coordinates ARE
 * anchors[a].anchor and anchors[b].anchor in walking-times.json. The enforced
 * denominator is the great-circle (haversine, R = 6,371,000 m, mirroring
 * frontend/src/lib/campus/geo.ts) distance between those two coordinates.
 *
 * Review round 1 used the centroid of each building's OSM outline (plus
 * registry-pin fallbacks) as the crow basis — a DIFFERENT pair of points than
 * the route endpoints, which allowed ratios below 1.0 (min 0.7298) that are
 * geometrically impossible on a same-anchor basis. That basis was removed:
 * this script now has a single crow basis, and every number it reports
 * derives from it in the same run (no separately maintained constants).
 *
 * Enforcement (review round 2 ruling):
 *   1. Same-anchor great-circle floor — ratio = networkMeters /
 *      sameAnchorCrowMeters must satisfy ratio >= 1.0 for every unordered
 *      pair: the routed path is a sum of haversine graph-edge lengths between
 *      the two anchor nodes, and the geodesic triangle inequality makes any
 *      ratio < 1 impossible except for storage rounding. A pair whose stored
 *      network distance is more than FLOOR_TOLERANCE_M (0.1 m) below its
 *      crow distance is a HARD ERROR: every violation is listed and the run
 *      exits non-zero. Violations are never clamped, skipped or hidden.
 *      Every pair's deficit is recorded either way.
 *   2. Reverse-entry symmetry — over the full matrix, every reverse entry
 *      [b][a] is checked against [a][b] for all 406 unordered pairs; max
 *      asymmetry is reported in meters and in seconds, and the run fails
 *      beyond a 1e-6 relative tolerance. The symmetry result is reported
 *      alongside the bounds.
 *   3. Reported numbers = enforced numbers — the min/median/p95/max
 *      distribution and the over-threshold list are computed, in this run,
 *      from these same-anchor ratios.
 *
 * Output:
 *   tools/campus-geodata/verification/detour-bounds-evidence.json
 *   (deterministic — no timestamp — so two runs are byte-identical; written
 *   even when enforcement fails, so violations are auditable)
 * plus a human-readable summary on stdout.
 *
 * Exit codes: 0 analysis completed and enforcement passed; 2 structural
 * invalidity (including any anchor whose latitude or longitude is not a
 * finite in-range number, and any pair whose crow distance or ratio comes out
 * non-finite) or speed-constant drift (before analysis); 3 enforcement
 * failure (floor violation or asymmetry beyond tolerance).
 *
 * Standalone by design: reads the committed JSON artifacts directly and
 * implements its own haversine. It imports no frontend modules, so it cannot
 * drift into the runtime it is checking. The only repo file it reads beyond
 * data JSON is frontend/src/lib/campus/speeds.ts, whose exported constants
 * must equal the speeds inlined below — a mismatch fails the run rather than
 * silently invalidating the seconds-derived metric.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

// The two path overrides exist for mutation checks (feed a corrupted matrix,
// write the evidence somewhere disposable); normal runs use the defaults.
const WALKING_TIMES_PATH =
  process.env.DETOUR_BOUNDS_INPUT ?? join(REPO_ROOT, "frontend", "src", "lib", "campus", "data", "walking-times.json");
const SPEEDS_PATH = join(REPO_ROOT, "frontend", "src", "lib", "campus", "speeds.ts");
const OUTPUT_PATH = process.env.DETOUR_BOUNDS_OUTPUT ?? join(HERE, "detour-bounds-evidence.json");

/** Mirrors frontend/src/lib/campus/speeds.ts (verified against it at run time). */
const BASE_SPEED_MPS = 1.4;
const STEPS_SPEED_MPS = 0.6;
/** Mirrors frontend/src/lib/campus/geo.ts: haversine on a 6,371,000 m sphere. */
const EARTH_RADIUS_M = 6371000;
const DETOUR_FLAG_RATIO = 2.0;
/**
 * How far (meters) a stored network distance may sit below the straight line
 * between the same two anchors before it counts as a floor violation.
 *
 * The matrix stores meters to one decimal, so a true path length can be
 * stored up to 0.05 m short. art/arta is exactly that: true length 71.0491 m
 * (independent Dijkstra, detour-bounds.md section 4), stored 71.0, crow
 * 71.0491 m, a 0.0491 m deficit. The acceptance owner ruled (2026-10-13)
 * that this is storage rounding, not a routing error, and set 0.1 m: twice
 * the storage step, still far below any real shortcut. A larger gap fails.
 */
const FLOOR_TOLERANCE_M = 0.1;
/** Reverse-entry asymmetry fails beyond this relative tolerance. */
const SYMMETRY_RELATIVE_TOLERANCE = 1e-6;

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

/** Exact per-pair metrics, before output rounding. */
type PairMetric = {
  from: string;
  to: string;
  networkMeters: number;
  seconds: number;
  crowMeters: number;
  ratio: number;
};

type PairRow = {
  from: string;
  to: string;
  networkMeters: number;
  seconds: number;
  impliedMeters: number;
  sameAnchorCrowMeters: number;
  ratio: number;
  ratioSeconds: number;
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

type ReverseSymmetry = {
  checkedPairs: number;
  maxSecondsDelta: number;
  maxMetersDelta: number;
  maxRelativeSeconds: number;
  maxRelativeMeters: number;
  worstSecondsPair: string | null;
  worstMetersPair: string | null;
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
    const coordinateError = anchorCoordinateError(a, bundle.anchors[a]);
    if (coordinateError) return coordinateError;
  }
  return null;
}

/**
 * Every anchor, whatever its method, must carry a finite in-range [lat, lng].
 * A bad coordinate would make every crow distance through it NaN, and NaN
 * fails every comparison, so its pairs would silently drop out of the floor
 * check instead of failing it.
 */
function anchorCoordinateError(id: string, record: AnchorRecord | undefined): string | null {
  const coordinate: unknown = record?.anchor;
  if (!Array.isArray(coordinate) || coordinate.length !== 2) return `anchor ${id} is not a [lat, lng] pair`;
  const [lat, lng] = coordinate as unknown[];
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return `anchor ${id} latitude ${String(lat)} is not a finite number in [-90, 90]`;
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return `anchor ${id} longitude ${String(lng)} is not a finite number in [-180, 180]`;
  }
  return null;
}

/** A pair whose crow distance or ratio is not a finite positive number cannot be judged; it fails the run. */
function nonFiniteMetricError(metrics: PairMetric[]): string | null {
  const bad = metrics.find(
    (m) => !Number.isFinite(m.crowMeters) || m.crowMeters <= 0 || !Number.isFinite(m.ratio),
  );
  return bad
    ? `pair ${bad.from}/${bad.to} has crow ${bad.crowMeters} m and ratio ${bad.ratio}; both must be finite and positive`
    : null;
}

/**
 * Reverse-entry symmetry over the full matrix: for every unordered pair
 * {a, b}, compare [a][b] against [b][a] in both matrices. Relative delta is
 * |x - y| / max(|x|, |y|); off-diagonal entries are guaranteed finite and
 * positive by validateBundle, so the denominator cannot be zero.
 */
function checkReverseSymmetry(bundle: MatrixBundle): ReverseSymmetry {
  const ids = sortedMatrixIds(bundle);
  let maxSecondsDelta = 0;
  let maxMetersDelta = 0;
  let maxRelativeSeconds = 0;
  let maxRelativeMeters = 0;
  let worstSecondsPair: string | null = null;
  let worstMetersPair: string | null = null;
  let orderedPairsOver1s = 0;
  let checkedPairs = 0;
  for (const a of ids) {
    for (const b of ids) {
      if (a >= b) continue;
      checkedPairs += 1;
      const ds = Math.abs(bundle.seconds[a][b] - bundle.seconds[b][a]);
      const dm = Math.abs(bundle.meters[a][b] - bundle.meters[b][a]);
      maxRelativeSeconds = Math.max(maxRelativeSeconds, ds / Math.max(bundle.seconds[a][b], bundle.seconds[b][a]));
      maxRelativeMeters = Math.max(maxRelativeMeters, dm / Math.max(bundle.meters[a][b], bundle.meters[b][a]));
      if (ds > maxSecondsDelta) {
        maxSecondsDelta = ds;
        worstSecondsPair = `${a}/${b}`;
      }
      if (dm > maxMetersDelta) {
        maxMetersDelta = dm;
        worstMetersPair = `${a}/${b}`;
      }
      if (ds > 1) orderedPairsOver1s += 2; // both orderings of the unordered pair
    }
  }
  return {
    checkedPairs,
    maxSecondsDelta: round(maxSecondsDelta, 6),
    maxMetersDelta: round(maxMetersDelta, 6),
    maxRelativeSeconds,
    maxRelativeMeters,
    worstSecondsPair,
    worstMetersPair,
    orderedPairsOver1s,
  };
}

/**
 * Exact metrics for every unordered pair. The crow term is the same-anchor
 * great-circle distance: the haversine between the two anchor coordinates the
 * router itself connects (see the anchor definition in the header).
 */
function buildPairMetrics(bundle: MatrixBundle): PairMetric[] {
  const ids = sortedMatrixIds(bundle);
  const metrics: PairMetric[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      const networkMeters = bundle.meters[a][b];
      const crowMeters = haversineMeters(bundle.anchors[a].anchor, bundle.anchors[b].anchor);
      metrics.push({ from: a, to: b, networkMeters, seconds: bundle.seconds[a][b], crowMeters, ratio: networkMeters / crowMeters });
    }
  }
  return metrics;
}

function toOutputRows(metrics: PairMetric[]): PairRow[] {
  return metrics.map((m) => ({
    from: m.from,
    to: m.to,
    networkMeters: round(m.networkMeters, 1),
    seconds: round(m.seconds, 1),
    impliedMeters: round(m.seconds * BASE_SPEED_MPS, 1),
    sameAnchorCrowMeters: round(m.crowMeters, 1),
    ratio: round(m.ratio, 4),
    ratioSeconds: round((m.seconds * BASE_SPEED_MPS) / m.crowMeters, 4),
    flagged: m.ratio > DETOUR_FLAG_RATIO,
  }));
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

  const invalid = validateBundle(bundle);
  if (invalid) {
    console.error(`FAIL: ${invalid}`);
    return 2;
  }

  const metrics = buildPairMetrics(bundle);
  const nonFinite = nonFiniteMetricError(metrics);
  if (nonFinite) {
    console.error(`FAIL: ${nonFinite}`);
    return 2;
  }
  const rows = toOutputRows(metrics);
  const ratioDist = distribution(rows.map((r) => r.ratio));
  const ratioSecondsDist = distribution(rows.map((r) => r.ratioSeconds));
  const flagged = rows.filter((r) => r.flagged);
  const stepsDriven = rows.filter((r) => !r.flagged && r.ratioSeconds > DETOUR_FLAG_RATIO);
  const symmetry = checkReverseSymmetry(bundle);

  // Enforcement 1: same-anchor great-circle floor. A ratio below 1 is
  // geometrically impossible between the routed endpoints; never clamped.
  const minRatio = Math.min(...metrics.map((m) => m.ratio));
  const floorViolations = metrics
    .filter((m) => m.crowMeters - m.networkMeters > FLOOR_TOLERANCE_M)
    .map((m) => ({
      from: m.from,
      to: m.to,
      networkMeters: round(m.networkMeters, 1),
      sameAnchorCrowMeters: round(m.crowMeters, 4),
      ratio: round(m.ratio, 6),
      deficitMeters: round(m.crowMeters - m.networkMeters, 4),
    }));
  const floorStatus = floorViolations.length === 0 ? "pass" : "fail";

  // Enforcement 2: reverse-entry symmetry, fail beyond relative tolerance.
  const symmetryStatus =
    symmetry.maxRelativeSeconds > SYMMETRY_RELATIVE_TOLERANCE || symmetry.maxRelativeMeters > SYMMETRY_RELATIVE_TOLERANCE
      ? "fail"
      : "pass";

  const methodCounts: Record<string, number> = {};
  for (const id of sortedMatrixIds(bundle)) {
    methodCounts[bundle.anchors[id].method] = (methodCounts[bundle.anchors[id].method] ?? 0) + 1;
  }

  const payload = {
    threshold: DETOUR_FLAG_RATIO,
    enforcement: {
      sameAnchorFloor: {
        status: floorStatus,
        toleranceMeters: FLOOR_TOLERANCE_M,
        definition:
          "violation = haversine(anchors[a].anchor, anchors[b].anchor) - meters[a][b] > toleranceMeters; the anchors are the exact walkway nodes routeBetweenNodes connects, so a network path shorter than the straight line by more than the 0.1 m storage-rounding allowance is impossible and is a hard error (never clamped, skipped or hidden)",
        largestDeficitMeters: round(Math.max(...metrics.map((m) => m.crowMeters - m.networkMeters)), 4),
        minRatio: round(minRatio, 6),
        violations: floorViolations,
      },
      reverseSymmetry: {
        status: symmetryStatus,
        relativeTolerance: SYMMETRY_RELATIVE_TOLERANCE,
        ...symmetry,
      },
    },
    inputs: {
      walkingTimes: "frontend/src/lib/campus/data/walking-times.json",
      speeds: "frontend/src/lib/campus/speeds.ts (verified equal to the inlined constants)",
      matrixDim: `${sortedMatrixIds(bundle).length}x${sortedMatrixIds(bundle).length}`,
      generatedBy: bundle.meta.generatedBy,
    },
    method: {
      networkMeters: "matrix meters — the runtime A* path length between the two anchor walkway nodes, recorded at matrix build time (stored at 1-decimal precision)",
      sameAnchorCrowMeters:
        "inline haversine (R=6371000 m) between anchors[a].anchor and anchors[b].anchor — the exact endpoint coordinates of the routed path (anchor definition in the script header)",
      impliedMeters: "matrix seconds x 1.4 m/s base speed (steps legs timed at 0.6 m/s inflate this)",
      ratio: "networkMeters / sameAnchorCrowMeters",
      ratioSeconds: "impliedMeters / sameAnchorCrowMeters",
      pairSet: "unordered pairs; diagonal excluded",
      reviewRound1BasisRemoved:
        "round 1 divided by outline-centroid / registry-pin crow (not the routed endpoints), which admitted ratios < 1; that basis no longer exists in this script",
    },
    summary: {
      orderedPairsOffDiagonal: sortedMatrixIds(bundle).length * (sortedMatrixIds(bundle).length - 1),
      unorderedPairs: rows.length,
      ratio: ratioDist,
      ratioSeconds: ratioSecondsDist,
      flaggedCount: flagged.length,
      flaggedPairs: flagged.map((r) => ({ from: r.from, to: r.to, ratio: r.ratio, networkMeters: r.networkMeters, sameAnchorCrowMeters: r.sameAnchorCrowMeters })),
      stepsDrivenFlags: stepsDriven.map((r) => ({ from: r.from, to: r.to, ratioSeconds: r.ratioSeconds, ratio: r.ratio })),
      maxStepsInflationMeters: rows.reduce(
        (best, r) => (r.impliedMeters - r.networkMeters > best.delta ? { pair: `${r.from}->${r.to}`, delta: round(r.impliedMeters - r.networkMeters, 1) } : best),
        { pair: "", delta: 0 },
      ),
      anchors: {
        count: sortedMatrixIds(bundle).length,
        methodCounts,
        connectorMeters: connectorStats(bundle),
      },
    },
    pairs: rows,
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`detour-bounds: ${sortedMatrixIds(bundle).length}x${sortedMatrixIds(bundle).length} matrix -> ${rows.length} unordered pairs`);
  console.log(`crow basis: same-anchor great-circle — haversine between the exact anchor coordinates the router connects (see script header)`);
  console.log(`ratio (network / same-anchor crow) over unordered pairs: ${JSON.stringify(ratioDist)}`);
  console.log(`ratio via seconds x 1.4 m/s (same-anchor basis): ${JSON.stringify(ratioSecondsDist)}`);
  console.log(
    `enforcement — same-anchor floor (0.1 m storage-rounding allowance): ${floorStatus.toUpperCase()}` +
      (floorViolations.length === 0 ? ` (min ratio ${round(minRatio, 6)})` : ""),
  );
  console.log(
    `enforcement — reverse-entry symmetry (relative tolerance 1e-6): ${symmetryStatus.toUpperCase()} — ` +
      `max |Δmeters| ${symmetry.maxMetersDelta} m, max |Δseconds| ${symmetry.maxSecondsDelta} s over ${symmetry.checkedPairs} reverse pairs`,
  );
  for (const v of floorViolations) {
    console.log(
      `  FLOOR VIOLATION ${v.from}->${v.to}: ratio ${v.ratio} (network ${v.networkMeters} m vs same-anchor crow ${v.sameAnchorCrowMeters} m; deficit ${v.deficitMeters} m) — geometrically impossible; surfaced, not clamped`,
    );
  }
  console.log(`flagged pairs (ratio > ${DETOUR_FLAG_RATIO}): ${flagged.length}`);
  for (const pair of flagged) {
    console.log(`  FLAG ${pair.from} -> ${pair.to}: ratio ${pair.ratio} (network ${pair.networkMeters} m vs same-anchor crow ${pair.sameAnchorCrowMeters} m)`);
  }
  for (const pair of stepsDriven) {
    console.log(`  STEPS-DRIVEN ${pair.from} -> ${pair.to}: ratio ${pair.ratio} but ${pair.ratioSeconds} via seconds x 1.4 (steps legs timed at 0.6 m/s)`);
  }
  console.log(`evidence written to ${OUTPUT_PATH}`);
  return floorStatus === "fail" || symmetryStatus === "fail" ? 3 : 0;
}

process.exit(main());
