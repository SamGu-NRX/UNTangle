# Schedule optimizer

Picks one section per course so that every hard constraint holds, ranks the
results by weighted preferences, and returns up to `k` (default 3) schedules
that differ in a way a student would notice. When nothing fits, it says which
settings conflict and offers one-click changes that it has checked.

The engine is the top-level files here. It imports nothing at runtime except
its own modules, so it knows nothing about the catalog, the plan or the page.
`planner.ts` (`buildOptimizeRequest`, `recommendSections`) adapts the plan into
an `OptimizeRequest`. `worker/` runs it off the main thread for the Week view.

## Contract

`optimize(request: OptimizeRequest): OptimizeResult`, types in `types.ts`.

- Times are minutes after midnight, half-open `[start, end)`. A class ending at
  10:00 and one starting at 10:00 do not overlap.
- Constraints are all or nothing: earliest start, latest end, days off,
  blocked times, max credits, and the walking check. Locks and exclusions are
  hard too.
- Weights are integers 0 to 4 over six terms (fewer days, idle time, mornings,
  evenings, walking, rating). The cost is an integer sum in human units, so
  ties are exact. The exchange rates in `score.ts` are a judgment, not a
  measurement.
- Ties break by section ids in course-code order. With `maxNodes` the answer
  is the same on every machine. With `timeBudgetMs` it can stop at different
  points on different machines.
- A malformed request (an unknown section, a duplicate exclusion or blocked-time
  id, a negative walking time) throws `OptimizerInputError`. That is a caller
  bug, never student input. `parseSchedulePreferences` in `planner.ts` rejects
  stored preferences that would trigger one, such as duplicate blocked-time ids.

## Statuses

| Status | Meaning | Page copy |
| --- | --- | --- |
| `optimal` | Every returned schedule is proven best at its rank. | "Ranked by your preferences..." |
| `feasible` | A schedule was found, but the budget ran out before it was proven best. | "Best so far" while the longer search runs, then "Best found within the time limit; a better one may exist." |
| `timeout` | The budget ran out before any schedule was found or ruled out. | "Still searching", then "No schedule found in time" |
| `infeasible` | Proven: no schedule meets every hard constraint. Carries an `explanation`. | The explanation sentence and its suggestions |

Only `optimal` and `infeasible` are proofs. The page labels anything else as
not proven.

## Alternatives and the diversity rule

Each alternative after the first is the cheapest schedule that puts at least
`minDifferentCourses` courses at different meeting times (days, start or end)
than every schedule already picked. A different room or instructor at the same
times does not count.

`minDifferentCourses` (in `prepare.ts`) is 2. It drops to 1 when only one
course still has a choice of times after locks, exclusions and the time
constraints. It is never 0. With two or more courses in the plan, the 1-course
fallback is surprising, so the Week view says "Only one course has other
times, so these differ in one course." (`differsInOneCourse` in
`components/schedule/run-state.ts`).

## Walking

The provider is a `WalkingTimeFn`: `(fromBuildingId, toBuildingId)` returns
`{ seconds, source: "campus-network" | "straight-line" }` or
`{ seconds: null, source: "unknown" }`. The planner passes
`getWalkingSeconds` from `lib/campus/walking-times.ts`, the walkway matrix from
map v2, with a straight-line fallback where the graph has no route.

- Seconds may be fractional (the matrix holds tenths). `walkSeconds` in
  `score.ts` is the only place they are normalized, by rounding to whole
  seconds, so the walking check, the cost and the breakdown agree.
- The same building is 0 seconds.
- An unknown walk (a building missing from the registry, or an off-campus one
  such as NTDP) is never 0. It counts as `UNKNOWN_WALK_SECONDS` (600 s) in the
  cost and in the walking check. Ten minutes is the standard break in the
  sample sections, so an unknown walk just fits a normal break. There is no
  measurement behind it. The breakdown counts these walks separately
  (`unknownWalks`), and the page labels them "Walk time unknown" and calls the
  10 minutes an estimate instead of saying the walk fits.

## Budgets

| Caller | Budget | Why |
| --- | --- | --- |
| Week view, first answer | 300 ms (`FIRST_BUDGET_MS`) | Shown at once. |
| Week view, follow-up | 3 s cap (`FINAL_BUDGET_MS`), only when the first answer is `feasible` or `timeout` | A fresh search that replaces the first answer in place. |
| `recommendSections` (state normalization) | 20,000 nodes, no clock | Runs synchronously on every normalization and must give the same answer everywhere. |
| Infeasibility explanation | 250 ms default (`explainBudgetMs`) | When it runs out, `explanation.minimal` is false and suggestions may have `resolves: null`. |

Preparation checks the deadline too, so a huge request reports `timeout`
instead of overrunning.

## The worker

`worker/protocol.ts` defines the messages and `runJob`, the two-phase rule
above. A function cannot be posted, so the page builds the request with
`buildOptimizeRequest` and `toPlainRequest` swaps the walking provider for a
table of every ordered pair of buildings the request's sections use (at most
15 x 15 in the sample data). The worker turns the table back into a provider.
A pair outside the table is unknown. Every reply carries the job id.

The browser runs `worker/optimize.worker.bundle.js`, a committed, self-contained
build of `optimize.worker.ts`. Next 16.1's Turbopack copies a
`new Worker(new URL("./x.ts", import.meta.url))` source as a raw asset instead
of compiling it, so the bundle is built with Bun:
`bun tests/optimizer/build-worker.ts --write`. `tests/optimizer/worker.test.ts`
fails while the bundle is out of date. The bundle holds only the engine and the
protocol (about 60 KB), not the catalog. `worker/client.ts` drops replies to anything but the newest job, and
replaces the worker when a new job arrives while one is still searching,
because a running search cannot be interrupted. A crash or a worker that
cannot start becomes an `error` reply, which the page shows inline with "Try
again".

The page ties each shown result to the inputs it came from (preferences,
locks, courses). Once they change, the result is stale: its options and
suggestions are disabled, previews are cleared, and applying checks the inputs
again.

## Preferences storage

Constraints and weights live in this browser's localStorage, one entry per
identity (`components/schedule/preferences-store.ts`): the account id when
signed in, a per-browser guest id otherwise. They are not part of the saved
plan. That needs a plan schema change and is left for later. Entries carry a
revision. Other tabs pick up writes through the `storage` event, and a write
that finds a newer revision applies its change on top of that version instead
of overwriting it. A failed write is shown as "not stored".

## Tests

- `tests/optimizer/engine.test.ts`: agreement with a brute-force reference
  (`reference.ts`) on 400 seeds, plus budgets and large instances
  (`checks.ts`, `generator.ts`).
- `tests/optimizer/regressions.test.ts`: pinned bugs from review.
- `tests/optimizer/mutation.test.ts`: plants one bug at a time in a copy of
  this folder and asserts a check fails.
- `tests/optimizer/worker.test.ts`: the two-phase protocol, the plain request
  (same results as the original on 61 requests), the bundle's freshness and a
  run in a real Worker, and the client's stale-reply, replacement and failure
  handling.
- `tests/schedule-builder.test.ts`, `tests/schedule-builder-v2.test.ts`,
  `tests/schedule-dom.test.tsx`: the planner adapter and the Week view's rules.
- `tests/optimizer/bench.ts` (not a test; run with
  `bun tests/optimizer/bench.ts 40`): p50/p95/max of the first shown result
  and the final result over 40 instances of 8 courses x 40 sections.
