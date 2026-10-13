# Map handler latency — cold vs warm (12-stop trip)

Measured 2026-10-11 at commit `f44f23d` against the **real** `POST /api/map/route`
handler served over HTTP — not the in-process estimates in
`verification-report.md`. Reproduce with the commands at the bottom.

## Environment

| item | value |
|---|---|
| Build mode | **production** (`bun run build` → `next build`, exit 0, then `bun run start -- -p 3210`) |
| Commit | `f44f23d821966bbd39f581d0e63bbe1d851db910` |
| Server | `next-server (v1)` on port **3210**, started under tmux |
| Env scrubbing | server started with `env -u ORS_API_KEY -u DATABASE_URL`; verified empty via `/proc/<pid>/environ` for all 3 server starts |
| Machine | Linux 6.1.158+, Intel(R) Xeon(R) @ 2.60 GHz, 2 vCPU, 7.8 GiB RAM |
| Toolchain | bun 1.3.14, node v20.20.2 |

Because `ORS_API_KEY` is absent, the handler cannot touch the network: every
measured response came from the offline walkway path (`source: "walkway"` at
this commit — the rename to `campus-network` lands separately and is not
asserted here). With no `DATABASE_URL`, nothing else was reachable either.

## Trip body

12 stops (the handler's `maxStops`), all distinct registry buildings and all
routable walkway anchors, sent as `{"stops":[{"lat","lng"},…]}` in this order:

`sage → col → life → blb → dath → wh → chem → uu → matt → gab → env → gate`

(Sage Hall → Coliseum → Life Sciences Complex → Business Leadership Building →
Dance and Theatre Building → Wooten Hall → Chemistry Building → University
Union → Matthews Hall → General Academic Building → Environmental Science
Building → Gateway Center.) Exact coordinates are in
`latency-bench-results.json` under `trip.stops`. The full trip routes
deterministically on the walkway graph: all **27/27** successful responses
returned the identical payload — 8,358.5 m network distance, 6,107 s walking
duration, 662 geometry points.

## Results

Latency stats count **only HTTP 200 responses**. Non-200s: **none** (27/27 = 200).

### Cold — 1 request per fresh server start (3 starts)

| start | wall-clock ms |
|---|---|
| cold 1 (first start after build) | **304.3** |
| cold 2 (fresh start) | **150.9** |
| cold 3 (fresh start) | **124.7** |

### Warm — 12 requests, 5 s apart (12 req/min; limiter allows 60/min)

Two complete runs, both reported:

| run | n | p50 (ms) | p95 (ms) | max (ms) |
|---|---|---|---|---|
| warm run 1 | 12 | 55.5 | 124.2 | 124.2 |
| warm run 2 | 12 | 22.4 | 39.5 | 39.5 |
| **warm pooled** | **24** | **37.7** | **123.9** | **124.2** |

Run 1's first request took 112.4 ms (JIT/module warm-up inside the already
running process) and run 1's p95 is dominated by those early samples; by run 2
the process had settled to a p50 of 22.4 ms. Per-request numbers for every
sample are in `latency-bench-results.json` (per-run files in `latency-runs/`).

## Verdict against the plan's budget

The plan (`docs/plan/untangle-plan.md`, routing row) gates at **p95 ≤ 200 ms
for 12 stops**. Steady-state performance passes with room to spare: pooled warm
p95 is **123.9 ms** (and 39.5 ms in the settled second run) against the 200 ms
budget, with all 24 warm requests 200s. The budget is exceeded **once** — the
single very first request served by the very first server start after a build
(304.3 ms), which additionally pays route-module initialization and cold OS
page caches for the ~0.35 MB walkway graph JSON; the two subsequent
fresh-process cold
starts (150.9 ms and 124.7 ms) are within budget, so the overage is a
one-time-after-deploy cost, not steady-state latency. Honest caveat: these are
sandbox numbers on a 2-vCPU shared host; absolute values will differ on other
hardware, but the offline walkway path leaves a >75 ms margin at p95 here.

## Reproduce

```bash
git checkout obv/untangle-campus-routing-f1-fix5-latency
cd frontend && bun install --frozen-lockfile && bun run build
# from the repo root, port 3210 must be free (ss -tlnp); no ORS_API_KEY /
# DATABASE_URL may be set — the offline path must be what is measured:
bun tools/campus-geodata/verification/latency-bench.ts run \
  --url=http://127.0.0.1:3210/api/map/route --label=cold-1 \
  --requests=1 --gap-ms=0 \
  --out=tools/campus-geodata/verification/latency-runs/cold-1.json
bun tools/campus-geodata/verification/latency-bench.ts run \
  --url=http://127.0.0.1:3210/api/map/route --label=warm-run-1 \
  --requests=12 --gap-ms=5000 \
  --out=tools/campus-geodata/verification/latency-runs/warm-run-1.json
bun tools/campus-geodata/verification/latency-bench.ts merge \
  --dir=tools/campus-geodata/verification/latency-runs \
  --out=tools/campus-geodata/verification/latency-bench-results.json
```

Machine-readable evidence: `latency-bench-results.json` (all 5 runs, pooled
stats, commit, environment). This report deliberately does not touch
`verification-report.md` or `verification-evidence.json`.
