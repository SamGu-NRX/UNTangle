# UNTangle v2: build order

Read `DESIGN.md` first; the mockups in this folder are the acceptance reference. Each step names the new components, the files they replace under `frontend/src/`, and what the lead checks in a screenshot. Steps 1–3 unblock everything else; 4–8 can run in parallel after that.

## 1. Tokens, fonts, document shell

- Replace the palette and type variables in `app/globals.css` with the `:root` block from DESIGN.md §3. Keep the Syne and DM Sans imports; add `font-variant-numeric: tabular-nums` on `body`.
- In `app/layout.tsx`: viewport `width=device-width, initial-scale=1, viewport-fit=cover`, `theme-color #f4f6f4`, `apple-mobile-web-app-capable`, a manifest link (`display: standalone`, `background_color #f4f6f4`, `theme_color #00512b`, 192 and 512 icons), `overscroll-behavior-y: none` on body, `100dvh` for full-height layouts.
- Add the `@media (prefers-reduced-motion: reduce)` block: transforms off, opacity 120ms.

Check: no Syne text larger than 22px anywhere; `--ink-3` is not used as text under 14px.

## 2. Controls (`components/ui/`)

Build to `controls.html`. New or replaced:

| Component | Replaces | Notes |
| --- | --- | --- |
| `Button` (primary, ghost, quiet, destructive, split, icon, loading) | `ui/Button.tsx` | `:active` scale .97, 120ms |
| `Select` + `Listbox` | `ui/Select.tsx` | custom on fine pointers, native `<select>` behind the same skin on coarse |
| `Menu` | new | PlanChip menu, Auto-fill caret, every ⋯ |
| `Segmented` | new | one moving pill element, transform 160ms |
| `Toggle` | `ui/Toggle.tsx` | 36×20, knob translateX 16px |
| `Checkbox`, `Radio` | new | 16px |
| `Chip` | new | toggle chips for constraints and term presets |
| `Slider`, `RangeSlider` | new | value bubble while active |
| `SearchField` | `ui/SearchBar.tsx` | opens SearchPalette on desktop, search sheet on phone |
| `TextField` | `ui/Field.tsx` | error as help text, never a red box |
| `DateInput` + `DatePicker` + `TermPresets` | new | native `<input type="date">` on coarse pointers |
| `Tooltip`, `Kbd`, `ProgressBar`, `ProvenanceTag`, `Toast` | `ui/ProgressBar.tsx`, `planner-sample-notice.tsx` | ProvenanceTag replaces the sample-data banner everywhere |
| `StatusGlyph` | `ui/StatusMark.tsx` | glyph only; five states; no text |
| `BottomSheet` | new | detents, pointer capture, velocity dismiss, damping |
| `Dialog` | `ui/Modal.tsx` | origin center, scale .96, no backdrop blur |

Delete: `ui/StepBar.tsx`, `ui/StaggerGroup.tsx`, `ui/ConflictBanner.tsx` (conflicts are row and event states now).

Check: open Select shows a check on the selected option and a right-aligned meta; segmented pill has a 1px shadow; toggle knob is 16px inside a 20px track; focus ring is white 2px then accent 4px.

## 3. App shell

New: `AppShell`, `TopBar`, `ViewSwitcher`, `PlanChip` (+ `PlanMenu`), `BottomTabs`. Replaces `nav-shell.tsx` and `marketing-shell.tsx`. Routes `courses`, `schedule`, `map` render inside the shell; `plans` opens from PlanMenu "Open library". Remove the wizard footer from `courses-client.tsx`, `schedule-client.tsx`, `map-client.tsx`. `app/page.tsx` renders the guest Courses view with `EmptyState`; `landing-client.tsx` is deleted.

Check (desktop): 56px bar, wordmark, three-segment switcher, search trigger with ⌘K, plan chip with saved dot. Check (phone): 48px bar + bottom tabs with safe-area padding; no second row of nav; content starts within 100px of the top.

## 4. Courses view

New: `CourseList`, `CourseGroup`, `CourseRow`, `AutoControl`, `AutoNote`, `SearchPalette`, `EmptyState`. Replaces the list and search in `courses-client.tsx` and `ui/SearchBar.tsx`. `major-selection-modal.tsx` becomes a `Select` in the view header. Build to `courses.html`.

