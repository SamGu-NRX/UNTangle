# Journey r2 repaired run — rerun & supersession notes

Target: `d42166faca133b58eba410d0c0fd6b5a0fde38c1` (PR #8 tip). Branch: `obv/untangle-evals-r2-journey`.
All runs load-gated (1- and 5-min loadavg < 4 immediately before and sampled every 30s during; see `load-*.log`).

## Runs

| Scorecard | Run | Cases |
|---|---|---|
| `journey-r2-repaired-165043` | full 28-case pass (repairs at `cec2eafe`) | 28 |
| `journey-r2-repaired-only-instructor-174435` | targeted: instructor x4 (locator fix `f705f250`) | 4 |
| `journey-r2-repaired-only-transient-174635` | targeted: discover-registered-mobile, map-registered-mobile, auth-registered-desktop | 3 |
| `journey-r2-repaired-only-wedge-174834` | targeted: build-registered-desktop, plan-guest-mobile (480s wedges in main run) | 2 |
| `journey-r2-repaired-only-stragglers-180014` | targeted: instructor-registered-mobile, auth-registered-desktop (transient timeouts in earlier batches) | 2 |

`--only` reruns ran the exact case ids against the same target; their scorecards name the cases that ran.

## Final verdicts (main run superseded where a rerun re-measured)

**PASS (8):** discover x4 (discover-registered-mobile via transient rerun; the other three in the main run), auth-guest-desktop, auth-guest-mobile, auth-registered-mobile (main), auth-registered-desktop (stragglers rerun).

**FAIL — honest app-level baseline, contract-required surfaces absent at the target head (12):**
- **build x4** (wedge rerun covers registered-desktop): leg ran through the head's exposed surfaces (marked ANTH 1010 + CSCE 1030 taking, 5 optimization options, 8 events rendered); absent required surfaces: `Add {COURSE} section {NNN}`, `Lock {COURSE} section {NNN}`, `Optimize schedule`, option `aria-pressed` (app exposes `data-active` only). Verified in source: detail page renders no planner buttons (`frontend/src/app/courses/[subject]/[number]/page.tsx`), `schedule-client.tsx:188` uses `data-active`.
- **instructor x4** (stragglers rerun covers registered-mobile): grade-summary region now resolves via `[aria-label="Instructor grade summary"]` (locator fix); all four fail on the required ratings-unavailable `status` notice — absent from `frontend/src/app/instructors/[id]/page.tsx`.
- **map x4** (transient rerun covers registered-mobile): `Route legs` region absent — `map-client.tsx:208` renders it only when `routeDetails.legs.length > 0`, and no legs/stops rendered for the active courses.

**FAIL — recorded verbatim per task boundary (save/plan flow failures, not chased here) (8):**
- **save x4**: guest — app wrote no persisted plan to `sessionStorage["untangle-planner-state"]` before reload; registered — persisted state survived reload byte-exact, but the required durability/export surface is missing.
- **plan x4**: no calendar events rendered before saving the plan — nothing to restore.

Transient environment failures in the main run (3× goto/click/waitFor timeouts, 3× 480s browser-wedge case timeouts) were all re-measured cleanly by the targeted reruns; none recurred in a way that left a case unmeasured. This is the runner hardening from the selftests lane doing its job: bounded closes, launch retries, case caps, and now precise `--only` re-measurement.

## a11y-polish rerun (`a11y-polish-r2-repaired-182059`)

Validates the timeout fixes (defects 3+4) against the same target. All 12 cases measured in ~6 minutes with no wedge — the phase-2 240s-class case timeouts are gone (480s cap + hardened probes + one-mobile reuse never triggered). Compared to the recorded phase-2 a11y baseline (`a11y-polish-rerun-231358`): **axe-instructor now passes** (the focus timeout is fixed — the hardened contract-specific link probe finds the seeded instructor page), axe-home improved fail→pass (deterministic seeded stack), and every phase-2 pass held. No regressions.

The four remaining failures match the phase-2 recorded verdicts exactly and are honest app-level results, not instrument defects: axe-courses (1 serious), axe-schedule (1 serious), axe-auth (2 serious) — axe-core serious impacts on the target pages; keyboard-core-path (focus: Timeout 10000ms — the case's own element wait, an app keyboard surface failing the requirement, bounded by the runner); no-horizontal-overflow-mobile (390x844 horizontal overflow).

## Instrument repairs this branch (vs phase-2 e566ac9b)

1. **discover locator** (`cec2eafe`): accessible-name lookup for `Course grade summary` — validated by 4/4 discover passes.
2. **build retarget** (`cec2eafe`): leg drives the head's real row-status controls; contract-required absences collected into one precise verdict instead of crashing on #7-only surfaces.
3. **instructor locator** (`f705f250`): accessible-name lookup for `Instructor grade summary` — validated by all four instructor cases progressing past the summary probe to the honest next verdict.
4. **backend-seed stack step** (`cec2eafe`): runs the backend's seed script during setup — instructor pages have grade data to render.
5. **`--only` case filter** (`f705f250`): validated, pre-boot-checked case selection for targeted reruns (this evidence's own mechanism).
