# Baseline attempt 1 — PR #4 head 5cfdc3c99f51 — INVALID (infrastructure: runner wedge)

**Status: INVALID RUN — no application verdict for this head. Attempt 2 follows.**

- Head: `5cfdc3c99f510518130a918810627e07cb1ca0fc` (PR #4 head tip; `refs/pr/4`)
- Harness: branch `obv/untangle-evals-r2-baselines` at the joined umbrella `4985005a`
- Target checkout: fresh detached worktree at exactly `5cfdc3c9…` (verified `TARGET-VERIFIED` in the status log, 18:49:41Z)
- Command: `bun run.ts --target-dir /home/user/work/untangle-baseline-target --target-sha 5cfdc3c99f510518130a918810627e07cb1ca0fc --suite all --out /home/user/work/untangle-baseline-pr4/scorecard-pr4-184940.json --task-id baseline-pr4`
- Gate: `/home/user/work/heavy.lock` held 18:49:40Z; gate opened at load 1m=0.92 5m=0.88 (both < 4)

## What completed before the wedge

Preflight green through every stack step (backend ran under node/tsx — the
harness's documented `backend-runtime-fallback` path). Seven case outcomes,
all pass: the four `selfcheck` cases, then
`journey/discover-guest-desktop`, `journey/discover-guest-mobile`,
`journey/discover-registered-desktop`.

## The wedge — exact record

- `journey/discover-registered-mobile` started ≤ 19:02:23Z.
- Last `run.log` write: **19:02:23Z** (ui-browser teardown warnings:
  `context.close() did not finish within 10000ms — continuing`,
  `browser.close() did not finish within 10000ms — continuing`).
- The case's per-case timeout is **480s** (`journey.ts caseTimeoutMs: 480_000`,
  the longest of any suite). Its deadline (~19:10:23Z) fell inside a
  monitor-verified continuously-awake window (19:02→19:18:28Z) and **never
  fired**. No outcome line was ever printed.
- Runner process `bun run.ts` (pid 414929) observed afterwards: state `S` in
  `ep_poll`, **5 seconds cumulative CPU** — event loop idle, not spinning,
  not blocked on CPU; the pending timer simply never ran.
- One `chrome-headless` process left defunct (zombie).
- Run was killed externally at 19:35:45Z (`RUN-END exit=137`). No scorecard
  JSON was written — the runner never reached scorecard assembly.

## Interpretation

Suspected Bun 1.3.14 timer/child-transport starvation mid-journey — the same
instability family the harness itself documents in `run.ts`'s crash-card
comment ("Playwright's transport dying with `connect ENOENT` mid-journey on
2026-10-19, twice"). The exact root cause was not established from here. The
class of failure is invisible to the instrument's own timeouts: an in-process
`Promise.race` timer cannot fire when the event loop stops waking. Mitigation
is therefore external to the instrument (unchanged): attempt 2's run driver
kills the runner if `run.log` stalls for > 720s (above every suite's
`caseTimeoutMs`, max 480s, plus margin) or if the attempt exceeds 150 min.

## Load log

15-second samples in `load-baseline-pr4-attempt1.log`: 1-minute load stayed
within 0.6–2.9 for the whole run — under the gate the entire time. One
14.5-minute sample gap (19:18:28 → 19:32:57Z) is a sandbox suspension between
agent turns (infrastructure), distinct from and unrelated to the wedge, which
predates it.

## Disposition

- This attempt is recorded as **invalid/infrastructure** — it is NOT a
  case-failure verdict for head #4 and MUST NOT be read as one.
- Attempt 2 runs the identical instrument and command. Its outcome — pass,
  fail, or invalid — will be committed as head #4's scorecard of record.
- Evidence (this directory): `run-baseline-pr4-attempt1.log`,
  `load-baseline-pr4-attempt1.log`, `pr4-5cfdc3c9-attempt1-status.txt`.
  Stack-boot step logs remain at
  `/home/user/work/untangle-baseline-pr4/preflight-logs/` (sandbox-local).
