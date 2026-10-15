# student-auto — one student builds a real week, and Auto picks the true best

A browser journey that follows one student through the real path — import a
transcript, pick a major, let the tray plan courses, set schedule preferences,
run Auto on the Week page, use a schedule — and then proves, with the repo's
own independent reference solver, that Auto's top pick is the true optimum for
exactly the request the Week page sent.

## Files

- `journey.mjs` — the Playwright journey (plain Node; run with `node`).
- `solver.ts` — the comparison half, run with Bun against the app's own
  TypeScript: rebuilds the exact `OptimizeRequest` from the student's captured
  storage, runs the app engine (`src/lib/optimizer/optimize.ts` through the
  worker protocol, walking time included), then runs
  `frontend/tests/optimizer/reference.ts` — the independent reference solver,
  imported, never copied — on the same request.
- `fixtures/make-transcript.mjs` + `fixtures/synthetic-transcript.pdf` — the
  made-up myUNT unofficial transcript the student imports. Regenerate the PDF
  with `node fixtures/make-transcript.mjs`.
- `report.md` / `journey-report.json` — the run's report (written by the
  journey into the output directory).

## The student

Synthetic, not a capture: the transcript is generated locally and describes no
real person. Its rows mirror the completed records of the app's own sample
transcript (`src/components/courses/model/sample-transcript.ts`), which the
2026-27 catalog's inference engine can verify cleanly:

- Completed: MATH 1710 (B, Fall 2025), ENGL 1310 (A, Fall 2025),
  CSCE 1040 (A, Spring 2026) — the same course set as the app's sample
  transcript. The synthetic PDF goes through the app's own import pipeline
  and is saved from the review screen with "Looks right", so the planner's
  model is produced end to end rather than injected.
- Major: Computer Science. Then the Courses tray's Auto plans the next term.
- Preferences on the Week page: nothing before 10 AM, Fridays off, and two
  "Work" busy blocks painted onto the grid — Tuesday and Thursday, 5–9 PM.
- Auto, then every option walked, screenshotted, axe-audited, and checked for
  the student's own rules as the UI shows them: no Friday meetings, no
  conflict markers. Details on option 1, then "Use this".

Run twice: desktop 1440×900 and phone 390×844, each with a fresh guest
identity (fresh browser context, so storage starts empty).

## What the solver proves

The journey reads back the student's own storage — the planner state and the
stored schedule preferences — which is precisely what `buildOptimizeRequest`
in `src/app/schedule/untangle-host.ts` builds the Week page's request from.
The solver then answers, on that exact request:

1. Auto (the app engine, run on the same request through the same worker
   protocol) finishes `optimal`.
2. Auto's options cost what the reference solver's options cost, rank by
   rank — in particular Auto's top pick equals the true optimum.
3. Every Auto option is feasible (`violations()` finds nothing).
4. Options differ by at least the contract's `minDifferentCourses` (compared
   against the reference's own minimum).
5. The applied plan (`state.selectedSections`) is Auto's option 1, and the
   week offered exactly as many options as the engine returned.

## Section data

The app is served the repo's own recorded Spring 2027 capture,
`frontend/tests/optimizer/scenarios/fixtures/spring-2027-trimmed.json`
(recorded from `https://vsb.untgrades.app`, captured 2026-10-15, upstream
scrape updated 2026-10-04), through Playwright route interception — the same
fixture the optimizer scenarios use, parsed by the app's own
`src/lib/sections/vsb.ts`. The grades API is answered unavailable. No network
leaves the machine.

## Running it

Needs a built frontend, a PostgreSQL database, and Bun 1.3.10 (the repo's
pin — the solver imports the app's TypeScript). Playwright and axe-core are
loaded from wherever they are installed:

```sh
export PLAYWRIGHT_MODULE=/path/to/node_modules/playwright  # or a dir containing playwright
export AXE_PATH=/path/to/node_modules/axe-core/axe.min.js
export UNTANGLE_BUN="$(command -v bun)"                    # default: bun / journey-bun
node output/playwright/student-auto/journey.mjs http://127.0.0.1:3000 /tmp/student-auto
```

In CI (`journeys.yml`), the journey runs under its own user with outbound
traffic blocked; the lead adds the step, the same way the other journeys are
run (see the pull request description for the exact step).


## Known findings (2026-10-15 run)

The axe audit blocks on serious/critical violations, the same rule the other
journeys use. On the recorded run it found real ones on the app itself —
49/50 checks pass, and the one failing check is that audit:

- `/connect`: `color-contrast` (serious) on 3 caption/meta nodes.
- Preferences dialog: `color-contrast` (serious) on the "Fridays off" toggle
  label, and `label-content-name-mismatch` (serious) on all five day-toggle
  buttons (`aria-label="Mondays off"` does not contain the button's visible
  text).
- Options strip (options 2 and 3): `color-contrast` (serious) on the count
  pill and the strip sentence.

Full node targets are in `output/journey-report.json` (`axe`) and `report.md`.
Fixing them is app work, separate from this journey.
