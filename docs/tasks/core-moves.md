# Task family: moving pure modules into core

Each task moves one module from `frontend/src/lib/`, or one small group that imports each other, into `packages/core`, without changing what it does. Core is the bottom layer of docs/architecture/README.md ("Shape"): no React, Next, Node, Bun, DOM, storage, network, ambient clock or bundled data. Lint and core's tsconfig enforce that, so a module that breaks the rule fails `typecheck` or `lint` the moment it lands in `packages/core/src`.

This page lists every module in `frontend/src/lib` as of 2026-10-14, says which can move now, which need their I/O or data passed in first, and which stay. Take the "Movable now" groups in the order given; a module can only move after everything it imports has.

## The frontend already depends on core

`frontend/package.json` lists `"@untangle/core": "workspace:*"`, and `frontend/next.config.ts` has `transpilePackages: ["@untangle/core"]` because core ships TypeScript source. A move changes neither file.

## What one move looks like

1. `git mv frontend/src/lib/<path>.ts packages/core/src/<path>.ts`, keeping the path under `lib/`. `lib/optimizer/score.ts` becomes `packages/core/src/optimizer/score.ts`, imported as `@untangle/core/optimizer/score`. The export map already covers it; don't touch `package.json`.
2. Inside core, imports are relative. A remaining `@/` import means a dependency hasn't moved yet: stop and move that one first.
3. Its tests move from `frontend/tests/` to `packages/core/tests/` at the same relative path, and only their import lines change.
4. Every frontend import of the module switches to `@untangle/core/<path>`. Leave no re-export file behind in `frontend/`.

Acceptance:

- The moved tests pass in `packages/core`, unchanged apart from imports.
- `packages/core/tests/no-dom.test.ts` passes.
- From the repo root, `bun install --frozen-lockfile` and `bunx turbo run typecheck lint test` pass, and `bun run build` passes in `frontend/`.
- The diff is moves and import lines. No renames, no behavior changes, no "while I was here" fixes. Note anything you'd fix in the PR description instead.

Some package tests import frontend modules by path. Moving one of these means updating those import lines:

| Frontend module | Imported by |
|---|---|
| `types.ts` | `packages/contracts/tests/*` (lead-owned: the lead moves `types.ts`) |
| `sections/model.ts` | `packages/core/tests/filters/fixtures.ts`, `packages/core/tests/occurrences/fixtures.ts`, `packages/core/tests/frontend-shapes.test.ts` |
| `calendar-feeds/types.ts` | `packages/core/tests/occurrences/fixtures.ts`, `packages/core/tests/frontend-shapes.test.ts` |
| `sections/config.ts` | `packages/ingest/tests/source-policies.test.ts` |

The lane fixtures under `packages/core/tests/` are lead-owned (`.github/lead-owned-paths.txt`), so a move that changes their imports needs Sam's `sam-approved` label, and agents never add it. Don't move `sections/model.ts` or `calendar-feeds/types.ts` until the filter-predicates and calendar-occurrences tasks have landed; then ask the lead to update those import lines in your PR.

## Movable now, in this order

Each line is one PR unless it says "group". "Leaf" means it imports nothing else from `lib/`.

1. Leaves:
   - `course-colors.ts`
   - `schedule-oracle.ts` (move it with its test; it's the planner's independent check and must keep sharing no code with the planner)
   - `term-chronology.ts`
   - `grades.ts`
   - `webmcp/schema.ts`
   - `campus/geo.ts`, `campus/speeds.ts`
   - `instructors/fold.ts`, then `instructors/parse.ts`, then `instructors/match.ts`
   - `sections/model.ts` (see the table above)
2. Groups that import each other:
   - `prereq/types.ts`, `prereq/ast.ts`, `prereq/engine.ts`, `prereq/suggestions.ts` (group). `prereq/index.ts` re-exports `prereq/unt.ts`, which stays (see below), so update its importers to the module paths instead of moving the index.
   - `campus/contract/*` (group), then `campus/graph.ts`, then `campus/engine.ts`.
   - `calendar-feeds/{types,errors,ics-text,datetime,rrule,parse,preview}.ts` (group). `fetch.ts` and `ssrf.ts` stay with the server; `index.ts` re-exports `fetch.ts`, so it stays too and its importers that only need parsing switch to core paths.
   - `grades-history/types.ts` and `grades-history/errors.ts` (group), after `grades.ts`.
   - `pathing/{types,graph,requirements,analysis,scorer,index}.ts` (group), after `prereq`. `pathing/plans/` is a degree plan, which is data; it goes to `data/`, not core.
   - `optimizer/types.ts`, then `weeks.ts`, `score.ts`, `presets.ts`, `prepare.ts`, `search.ts`, `explain.ts`, `optimize.ts`, one per PR in that order. `optimizer/worker/protocol.ts` follows `prepare.ts`; `worker/client.ts` and `optimize.worker.ts` stay (they create a Worker).
   - `reasons/types.ts`, after the optimizer, grades-history and sections types it names.
