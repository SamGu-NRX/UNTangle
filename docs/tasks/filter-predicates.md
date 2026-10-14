# Task: filter predicates

Build `evaluateFilter` and `evaluateFilters` in `packages/core/src/filters.ts`. They judge one enrollment option against the student's filters and answer pass, fail or unknown. Unknown never satisfies a filter (docs/architecture/README.md, "Feature rules that follow from evidence").

## What to read first

- `packages/core/src/filters.ts`: the types and doc comments are the spec. Keep every exported name and signature.
- `frontend/src/lib/sections/model.ts` and `frontend/src/lib/sections/INTEGRATION.md`: what a parsed section holds, and what async, TBA and unassigned mean.
- `frontend/src/lib/planner-sections.ts`: `hasOpenSeats` and `otherSiteOf` are today's seat and site rules. The new rules are stricter where data is missing.

The instructor filter matches the displayed name (`instructor.display`), ignoring case and spacing, with each co-teacher counted. That is a stopgap: names aren't identities. Once the instructor matcher from #69 (`frontend/src/lib/instructors/`) moves into core, a later task switches this filter to matched identities.

An earlier attempt lives on the `edge` branch in `frontend/src/lib/smart-filters/` (PRs #78 and #83). Read it for names if you like, but don't port it. It lets TBA meetings pass day and time filters, treats an empty day list as "no constraint", and answers true or false where it should say unknown. The tests here fail on all three.

## The tests you make pass

`packages/core/tests/filters/filters.test.ts`, with fixtures in `packages/core/tests/filters/fixtures.ts`. The fixtures are real Spring 2027 sections that the app's own parser produced, frozen, so a predicate that changes its input throws.

## Files you may change

- `packages/core/src/filters.ts`, and new modules under `packages/core/src/` if you split the work up.
- `tests/pending-acceptance.txt`: delete the line `packages/core/tests/filters/filters.test.ts`, and nothing else.

## Constraints

- Don't change the test file or its fixtures. They are lead-owned, so the Path ownership check fails a PR that touches them, and the Task rule check fails one that edits a listed test.
- Core is pure: no imports from frontend, other workspace packages, Node, Bun, the DOM or data files. Lint and core's tsconfig enforce this.
- Add no dependencies, and touch no lead-owned path (`.github/lead-owned-paths.txt`). If you need a contract change, propose it in your PR description.
- Leave the planner alone. Wiring these filters into Auto and the Week view is a later task.
- The PR that listed this test is approved by Sam (`sam-approved`). Never add or remove that label, and never merge.

## Done means

- From the repo root, `bun install --frozen-lockfile` and `bunx turbo run typecheck lint test` pass, with your line gone from the pending list.
- A PR from an `obv/filter-predicates` branch into `alpha` that says which rules you found ambiguous, if any.
