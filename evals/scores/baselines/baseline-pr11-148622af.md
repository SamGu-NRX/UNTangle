# Baseline scorecard of record — PR #11 head `148622af51c4`

**Result: 19 pass / 39 fail / 5 not-applicable over 63 cases (suite `all`), exit 1.**
Same total shape as the head-#4 baseline but a different mix: journey drops one
pass (a 480 s case timeout) and a11y gains one (`reduced-motion`). All outcomes
are the honest instrument verdicts; nothing was retried into a pass.

- **Head**: `148622af51c4412853bc8d8abb9386c7adcf5f1b` — PR #11 head tip
  (`refs/pr/11`), commit subject "feat(map): extract client data layer with
  identity matching and safe caching"
- **Instrument**: evals on branch `obv/untangle-evals-r2-baselines` (the joined
  umbrella `4985005a`), unmodified for the run
- **Target checkout**: fresh detached worktree verified at exactly the pinned
  SHA (`TARGET-VERIFIED`; `target.actualHead == target.sha` in the scorecard)
- **Gate**: `/home/user/work/heavy.lock` held for the whole run; load gate 1m/5m
  < 4 — gate opened 20:40:49Z at 1m=0.97 5m=0.41
- **Run window**: 20:40:51Z → 21:44:18Z (~64 min); runner exit 1 (case failures)
- **Load log**: `load-baseline-pr11-attempt1.log` — 257 samples at 15 s; 1-minute
  load stayed ≤ 2.3 for the entire run
- **Run log**: `run-baseline-pr11-attempt1.log`; driver trail:
  `pr11-148622af-attempt1-status.txt` (external watchdog: kill on run.log stall
  > 720 s, 150-min cap — never fired; first attempt of this head, valid)

## Per-suite results

| Suite | Pass | Cases | Notes |
|---|---|---|---|
| selfcheck | 4/4 | 4 | preflight 15/15 steps green; db roundtrip; frontend renders; rmp-block active (105 requests blocked) |
| routing | 3/3 | 3 | building-coverage, route-geodesic-floor, route-latency pass (ORS disabled; warm p95 17.3 ms vs 200 ms bar, n=10/10) |
| journey | 7/28 | 28 | discover-guest ×2, discover-registered-desktop, auth ×4 pass; `discover-registered-mobile` hit its 480 s case timeout (the one case that flipped from #4) |
| honesty | 1/5 | 5 | only no-fabricated-precision passes; `rmp-labels-when-unavailable` timed out at its 240 s cap |
| a11y-polish | 4/12 | 12 | axe-map, focus-indicator, **reduced-motion**, image-icon-labeling pass (one more than head #4); axe-courses fails with 2 serious impacts (1 on #4) |
| optimizer | 0/3 | 3 | **not-applicable** — head predates `frontend/src/lib/optimizer/bench/run-bench.ts` |
| data | 0/2 | 2 | **not-applicable** — head predates `tools/catalog-consistency/audit.mjs` (+verify.mjs) and `frontend/src/lib/data-provenance.ts` |
| persistence-faults | 0/6 | 6 | **harness-error fails, not durability verdicts** — browser launch/connect exceeded 90 s on the post-restart legs; each case explicitly labeled "case could not complete (harness/journey error, not a measured durability verdict)" |

## Stubs disclosed in the scorecard

- `backend-runtime-fallback` — "the pinned backend's better-sqlite3 native
  addon crashes Bun (NAPI panic), so the backend ran under its documented
  Node/tsx runtime with the same rmp-block preload injected via NODE_OPTIONS"
  (the harness's own disclosure; identical path across baseline runs).

## Head-to-head notes vs the #4 baseline (same instrument, two hours apart)

- Durability inside journeys still works at this head: the save-registered
  cases report state persisted across reload **byte-exact** — the failure is
  the absent contract export surface (`Save state` region, `Print schedule`,
  `Download .ics` on `/schedule`), not persistence itself.
- Map cases fail with the required `Route legs` region absent on `/map`
  (no route legs/stops rendered for active courses) — this head's commit is
  the map client data-layer extraction, and route legs are still unexposed.
- One journey case flip is timeout-shaped, not a stable verdict:
  `discover-registered-mobile` passed on #4 and hit its 480 s cap here.
- `reduced-motion` passes here and failed on #4 — a genuine a11y gain.
- axe-courses impact count differs (serious 2 here vs 1 on #4).

## Infrastructure

`infrastructure: {ok: true, brokenStep: null}` — every declared case got a
verdict; no broken stack steps. The runner wrote the scorecard JSON+MD itself
(`baseline-pr11-148622af-attempt1.json` / `.md`); this summary wraps them with
head provenance, gate, and load-log naming per the baselines task.