3. After `types.ts` moves (lead):
   - `connect/import-confirmation.ts`, `plan-library/snapshot-types.ts`, `campus/route-legs.ts` (after `campus/engine.ts`)
   - `components/schedule/constraint-logic.ts`, which `preferences/` needs (see below)

## Needs its I/O or data passed in first

Each of these is a refactor PR in `frontend/` first (take the data, clock or fetch as an argument, callers pass it), then a move.

| Module | What it reaches for |
|---|---|
| `terms/terms.ts` | the registrar calendar table it defines. Split the table (data) from `classDayStatus` and the date helpers (take the table as an argument). |
| `planner-ics.ts` | `new Date()` as a default argument. Make `now` required. |
| `map-cache.ts` | `Date.now` when the caller passes no `now`. Make `now` required, so core never reads an ambient clock. |
| `policy/credit-load.ts` | UNT's catalog thresholds, source URLs, retrieval date and quoted policy text, which are institution data. Split them out to `data/` or the future `packages/campus`, and have `zoneFor` and the other functions take the thresholds as an argument. Only the calculation moves to core. |
| `sections/vsb.ts`, `sections/buildings.ts` | the campus building table, through `campus-locations.ts`. |
| `sections/sample.ts` | seed data and the building table. |
| `planner-sections.ts` | seed data (sample sections, course titles). |
| `planner-validation.ts`, `planner-walking.ts`, `course-import.ts`, `course-route.ts`, `transcript-import.ts`, `connect/import.ts` | seed data; `planner-walking.ts` also the walking-time table. |
| `plan-library/diff.ts`, `plan-library/snapshot.ts` | seed data; `snapshot.ts` also `new Date()` and `Math.random()`. |
| `planner.ts` | seed data, the building table and `window.sessionStorage`. Split the storage functions out; they stay in `frontend/src/platform/`. |
| `planner-save.ts`, `planner-transaction.ts`, `saved-plans/restore-adapter.ts`, `section-store.ts` | `planner.ts` or `planner-sections.ts`, so they follow those. |
| `map-itinerary.ts`, `map-client-data.ts`, `reasons/scheduleReasons.ts` | `planner-sections.ts` and `planner-walking.ts`. |
| `preferences/schema.ts`, `preferences/parse.ts` | `uniqueBlockId` from `components/schedule/constraint-logic.ts`, and `lib/types.ts`. Once both are in core, these two move with no refactor. |
| `grades-history/normalize.ts` | types it borrows from `grades-history/parse.ts`, which defaults to global `fetch` through `client.ts`. Move those types into `grades-history/types.ts` first. |
| `grades-history/client.ts`, `limiter.ts`, `parse.ts`, `sections/proxy.ts` | global `fetch` and `Date.now` as defaults. They are server code; their home is the server or `packages/ingest`, not core. |

## Stays where it is

- Lead-owned: `auth*.ts`, `account-password.ts`, `magic-link-*.ts`, `unt-auth.ts`, `db/**`, `persistence.ts`.
- Source configuration: `sections/config.ts` holds the vsb URLs, the supported-term list and the proxy's fetch timings. It belongs with the server or `packages/ingest`, not core.
- Server, Node or Next: `email.ts`, `email-budget.ts`, `rate-limit/*`, `grades-history/{cache,server,service,http,index}.ts`, `sections/{client,server,index}.ts`, `campus/resolve-handler.ts`, `calendar-feeds/{fetch,ssrf,index}.ts`, `course-catalog/build.ts`, `course-history.ts`.
- Browser: `planner-store.ts`, `saved-plans/store.ts`, `webmcp/register.ts`, `optimizer/worker/{client,optimize.worker}.ts`. These go to `frontend/src/platform/` later.
- Data: `campus-locations.ts`, `seed-data.ts`, `generated/`, `data-provenance.ts`, `campus/config.ts`, `campus/walking-times.ts`, `campus/data/`, `course-catalog/prerequisites.json`, `terms.ts` (one constant). Core never imports data; the caller passes it in.
- UNT-specific: `prereq/unt.ts` (the prerequisite grammar) belongs in `packages/campus`, built in step 7.
- Too coupled for now: `webmcp/tools.ts` imports eight modules from `components/` plus the planner. Move those first; it is the last module out.
- `session-events.ts` is a stand-in for an account PR (#19) and should be replaced, not moved.

## Constraints for every move

- Add no dependencies, and touch no lead-owned path (`.github/lead-owned-paths.txt`). That includes `packages/*/package.json`, so a move never edits an export map.
- Never edit a test listed in `tests/pending-acceptance.txt`.
- The PR that listed a lane's acceptance test is approved by Sam (`sam-approved`). Never add or remove that label, and never merge.
- One module or one group per PR, from an `obv/core-move-<module>` branch into `alpha`.
