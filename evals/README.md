# UNTangle eval harness

A self-contained harness that boots the whole UNTangle stack, runs eval suites
against it, and writes validated scorecards. It drives a target checkout from
the outside and never depends on files inside the target at runtime beyond the
checkout itself (its drizzle migrations, its apps). The target is never
required to carry `evals/` — the contract document belongs to the harness,
which hashes its own `evals/CONTRACT.md` during preflight (decision 685a).

Owner files (the harness core — suite workers must not edit these):
`package.json`, `tsconfig.json`, `stack.ts`, `preflight.ts`, `rmp-block.ts`,
`scorecard.ts`, `SCHEMA.md`, `bars.json`, `run.ts`, `suite-kit.ts`, and
`selfcheck/`. Suites live in `suites/<name>.ts`, are registered in
`run.ts`'s explicit `SUITE_REGISTRY` (the seven real suites), and are added
by suite workers.

## Quickstart

```sh
# from the repo root (harness deps are local to evals/)
cd evals
bun install
bun run.ts --target-dir <UNTangle checkout> --target-sha <40-hex sha> \
     --suite selfcheck --out /tmp/scorecard.json
echo $?   # 0 all pass · 1 case failures · 2 usage error · 3 infra failure
```

The selfcheck suite owns no application cases: it proves the plumbing
(preflight green, database roundtrip, frontend renders, the
RateMyProfessors block actually blocks). When it exits 0 the stack is
healthy and the runner has produced a validated scorecard.

## How a run works

1. **Preflight** (`stack.ts`, via `preflight.ts`) boots the stack step by
   step. Every step has a timeout, a name, its own log under
   `<out-dir>/preflight-logs/`, and is cleaned up by `stop()`:
   | step | what happens |
   | --- | --- |
   | `target-dir` / `contract-hash` | target checkout exists and is a directory; the HARNESS's own `evals/CONTRACT.md` is hashed (sha256 recorded in the step detail) — the target is never required to carry `evals/` (decision 685a) |
   | `submodule-backend` | backend submodule at its pinned SHA (`0a49d4d…`) |
   | `backend-install` | `bun install` in the backend; native `better-sqlite3` binding present |
   | `backend-sqlite-build` | addon loads in Node (memory-db roundtrip) + backend `tsc` build |
   | `postgres-init` / `postgres-start` | fresh cluster under `/home/user/work/pgdata-<task-id>/` (never in the repo), started on a free 5432x port, `untangle` database created |
   | `migrations-apply` | frontend drizzle migrations applied with `DATABASE_URL` pointed at that cluster |
   | `db-roundtrip` | save-then-read-back probe — registered-user persistence is off without a working `DATABASE_URL` (frontend/src/lib/persistence.ts), so this gates everything downstream |
   | `frontend-install` | workspace `bun install` |
   | `backend-start` | backend up on a free port with the rmp-block preload (see below) |
   | `frontend-build` / `frontend-start` | `next build` (production) then `next start` with `DATABASE_URL`, `BETTER_AUTH_URL` aligned to the app origin, and a fresh random `BETTER_AUTH_SECRET` |
   | `playwright-launch` | headless chromium loads the app |
2. **Suites run** (`run.ts`): each discovered suite is loaded, its
   `describe()` case list is expanded, and every case runs with a per-case
   timeout (default 120 s; a suite can override via `caseTimeoutMs`).
3. **Scorecard** (`scorecard.ts`, schema in `SCHEMA.md`): assembled from
   observed facts, validated, written to `--out`, re-read and re-validated.
   A markdown summary lands next to it.

Any step failure is an **infrastructure failure**: exit 3, every case
`not-applicable`, and `infrastructure.error` naming the exact broken step.
A **registered suite that fails to load** (missing file, module-level throw,
wrong export shape) is a harness defect, not a skip: the runner also treats
it as infrastructure (exit 3), with a `suite-load` step record naming every
failing suite and the loadable suites' declared cases recorded
`not-applicable`. The choice of exit 3 (over a distinct code) keeps the
contract simple: exit 3 always means "the run produced no application
evidence — the harness itself is broken", and the scorecard's
`infrastructure.error` says exactly what it was.
Failing cases are **application failures**: exit 1. Never the same file.

