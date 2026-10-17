# Round 1 — UX directions lab plan

Branch `obv/untangle-ux-directions-round1-f1`, base `5cfdc3c` (alpha tip at task start).
Draft PR: opened against `alpha` (filled in after the first push).

## Goal

Three self-contained directions for the planner schedule + map screen, each a real
`/lab/<id>` route running on real planner state, compared against the production
implementation with identical scripted tasks, browser evidence, axe results and
performance numbers, then recommended (or not) for round two.

## Ownership boundaries

- May edit: `frontend/src/app/lab/**`, `frontend/src/components/lab/**`,
  `frontend/src/lib/lab/**`, `frontend/tests/lab/**`, `docs/lab/**`,
  `frontend/package.json` (additive devDependencies only), lockfile via install.
- Never edit: planner/map/schedule/leaf components and providers, shared types,
  backend code, workflows, config, seed data.

## Directions

- **A — Week grid with integrated day map** (`/lab/a`): production-style week grid
  with a live day-route panel beside it.
- **B — Day-first itinerary** (`/lab/b`): classes and walking legs as one timeline;
  map follows the selected stop.
- **C — Mobile map with bottom sheet** (`/lab/c`): full-bleed map, draggable sheet
  with peek/half/full snap points; the only direction whose desktop layout is
  secondary to the mobile one.

## Scripted comparison tasks (identical per direction, both 1440×900 and 390×844)

1. Plan Tuesday: select courses/sections for a four-class day.
2. Find the longest walk of the week; report which leg wins.
3. Fix a time conflict by swapping one section.
4. Move one class to keep Friday completely free.

## Honest route-source presentation

- `ors` / `campus-network` → walking style + OSM attribution + distance + walking time.
- `fallback` → dashed straight line, "approximate distance", never a time.
- Same building → no request, "same building" row.
- Unknown source → treated as fallback (see `normalizeLegSource`).

## Verification loop

- `tsc --noEmit` after every change.
- `bun test tests/lab` scoped to lab tests after every change.
- Browser evidence (screenshots, axe, load/interaction timings) for all three
  directions at both viewports in the comparison phase.
- Milestones: (1) foundation, (2) direction A, (3) direction B, (4) direction C,
  (5) comparison + recommendation. Each pushed.

## Deviations recorded

- The brief names skills `frontend-design`, `emil-design-eng`, `holistic-ux`,
  `apple-design`, `animate`, `prep-for-prod`. None exist in the repo (alpha/main
  ship `anti-ui-slop`, `better-accessibility`, `blast-radius`, `pstack-*`) nor in
  the workspace skill list. The repo's own skills plus the brief's embedded rules
  (palette, motion contract, accessibility) are applied instead; this is restated
  in the PR.
- `--copy` is scoped to `#586e58` inside `.lab-root` only; the app's
  `globals.css` (`--copy: #6b826b`) is untouched.
- The base map endpoint never reports a `campus-network` source; the lab presents
  sources honestly (ors → walking style, anything else → approximate fallback)
  rather than inventing a source the backend does not emit.
