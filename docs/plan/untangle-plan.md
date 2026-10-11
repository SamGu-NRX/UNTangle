# UNTangle plan

Owner: the UNTangle lead (focus/gushi fleet). Task prompts quote this file. Each change to it is a commit on
`fleet/untangle-plan`, with the reason in the commit message.

## End goal

A UNT Denton student can open UNTangle on `alpha` and, as a guest or a registered UNT-email user:

1. find their courses and read real grade history and instructor ratings;
2. turn them into a conflict-free weekly schedule that respects their constraints, with ranked alternatives and
   an explanation when none exists;
3. see each day on the campus map, with walking paths along real campus walkways and honest times;
4. save, reload, restore and keep the plan across tabs and devices without losing work;
5. print it or download it as a calendar file.

The data must say what it is. The course catalog text is real (catalog.unt.edu). All 2,704 sections are
synthetic (`backend/data/compD.csv`: exactly 15 buildings and no term) and are labeled as samples until a
permitted real-term source is ingested.

## Evals that decide "best"

The harness lives in `evals/` (task `untangle-evals-f1`). Bars sit in `evals/bars.json`. They are proposals with
no calibration evidence yet and will be revised with a reason when the first scorecards exist.

| Suite | What it measures | Proposed bar |
|---|---|---|
| journey | Both personas complete the full journey through normal routes at 1440x900 and 390x844 | every case passes |
| persistence-faults | Lost edits, and a false "Saved", under 500s, dropped connections, expired sessions, second tabs, denied or corrupt storage | 0 and 0 |
| honesty | A straight line shown as walking time, an outage shown as a missing course, unlabeled sample data | 0 violations |
| routing | Building coverage for the bundled and compD data; distance error on at least 15 hand-measured routes; p95 latency for 12 stops | 100% coverage; median error ≤10% and max ≤20%; p95 ≤200 ms |
| optimizer | Hard-constraint violations; optimality gap and top-k agreement against brute force; infeasibility explanations verified by removal; p95 latency | 0 violations; gap 0 on enumerable instances; p95 ≤500 ms at 8 courses |
| a11y-polish | axe, keyboard-only journey, reduced motion, layout shift, overflow with long names | 0 serious or critical; journey completes; no clipping |
| data | Exact catalog certification counts; a real-term bundle present | exact; present, or the survey is blocked with evidence |

UI polish is also judged by a council critique of the running `alpha` app (Fable for taste, Astra for
adversarial cases, Sol for correctness, Opus for integration).

## Steps

- **R0, evals and plan.** `untangle-evals-f1` builds the harness, its self-tests and baseline scorecards for #4,
  #7, #8 and #11. This file.
- **R1, make each surface work, in parallel with disjoint files:**
  - `apps-untangle-map-m2-f1`: the /map itinerary UI (#11).
  - `untangle-campus-routing-f1`: offline OSM walkway routing, the building registry and `getWalkingSeconds`.
  - `untangle-courses-f1`: courses, instructors and import against the real backend (#7).
  - `untangle-planner-f1`: schedule, persistence, saved plans and export, for guests and registered users (#8).
  - `apps-untangle-auditor-v2-f1`: catalog certification and provenance (#6).
  - `untangle-real-schedule-data-f1`: a survey of permitted real-term sources, and an ingest if one exists.
  - Variant rounds: `untangle-optimizer-round1-f1` (branch-and-bound, MIP, and propagation with large-neighborhood
    search) and `untangle-ux-directions-round1-f1` (week grid with map, day-first itinerary, and a mobile bottom
    sheet).
- **R1 join.** `untangle-integration-f1` merges the accepted work into a branch off `alpha`, wires the winning
  optimizer and the walking times, and scores the integrated app with the harness.
- **Council 1.** Run `alpha` in the T3 browser preview. Pick the optimizer and UX winners, list the gaps by
  suite, and write R2.
- **R2 and later.** Port the winning UX direction into production pages. Adopt real-term data if the survey found a
  source. Then fix the failing eval cases, one task per gap with its own files, and polish from the council's
  critique.

Directions still open: OSRM's foot profile as a routing alternative, if the A* engine misses the routing bars;
multi-term degree planning from #5, which belongs to another workspace's thread and stays read-only.

## Rules every task inherits

- Branches of #3, #4 and #5 belong to live threads in another workspace. Read them; never push to them.
- Accepted work merges into `alpha` with `--no-ff`, after the lead's accept and the caretaker's pass. Never into
  `main`. Nothing deploys from this repo: there are no workflows, webhooks or deployments, and only CodeRabbit
  reports.
- No paid providers. ORS stays optional. RateMyProfessors is read only from the backend cache. Email uses the dev
  path.
- University policy (prerequisite intent, the academic calendar) is never inferred. Unknowns stay unknown.

## Stop rule

Stop a workstream when its suite meets its bars on `alpha`, or when two consecutive rounds don't move any of
its metrics. Record the reason here.
