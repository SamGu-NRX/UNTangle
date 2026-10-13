/**
 * latency-bench.ts — fix-5 verification evidence: real handler latency for
 * POST /api/map/route against a locally served build (cold vs warm).
 *
 * The trip is a 12-stop across-campus tour between UNT registry buildings
 * (12 distinct ids, all routable walkway anchors), the handler's maximum.
 *
 * Run modes:
 *   bun tools/campus-geodata/verification/latency-bench.ts run \
 *     --url=http://127.0.0.1:3210/api/map/route \
 *     --label=warm-run-1 --requests=12 --gap-ms=5000 \
 *     --out=tools/campus-geodata/verification/latency-runs/warm-run-1.json
 *
 *   bun tools/campus-geodata/verification/latency-bench.ts merge \
 *     --dir=tools/campus-geodata/verification/latency-runs \
 *     --out=tools/campus-geodata/verification/latency-bench-results.json
 *
 * `run` POSTs the same 12-stop trip `--requests` times, `--gap-ms` apart
 * (default pacing keeps well under the handler's 60 req/min rate limit),
 * and records per-request wall-clock ms, HTTP status, and the response
 * source. Only HTTP 200 responses enter latency stats; every non-200 is
 * listed with its status and a short body excerpt.
 *
 * `merge` combines per-run JSON files into one machine-readable results
 * file with pooled warm stats and the cold list.
 *
 * No network calls beyond the local server; no API keys; no env access.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { campusBuildings } from "../../../frontend/src/lib/campus-locations";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 12 distinct registry buildings forming an across-campus tour. Every id is
 * a routable walkway anchor (see data/walking-times.json anchors). Order
 * spans west (sage), east (col), south (chem, matt, life, dath), central
 * (wh, uu, gab), north (env, blb), and the Gateway Center (gate) — a mix of
 * long legs (sage→gate ≈ 1.1 km) and short ones (gab→life ≈ 155 m).
 */
const TRIP_IDS = [
  "sage",
  "col",
  "life",
  "blb",
  "dath",
  "wh",
  "chem",
  "uu",
  "matt",
  "gab",
  "env",
  "gate",
] as const;

type Sample = {
  request: number;
  status: number;
  ms: number;
  source?: string;
  distanceMeters?: number;
  durationSeconds?: number;
  geometryPoints?: number;
  bodyExcerpt?: string;
};

type RunResult = {
  label: string;
  measuredAt: string;
  url: string;
  requests: number;
  gapMs: number;
  trip: { stopCount: number; buildingIds: string[]; stops: Array<{ lat: number; lng: number }> };
  samples: Sample[];
  ok200: number;
  non200: Sample[];
  latencyMs: {
    n: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    min: number;
  };
  sources: Record<string, number>;
};

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (v: number) => Number(v.toFixed(3));
  return {
    n: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1] ?? 0),
    min: round(sorted[0] ?? 0),
  };
}

function buildTrip() {
  const byId = new Map(campusBuildings.map((b) => [b.id, b]));
  const stops = TRIP_IDS.map((id) => {
    const building = byId.get(id);
    if (!building) throw new Error(`trip id ${id} not found in registry`);
    return { lat: building.lat, lng: building.lng };
  });
  return { stopCount: stops.length, buildingIds: [...TRIP_IDS], stops };
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-zA-Z-]+)=(.*)$/.exec(arg);
    if (match) args.set(match[1], match[2]);
  }
  return args;
}

