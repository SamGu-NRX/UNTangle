# Task: instructor tie-break

Build `instructorTiebreak` in `packages/core/src/instructor-tiebreak.ts`. When two schedules tie on the optimizer's primary score, it ranks the one whose instructors have stronger grade-history evidence first.

The rule from docs/architecture/README.md: when some options in a course lack accepted evidence, that course's grade term is left out for every option. Missing evidence is never zero, never a neutral 3.00 and never the course's average. Eligibility is decided once per course from all of its options, not per pair of schedules. A per-pair rule can rank A over B, B over C and C over A, and the test has fixtures that do exactly that.

## What to read first

- `packages/core/src/instructor-tiebreak.ts`: the types and doc comment are the spec. Keep every exported name and signature.
- On the `edge` branch, PRs #79 and #88 changed `frontend/src/lib/optimizer/{score,search,prepare}.ts`. #88's omit-per-course rule is the right idea. #79's first version imputed 3.00 for missing evidence, which the tests reject. Edge also compares floating-point means, while this interface takes whole hundredths so equal totals tie exactly.

## The tests you make pass

`packages/core/tests/instructor-tiebreak/instructor-tiebreak.test.ts`, with fixtures in the same folder. It checks the strict weak order over all 54 schedules of a request (irreflexive, antisymmetric, transitive, transitive ties), the imputation trap, exact ties, and the loud errors.

## Files you may change

- `packages/core/src/instructor-tiebreak.ts`, and new modules under `packages/core/src/`.
- `tests/pending-acceptance.txt`: delete the line `packages/core/tests/instructor-tiebreak/instructor-tiebreak.test.ts`, and nothing else.

## Constraints

- Don't change the test file or its fixtures.
- Core is pure: no imports from frontend, Node, Bun, the DOM or data files.
- Don't touch the optimizer. Using this comparator in the search, with a pruning bound that respects it, happens after the optimizer moves into core.
- Grade history never feeds the optimizer's `rating` weight.
- Add no dependencies, and touch no lead-owned path (`.github/lead-owned-paths.txt`). Propose contract changes in your PR description.
- The PR that listed this test is approved by Sam (`sam-approved`). Never add or remove that label, and never merge.

## Done means

- From the repo root, `bun install --frozen-lockfile` and `bunx turbo run typecheck lint test` pass, with your line gone from the pending list.
- A PR from an `obv/instructor-tiebreak` branch into `alpha`.
