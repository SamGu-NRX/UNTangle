# Optimizer benchmark (bench/)

The shared benchmark for UNTangle optimizer round 1. Everything here is
deterministic: seeded generators, no `Math.random`, no clocks in the outputs
(timings are the only non-deterministic numbers, and they are clearly marked).
All sections and catalog instances are SYNTHETIC samples — nothing here
describes a real term.

## Pieces

| File | Role |
|---|---|
| `rng.ts` | Seeded PRNG (mulberry32, the `tests/schedule-oracle.test.ts` pattern) plus `pick`/`shuffled`/`randInt`/`maybe` helpers. |
| `generator.ts` | `generateInstance(seed, size)` builds complete `OptimizeRequest`s over a synthetic 5-building network (+2 deliberately unknown `bench-ghost-*` ids), with dense conflict injection and per-profile constraint mixes. Exports `benchWalkingTime`, the benchmark's walking function. |
| `catalogAdapter.ts` | Builds `OptimizeRequest`s from the bundled `@/lib/seed-data` catalog (656 courses / 2704 sections): `'HH:MM'` → minutes, credits from the course's `creditHours`, `instructorRating` from the section rating, no `historicalGpa`, lowercase building ids. The real-catalog suite. |
| `instances.ts` | THE pinned suite: named families, fixed seeds, exact counts. Reproducible from its seeds forever. |
| `../scorer.ts` | The NORMATIVE scorer (`computeBreakdown`) — the cost definition every variant must match. |
| `../brute-force.ts` | The exact reference optimizer + `isFeasible`. |
| `../iis-reference.ts` | The IIS deletion-filter reference. |
| `../checker.ts` | THE INDEPENDENT checker — re-implements every rule from the `types.ts` doc comments, sharing no code with scorer/brute force. |
| `run-bench.ts` | The runner (below). |
| `bundle-size.ts` | Per-variant bundle probe (below). |
| `results/` | Committed snapshots of runs. |

## Running

```bash
cd frontend
# One variant over the pinned suites; brute force itself is the M1 smoke variant:
bun run src/lib/optimizer/bench/run-bench.ts --variant=./src/lib/optimizer/brute-force --suite=all --k=3 --repeat=5
# --suite=all | synthetic | catalog | edge;  --k defaults to the pinned 3;  --repeat defaults to 5

# Bundle probe (Bun.build minified, then gzip; no new dependencies):
bun run src/lib/optimizer/bench/bundle-size.ts --variant=./src/lib/optimizer/brute-force

# The contract tests:
bun test tests/optimizer/
```

The runner writes `bench/results/<variant>-<suite>.json` (bundle probe:
`bench/results/bundle-<variant>.json`), prints a markdown table, and skips —
with a reason — any instance the variant refuses (e.g. brute force's
enumerability bound on non-enumerable instances).

## Seeds

- `BASE_SEED = 424242` (in `instances.ts`).
- Synthetic family `i` (in `SYNTHETIC_FAMILIES` order) uses seed
  `424242 + i * 7919`.
- Catalog families use the adapter's lock/exclusion seed `1` (course-code
  picks are deterministic by name range).
- `generateInstance(seed, size)` is a pure function of `(seed, size)` —
  same inputs, same instance, byte for byte.

Changing any seed or family size in `instances.ts` invalidates every
previously recorded result. Do it only in a new benchmark round and note the
change here.

## Metric definitions

- **violations** — MAX count of `runChecker(req, result)` violations over the
  repeats that ran, with per-repeat values in `repeatViolations`. A single
  invalid repeat flags the instance even when later repeats are clean —
  nothing is silently replaced. `iisValid` is false if ANY repeat's IIS is
  absent or invalid.
- **optimality gap** — variant best cost − brute-force best cost, on
  enumerable instances where both return at least one schedule. On infeasible
  instances it is `-` (use top-k and IIS validity instead).
- **top-k agreement** — `|variant top-k set ∩ brute-force top-k set| / k`,
  on enumerable instances. When an instance has fewer than `k` feasible
  schedules the ceiling is `m/k`, not 1.0 (e.g. 0.333 for a single-schedule
  instance is FULL agreement). Two infeasible results agree fully → 1.0.
- **diversity** — the returned value; the checker recomputes it from the
  schedules (tolerance 1e-9).
- **IIS validity** — for infeasible results, `verifyIis`'s conjunction of
  `subsetInfeasible` and `allSingleRemovalsFeasible` (the checker's own
  independent enumeration).
- **initMs / searchMs** — the variant's own reported phases: init =
  candidate construction, search = solving. The runner also measures wall
  time around the whole call. p50/p95 use the nearest-rank method over the
  `--repeat` runs (per instance) or all repeats pooled (per size class).

## Error classification

Variants that cannot run a non-enumerable instance (exhaustive search)
MUST refuse by throwing `NonEnumerableRefusal` (exported from
`../brute-force`, carrying `productSize`). The runner classifies
exceptions STRUCTURALLY via `instanceof` — never by matching messages:

- `NonEnumerableRefusal` on a non-enumerable instance → skip, with the
  reason (and product size) recorded in `skipReason`.
- Anything else — including `NonEnumerableRefusal` on an ENUMERABLE
  instance — is a variant ERROR: recorded per instance (`errorClass`,
  `errorMessage`) and in the run-level `errorInstances`; the runner prints
  the failures to stderr, still writes the JSON (errors must appear in
  committed results, never vanish), and exits non-zero.

Every repeat is checked; `repeatViolations` / `repeatIIsValid` keep the
per-repeat evidence in the JSON.

## Enumerable bound

Brute force enumerates the cartesian product of per-course candidate counts
(after exclusions, locks applied) and refuses (throws) any instance whose
product exceeds **1,000,000**. `BenchInstance.enumerable` computes the same
bound so the runner knows when a reference comparison is possible. Heuristic
variants should run every instance regardless; their non-enumerable rows
simply have no gap/top-k columns.

## Latency protocol

Benchmarks run alone on a quiet machine, single thread. Every repeat gets
the request's own `timeBudgetMs` (the suite overrides it to 3000 ms for the
8×40 worst case and 2000 ms for the 6×30 large family). Report medians and
p95s, never single runs. Do not compare timings across machines or across
commits that changed the instance seeds.

## Committed M1 smoke results

`results/brute-force-all.json`, `results/bundle-brute-force.json`,
`results/bundle-scorer.json` — the M1 smoke run of brute force as the
variant (all enumerable instances clean: 0 violations, gap 0, full top-k
agreement at each instance's schedule count; infeasible instances carry
irreducible IIS subsets verified by the independent checker). These are
snapshots, not live numbers; per-variant numbers arrive with the variant
threads.
