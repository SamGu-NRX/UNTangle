# Baseline scorecard of record — PR #4 head `5cfdc3c99f51`

**Result: 19 pass / 39 fail / 5 not-applicable over 63 cases (suite `all`), exit 1.**
This is the baseline of record for head #4 — most measured contract surfaces are
absent at this pin, which is the expected shape for an early revision. All
outcomes are the honest instrument verdicts; nothing was retried into a pass.

- **Head**: `5cfdc3c99f510518130a918810627e07cb1ca0fc` — PR #4 head tip (`refs/pr/4`)
- **Instrument**: evals on branch `obv/untangle-evals-r2-baselines` (the joined umbrella `4985005a`), unmodified for the run
- **Target checkout**: fresh detached worktree verified at exactly the pinned SHA (`TARGET-VERIFIED`, `target.actualHead == target.sha` in the scorecard)
- **Gate**: `/home/user/work/heavy.lock` held for the whole run; load gate 1m/5m < 4 — gate opened 19:37:55Z at 1m=1.27 5m=1.40
- **Run window**: 19:37:56Z → 20:34:57Z (~57 min); runner exit 1 (case failures)
- **Load log**: `load-baseline-pr4-attempt2.log` — 230 samples at 15 s, zero gaps; 1-minute load stayed ≤ 2.59 for the entire run
- **Run log**: `run-baseline-pr4-attempt2.log`; driver trail: `pr4-5cfdc3c9-attempt2-status.txt`
- **Attempt-1 of this head is INVALID** (Bun event-loop wedge; no scorecard was
  produced): `pr4-5cfdc3c9-attempt1-invalid.md`. Attempt-2 ran the identical
  instrument and command under an external run-driver watchdog (kill on
  run.log stall > 720 s, 150-min cap) — the watchdog never had to fire.

## Per-suite results

| Suite | Pass | Cases | Notes |
|---|---|---|---|
| selfcheck | 4/4 | 4 | preflight 15/15 steps green; db roundtrip; frontend renders; rmp-block active (92 requests blocked) |
| routing | 3/3 | 3 | building-coverage, route-geodesic-floor, route-latency all pass |
| journey | 8/28 | 28 | discover ×4 and auth ×4 pass (guest+registered, desktop+mobile); instructor/build/persist legs fail on absent contract surfaces |
| honesty | 1/5 | 5 | only no-fabricated-precision passes; unavailable-labels / notices / disclaimer surfaces absent |
| a11y-polish | 3/12 | 12 | axe-map, focus-indicator, image-icon-labeling pass; axe serious+moderate impacts on home/courses/detail/instructor/schedule/auth |
| optimizer | 0/3 | 3 | **not-applicable** — head predates `frontend/src/lib/optimizer/bench/run-bench.ts` |
| data | 0/2 | 2 | **not-applicable** — head predates `tools/catalog-consistency/audit.mjs` (+verify.mjs) and `frontend/src/lib/data-provenance.ts` |
| persistence-faults | 0/6 | 6 | **harness-error fails, not durability verdicts** — browser launch/connect exceeded 90 s on the post-restart legs; each case is explicitly labeled "case could not complete (harness/journey error, not a measured durability verdict)" |

## Stubs disclosed in the scorecard

- `backend-runtime-fallback` — "the pinned backend's better-sqlite3 native
  addon crashes Bun (NAPI panic), so the backend ran under its documented
  Node/tsx runtime with the same rmp-block preload injected via NODE_OPTIONS"
  (the harness's own disclosure; identical path on the prior r2 runs).

## Representative failure detail (scorecard carries full reasons)

- Journey build/instructor legs: contract-REQUIRED surfaces absent —
  `ratings-unavailable` status notice on `/instructors/[id]`; "Add … section"
  and "Optimize schedule" controls plus optimization-option `aria-pressed`
  state on `/schedule`; route-legs region on course detail.
- One journey case timed out at its full 480 s cap
  (`instructor-registered-desktop`) — the in-process case timer fired
  correctly this attempt.
- a11y: axe counts `{"serious":1,"moderate":1}` on home, `{"serious":1}` on
  courses/detail/instructor/schedule, `{"serious":2}` on auth;
  keyboard-core-path failed a `focus:` 10 s timeout.
- honesty: no honest-unavailable RMP label, no sample-data `status` notice,
  no grade-data-unavailable notice, no `/plans` page (404) for disclaimers.

## Infrastructure

`infrastructure: {ok: true, brokenStep: null}` — every declared case got a
verdict; no broken stack steps. The runner wrote the scorecard JSON+MD itself
(`baseline-pr4-5cfdc3c9-attempt2.json` / `.md`); this summary and the
attempt-1 invalid record wrap them with head provenance, gate, and load-log
naming per the baselines task.
