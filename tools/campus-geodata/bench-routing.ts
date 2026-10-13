/**
 * bench-routing.ts — milestone-3 verification evidence.
 *
 * Run: bun tools/campus-geodata/bench-routing.ts <campus-routes.json | --no-fixture>
 * Exit codes: 0 the p95 route gate passed; 1 it failed; 2 usage error.
 *
 * Produces tools/campus-geodata/verification-evidence.json only. It used to
 * regenerate verification-report.md too, which overwrote the hand-written
 * accuracy, detour and latency sections and printed a test count it never
 * ran; the report is now edited by hand from the evidence files, and test
 * results come from an actual `bun test` run.
 *
 * Measures, on the committed artifacts only (no network):
 *   1. The 18 eval-fixture entrance pairs re-routed on the graph (agreement).
 *   2. Engine output (not field measurements) for 20 building-to-building
 *      routes between registry pins, as POST /api/map/route computes a leg.
 *   3. Latency: p50/p95/p99/max over 120 route computations and 10,000
 *      matrix lookups (the plan's gate: route p95 <= 200 ms).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { campusBuildings } from "../../frontend/src/lib/campus-locations";
import { routeBetweenPoints } from "../../frontend/src/lib/campus/graph";
import { walkingSecondsBetween } from "../../frontend/src/lib/campus/walking-times";

const HERE = dirname(fileURLToPath(import.meta.url));
// The eval fixture path is the first argument. `--no-fixture` skips the
// accuracy section on purpose (and says so in the evidence); a missing path
// is a usage error, not a silent skip.
const FIXTURE = process.argv[2];
if (!FIXTURE) {
  console.error("usage: bun tools/campus-geodata/bench-routing.ts <campus-routes.json | --no-fixture>");
  process.exit(2);
}
const SKIP_FIXTURE = FIXTURE === "--no-fixture";
// Overrides for checking the gate itself: a 0 ms gate must fail, and its
// evidence must not overwrite the committed file.
const GATE_MS = Number(process.env.BENCH_GATE_MS ?? 200);
const OUTPUT = process.env.BENCH_OUTPUT ?? join(HERE, "verification-evidence.json");

type FixturePair = {
  id: string;
  start: { buildingId: string; entrance: { lat: number; lng: number } };
  end: { buildingId: string; entrance: { lat: number; lng: number } };
  distanceMeters: number;
};

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: Number(percentile(sorted, 50).toFixed(3)),
    p95: Number(percentile(sorted, 95).toFixed(3)),
    p99: Number(percentile(sorted, 99).toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)),
  };
}

// ---- 1. fixture agreement -------------------------------------------------
const fixture = SKIP_FIXTURE ? { pairs: [] as FixturePair[] } : (JSON.parse(readFileSync(FIXTURE, "utf8")) as { pairs: FixturePair[] });
const fixtureRows = fixture.pairs.map((pair) => {
  const route = routeBetweenPoints(pair.start.entrance, pair.end.entrance);
  const mine = route?.distanceMeters ?? null;
  return {
    id: pair.id,
    fixtureMeters: pair.distanceMeters,
    routedMeters: mine === null ? null : Number(mine.toFixed(1)),
    errorPct: mine === null ? null : Number((((mine - pair.distanceMeters) / pair.distanceMeters) * 100).toFixed(2)),
  };
});
const routed = fixtureRows.filter((r) => r.routedMeters !== null);
const absErrors = routed.map((r) => Math.abs(r.errorPct!)).sort((a, b) => a - b);
const fixtureSummary = {
  total: fixtureRows.length,
  routed: routed.length,
  medianAbsErrorPct: Number(((absErrors[absErrors.length / 2 - 1] + absErrors[absErrors.length / 2]) / 2).toFixed(2)),
  within20Pct: routed.filter((r) => Math.abs(r.errorPct!) <= 20).length,
  exact: routed.filter((r) => r.errorPct === 0).length,
};

// ---- 2. 20 measured building-pair routes ----------------------------------
const routable = campusBuildings.filter((b) => !b.isOffCampus);
const byId = new Map(routable.map((b) => [b.id, b] as const));
// Deterministic spread: pair each compD code building with a far counterpart.
const MEASURED_PAIRS: Array<[string, string]> = [
  ["sage", "blb"], ["sage", "gab"], ["sage", "wh"], ["sage", "gate"], ["sage", "col"],
  ["chem", "art"], ["chem", "phys"], ["chem", "lang"], ["chem", "musi"], ["chem", "musa"],
  ["life", "blb"], ["life", "aud"], ["life", "hick"], ["life", "peb"], ["life", "pac"],
  ["matt", "dath"], ["matt", "symr"], ["gab", "life"], ["wh", "env"], ["uu", "gate"],
];
const measuredRoutes = MEASURED_PAIRS.map(([fromId, toId]) => {
  const from = byId.get(fromId)!;
  const to = byId.get(toId)!;
  const t0 = performance.now();
  const route = routeBetweenPoints({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng });
  const elapsed = performance.now() - t0;
  if (!route) throw new Error(`no route ${fromId} -> ${toId}`);
  return {
    from: fromId,
    to: toId,
    distanceMeters: Number(route.distanceMeters.toFixed(1)),
    networkMeters: Number(route.networkDistanceMeters.toFixed(1)),
    durationSeconds: Number(route.durationSeconds.toFixed(1)),
    stepsMeters: Number(route.stepsMeters.toFixed(1)),
    roadCrossings: route.roadCrossings,
    geometryPoints: route.geometry.length,
    computeMs: Number(elapsed.toFixed(3)),
  };
});

// ---- 3. latency ------------------------------------------------------------
const latencies: number[] = [];
for (let i = 0; i < 100; i += 1) {
  const from = routable[(i * 7) % routable.length];
  const to = routable[(i * 13 + 5) % routable.length];
  const t0 = performance.now();
  routeBetweenPoints({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng });
  latencies.push(performance.now() - t0);
}
// Plus the 20 measured-pair timings for a 120-sample pool.
for (const row of measuredRoutes) latencies.push(row.computeMs);
const routeLatency = summarize(latencies);

const lookupLatencies: number[] = [];
const ids = [...byId.keys()];
for (let i = 0; i < 10_000; i += 1) {
  const t0 = performance.now();
  walkingSecondsBetween(ids[i % ids.length], ids[(i * 31 + 7) % ids.length]);
  lookupLatencies.push((performance.now() - t0) * 1000); // microseconds
}
const matrixLatency = summarize(lookupLatencies);

const gate = { routeP95Ms: routeLatency.p95, gateMs: GATE_MS, pass: routeLatency.p95 <= GATE_MS };

// ---- 4. evidence + report ---------------------------------------------------
let commitSha = "unknown";
try {
  commitSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: join(HERE, "..", "..") }).toString().trim();
} catch {
  // best-effort provenance
}

const evidence = {
  generatedAt: new Date().toISOString(),
  commit: commitSha,
  fixture: SKIP_FIXTURE ? { skipped: "run with --no-fixture" } : { ...fixtureSummary, rows: fixtureRows },
  measuredRoutes,
  latency: {
    routeComputationMs: routeLatency,
    matrixLookupUs: matrixLatency,
    gate,
  },
  matrix: (() => { const mr = JSON.parse(readFileSync(join(HERE, "matrix-report.json"), "utf8")) as { buildings: number; maxMinutes: number; asymmetries: number }; return { buildings: mr.buildings, maxLegMinutes: mr.maxMinutes, asymmetries: mr.asymmetries }; })(),
};
writeFileSync(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`);


console.log(
  SKIP_FIXTURE
    ? "fixture: skipped (--no-fixture)"
    : `fixture: ${fixtureSummary.routed}/${fixtureSummary.total} routed, median |err| ${fixtureSummary.medianAbsErrorPct}%`,
);
console.log(`measured routes: ${measuredRoutes.length}/20`);
console.log(`route latency p95: ${routeLatency.p95} ms (gate ${GATE_MS}) — ${gate.pass ? "PASS" : "FAIL"}`);
console.log(`matrix lookup p95: ${matrixLatency.p95} µs`);
console.log(`wrote ${OUTPUT} (verification-report.md is edited by hand from the evidence files)`);
// A printed FAIL is a failed run.
process.exit(gate.pass ? 0 : 1);