## Runtime notes that shape the design

- **The backend cannot run on Bun.** Its `better-sqlite3` native addon
  crashes Bun (NAPI panic — the backend's own README says it runs on
  Node). `backend-start` therefore tries `bun --preload evals/rmp-block.ts`
  first (the spec'd shape) and falls back to the backend's documented
  runtime — `node`+`tsx` with the same preload transpiled to CJS and
  injected via `NODE_OPTIONS=--require`. Which mode ran is recorded in the
  step detail and disclosed as a `backend-runtime-fallback` stub on the
  scorecard when the fallback was used.
- **No `.env*` file is ever read, written, or copied.** Everything is passed
  via spawned-process environments; secrets (`BETTER_AUTH_SECRET`,
  `JWT_SECRET`) are fresh random values per run. A live key was leaked in
  this public repo's history — the harness treats every `.env*` file as
  radioactive.
- **No request ever reaches ratemyprofessors.com.** `rmp-block.ts` is a
  preload that wraps global fetch, rejects any RMP host, logs the attempt,
  and appends the count to a JSON file (`UNTANGLE_RMP_BLOCK_LOG`) the
  runner reads for the scorecard's `blockedRmpRequests` field. Unavailable
  or stale rating data is surfaced honestly by suites, never silently.
- **Google Fonts are pinned for reproducible builds.** Next's
  `next/font/google` occasionally receives a css2 response whose font URLs
  are extensionless (`/l/font?kit=…`), which crashes the Turbopack font
  module (vercel/next.js#99114). The harness pins verified css2 responses
  via `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` (cached under
  `/home/user/work/untangle-evals-cache/`); set
  `UNTANGLE_EVALS_FONT_MODE=live` to fetch live instead.

## Writing a suite

```ts
// evals/suites/my-suite.ts — the file name IS the suite name
// AND the file must be registered in run.ts's SUITE_REGISTRY (decision 685b).
import { defineSuite } from "../suite-kit";

export default defineSuite({
  name: "my-suite",
  describe: () => [{ id: "first-case" }, { id: "second-case" }],
  run: (caseId, ctx) => {
    // ctx.frontendOrigin, ctx.backendOrigin, ctx.databaseUrl,
    // ctx.runDir (write evidence here), ctx.blockedRmpLogPath,
    // ctx.preflightSteps
    switch (caseId) {
      case "first-case":
        return { status: "pass", measured: "42ms", evidencePath: `${ctx.runDir}/x.log` };
      default:
        return { status: "fail", note: `unknown case ${caseId}` };
    }
  },
});
```

Rules: the file must be registered in `run.ts`'s `SUITE_REGISTRY` (helper
modules keep an underscore prefix — `_optdata-lib`, `_persist-helpers`,
`_persist-injections` — and are imported by suites, never registered);
`describe()` returns the full case list up front (so an infra
failure can still produce an honest all-`not-applicable` scorecard); `run()`
executes ONE case and returns an outcome; throwing inside `run()` is
recorded as a case failure, not a crash. Bars come from `bars.json`
keyed by suite name unless a case overrides its own.

`bars.json` carries a disclaimer, verbatim: **these bars are proposals with
no calibration evidence yet** — they encode the plan's intent as first-pass
thresholds and will be recalibrated once real scorecards exist.

## Environment

- Bun ≥ 1.3 (`bun x tsc --noEmit` must be clean — run `bun run typecheck`),
  Node ≥ 20 (the backend's runtime), PostgreSQL 17 server binaries
  (`UNTANGLE_PG_BIN` overrides `/usr/lib/postgresql/17/bin`).
- Set `PLAYWRIGHT_BROWSERS_PATH=/home/user/work/pw-browsers` to share browser
  downloads across tasks; `bun x playwright install chromium` once.
- Runs are self-cleaning: processes are killed by process group, the
  Postgres cluster is stopped and removed (`UNTANGLE_EVALS_KEEP_PGDATA=1`
  keeps it for debugging).
