# UNTangle v3: build order

Who reads this: the lead splitting work across Opus implementers, and each implementer at the start of their slice. Slices own disjoint files; S0 ships before anything else, S1 before S2–S7, and S2–S7 can run in parallel. Each slice ends with its acceptance checks run at 1440×900 and 390×844 with Playwright from `~/.cache/untangle8/e2e`.

Read first: `DESIGN.md` (direction, tokens, components), `MOTION.md` (values), the mockup for your slice. The mockups are the contract for layout, copy and motion; where a mockup and this file disagree, the mockup wins and you note it in the PR.

## S0. Tokens, fonts, motion primitives

Owns: `frontend/src/app/globals.css`, `frontend/src/app/fonts/**`, `frontend/src/components/ui/motion.ts`, `frontend/src/components/ui/Sheet.tsx`, `ui/Menu.tsx`, `ui/Popover.tsx`, `ui/Toast.tsx`, `ui/Tooltip.tsx`, `ui/Segmented.tsx`, `ui/Chip.tsx`, `ui/Select.tsx`, `ui/Slider.tsx`, `ui/Toggle.tsx`, `ui/SearchField.tsx`, `ui/StatusMark.tsx`, `ui/ProvenanceTag.tsx`, `ui/Button.tsx`.

1. Replace the color, type, spacing, radius, elevation and layout tokens with `DESIGN.md` §5 and §4; add the motion tokens from `MOTION.md` §2 including the reduced-motion block.
2. Self-host DM Sans (variable, opsz 9..40) and Syne 700/800 with `font-display: swap` and a `size-adjust` fallback.
3. Restyle the existing controls to v2 §4 as amended in `DESIGN.md` §6 "Controls" (36px desktop / 44px phone buttons, popovers with `transform-origin` at the trigger, native `<select>` wrapped on coarse pointers).
4. Sheet: detents, pointer capture, velocity rule, damping, `data-dragging`, modal and non-modal variants, scrim (`MOTION.md` §5).
5. StatusMark with the seven states and the `override` dotted underline; ProvenanceTag; Toast (one at a time, pauses when hidden).
6. `motion.ts` exports `sheetSpring`, `sheetFlick`, `cameraEase`, and a `useReducedMotion()` that listens for changes.

Accept: a storybook-style page `/dev/controls` renders every control in every state (keep it behind `NODE_ENV !== "production"`); the segmented pill moves with transform only; a menu opened from the right edge scales from its top-right corner; the sheet on a 390 viewport reaches all three detents by drag and by flick; Axe reports no contrast failures on `/dev/controls`; with `prefers-reduced-motion`, no element has a non-zero transform transition.

## S1. Shell and routing

Owns: `frontend/src/components/shell/**`, `frontend/src/app/layout.tsx`, `frontend/src/app/(lenses)/layout.tsx`, `frontend/src/lib/brand.ts`, `frontend/src/lib/lens-default.ts`, `manifest.webmanifest`.

1. TopBar (56; phone 48; absent on Day on phone), LensSwitcher (Courses · Week · Day), ScheduleChip with its Menu (schedules list, New, Duplicate, Rename, Compare…, Import a schedule file, Open library), BottomTabs (phone).
2. `brand.ts`: host-based config. `untangle.*` → name "UNTangle", lenses [courses, week, day], account on. `vsb.untgrades.app` (and a `?entry=standalone` dev override) → name "UNT Schedule Builder", lenses [week, day], account off, Find column open by default, data-freshness line on. The wordmark component takes the name from here.
3. `lens-default.ts`: the H2 rule (phone, sections present, weekday 06:00–18:00 → Day on today; else last lens; no sections → Courses). Desktop → last lens.
4. Routing rules from `DESIGN.md` §2: lens switch is instant and preserves selection and scroll; browser back closes a sheet or panel before changing lens; tapping the active tab scrolls to top (Day: refits the camera).
5. PWA meta from `DESIGN.md` §9.

