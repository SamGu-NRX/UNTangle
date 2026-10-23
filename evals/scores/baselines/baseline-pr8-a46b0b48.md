# Baseline scorecard of record — PR #8 head `a46b0b48a75d`

**Result: 22 pass / 36 fail / 5 not-applicable over 63 cases (suite `all`), exit 1.**
The strongest of the four baselines run so far: a11y rises to 7/12 and
`auth-registered-mobile` recovers. All outcomes are the honest instrument
verdicts; nothing was retried into a pass.

- **Head**: `a46b0b48a75d172f3f2b71f5b570ccd5720a7989` — PR #8 head tip
  (`refs/pr/8`), commit subject "Verify /plans with browser evidence and a11y
  fixes (M4)"
- **Instrument**: evals on branch `obv/untangle-evals-r2-baselines` (the joined
  umbrella `4985005a`), unmodified for the run
- **Target checkout**: fresh detached worktree verified at exactly the pinned
  SHA (`TARGET-VERIFIED`; `target.actualHead == target.sha` in the scorecard)
- **Gate**: `/home/user/work/heavy.lock` held for the whole run; load gate 1m/5m
  < 4 — gate opened 22:56:19Z at 1m=0.97 5m=0.37
- **Run window**: 22:56:20Z → 23:57:55Z (~62 min); runner exit 1 (case failures)
- **Load log**: `load-baseline-pr8-attempt1.log` — 249 samples at 15 s; 1-minute
  load stayed ≤ 2.26 for the entire run
- **Run log**: `run-baseline-pr8-attempt1.log`; driver trail:
  `pr8-a46b0b48-attempt1-status.txt` (external watchdog: kill on run.log stall
  > 720 s, 150-min cap — never fired; first attempt of this head, valid)

## Per-suite results

| Suite | Pass | Cases | Notes |
|---|---|---|---|
| selfcheck | 4/4 | 4 | preflight 15/15 steps green; db roundtrip; frontend renders; rmp-block active (100 requests blocked) |
| routing | 3/3 | 3 | building-coverage, route-geodesic-floor, route-latency pass |
| journey | 7/28 | 28 | discover-guest ×2, discover-registered-desktop, **all four auth journeys** pass (auth-registered-mobile recovered after its #7 focus timeout); build/plan/save/map families fail on absent contract surfaces |
| honesty | 1/5 | 5 | only no-fabricated-precision passes; the /plans page exists and verifies at this pin, but the **unverified-savings disclaimer surface is absent** (`unverified-savings-disclaimer` fail); `rmp-labels-when-unavailable` hit its 240 s cap again |
| a11y-polish | 7/12 | 12 | **axe-home, axe-detail, axe-instructor, axe-map, focus-indicator, reduced-motion, image-icon-labeling pass** — the broadest axe coverage of any baseline (axe-detail passes for the first time); axe-courses (serious 2), axe-schedule (serious 1), axe-auth (serious 2) still fail; keyboard-core-path still times out on `focus:` |
| optimizer | 0/3 | 3 | **not-applicable** — head predates `frontend/src/lib/optimizer/bench/run-bench.ts` |
| data | 0/2 | 2 | **not-applicable** — head predates `tools/catalog-consistency/audit.mjs` (+verify.mjs) and `frontend/src/lib/data-provenance.ts` |
| persistence-faults | 0/6 | 6 | **harness-error fails, not durability verdicts** — browser launch/connect exceeded 90 s on the post-restart legs; each case explicitly labeled "case could not complete (harness/journey error, not a measured durability verdict)" |

## Stubs disclosed in the scorecard

- `backend-runtime-fallback` — "the pinned backend's better-sqlite3 native
  addon crashes Bun (NAPI panic), so the backend ran under its documented
  Node/tsx runtime with the same rmp-block preload injected via NODE_OPTIONS"
  (the harness's own disclosure; identical path across baseline runs).

## Head-to-head notes vs the #4/#11/#7 baselines (same instrument)

- a11y climbs monotonically across the four baselines so far (3 → 4 → 6 → 7
  of 12), matching the a11y work landing in these pins; this head adds
  axe-detail and keeps reduced-motion.
- Auth journeys are fully green here (4/4) for the first time.
- Save journeys persist state across reload **byte-exact** with the contract
  export surface absent (`Save state` region, `Print schedule`,
  `Download .ics` on `/schedule`) — same shape as #4/#11/#7.
- Honesty's binding /plans disclaimer rule fails at this pin even though the
  /plans page itself renders and verifies — the surface, not the page, is
  what is missing.
- Map cases fail with the required `Route legs` region absent on `/map`
  (no route legs/stops rendered for active courses).

## Infrastructure

`infrastructure: {ok: true, brokenStep: null}` — every declared case got a
verdict; no broken stack steps. The runner wrote the scorecard JSON+MD itself
(`baseline-pr8-a46b0b48-attempt1.json` / `.md`); this summary wraps them with
head provenance, gate, and load-log naming per the baselines task.
