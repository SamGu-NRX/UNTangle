# Schedule Oracle Report

Independent brute-force schedule oracle cross-checked against the planner on the
real seed catalog. **Planner behavior was NOT changed to match the oracle**; the
single disagreement below is recorded for integration to decide later.

## What was built

- `frontend/src/lib/schedule-oracle.ts` — the oracle. Deliberately dumb and
  independently written: it imports nothing and shares no code with
  `planner.ts`. Total credits = sum of each selected section's course credit
  hours; conflicts = naive pairwise overlap check on `(day, start, end)`
  minutes, treating intervals as half-open `[start, end)` (so adjacency, where
  one meeting ends exactly when another starts, is NOT a conflict).
- `frontend/tests/schedule-oracle.test.ts` — the comparison harness. It runs
  the oracle and the planner's own outputs (`sectionConflicts`,
  `summarizeCredits`) side by side on identical inputs and tallies
  agreements/disagreements. The exact totals are pinned as assertions in the
  test, so any change to the catalog or either engine that moves the counts
  fails the suite.

## Exact reference-case counts

Every comparison is one case: one section-pair conflict verdict, or one
selection credits verdict.

| Metric | Count |
| --- | --- |
| Cases (N) | **8663** |
| Agreements (M) | **8662** |
| Disagreements (K) | **1** |

Case categories:

| Category | Cases |
| --- | --- |
| Hand-built (true conflict, adjacency edge `end == start`, disjoint same-day, identical times, two-course credits, duplicate-course credits) | 6 |
| Major full section-set pairs — CS (76 sections → 2850 pairs), CE (68 → 2278), MATH (64 → 2016), BIOL (34 → 561), BUSI (30 → 435); plus 1 credits case per major | 8145 |
| Seeded pseudo-random selections (mulberry32, seed `0x5eed`, 200 selections of 2–5 sections, one section per course, all pairs + 1 credits case each) | 512 |

The catalog: 656 courses / 2704 sections. PSYC, ENGL, and "other" majors have
no catalog sections for their core course lists and contribute no cases.

## The 1 disagreement, with both sides' values

- **Case:** hand-built duplicate course — selection of two sections of the same
  course (`anth-1010-001` and an identical-times clone of it), ANTH 1010,
  3 credit hours.
- **Oracle:** 6 — the oracle sums credit hours per *selected section* (3 + 3).
- **Planner:** 3 — `summarizeCredits`/`getActiveCourseCodes` sums credit hours
  per *active course*, and a course counts once regardless of how many of its
  sections are in the selection (`selectedSections` is keyed by course code).
- **Assessment:** a modeling difference, not obviously a defect. The planner's
  one-section-per-course domain is the intended domain (only one section of a
  course is ever selected in the app), and under that domain the two engines
  agree everywhere — including all 8,140 synthetic section pairs attached to real catalog course text and all
  512 random-selection cases. Recorded only; planner left as-is.

Conflict detection had **zero** disagreements in all 8,151 conflict cases,
including the true-conflict and adjacency-edge (`end == start`) hand-built
cases.

## Methodology notes

- The harness neutralizes `defaultPlannerState.courseStatuses` before each
  planner credits comparison (`getActiveCourseCodes` merges those defaults into
  every state). Without this, the seed's default in-progress course leaked 3
  credits into every planner sum — a harness artifact, not a planner defect.
  With it, the comparison isolates exactly the selection under test.
- The PRNG is mulberry32 seeded with a fixed constant; there is no
  `Math.random` anywhere in the oracle or harness. Re-runs are deterministic.

## Documented limits

- The oracle does **NOT** model university-grade or prerequisite policy. The
  planner's prerequisite logic is a deliberate simplification (it is not a
  full registrar rule engine) and is retained as a known limit; grade and
  prerequisite rules were deliberately **not** re-implemented in the oracle.
- The oracle assumes well-formed `HH:MM` times and does no validation.
- Credits are summed per selected section with no per-course cap, no repeated
  course policy, and no pass/fail or remediation handling.
- Adjacent meetings (`end == start`) are treated as non-conflicting; if the
  university considers zero-gap back-to-back classes a conflict, both the
  oracle and the planner would need that policy change.

## Reproduction

```
cd frontend
bun test tests/schedule-oracle.test.ts
```

Full gate at time of writing: `bun test tests/` → 74 pass / 0 fail across 6
files (493 expect() calls, including the 68-test pre-existing baseline);
`bunx tsc --noEmit` clean; `bun run lint` clean; `bun run build` exits 0.