Engine contract the UI needs (see DESIGN.md §4 AutoControl): each course exposes `status`, `override`, `needs: Rule[]`, `unlocks: Course[]`; `Rule` renders to text.

Check: 44px rows, status glyph left, Syne 13 code, right meta ("Fall 2025 · A", "Needs CSCE 2110"), status label right; no chips, no toggle, no "Details" link; hover on an available row reveals "+ Plan"; AutoNote under the header after a run; ⌘K opens with no animation.

## 5. Detail panel (course popup)

New: `DetailPanel`, `GradeChart` (re-skin `grade-chart.tsx` / `grade-chart-canvas.tsx` to the single ramp), `SectionList`, `LinkOuts`. `app/courses/[subject]/[number]/page.tsx` becomes a deep link that opens the Courses view with the panel on that course; `app/instructors/[id]/page.tsx` is replaced by the per-instructor selector plus the three link-outs. Build to `course-popup.html`.

Link-outs: RateMyProf search URL for the instructor; `facultyinfo.unt.edu` profile for Syllabi & CV; SPOT via the same system; "Data source ↗" on the chart.

Check: panel is 520px, list narrows (no scrim); ↑/↓ changes the course without the panel re-animating; bars are one green ramp; instructor select re-draws bars with a crossfade; section rows show conflicts in `--danger` text.

## 6. Week view

New: `ScheduleGrid`, `ScheduleEvent`, `ConstraintRail` (Segmented + Chips + Slider + Optimize), `InPlanList`, `StatsStrip`, `AlternativesCompare`. Replaces the rail and modal in `schedule-client.tsx`, `schedule-section-locks.tsx`, `planner-export-panel.tsx`. `.ics` dialog uses `DateInput` with `TermPresets`. Build to `schedule.html`.

Check: no headline; one ProvenanceTag in the view header; the dismissable first-visit note is the only banner; hour rows 56px with dashed half-hours; events use the course tints with a 3px left border; selected event has a 1.5px outline; hovering an alternative paints a dashed ghost; stats are Syne 20 and never wrap; toast at bottom center with Undo.

## 7. Map view

New: `MapView` (MapLibre GL + OpenFreeMap style with the overrides in DESIGN.md §4), `MapPanel`, `DaySwitcher`, `StopCard`, `RouteLeg`, `MapPin`, `MapSheet`, `MapControls`. Replaces `map-client.tsx` and deletes `map-leaflet-canvas.tsx`; `app/api/map/route` stays. Build to `map.html`.

Check: pale basemap, buildings extruded at zoom ≥ 16 with the camera pitched; frosted panel at 16px inset; route has a white casing, approximate legs dashed; pins are numbered lollipops, shared building shows "2–3"; selected stop flies the map; phone sheet has three detents and the map stays pannable at peek and half.

## 8. Connect

New: `ConnectSheet` with `request`, `handoff`, `progress`, `review`, `done`, `error`, `upload` states; `BrowserCard`, `DropZone`, `StepDots`. Replaces `course-import-panel.tsx` and `transcript-import-client.tsx`; `app/courses/import/page.tsx` becomes a route that opens the sheet over Courses. Build to `connect.html`.

Check: three step dots; the request copy lists Reads / Removes / Keeps; "Upload a PDF instead" visible in request and handoff; the browser card has the myUNT breadcrumb and a single primary; progress has three steps and never says "AI"; the review list flags the unmatched row with a Select; on phone the sheet survives a trip to Safari.

## 9. Plans and auth re-skin

`saved-plans/plans-client.tsx`, `planner-persistence-panel.tsx`: view header instead of headline, primary "Restore" + Menu, Syne 13 codes in diff rows. `auth-shell.tsx`, `auth-client.tsx`, `forgot-password-client.tsx`: DM Sans 18 title, TextField with error help text, no progress bar of four steps.

Check: no Syne above 22px; errors are 12.5px under the field.

## 10. Motion and ship check

Apply DESIGN.md §6 as written; then run `prep-for-prod`. Exits faster than enters; nothing from scale(0); reduced motion verified; no `transition: all`.

## Open items the lead must resolve before step 8

See DESIGN.md §9: landing as the guest Courses view; Plans as a switcher; Auto-fill plans suggestions directly; SPOT and Faculty Information System link patterns.
