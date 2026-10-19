# Baseline scorecard of record — PR #7 head `1fa6bb7c57a8`

**Result: 20 pass / 38 fail / 5 not-applicable over 63 cases (suite `all`), exit 1.**
One more pass than the #4/#11 baselines, with the gain concentrated in the
a11y suite — consistent with this pin being the a11y journey-verification
commit. All outcomes are the honest instrument verdicts; nothing was retried
into a pass.

- **Head**: `1fa6bb7c57a8a08b7a3aea8bcb7d766c574880af` — PR #7 head tip
  (`refs/pr/7`), commit subject "a11y: verify the course journey with
  Playwright and axe at both viewports"
- **Instrument**: evals on branch `obv/untangle-evals-r2-baselines` (the joined
  umbrella `4985005a`), unmodified for the run
- **Target checkout**: fresh detached worktree verified at exactly the pinned
  SHA (`TARGET-VERIFIED`; `target.actualHead == target.sha` in the scorecard)
- **Gate**: `/home/user/work/heavy.lock` held for the whole run; load gate 1m/5m
  < 4 — gate opened 21:53:15Z at 1m=1.00 5m=0.48
- **Run window**: 21:53:18Z → 22:51:33Z (~58 min); runner exit 1 (case failures)
- **Load log**: `load-baseline-pr7-attempt1.log` — 236 samples at 15 s; 1-minute
  load stayed ≤ 2.68 for the entire run
- **Run log**: `run-baseline-pr7-attempt1.log`; driver trail:
  `pr7-1fa6bb7c-attempt1-status.txt` (external watchdog: kill on run.log stall
  > 720 s, 150-min cap — never fired; first attempt of this head, valid)

## Per-suite results

| Suite | Pass | Cases | Notes |
|---|---|---|---|
| selfcheck | 4/4 | 4 | preflight 15/15 steps green; db roundtrip; frontend renders; rmp-block active (104 requests blocked) |
| routing | 3/3 | 3 | building-coverage, route-geodesic-floor, route-latency pass |
| journey | 6/28 | 28 | discover-guest ×2, discover-registered-desktop, auth-guest ×2, auth-registered-desktop pass |
| honesty | 1/5 | 5 | only no-fabricated-precision passes; unavailable-label / notice / disclaimer surfaces absent |
| a11y-polish | 6/12 | 12 | **axe-home, axe-instructor, axe-map, focus-indicator, no-horizontal-overflow-mobile, image-icon-labeling pass** — the strongest a11y result of the three baselines so far; axe-courses/detail/schedule/auth still fail (serious 1–2 impacts) and keyboard-core-path hits a `focus:` timeout |
| optimizer | 0/3 | 3 | **not-applicable** — head predates `frontend/src/lib/optimizer/bench/run-bench.ts` |
| data | 0/2 | 2 | **not-applicable** — head predates `tools/catalog-consistency/audit.mjs` (+verify.mjs) and `frontend/src/lib/data-provenance.ts` |
| persistence-faults | 0/6 | 6 | **harness-error fails, not durability verdicts** — browser launch/connect exceeded 90 s on the post-restart legs; each case explicitly labeled "case could not complete (harness/journey error, not a measured durability verdict)" |

## Stubs disclosed in the scorecard

- `backend-runtime-fallback` — "the pinned backend's better-sqlite3 native
  addon crashes Bun (NAPI panic), so the backend ran under its documented
  Node/tsx runtime with the same rmp-block preload injected via NODE_OPTIONS"
  (the harness's own disclosure; identical path across baseline runs).

## Head-to-head notes vs the #4 and #11 baselines (same instrument)

- a11y is the real mover: 6/12 here vs 3/12 on #4 and 4/12 on #11. axe-home
  and axe-instructor pass here but failed on both earlier baselines, and
  `no-horizontal-overflow-mobile` passes here too; `reduced-motion` (passed on
  #11) fails here. The pin carries a11y journey-verification work, and the
  scorecard shows it.
- Journey is one to two passes lighter (6 vs 8 on #4, 7 on #11):
  `discover-registered-mobile` hit its 480 s case timeout (same timeout-shaped
  flip as #11) and `auth-registered-mobile` failed on a 5 s `focus:` timeout
  waiting for the "Sign in or create account" link — both timeout-family, not
  clean verdict regressions.
- Map cases fail with the required `Route legs` region absent on `/map`
  (map-guest-desktop hit its 480 s cap; map-guest-mobile reports the region
  absent for active courses CSCE 1030/1040).
- Save journeys again persist state across reload (byte-exact) with the
  contract export surface absent (`Save state` region, `Print schedule`,
  `Download .ics` on `/schedule`).

## Infrastructure

`infrastructure: {ok: true, brokenStep: null}` — every declared case got a
verdict; no broken stack steps. The runner wrote the scorecard JSON+MD itself
(`baseline-pr7-1fa6bb7c-attempt1.json` / `.md`); this summary wraps them with
head provenance, gate, and load-log naming per the baselines task.