Accept: screenshots of the shell on each lens at both sizes match `07-phone-nav.html` and the top bars in `02`–`04`; on a 390 viewport with a seeded schedule at a mocked Tuesday 08:00 the app opens on Day/Tue; with `?entry=standalone` the wordmark reads "UNT Schedule Builder" and Courses is absent from the switcher and tabs; pressing back with the detail sheet open closes the sheet and stays on the lens.

## S2. Import page

Owns: `frontend/src/app/(lenses)/courses/import/**`, `frontend/src/components/import/**`, `frontend/src/lib/import/**` (popup, picker, drop, parse, review).

Mockup: `01-import.html`. States: idle, waiting, returned, drop, reading, review, error, done (= Courses with the AutoNote).

1. `openMyUNT()` opens the transcript URL with `window.open(url, "myunt", "popup,width=1100,height=800")`; poll `closed` every 500ms; `visibilitychange` and `focus` also set `returned`.
2. `pickTranscript()` uses `showOpenFilePicker({ startIn: "downloads", types: [pdf] })` when present, else a hidden `<input type=file accept="application/pdf">`. AbortError returns to the previous state silently.
3. Page-wide drop with a depth counter so child `dragleave` does not flicker the overlay; non-PDF drops go to `error`.
4. Parse locally in a worker; the three reading steps are real phases, not timers. The PDF never leaves the device; say so once, in the idle state.
5. Review: the unmatched row's "Pick course" opens the SearchPalette scoped to that row; "Skip" removes it. "Add N courses" writes statuses in one transaction and routes to Courses with the AutoNote.
6. No extension code paths remain anywhere; delete them.

Accept: the flow completes with a real PDF on Chrome (picker opens in Downloads), Safari (file input), and iOS Safari (native picker); dragging a PDF anywhere over the page shows the overlay within 120ms and dropping parses it; the `returned` state's button has focus and Enter opens the picker; with the popup blocked, the page shows the `error` title "Pop-up blocked" with the fix "Allow pop-ups for UNTangle, or open myUNT yourself and come back"; state survives a reload mid-flow via `sessionStorage`.

## S3. Courses lens and course detail

Owns: `frontend/src/app/(lenses)/courses/**` (except `import/`), `frontend/src/components/courses/**` (CourseGroup, CourseRow, AutoButton, AutoNote, DetailPanel and its sections, GradeChart, SectionList).

Mockup: `02-courses.html`.

1. Rows per `DESIGN.md` §6 with the StatusMark; groups collapsible and remembered; keyboard ↑/↓/Enter/Space; `/course/:id` opens the panel.
2. AutoButton runs the planner as one undoable transaction; the reveal per `MOTION.md` §6; the AutoNote dismisses on navigation.
3. DetailPanel sections in order; Needs/Unlocks chips carry StatusMarks and re-target the panel; the instructor Select crossfades the bars; link-outs per instructor and disabled without one.
4. SectionList: one-tap Add per row; conflict text computed against the active schedule before render; hover ghosts the section onto the Week grid when Week is mounted behind (desktop only; emit an event the Week slice listens to).
5. Phone: the panel is the modal Sheet at 92%.

Accept: before/after Auto screenshots match the mockup's two states; Undo restores every row with no animation; a row with `status=check` shows the rule text in its tooltip; in the panel, Tab order is Close → Add → link-outs → chips → Select → section Adds; the grade bars have `aria-hidden` and a text summary for screen readers; a conflicting section row shows "Conflicts with …" without hovering.

## S4. Week lens and the schedule builder (both entries)

Owns: `frontend/src/app/(lenses)/week/**`, `frontend/src/components/week/**` (FindColumn, ScheduleGrid, ScheduleEvent, WalkRibbon, NoSetTimeStrip, WeekRail, CourseBlocks, ConstraintRail, OptionsRail, ExportMenu, ClassNumbersPopover, QuickAdd), `frontend/src/lib/schedule/**` (named schedules store, conflicts, overlap groups, undo stack, share link, exports), `frontend/src/lib/colors.ts`.

Mockup: `03-week.html`, both entries.

