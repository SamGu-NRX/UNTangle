# UNTangle v3 (Opus direction): build order

Readers: the lead assigning slices and the engineer who owns each one. Read `DESIGN.md` first; the mockups in this folder are the acceptance reference and `screens/` holds the captures (1440x900 and 390x844). Paths are relative to `frontend/src/` unless stated.

The simplification rules at the top of [`../untangle-v3.md`](../untangle-v3.md#simplification-rules) override this file where they disagree. Items they change are marked **Changed by rule N** below; the mockups and `screens/` already follow them, and `screens/before/` keeps the earlier captures.

Slices 1 to 3 run in order and unblock everything else. Slices 4 to 9 then run in parallel with disjoint file ownership. Slice 10 runs last. A slice may read any file; it writes only the files it owns. If a slice needs a change in another slice's file, it asks that owner.

Before slice 3, the lead decides DESIGN.md §12 items 1 to 3 (landing on Day, the Day name, Schedules replacing Plans), because they fix route and component names.

## 1. Tokens, fonts, document

**Owns:** `app/globals.css`, `app/layout.tsx`, `public/manifest.webmanifest`, new `lib/course-colors.ts`.

- Replace the color, type, spacing, radius and shadow tokens with DESIGN.md §7, and the motion tokens with MOTION.md §2. Keep the existing names that MOTION.md extends; delete `--ease-bounce`.
- Keep the self-hosted Syne 700/800 and DM Sans (opsz) files. Set `font-optical-sizing: auto` and `tabular-nums` on `body`.
- Viewport `viewport-fit=cover`; `theme-color` `#f4f6f3`; the manifest is `standalone`.
- Root CSS: tap highlight off, `overscroll-behavior: none`, hover gating, plus the reduced-motion and reduced-transparency blocks from `base.css`.
- `lib/course-colors.ts`: `assignColors(schedule): Map<courseId, 1..6>` per DESIGN.md §7 (department clustering, ring order 1-3-6-4-2-5). It is pure and has one correct answer, so it gets strict unit tests: same department lands on an adjacent hue, a new department gets the farthest free hue, assignment is stable across re-renders, and a seventh course reuses a hue deterministically.

**Accept:** contrast pairs from DESIGN.md §7 recomputed in a test; no `--ink-3` text under 14px (grep); the tests pass.

## 2. Controls

**Owns:** `components/ui/**`.

- Build or replace: Button (sizes, loading with held width), Segmented (one pill, instant on keyboard activation), Chip, SearchField, TextField, Switch, Plate (new), StatusGlyph (seven states, svg, accessible name), ProvenanceTag, PathLine (new; vertical and horizontal; `data-leg`), Toast, Sheet, Dialog.
- Sheet: extend `sheet-physics.ts` with projection (d = 0.995), the rubber-band formula, 8px hysteresis, spring settle with velocity handoff, and the modal focus lifecycle (role dialog, focus in, background `inert`, focus restored). Values are in MOTION.md §5.
- **Changed by rules 2 and 7:** add `ContextualPanel` (desktop only: opens on a selection, empty otherwise; from 1200px it pushes the main region aside, narrower it slides over the right edge; Esc and keyboard opens are instant; MOTION.md §3) and `DayStepper` (previous day, the day's name or "Today", next day). Drop the Day use of Segmented.
- Remove value-choosing `Select` usage. `Menu` stays for ⋯ overflow only. Delete `StepBar.tsx`, `StaggerGroup.tsx` and `ConflictBanner.tsx`.
- Update `app/dev/controls/page.tsx` to show every control in every state.

**Accept:** the dev controls page at both sizes matches the mockups' controls; axe is clean (`_build/axe.mjs` pattern); keyboard Tab reaches every control with a visible ring; under reduced motion no control moves; on a coarse pointer every control has a ≥ 44px hit area.

## 3. App shell and routes

**Owns:** `components/shell/**`, `app/page.tsx`, `app/day/page.tsx` (new), `app/schedules/page.tsx` (new), redirects from `app/map` and `app/plans`.

- TopBar with ViewTabs, SearchTrigger (which matches 5-digit class numbers), SchedulePill and Account. **Changed by rule 2:** the top bar is the only navigation. SchedulePill shows the term in a lighter weight and then the name, with no separator glyph, and opens a switcher (a popover on desktop, a sheet on phone) listing the term's schedules, New schedule, All schedules and compare, and Clear. No lens has its own schedule tabs. PhoneHeader (hidden on Day). TabBar with Courses, Week and Day.
- Landing rule (DESIGN.md §3.2) in `home-entry.ts` / `routes.ts`. It is pure logic with one correct answer, so it gets strict tests for: in session with a class still ahead, in session with the day over, a weekend, no in-session schedule, and a first visit with no transcript.
- Per-tab scroll and sheet state survive tab switches; re-tapping the current tab scrolls to the top.

**Accept:** `07-phone-navigation.html` behavior on a phone: instant tabs, preserved scroll, schedule sheet, back closes the sheet first. The desktop bar matches `screens/02-*-desk.png`. The tests pass.

## 4. Import

**Owns:** `components/connect/**`, `lib/connect/**`, `app/connect/page.tsx`, `app/courses/import/page.tsx`, `components/transcript-import-client.tsx`, `components/course-import-panel.tsx` (delete these two once replaced).

- States and copy exactly as DESIGN.md §4.1. Delete the extension path and its protocol messages.
- `openPortal()` runs `window.open(url, "myunt", "popup,width=480,height=760,left=…,top=…")` inside the click handler. A `null` return goes to `blocked`. Poll `popup.closed` every 500ms, listen for `focus` and `visibilitychange`, and go to `returned` on any of them.
- `pickTranscript()` uses `showOpenFilePicker({ startIn: "downloads", types: [{ accept: { "application/pdf": [".pdf"] } }] })` with an `<input type=file accept="application/pdf">` fallback. Cancelling does nothing.
- A page-level drop target shows the overlay on `dragenter` with Files and the not-a-PDF variant from `items[].type`. It is disabled on coarse pointers.
- Parsing stays local. The progress state appears only when parsing takes ≥ 400ms. Wrong document and no-text detection produce `wrongfile` and `notext`.
- Phone: state survives the trip to Safari (sessionStorage), and `visibilitychange` lands on `returned`.

**Accept:** each state in `01-first-visit-import.html` reproduced, compared against `screens/01-*`; a popup-blocked browser gets the new-tab link; on iOS the picker opens and the flow resumes after backgrounding; nothing is uploaded (network panel shows no request carrying the PDF).

## 5. Courses

**Owns:** new `components/courses/**`, `app/courses/page.tsx`. It replaces `components/courses-client.tsx`, `major-selection-modal.tsx`, `grade-chart.tsx`, `grade-chart-canvas.tsx`, `gpa-badge.tsx` and `instructors/[id]` (that route redirects to the course detail).

- TermTray with Auto, CourseGroup and CourseRow (a stretched native button for detail with sibling actions, never a button nested in a button), the CourseDetail panel and sheet, and the MajorPicker dialog. **Changed by rules 2, 4 and 8:** no rail. A header line holds the degree name (it opens the degree dialog: major, catalog year, transcript date, Import again) and "54 of 120 credits". Tray rows show the course only; group rows show the status reason or the grade. To check and You can take start open; the rest start closed, and only closed groups show a count.
- Status mapping from `lib/prereq` (read only):
  - `done` → done, or covered when `reason.kind === "closure"`;
  - `taking` → taking;
  - `eligible` → available;
  - `locked` → locked, with meta from the unmet `Reason` children;
  - `unknown` → check, with meta from the reason message;
  - a course in the active schedule → planned.
- Auto calls the plan-scoped transaction, then plays the reveal (MOTION.md §8). Undo reverts the transaction and plays the reverse.
- Detail sections use the shared section source and conflict check (slice 6 exports `sectionConflicts(schedule, section)` from `components/schedule-builder/conflicts.ts`; read only here).

**Accept:**
- The 02 screens at both sizes. **Changed by rules 2, 4, 8 and 9:** compare against the new captures, not `screens/before/`.
- The Auto reveal timeline matches `screens/02-auto-midflight-*.png` at about 830ms, with the counter rising per landing; Undo returns every row to its original place.
- ↑/↓ moves the detail without re-animating; Enter on `+` adds and never opens the detail.
- Reduced motion produces a crossfade only.

## 6. Schedule builder (both hosts)

**Owns:** new `components/schedule-builder/**`, `app/schedule/page.tsx`, `app/schedule/print/page.tsx`, `lib/planner-ics.ts`, new `lib/export/class-numbers.ts`. It replaces `schedule-client.tsx`, `schedule-section-locks.tsx`, `planner-export-panel.tsx` and `schedule-print-view.tsx`. The standalone vsb entry is a separate app; it imports this folder and supplies its own `BuilderHost` (DESIGN.md §8.4). Where that app lives is a lead decision.

- Nothing in `components/schedule-builder/**` imports UNTangle stores, the prereq engine or shell components. A lint rule or import test enforces it.
- WeekGrid: events by department color, overlap groups side by side, walk chips (`walkMinutes` prop), busy blocks (drag to create), the No set time strip, dotted section options and drag-to-snap on fine pointers only, and a ghost preview from search. **Changed by rule 4:** events show the code and the time only (no building plate); the walk chip sits on a 2px line between the two classes, amber when tight and red when late.
- **Changed by rules 1, 2, 3 and 6:** no Find column, registration list, stats line or schedule tabs. The page is a header (a Preferences button with its one-line summary, Undo, Export, Auto or Build), one answer line, and the grid. The answer line is a fixable warning with "Show a fix", or "This week fits your preferences". Search opens the contextual panel; so do a selected event (sections, "Keep this section", Remove) and Preferences.
- OptionsBar: subscribes to the optimizer worker's best-so-far stream. It previews option A within 300ms and updates text in place; it never swaps a grid the student is previewing (MOTION.md §9). **Changed by rule 5:** it shows one alternative at a time as "1 of 3" and one sentence saying how it differs from the current week, with Details (figures in the panel), Next, Use this and a close button. There is no A, B, C control and no "checked N weeks" text.
- Export:
  - `.ics` with RRULE, UNTIL and EXDATE from a term calendar table (start with Spring 2027: Jan 19 – May 7, spring break Mar 15–19);
  - optional leave-by VALARMs once slice 7 ships `lib/leave-by.ts`;
  - `.png`;
  - class numbers ordered fewest open seats first;
  - share link, file save and open, print.
- `lib/export/class-numbers.ts` and the `.ics` builder are pure and get strict tests: EXDATE dates, UNTIL, timezone `America/Chicago`, online sections excluded, the order rule.

**Accept:**
- `03-schedule-builder.html` at both sizes in both hosts (`?host=vsb`). **Changed:** compare against the new captures.
- One-tap add from a search result; a conflict is visible before adding, and an added conflict renders side by side.
- Undo and ⌘Z (instant).
- An imported `.ics` shows no class over spring break.
- The vsb parity list in DESIGN.md §3.5 checked item by item. **Changed by rule 2:** search lives in the top bar and the panel, saved schedules in the switcher, and class numbers in Export. The vsb host has no account control, as the decision page says.

## 7. Day

**Owns:** `components/map/**`, `lib/map-itinerary.ts`, new `lib/leave-by.ts`, `app/day/page.tsx` contents (slice 3 creates the route file; slice 7 owns what it renders).

- DayHero, the Itinerary on PathLine, MapCanvas per `../apple-maps-web/` (layers, padding, camera), MapControls, DaySwitcher, and a StartingPoint setting. **Changed by rule 7:** a stop row shows the time and the building plate; a walk shows minutes, plus one line only when tight or late. Selecting a stop expands it (title, room, end time, Directions); selecting a walk shows its leave-by, and the first walk carries "Change starting point". DaySwitcher is the stepper. The online class row moves out of Day. The mockup's map is a capture of the live map; the map pass owns MapCanvas.
- `lib/leave-by.ts`: `leaveBy(start, walkMin, bufferMin = 2)` and `isTight(leave, previousEnd)`, using exact minute arithmetic (the mockup's float bug is the reason). It has one correct answer, so it gets strict tests for these hero states: before the first class, within a minute, between classes, tight, after the last class, and no classes.
- Camera per MOTION.md §6, including snap-to-half before a flight from the full detent.

**Accept:** the 04 screens at both sizes (**changed by rule 7**); selecting every stop and leg at 390 and 1440 keeps the target outside the panel, sheet and controls (camera.md acceptance list); reduced motion jumps the camera and keeps pitch at 0; attribution stays visible at every detent.

## 8. Schedules library and compare

**Owns:** `components/saved-plans/**` (rename to `components/schedules-library/**`), `lib/plan-library/**`, `lib/saved-plans/**`, `app/schedules/page.tsx` contents.

- ScheduleCard (a stretched button, ⋯ menu), ScheduleDetail, VersionList on PathLine (automatic "Before Auto" snapshot from the transaction), and CompareView (a segmented control with the two names and Both, delta table, change list, make B active). **Changed by rules 2, 4 and 9:** cards become rows (small drawn week, name, when it was edited, ⋯). ScheduleDetail and CompareView open in the contextual panel and nothing shows there until a schedule is picked. Detail drops the stats line.
- Phone push and pop at 260ms in and 200ms out (MOTION.md §3).

**Accept:** the 05 screens (**changed**); restoring a version is undoable; compare deltas match a hand calculation for the two sample schedules; keyboard reaches cards, versions and Restore.

## 9. Sign in

**Owns:** `components/auth-shell.tsx`, `components/auth-client.tsx`, `components/forgot-password-client.tsx`, `app/auth/page.tsx`, `app/forgot-password/page.tsx`.

- A dialog on desktop and a sheet on phone over the current route (`/auth` stays as a deep link). One form; the create-account switch happens in place; errors sit under the field; no magic-link button.
- Merging the guest's schedules into the account on first sign-in is stated in the copy, so it has to be true. Confirm the persistence layer does it before shipping.

**Accept:** the 06 screens; `autocomplete` values as in DESIGN.md §4.6; Esc closes and focus returns to the Sign in trigger; the closed dialog is not tabbable.

## 10. Motion and ship check

**Owns:** nothing new. Fixes go back to the owning slice.

- Run prep-for-prod on the integrated app, with a fresh reviewer on the code and a runtime pass at 390 and 1440, with reduced motion on, plus a keyboard-only pass.
- Real-device checks that emulation can't settle (MOTION.md §12): sheet drag next to the iOS back swipe, momentum feel, the input zoom, the keyboard over the sign-in sheet, map camera frame rate on an older iPhone and a mid-range Android.

**Accept:** no blocking findings; the device checks are recorded with the device and OS.

## Working on the mockups

The HTML files in this folder are built: `_build/pages/*.html` plus the shared `_build/base.css` and `_build/base.js`, inlined by `node _build/build.mjs`. Edit the sources and rebuild; never edit the built files. From `~/.cache/untangle8/e2e`, `node "<this folder>/_build/shoot.mjs" [filter]` re-captures `screens/`, `node "<this folder>/_build/axe.mjs"` runs axe plus a keyboard Tab pass at both sizes, and `node "<this folder>/_build/count.mjs" [folder]` counts the visible text items above the fold on each lens at 1440×900 (pass a folder holding older built pages to count those).

## Verification already done on the mockups

- Captures: every state in `_build/shots.mjs` at 1440x900 and 390x844, including mid-animation frames (`02-auto-midflight`, `03-untangle-next`) and reduced-motion runs (`02-auto-reduced`, `03-untangle-options-reduced`). The Day camera frames (`04-day-flight`, `04-day-reduced`) were dropped with the drawn map; the map pass re-captures them.
- After the simplification pass, axe-core 4 (WCAG 2.1 A/AA) is clean on eleven page states at both sizes, including Week's options and Preferences states, Day with a stop selected, and the library with nothing selected. Before that pass it was clean on eight page variants. The keyboard pass found focus indicators everywhere; the inputs use a box-shadow ring, which the script's outline check doesn't count.
- A fresh read-only code review against the prep-for-prod checks returned "Block". Every item it raised was fixed (nested interactive rows, keyboard activation, the modal focus lifecycle, flex-grow animation, keyboard-triggered animation, reduced-motion presses and spinners, hit areas, labels, touch-action) and axe was rerun. Lighthouse was not run.
