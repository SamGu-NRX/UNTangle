# selftest — prove the eval harness can fail

Bun tests that exercise the real runner (`evals/run.ts`, spawned as a bounded
subprocess) against throwaway fixtures and planted defects. Two layers:

1. **Runner-contract tests** — prove the runner's own failure contract with
   fake suites/fake targets (exit codes, accounting, honest not-applicable
   records).
2. **Real-suite planted-defect tests** — for each real suite, plant one defect
   at exactly the boundary that suite observes and assert the REAL suite's
   named case fails (a harness that only fails on fake suites proves nothing
   about the real ones).

| file | layer | proves |
| --- | --- | --- |
| `runner-contract-args.test.ts` | contract | bad args are refused with **exit 2** (missing `--target-sha`, short SHA, no args, unknown `--suite`) — no stack, no scorecard |
| `runner-contract-case-accounting.test.ts` | contract | case outcomes are accounted honestly: green run **exit 0**, a failing case **exit 1** (returned fail, thrown case, crashed `describe()`), with the case record, summary line, and a validator-clean scorecard |
| `runner-contract-infra-exit3.test.ts` | contract | a preflight/stack step failure is an honest **exit 3**: scorecard still written, `infrastructure.brokenStep` names the broken step, every declared case is `not-applicable` with the honest not-run note |
| `runner-contract-planted-failure.test.ts` | contract | a deliberately planted data defect is **caught** by a fake suite: one mutated byte flips the same (byte-identical) detector from pass to fail |
| `real-optimizer-planted-defect.test.ts` | real suite | the optimizer suite's boundary is the target's bench artifact: no bench → 3 × not-applicable; conforming bench → 3 × pass; a planted bench reporting 3 hard-constraint violations → `violations-zero` FAILS naming the count while `p95-8courses` still passes |
| `real-data-planted-defect.test.ts` | real suite | the data suite's boundaries are the provenance descriptor and the catalog-consistency tool: one corrupted bundle byte → `provenance-descriptor` FAILS with `sha256 MISMATCH`; a tool reporting `failures=2` → `catalog-certification-counts` FAILS naming the count; each with the sibling case still passing |
| `real-routing-planted-defect.test.ts` | real suite | the routing suite's boundary is `/api/map/resolve` + `/api/map/route`: a fake HTTP app with legal distances → 3 × pass; a planted sub-geodesic `/api/map/route` response → `route-geodesic-floor` FAILS with a `< great-circle` violation note while `building-coverage` and `route-latency` still pass |
| `real-persistence-faults-planted-defect.test.ts` | real suite | full real stack + real UI: a saboteur SIGKILLs Postgres the moment the playwright-launch step starts; the run must blame CASES (exit 1, `infrastructure.ok` true, all stack steps pass), with `failed-saves-never-saved` failing and "case could not complete" harness-error notes. **Heavy — env-gated**: `SELFTEST_HEAVY=1 bun test selftest/real-persistence-faults-planted-defect.test.ts`; boots the real stack, run solo, never concurrently with other Playwright work |
| `real-ui-suites-planted-defect.test.ts` | real suite | journey/honesty/a11y-polish defect tests written against the case IDs those suites declare. The test bodies are **skip-guarded** on those suites landing on the integration branch (`describe.skipIf`), so the file runs green as 3 skips today and activates when the suites land |

Run:

```sh
cd evals
bun install          # once; the real runner imports pg at module load
bun test selftest/
```

Fast contract batch only (no real-suite runs, seconds not minutes):

```sh
cd evals && bun test selftest/runner-contract-*.test.ts
```

Heavy real-suite runs are paced by the routing suite (~1 request/s), so the
optimizer/data/routing planted-defect files take on the order of a few minutes
total. The persistence-faults file boots the real stack and is the only
Playwright one here — never run it concurrently with other Playwright work.

Type checks: the evals `tsconfig.json` include set does not cover `selftest/`,
so the files are strict-typechecked separately with the same compiler options:

```sh
cd evals && bun x tsc --noEmit --strict --target esnext --module esnext \
  --moduleResolution bundler --skipLibCheck --types bun selftest/*.ts
```

## How the fixtures work

- **Fake target** — a temp directory holding only `evals/CONTRACT.md` (the
  runner's only hard requirement), deliberately NOT a git repo.
- **Stubbed harness copy** — a full `cp` of `evals/` into the fixture root
  whose `stack.ts` is replaced by a healthy stub (`helpers.ts`'s
  `STUB_STACK_TS`). The copied `run.ts` is byte-identical to the real one, so
  the accounting logic under test is real while no Postgres, backend,
  frontend build, or browser is ever booted. The real suites run against this
  copy and the planted target artifacts.
- **Planted target artifacts** (`helpers.ts`) — `writeBenchArtifact` emits a
  bench artifact whose JSON report conforms to the documented contract except
  for one controlled field (violations count); `writeDataArtifacts` emits a
  flat-literal provenance descriptor whose sha256 matches the bundled catalog
  plus a conforming consistency tool, with `corruptBundle()` mutating one byte
  and `toolFailures` controlling the tool's reported failure count.
- **Fake routing app** — a throwaway Bun HTTP server implementing the
  `/api/map/resolve` and `/api/map/route` boundary; `plantSubGeodesic` mutates
  route responses to report distances below the great-circle floor. The real
  routing suite is pointed at it via its own standalone knob
  (`UNTANGLE_BASE_URL`, `suites/routing.ts`'s documented precedence).
- **Real stack sabotage** — `runner-contract-infra-exit3.test.ts` uses the
  real, unstubbed harness: the non-git fake target makes the real
  `submodule-backend` preflight step fail within seconds, exercising the
  identical `step()` → `StackBootError` → infra-scorecard code path the
  broken-Postgres exit-3 reference went through, at the earliest breakable
  step.
- Every fixture lives in a unique `mkdtemp` dir and is removed after the run.

## Observations for the harness owner (not fixed here)

Code-reading while writing these tests surfaced two latent paths this suite
does not exercise (reaching either requires booting the real backend or an
unwritable `--out`; fixing either is a design call above this suite's scope):

1. **Raw (non-step) preflight errors can never emit their infra scorecard.**
   In `run.ts`'s catch, a non-`StackBootError` gets `brokenStep: "(unknown
   step)"` and `stackSteps: []` — but `validateScorecard` requires a
   non-empty `stack` array, so `writeScorecard` throws and the runner crashes
   with exit 1 and no scorecard, instead of the documented exit 3. Today the
   only cheaply reachable raw error is the `pgdata` guard in `stack.ts`
   (expensive to reach: it sits behind the backend install/build steps); out-dir
   errors crash earlier, in `writeOutputs`' own `mkdirSync`.
2. **An unwritable `--out` misreports as a case failure.** When a path
   component of `--out` is a file, `writeOutputs` throws `ENOTDIR` and the
   runner exits 1 ("case failures") with no scorecard — a usage-shaped error
   reported with the case-failure exit code.

## Scope

Only this directory was added; no evals core file changed. The selftest files
follow the existing `suites/` convention of sitting outside
`evals/tsconfig.json`'s include set; they are strict-typechecked with the same
compiler options (command above).