async function run(url: string, label: string, requests: number, gapMs: number, out: string) {
  const trip = buildTrip();
  const body = JSON.stringify({ stops: trip.stops });
  const samples: Sample[] = [];

  for (let index = 0; index < requests; index += 1) {
    if (index > 0 && gapMs > 0) {
      await Bun.sleep(gapMs);
    }
    const started = performance.now();
    let status = 0;
    let source: string | undefined;
    let distanceMeters: number | undefined;
    let durationSeconds: number | undefined;
    let geometryPoints: number | undefined;
    let bodyExcerpt: string | undefined;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      status = response.status;
      const text = await response.text();
      if (response.ok) {
        try {
          const parsed = JSON.parse(text) as {
            source?: string;
            distanceMeters?: number;
            durationSeconds?: number;
            geometry?: unknown[];
          };
          source = parsed.source;
          distanceMeters = parsed.distanceMeters;
          durationSeconds = parsed.durationSeconds;
          geometryPoints = parsed.geometry?.length;
        } catch {
          bodyExcerpt = `unparseable 200 body: ${text.slice(0, 200)}`;
        }
      } else {
        bodyExcerpt = text.slice(0, 200);
      }
    } catch (error) {
      bodyExcerpt = `transport error: ${error instanceof Error ? error.message : String(error)}`;
    }
    const ms = performance.now() - started;
    samples.push({
      request: index + 1,
      status,
      ms: Number(ms.toFixed(3)),
      source,
      distanceMeters,
      durationSeconds,
      geometryPoints,
      ...(bodyExcerpt ? { bodyExcerpt } : {}),
    });
    const tag = status === 200 ? `${status} ${source}` : `HTTP ${status || "no-response"}`;
    console.log(`[${label}] request ${index + 1}/${requests}: ${tag} ${ms.toFixed(1)} ms`);
  }

  const ok = samples.filter((s) => s.status === 200);
  const non200 = samples.filter((s) => s.status !== 200);
  const sources: Record<string, number> = {};
  for (const sample of ok) {
    const key = sample.source ?? "(none)";
    sources[key] = (sources[key] ?? 0) + 1;
  }

  const result: RunResult = {
    label,
    measuredAt: new Date().toISOString(),
    url,
    requests,
    gapMs,
    trip,
    samples,
    ok200: ok.length,
    non200,
    latencyMs: summarize(ok.map((s) => s.ms)),
    sources,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `[${label}] 200s: ${ok.length}/${requests}; p50 ${result.latencyMs.p50} ms, p95 ${result.latencyMs.p95} ms, max ${result.latencyMs.max} ms; sources ${JSON.stringify(sources)}; wrote ${out}`,
  );
}

function commitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(HERE, "..", "..", ".."), encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function merge(dir: string, out: string) {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json") && resolve(dir, name) !== resolve(out))
    .sort();
  if (files.length === 0) throw new Error(`no run JSON files in ${dir}`);

  const runs = files.map((name) => {
    const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as RunResult;
    return parsed;
  });

  const warmRuns = runs.filter((r) => r.requests > 1);
  const coldRuns = runs.filter((r) => r.requests === 1);
  const pooledWarm = summarize(warmRuns.flatMap((r) => r.samples.filter((s) => s.status === 200).map((s) => s.ms)));
  const coldMs = coldRuns.filter((r) => r.ok200 > 0).map((r) => r.samples.find((s) => s.status === 200)!.ms);
  const non200 = runs.flatMap((r) => r.non200.map((s) => ({ run: r.label, ...s })));
  const sources: Record<string, number> = {};
  for (const run of runs) {
    for (const [key, count] of Object.entries(run.sources)) {
      sources[key] = (sources[key] ?? 0) + count;
    }
  }

  const merged = {
    generatedAt: new Date().toISOString(),
    commit: commitSha(),
    bun: Bun.version,
    note: "All numbers from real POST /api/map/route requests against a locally served production build (next start, port 3210, no ORS_API_KEY, no DATABASE_URL). 12-stop registry-building trip. Only HTTP 200s counted in latency stats.",
    trip: buildTrip(),
    runs,
    summary: {
      cold: {
        n: coldMs.length,
        measurementsMs: coldMs.map((v) => Number(v.toFixed(3))),
        maxMs: coldMs.length ? Number(Math.max(...coldMs).toFixed(3)) : null,
      },
      warm: {
        runs: warmRuns.map((r) => ({ label: r.label, ...r.latencyMs })),
        pooled: pooledWarm,
      },
      non200,
      sources,
    },
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`merged ${files.length} runs (${relative(process.cwd(), out)}):`);
  console.log(`  cold: ${JSON.stringify(merged.summary.cold.measurementsMs)} ms (max ${merged.summary.cold.maxMs} ms)`);
  for (const run of merged.summary.warm.runs) {
    console.log(`  ${run.label}: n=${run.n} p50=${run.p50} p95=${run.p95} max=${run.max} ms`);
  }
  console.log(`  warm pooled: n=${pooledWarm.n} p50=${pooledWarm.p50} p95=${pooledWarm.p95} max=${pooledWarm.max} ms`);
  console.log(`  non-200: ${non200.length}; sources: ${JSON.stringify(sources)}`);
}

const [mode] = process.argv.slice(2);
const args = parseArgs(process.argv.slice(3));

if (mode === "run") {
  const url = args.get("url") ?? "http://127.0.0.1:3210/api/map/route";
  const label = args.get("label") ?? "run";
  const requests = Number(args.get("requests") ?? "12");
  const gapMs = Number(args.get("gap-ms") ?? "5000");
  const out = args.get("out");
  if (!out) throw new Error("--out=<path> is required for run");
  await run(url, label, requests, gapMs, out);
} else if (mode === "merge") {
  const dir = args.get("dir");
  const out = args.get("out");
  if (!dir || !out) throw new Error("--dir=<runs-dir> and --out=<path> are required for merge");
  merge(dir, out);
} else {
  console.error("usage: latency-bench.ts run|merge ...  (see header comment)");
  process.exit(2);
}
