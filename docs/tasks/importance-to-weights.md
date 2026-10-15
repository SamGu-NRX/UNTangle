# Task: importance to weights

Build `weightsFromImportance` in `packages/core/src/importance.ts`. Onboarding asks how much each leaning matters on a 1 to 5 scale, optionally starting from one of the planner's five goal presets. The function turns those answers into the optimizer's `PreferenceWeights`, whole numbers from 0 to 4.

## What to read first

- `packages/core/src/importance.ts`: the types and doc comment are the spec. Keep every exported name and signature.
- `frontend/src/lib/optimizer/presets.ts`: `GOAL_WEIGHTS`, the preset values to reproduce.
- `frontend/src/components/schedule/constraint-logic.ts` (`applyChoice`) and `frontend/src/lib/preferences/schema.ts` (`STRENGTH_WEIGHT`): why 4 is "matters most", and why mornings and evenings are one lean.

## The tests you make pass

`packages/core/tests/importance/importance.test.ts`. It checks the mapping key by key, every one of the 85,536 answer combinations for range and determinism, and monotonicity on all of them.

## Files you may change

- `packages/core/src/importance.ts`, and new modules under `packages/core/src/` if you need them.
- `tests/pending-acceptance.txt`: delete the line `packages/core/tests/importance/importance.test.ts`, and nothing else.

## Constraints

- Don't change the test file. The Task rule check fails a PR that edits a listed test.
- Core can't import the frontend, so copy the five preset weights into core. Moving `presets.ts` itself belongs to `docs/tasks/core-moves.md`, in its own PR.
- A bad answer throws. Never clamp or round it into a valid one.
- Add no dependencies, and touch no lead-owned path (`.github/lead-owned-paths.txt`). Propose contract changes in your PR description.
- The PR that listed this test was approved by Sam's approving review on the PR's head commit. Never submit a review, never merge and never use `--admin`.

## Done means

- From the repo root, `bun install --frozen-lockfile` and `bunx turbo run typecheck lint test` pass, with your line gone from the pending list.
- A PR from an `obv/importance-to-weights` branch into `alpha`.
