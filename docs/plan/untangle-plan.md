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

## Integration base

`alpha` was cut from `main` at 361cf3044046132ee9e043cda2ba61afb18f7b76 (2026-10-11, checked 11:58Z). Main is the
project's definitive latest version. Its last app change is f08067b (2026-04-29), after vishyj's jointv2 UI overhaul
was merged, and its newest commits are the agent-skills PRs #9 and #10. No remote branch has commits from between
2026-04-30 and 2026-10-09: the July polish work (`feat/ui-overhaul-jointv2`, `google-maps`) was never pushed. Every
branch newer than main is an unmerged fleet draft (#3-#11), which enters `alpha` only through review. The older
branches are April backups or vishyj's design sources, which main already absorbed.

## Evals that decide "best"

The harness lives in `evals/` (task `untangle-evals-f1`). Bars sit in `evals/bars.json`. They are proposals with
no calibration evidence yet and will be revised with a reason when the first scorecards exist.

| Suite | What it measures | Proposed bar |
|---|---|---|
| journey | Both personas complete the full journey through normal routes at 1440x900 and 390x844 | every case passes |
| persistence-faults | The five durability rules in the planner and evals tasks: acknowledged saves survive reload and re-sign-in; a failed save is never shown as Saved; denied storage keeps edits in memory with a warning and an export; corrupt bytes are quarantined intact; a cross-tab conflict is shown, never silently overwritten | each rule holds in every injected case |
| honesty | A straight line shown as walking time, an outage shown as a missing course, unlabeled sample data | 0 violations |
| routing | Building coverage for the bundled and compD data; distance error on at least 15 hand-measured routes; p95 latency for 12 stops | 100% coverage; median error ≤10% and max ≤20%; p95 ≤200 ms |
| optimizer | Hard-constraint violations; optimality gap and top-k agreement against brute force; irreducible infeasible subsets verified (the subset is infeasible, and every one-member removal is feasible); p95 latency | 0 violations; gap 0 on enumerable instances; p95 ≤500 ms at 8 courses |
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
  - `untangle-account-shell-f1`: magic link through a dev outbox (today the button has no plugin behind it), honest
    guest mode, and app-wide loading, error and not-found states.
  - `untangle-real-schedule-data-f1`: a survey of permitted real-term sources, and an ingest if one exists. Real-term
    data is in scope: Sam's "making into a real working tool" (2026-10-11) supersedes the July portfolio framing.
  - `untangle-degree-plan-f1`: multi-term degree planning from published catalog.unt.edu requirements, rebuilt
    from #5's experiment with an independent exact reference.
  - `untangle-today-pwa-f1`: a Today view (next class and the walk to it) and an installable app that works offline.
  - Variant rounds: `untangle-optimizer-round1-f1` (branch-and-bound, MIP, and propagation with large-neighborhood
    search; these directions, ranked alternatives and infeasibility explanations are the lead's proposal, not Sam's
    request; today's `recommendSections` is an exhaustive depth-first enumeration with a conflict check) and `untangle-ux-directions-round1-f1` (week grid with map, day-first itinerary, and a mobile bottom
    sheet).
- **Independent verification (from 16:40Z).** Read-only audits at pinned PR heads, reported as PR comments plus
  `audits/<PR>/<SHA>.md` on each audit's own branch: `untangle-audit-algorithms-f1` (#14, #15, #17),
  `untangle-audit-data-f1` (#6, #16), `untangle-audit-app-f1` (#7, #8, #19), `untangle-audit-map-ux-f1` (#11, #18),
  and `untangle-evals-rerun-f1` (#13's harness, re-run on fresh seeds against the task heads). The council weighs
  audit findings before any accept.
- **Optimizer council.** When `untangle-optimizer-round1-f1` returns, a council (Sol for correctness, Astra for
  adversarial instances, Opus for integration) reads the benchmark results. The lead's accept line names the
  winning variant and the accepted SHA. Integration depends on that line.
- **R1 join.** `untangle-integration-f1` merges the exact accepted SHAs into a branch off `alpha`, wires the winning
  optimizer and the walking times, makes one test command cover every inherited suite, and scores the integrated
  app with the harness.
- **Council 1.** Run `alpha` in the T3 browser preview, under the Mac's one-heavy-job lease. Pick the UX winner,
  list the gaps by suite, and write R2.
- **R2 and later.** Port the winning UX direction into production pages. Adopt real-term data if the survey found a
  source. Then fix the failing eval cases, one task per gap with its own files, and polish from the council's
  critique.

Directions still open: OSRM's foot profile as a routing alternative, if the A* engine misses the routing bars.

## Rules every task inherits

- Never open, print, test or use any `.env*` file: a live Resend key was reported committed in this public repo, and
  rotating it is Sam's call. Never push to the backend submodule (sunnyD1000's) or the `vishyj/*` branches.
- Design source: vishyj's jointv2 UI on main (UNT green palette, Syne and DM Sans, compact and task-first) with
  gt-credits-style motion.

- Branches of #3, #4 and #5 belong to live threads in another workspace. Read them; never push to them.
- A PR head merges into `alpha` with `--no-ff` as soon as it passes its own tests and its latest independent review
  (the native Codex Sol reviewer, `~/.long-run/obvious-fleet/reviews/UNTangle.jsonl`, plus the GitHub review bots)
  has no blockers. It doesn't wait for the lead's final accept or the caretaker. Each merge records the head SHA.
  A merge that breaks `alpha` is reverted with a new commit, never by rewriting history. Never merge into `main`.
  (Sam, 18:05Z; replaces the accept-and-caretaker gate.) Nothing deploys from this repo: there are no workflows, webhooks or deployments, and only CodeRabbit
  reports.
- No paid providers. ORS stays optional. The pinned backend calls RateMyProfessors live on cache misses, so every
  real-backend run blocks that host with a fetch-wrapping `--preload` file kept outside the backend, and counts the
  blocked requests. Changing the backend itself is an external gate for its owner. Sign-up sends no email; password
  reset needs Resend and stays an external gate.
- University policy (prerequisite intent, the academic calendar) is never inferred. Unknowns stay unknown.

## Contract changes

- 2026-10-11 15:27Z: route source order is now the campus walkway graph, then ORS (when a key is set), then the
  straight line, instead of ORS first. Accepted on PR #15 because the offline graph is campus-tuned (steps,
  crossings, entrances), needs no external service, and no consumer depends on the order. The source names are
  unchanged: `"ors" | "campus-network" | "fallback"`.

## Stop rule

Stop a workstream when its suite meets its bars on `alpha`, or when two consecutive rounds don't move any of
its metrics. Record the reason here.
