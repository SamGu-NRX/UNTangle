# Baseline scorecard of record — alpha head `fb741afdf7ae`

**Result: 17 pass / 41 fail / 5 not-applicable over 63 cases (suite `all`), exit 1.**
The lowest of the five baselines: a11y returns to the #4 floor (3/12) and the
journey pass set matches #7. All outcomes are the honest instrument verdicts;
nothing was retried into a pass.

- **Head**: `fb741afdf7ae3480baf0eecc8c2db3ef7806bd56` — the alpha candidate.
  **Provenance caveat, recorded in the run label and verified before launch:
  `origin/fleet/alpha-candidate-r1` no longer exists on origin.** The SHA
  resolves in the task clone and is reachable from `origin/alpha`; the run
  materialized and verified the worktree at exactly this SHA
  (`TARGET-VERIFIED`; `target.actualHead == target.sha` in the scorecard).
  Commit subject: "Merge #16 (real-term survey + data provenance) at
  641b20ed729d into alpha".
- **Instrument**: evals on branch `obv/untangle-evals-r2-baselines` (the joined
  umbrella `4985005a`), unmodified for the run
- **Gate**: `/home/user/work/heavy.lock` held for the whole run; load gate 1m/5m
  < 4 — gate opened 00:10:23Z at 1m=0.80 5m=0.35
- **Run window**: 00:10:24Z → 00:59:07Z (~49 min); runner exit 1 (case failures)
- **Load log**: `load-baseline-alpha-attempt1.log` — 198 samples at 15 s;
  1-minute load stayed ≤ 2.74 for the entire run
- **Run log**: `run-baseline-alpha-attempt1.log`; driver trail:
  `alpha-fb741afd-attempt1-status.txt` (external watchdog: kill on run.log
  stall > 720 s, 150-min cap — never fired; first attempt of this head, valid)

## Per-suite results

| Suite | Pass | Cases | Notes |
|---|---|---|---|
| selfcheck | 4/4 | 4 | preflight 15/15 steps green; db roundtrip; frontend renders; rmp-block active (110 requests blocked) |
| routing | 3/3 | 3 | building-coverage, route-geodesic-floor, route-latency pass |
| journey | 6/28 | 28 | discover-guest ×2, discover-registered-desktop, auth-guest ×2, auth-registered-desktop pass (identical pass set to #7); **five timeout-family journey fails** — discover-registered-mobile (480 s cap), save-guest-mobile (480 s cap), build-guest-mobile (`focus:` 5 s), map-guest-desktop (`waitForURL` 30 s), auth-registered-mobile (`waitFor` 30 s) |
| honesty | 1/5 | 5 | only no-fabricated-precision passes; sample-data notice, stale-rating notice, and /plans unverified-savings disclaimer surfaces absent; `rmp-labels-when-unavailable` timed out on prior heads |
| a11y-polish | 3/12 | 12 | only **axe-map, focus-indicator, image-icon-labeling** pass — the same floor set as head #4; axe-home fails (serious 1, moderate 1) after passing on #7/#8, axe-detail and reduced-motion fail after passing on #8 |
| optimizer | 0/3 | 3 | **not-applicable** — head has no `frontend/src/lib/optimizer/bench/run-bench.ts` |
| data | 0/2 | 2 | **not-applicable despite the pin carrying the #16 data-provenance merge**: `tools/catalog-consistency/audit.mjs` (+`verify.mjs`) are absent, and `provenance-descriptor` is n/a because the activeDataset literal (recorded verbatim in `preflight-logs/optdata-provenance-evidence.json` under the run directory) "names no bundled file the suite could recognize (no file-like field or .json reference)" |
| persistence-faults | 0/6 | 6 | **harness-error fails, not durability verdicts** — browser launch/connect exceeded 90 s on the post-restart legs; each case explicitly labeled "case could not complete (harness/journey error, not a measured durability verdict)" |

## Stubs disclosed in the scorecard

- `backend-runtime-fallback` — "the pinned backend's better-sqlite3 native
  addon crashes Bun (NAPI panic), so the backend ran under its documented
  Node/tsx runtime with the same rmp-block preload injected via NODE_OPTIONS"
  (the harness's own disclosure; identical path across all five baseline runs).

## Head-to-head notes vs the four PR baselines (same instrument)

- This is the **weakest baseline of the five** (17 pass vs 19/19/20/22).
  a11y falls back to the #4 floor set; axe-home, axe-detail, axe-instructor,
  reduced-motion, and no-horizontal-overflow-mobile all fail here after
  passing on at least one PR baseline — the alpha tree does not carry the
  a11y fixes present in #7/#8.
- The data-provenance merge in the pin does **not** make the data suite
  executable: the required audit tooling is absent and the recorded
  activeDataset literal names no recognized bundled file. Recorded as n/a,
  not as a pass.
- Journey strength matches #7 (6/28) with an identical pass set, and the run
  had more timeout-family journey failures than any other baseline (5).
- Infrastructure `ok: true, brokenStep: null` on every head; the
  persistence-faults suite produced zero measured durability verdicts on all
  five heads (launch/connect > 90 s on the post-restart legs each time).

## Infrastructure

`infrastructure: {ok: true, brokenStep: null}` — every declared case got a
verdict; no broken stack steps. The runner wrote the scorecard JSON+MD itself
(`baseline-alpha-fb741afd-attempt1.json` / `.md`); this summary wraps them
with head provenance, gate, and load-log naming per the baselines task.