1. Named schedules store: up to 10 per term, reorder, rename, duplicate, delete with confirm, active index; persisted to the account when signed in and to local storage as a guest; Undo stack per schedule (⌘Z), Clear.
2. Grid per `DESIGN.md` §6: Saturday when needed, overlap groups side by side, WalkRibbon between consecutive events using the route engine's minutes (dashed when approximate; `tight` when walk ≥ gap − 2), NoSetTimeStrip. Click an event → DetailPanel; select a CourseBlock → pick-on-grid ghosts of its other sections; click a ghost → swap (120ms out/in).
3. Find column: search by code, title, instructor or class number; "Open sections only"; Advanced filters (days, core, honors); TAMS rules toggle; results with one-tap Add and conflict text. Collapsed by default in UNTangle, open in standalone; the header field opens it.
4. Rail: CourseBlocks (department colors from `colors.ts`, per-course override popover, lock, remove, drag reorder = export order), Preferences (Earlier/Any/Later, chips, Busy times chips, two sliders), stats. Auto flips to Options with best-so-far per `MOTION.md` §6; "Use" applies with a toast and Undo.
5. ExportMenu: .ics with RRULE + EXDATE from the term's academic calendar table; .png of the grid; class numbers in cart order with Copy; Share link (schedule encoded in the URL, no account); Print. Phone: native share sheet.
6. View header: UNTangle entry shows schedule name, credits, "Sample sections" tag; standalone entry shows the term Select and "3,048 courses · Updated …" from the data endpoint.

Accept: both entries screenshot-match the mockup at both sizes; adding a section that conflicts shows the conflict before the tap and lays the two events side by side after; the ribbon's minutes equal the Day lens's leg minutes for the same pair; Auto shows three options within 300ms of the click on a mid-range phone and upgrades a figure in place without reflow; the class-number list copies in CourseBlock order; the .ics skips the term's holidays; `?entry=standalone` works with no account and no transcript.

## S5. Day lens

Owns: `frontend/src/app/(lenses)/day/**`, `frontend/src/components/day/**` (DayPanel, DaySwitcher, UpNext, StopCard, LegRow, MapControls), `frontend/src/components/map/**` (MapLibre wrapper, overlays per `apple-maps-web/layers.ts`, camera per `camera.md`).

Mockup: `04-day.html`.

1. Panel (desktop floating frost; phone non-modal Sheet with three detents) and the timeline with the ribbon drawn between cards.
2. UpNext when the selected day is today and a class is ahead, with "Leave by" as the Syne 24 figure.
3. Camera per `MOTION.md` §7 and `camera.md`; a user gesture cancels a flight; pins per `route-and-pins.md`.
4. Day defaults per `?d=` and the H2 rule; "No walking route" and "Not on map" states; Print day; Open in Google Maps.

Accept: the `camera.md` acceptance list (select every stop and leg at both widths, interrupt with a selection and a drag, reduced motion before and during); the sheet's three detents refit the camera once per settle; UpNext appears only for today; the leg text and the Week ribbon agree.

## S6. Schedule library and compare

Owns: `frontend/src/app/schedules/**`, `frontend/src/components/schedules/**`.

Mockup: `05-schedules.html`.

Accept: rename inline commits on Enter and cancels on Esc; two checked rows enable Compare; the compare figures show deltas colored by better/worse; phone rows expose Duplicate and Delete by swipe and by the menu.

## S7. Sign-in

Owns: `frontend/src/app/signin/**`, `frontend/src/components/auth/**`.

Mockup: `06-signin.html`.

Accept: a non-UNT email fails client-side with the help text under the field; "Continue as guest" is visible without scrolling at 390×844; the magic-link button is gone from this page; errors are never a red box.

## Verification for every slice

From `~/.cache/untangle8/e2e`: `npx playwright test --project=chromium --grep @v3-<slice>` at 1440×900 and 390×844; save screenshots to `output/playwright/v3/<slice>/`. Check `prefers-reduced-motion: reduce` once per slice. Run Axe on the slice's main route. On phone, test on hardware once before the PR is marked ready: the sheet drag, the picker, and the standalone entry.
