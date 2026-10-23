# Scorecard schema (v1)

Every eval run writes one scorecard JSON — the machine-readable record of what
was tested, against what code, with what result. The canonical type lives in
`evals/scorecard.ts` (`Scorecard`); `validateScorecard()` there is the
authority, and every written scorecard is validated before writing **and**
re-read and re-validated after writing. This document mirrors that type; if
they ever disagree, `scorecard.ts` wins and this file must be fixed.

A scorecard is a single JSON object with exactly these top-level fields:

## `schemaVersion` — `1` (required)

Bumps on any breaking shape change.

## `suite` — string (required, non-empty)

The suite *selector* this scorecard was produced for: either a single suite
name (e.g. `"selfcheck"`) or `"all"`. Individual cases carry their own
`suite` field (below), so one scorecard for `--suite all` records cases from
several suites.

## `startedAt` / `finishedAt` — ISO-8601 strings (required)

Wall-clock start of the run (before preflight) and time the scorecard was
assembled. `finishedAt >= startedAt` is validated.

## `target` — object (required)

- `sha` — string, the `--target-sha` flag the runner was given (7–40 hex chars).
- `dir` — string, non-empty, the target checkout directory that was exercised.
- `actualHead` — string (7–40 hex) or `null`: the real `git rev-parse HEAD` of
  the checkout at run time, when detectable. When `actualHead != sha` the run
  warns loudly on stderr; the scorecard records both so reviewers can judge
  attribution themselves.

## `runtime` — object (required)

Versions actually observed, not assumed: `bun`, `node`, `postgres`,
`playwright`, `os` — each a non-empty string. `postgres` is the full
`postgres --version` line; `os` is `<type> <release> <arch>`.

## `stack` — array (required, non-empty)

Per-step results of the stack preflight, in execution order. One entry per
step (ids unique; validated):

- `step` — string id, e.g. `"postgres-start"`, `"frontend-build"`.
- `status` — `"pass" | "fail" | "skipped"`.
- `durationMs` — non-negative number.
- `detail` — optional string; on failure it names the broken command and its
  error tail.
- `logPath` — optional path to the step's full log on the runner machine.

## `infrastructure` — object (required)

- `ok` — boolean. `true` when the whole stack came up.
- `brokenStep` — the named step that broke, when `ok` is `false`; must be
  `null` when `ok` is `true` (validated both ways).
- `error` — optional string; the human-readable failure, present on infra
  failure.

The infra contract: when the stack fails to boot, the runner still writes a
scorecard (exit code 3) where every declared case is `not-applicable` with a
"not run" note, `infrastructure.ok` is `false`, and `infrastructure.error`
names the exact broken step. Application failures and infrastructure failures
must never be conflated.

## `cases` — array (required)

One entry per executed (or declared-but-not-run) case:

- `suite` — string, non-empty: the suite this case belongs to.
- `id` — string, non-empty: stable case id within the suite.
- `status` — `"pass" | "fail" | "not-applicable"`.
- `measured` — string | number | boolean | null: the value actually observed
  (e.g. `"median 412ms"`, `0`, `true`). Absent/`null` when nothing was
  measured — e.g. every `not-applicable` case.
- `bar` — optional non-empty string: the bar this case was judged against
  (the suite's `bars.json` bar unless the case overrode it).
- `evidencePath` — optional string: file (log/screenshot/JSON) evidencing the
  outcome.
- `note` — optional string: free-form context, e.g. why a case is
  not-applicable or the error message of a case that threw.

## `blockedRmpRequests` — non-negative integer (required)

Count of outbound `ratemyprofessors.com` requests the `rmp-block` preload
rejected during the run, read from the counter file the preload maintains.
`0` is normal on suites that never trigger ratings traffic; the counter's
presence (not its value) is what the selfcheck proves.

## `stubs` — array (required)

Honest labels for degraded/stubbed behavior the run itself observed. Each
entry: `{ "label": string, "reason": string }` (both non-empty). Current
emitted label: `backend-runtime-fallback` (the pinned backend's native SQLite
addon crashes Bun, so the backend ran under Node/tsx with the same preload).
Empty array when the run had nothing to disclose.

## `hashes` — object (required)

- `contractMd` — sha256 hex of the HARNESS checkout's own `evals/CONTRACT.md`.
  The target is never required to carry `evals/` (decision 685a); the hash
  binds every scorecard to the exact contract text it was judged against.
- `barsJson` — sha256 hex of the harness checkout's own `evals/bars.json`
  (the harness's bars are the judging source, wherever the target points;
  see `scorecard.ts` for which file fed the hash).

Both are 64-char lowercase hex (validated).

---

## Exit-code contract of the runner

| exit | meaning |
| --- | --- |
| 0 | preflight green, every case passed |
| 1 | preflight green, ≥1 case failed |
| 2 | usage error (bad or missing CLI arguments) |
| 3 | infrastructure failure — a failed stack step, or a registered suite that failed to load (harness defect, `brokenStep: "suite-load"`); scorecard still written (all cases not-applicable) |

The markdown summary is written next to the JSON (`<out>.json` → `<out>.md`).
