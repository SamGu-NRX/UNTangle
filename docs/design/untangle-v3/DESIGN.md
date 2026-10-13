# UNTangle v3: design direction

Direction in one line: **three zoom levels of one semester, and the walk is drawn.**

The plan is one object. Courses shows it at semester scale (what is done, what is next). Week shows it at week scale (sections on a grid). Day shows it at day scale (a route across campus with leave-by times). The thing that ties the three together visually is the route ribbon: the same 2px green line that is the walking route on the map also connects consecutive classes in the week grid and the stops in the day timeline, labelled with minutes. Walking time is UNTangle's actual differentiator over every other planner, so it is the thing the eye lands on everywhere, instead of being a number in a stats strip.

Who reads this: the implementers in `HANDOFF.md` order, and the lead judging screenshots. Mockups are in this folder; `MOTION.md` has the motion values; `NOTES.md` has the questions for Sam.

This replaces `docs/design/untangle-v2/DESIGN.md`. What v2 got right and v3 keeps: status is inferred, never entered; Syne only at small sizes for codes, figures and the wordmark; provenance is a tag, not a banner; keyboard actions never animate; the control specs in v2 §4 (Select, Segmented, Slider, Toggle, Date input with term presets) stand unless changed below. Everything in v2 §8 ("remove from today's UI") still applies.

## 1. Hypotheses, each labelled with why

H1. **The third lens is "Day", not "Map".** The map is the material; the day is the subject. A student asks "where am I going next and when do I leave", never "show me a map". The panel's content (stops, walks, leave-by) is the view; the map is its backdrop. Reason: the current Map screenshots already behave this way; the name was the only thing pointing the wrong way.

H2. **On a phone, the app opens on Day when there is a schedule.** Returning students open UNTangle mostly on weekday mornings. Rule: if the plan has sections and it is a weekday between 06:00 and 18:00 local, open Day on today's weekday; otherwise open the last lens used; with no sections, open Courses. Desktop always opens the last lens used (desktop sessions are planning sessions). Reason: the 8 a.m. question in the brief; nothing in Courses helps at 8 a.m.

H3. **Lens order encodes zoom, Courses → Week → Day, on every device.** Left to right is semester → week → day. This is the one place where ordering carries information, so the tab bar keeps it even when Day is the default. Rejected: putting Day first on phone. Tab order that differs by device breaks the mental model when a student moves between laptop and phone.

H4. **One verb, "Auto", in Courses and in Week.** Courses: Auto plans next term's courses. Week: Auto arranges sections and offers three options. Both are plan-scoped transactions with Undo. Reason: Sam asked for one Auto button; a student should not have to learn "Auto-fill" and "Optimize" as two ideas. The result note says what happened in plain words so the shared verb stays honest ("Planned 4 courses" vs "Arranged 5 sections").

H5. **Import is the empty Courses page, not a dialog.** First visit shows one button on an otherwise empty lens. The popup-window flow (decided, see §7) runs as page states, with one primary action at a time. Reason: Sam's "too cluttered of a workflow"; a dialog inside a page inside a popup is three frames for one task.

H6. **Phone Week is the grid, but the day you tap becomes a vertical timeline.** Tapping a day header in the phone grid opens the Day sheet's timeline for that day (same component as Day), with the map hidden. Reason: five 66px columns cannot show times; the timeline can, and it already exists.

H7. **Alternatives replace the constraints rail instead of pushing the grid down.** The rail flips Constraints ⇄ Options. Hovering an option ghosts it onto the grid. Reason: the current strip of three mini-weeks above the grid reflows the grid and the mini-weeks are unreadable.

H8. **Sign-in is one path.** Email and password, "Continue as guest" visible, no magic-link button on the main surface. Reason: Sam found it confusing; two sign-in methods on one screen is a choice the student should not have to make. The magic link can remain as the "Forgot password" path (see `NOTES.md`).

H9. **Named schedules are the first-class object; the plan is the record behind them.** A plan is the student's degree record (statuses from the transcript and the prerequisite engine), one per student. A schedule is a named set of sections for one term ("Mornings", "No Fridays"), many per term, switchable from the chip in the top bar, duplicated, renamed, reordered, compared. "Planned" in Courses means "in the active schedule". Reason: UT Registration Plus's `UserSchedule` (`ScheduleListItem.tsx`, `CalendarSchedules.tsx`) is the thing students actually juggle in registration week, and vsb.untgrades.app's "Saved schedules" is the same object. v2's "plan versions" was this with a worse name.

H10. **Adding a section is one tap from its row, with the conflict shown first.** In the detail panel's section list each row has an Add button; a row that would overlap something in the schedule says "Conflicts with PHYS 2220" before you tap, and hovering it ghosts the section onto the grid behind the panel. Reason: UTRP's add is two steps behind a chart icon (`TableRow.tsx` → `HeadingAndActions.tsx`); its conflict strike-through on the row (`TableRow.tsx:88-94`) is the part worth keeping.

H11. **Course colors come from the department, automatically.** CSCE is always moss, MATH always ochre; the student can override per course from the block in the rail. Reason: UTRP's `colors.ts:306` clusters departments; a student recognizes "the green ones are CS" without a legend. v2 assigned colors in plan order.

H12. **Export is a set, with a register handoff.** One Export menu: Calendar (.ics with term dates and holidays skipped), Image (.png), and Class numbers for myUNT (a copyable list ordered the way myUNT's cart wants it). Reason: UTRP exports .png, .ics with EXDATE holidays, and a .txt of unique numbers; the class-number list is the closest thing to a register button a web app can offer.

## 2. Information architecture

```
Routes
/            → Courses lens (guest or signed in). Empty plan shows the Import page (§7).
/week        → Week lens
/day         → Day lens (?d=mon..fri; defaults per H2)
/schedules   → Schedule library and compare (reached from the schedule chip)
/signin      → Sign-in page
/course/:id  → deep link; opens Courses with the detail panel/sheet on that course
```

The browse → add → schedule → export flow, grounded in UTRP's interactions (see §11):

```
Courses row ──click──▶ DetailPanel ──Add on a section row──▶ Week (section on grid, ribbon drawn)
   ▲                      │ conflict shown on the row before Add; hover ghosts it on the grid
   │                      ▼
   └── search / ⌘K / Quick add by code or class number (from Week too)
Week ──✦ Auto──▶ 3 options in the rail ──Use──▶ grid updates ──Export──▶ .ics / .png / class numbers
Schedule chip ──▶ switch, duplicate, rename, Compare…, Open library (/schedules)
```

```
Desktop 1440
┌────────────────────────────────────────────────────────────────────────────┐
│ UNTangle   [ Courses │ Week │ Day ]                  ● Spring 2027 · v3 ▾  SG │ 56
├────────────────────────────────────────────────────────────────────────────┤
│ view header 48: context left, the lens's primary action right              │
├──────────────────────────────────────────────────────┬─────────────────────┤
│ body (list / grid / map)                             │ detail panel 480    │
└──────────────────────────────────────────────────────┴─────────────────────┘

Phone 390
┌──────────────────────────────┐
│ UNTangle         ● Spring ▾  │ 48 (absent on Day; the chip floats frosted)
│ view header 44               │
│ body                         │
│                              │
│ ▔▔ bottom sheet (details)    │
├──────────────────────────────┤
│  Courses     Week     Day    │ 56 + safe area
└──────────────────────────────┘
```

Rules the shell enforces:

- Switching lenses never animates and never loses selection, scroll or the open detail's subject.
- Each lens has exactly one primary button in its view header: Courses "Auto", Week "Auto", Day none (its primary act is choosing a stop).
- Search lives in the Courses view header, not the top bar. Week and Day have no search. ⌘K opens the same search from anywhere.
- The schedule chip is the only place the active schedule's name, saved state, the other schedules and the library live. States: `saved` (accent dot), `saving` (ink-4 dot), `error` (danger dot), `guest` ("Guest · not saved", ink-4 dot).
- Tapping the active phone tab scrolls its lens to the top; tapping it again on Day resets the camera to the day overview.
- Browser back closes an open sheet or panel before it changes lens.

## 3. Layout

4px base. Desktop content column for Courses is 880px max, left-aligned at 32px when the panel is open, centered when closed. Week rail is 296px; the grid fills the rest; the detail panel over Week is 400px. Day panel floats at 16px inset, 360px wide, max height `100dvh - 56 - 32`.

Breakpoints: `< 720` phone layout (tabs, sheets); `720–1199` desktop layout with panels overlaying instead of pushing; `≥ 1200` panels push.

Row heights: course row 44 desktop, 52 phone. Section row 48. Stop card 60. Option card 72. Grid hour 56 desktop, 48 phone. Everything pressable is at least 44px on coarse pointers.

## 4. Type

DM Sans for all UI, self-hosted, OFL. Syne for the wordmark, course codes, section numbers, pin numbers and figures. No sentence is ever set in Syne. Syne maximum 24px, used once per screen at most (the leave-by figure on Day, the "found" count on import).

```css
--font-body: "DM Sans", system-ui, sans-serif;
--font-display: "Syne", sans-serif;
--text-xs: 11px; --lh-xs: 16px;   /* uppercase labels, tags, letter-spacing .06em */
--text-sm: 12.5px; --lh-sm: 18px; /* meta */
--text-md: 14px; --lh-md: 20px;   /* rows, body */
--text-lg: 15px; --lh-lg: 22px;   /* view header, section titles, weight 600 */
--text-xl: 18px; --lh-xl: 24px;   /* panel title, page title, weight 600 */
--code-sm: 13px;                  /* Syne 700 codes in rows and events */
--code-md: 16px;                  /* Syne 700 codes in cards */
--code-lg: 20px;                  /* Syne 700 panel code, stat figures */
--code-xl: 24px;                  /* Syne 700 the one hero figure */
--wordmark: 22px;                 /* Syne 800; 18px on phone */
```

Numbers, times and credits always use `font-variant-numeric: tabular-nums`.

## 5. Color and elevation

Paste into `frontend/src/app/globals.css`. The canvas moved one step warmer than v2 (`#f4f6f4` → `#f3f5f1`) so app panels and the warm-grey map land (`#eeede9`, from `apple-maps-web/route-and-pins.md`) read as one material instead of cool-over-warm. Contrast figures are from WCAG relative-luminance math, not a run: `--ink-2` 5.5:1 on white, `--brand` 9.6:1, `--danger` 5.9:1, `--warn` 6.0:1, `--accent` 3.1:1 (never text), `--ink-3` 4.2:1 (glyphs, placeholders and dividers only).

```css
:root {
  /* canvas and surfaces */
  --bg: #f3f5f1;
  --surface: #ffffff;
  --surface-2: #edf1ec;      /* hovered rows, insets, kbd */
  --surface-3: #e3e9e2;      /* pressed rows, segmented track */
  --line: #dbe4da;
  --line-strong: #c2d0c2;
  --frost: rgba(255, 255, 255, 0.80);   /* floating panels over the map */
  --frost-edge: rgba(255, 255, 255, 0.60);
  --overlay: rgba(26, 46, 26, 0.32);

  /* ink */
  --ink: #1a2e1a;
  --ink-2: #586e58;
  --ink-3: #6f836d;
  --ink-4: #9aab99;

  /* brand */
  --brand: #00512b;
  --brand-hover: #00703a;
  --brand-soft: #e3efe6;
  --accent: #00a855;         /* focus ring, live dot, taking ring; never text */
  --accent-soft: #e2f6ea;

  /* semantic */
  --warn: #7a5a0f;           /* "check with an advisor" */
  --warn-soft: #f7f0db;
  --danger: #b3261e;         /* conflicts, tight walks */
  --danger-soft: #fbeae8;

  /* route ribbon (the signature) */
  --route: #00512b;
  --route-casing: #ffffff;
  --route-approx-dash: 8 6;

  /* course colors, assigned by department (H11); never as text under 14px */
  --course-1: #3f7a4f; --course-1-tint: #e6f0e8;   /* moss  */
  --course-2: #a3613f; --course-2-tint: #f6ebe4;   /* clay  */
  --course-3: #4b6a8a; --course-3-tint: #e6ecf2;   /* slate */
  --course-4: #8d7325; --course-4-tint: #f5f0e0;   /* ochre */
  --course-5: #7a5272; --course-5-tint: #f1e8f0;   /* plum  */
  --course-6: #3d7a7a; --course-6-tint: #e3f0f0;   /* teal  */
  /* assignment: hash(department) mod 6, with a fixed table for the common UNT departments so
     CSCE=1, ENGL=2, PHYS=3, MATH=4, PSYC=5, BIOL=6; a seventh department in one schedule reuses
     the least-used hue. Per-course override is stored on the schedule. */

  /* spacing */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 20px;
  --s-6: 24px; --s-8: 32px; --s-10: 40px;

  /* radius */
  --r-sm: 6px; --r-md: 10px; --r-lg: 14px; --r-xl: 20px; --r-pill: 999px;

  /* elevation, green-tinted and quiet */
  --shadow-1: 0 1px 2px rgba(26, 46, 26, 0.06);
  --shadow-2: 0 4px 12px rgba(26, 46, 26, 0.08), 0 1px 2px rgba(26, 46, 26, 0.06);
  --shadow-3: 0 16px 40px rgba(26, 46, 26, 0.14), 0 2px 6px rgba(26, 46, 26, 0.08);
  --focus: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent);

  /* layout */
  --topbar-h: 56px; --viewhead-h: 48px; --row-h: 44px;
  --panel-w: 480px; --rail-w: 296px; --day-panel-w: 360px; --tabbar-h: 56px;
}
```

Motion tokens are in `MOTION.md` and are also CSS custom properties.

## 6. Components and states

Names are React component names. `data-state` values are the ones the engineer needs.

### Shell: TopBar, LensSwitcher, PlanChip, BottomTabs
- TopBar 56, `--surface`, 1px `--line` bottom. Wordmark Syne 800 22 `--brand`. On Day on phone there is no TopBar; the PlanChip floats top-right in frost material 8px under the safe area.
- LensSwitcher: segmented, track `--surface-3`, 32 tall, radius 8; the selected pill is one element that moves with `transform` over `--t-hover`; labels never animate. Phone: BottomTabs, 56 + safe area, glyph 22 + label 11, selected `--brand`; no animation.
- ScheduleChip: saved dot 8px + schedule name 13/600 + "· Spring 2027" 13/400 `--ink-2` + caret. Click opens a Menu (origin top-right): the term's schedules as rows (name, "16 cr · 3 days", the active one checked; drag handle on desktop), then New schedule, Duplicate, Rename, Compare…, Open library. Up to 10 per term.

### StatusMark (the six states)
16px glyphs, one family, so the list reads as a legend without a legend:

| state | glyph | word | row treatment |
| --- | --- | --- | --- |
| `done` | filled `--ink-3` disc, white check | Done | meta "Fall 2025 · A" |
| `taking` | `--accent` ring with a centered `--accent` dot | Taking | meta "This term" |
| `planned` | filled `--brand` disc | Planned | meta "Spring 2027"; hover "Remove" |
| `available` | 1.5px `--ink-4` ring | (none) | hover "+ Plan" |
| `covered` | 1.5px `--ink-3` ring with an `--ink-3` check inside | Covered | meta "by CSCE 1040"; tooltip "Counts as done because you passed CSCE 1040" |
| `locked` | 1.5px dotted `--ink-4` ring | Locked | title in `--ink-2`; meta "Needs CSCE 2110" with the code as a link |
| `check` | 1.5px `--warn` ring with a `--warn` "?" | Check | meta "Catalog rule needs an advisor"; tooltip with the rule text |

`override=true` on any state: the word gets a dotted underline and the tooltip "You set this. Click to reset."

### CourseRow, CourseGroup
Row 44 (52 phone, two lines): `[mark 16] [code Syne 13] [title 14] [credits 12.5] … [meta 12.5 ink-2] [word 12.5 ink-2]`. `selected`: `--brand-soft` with a 2px `--brand` inset left. Hover `--surface-2`. Click opens DetailPanel; ↑/↓ move; Enter opens; Space plans/unplans. Group header 36: uppercase 11 name, "5 of 8 done", ProvenanceTag "Degree plan 2024", caret; collapsible.

### AutoButton and AutoNote
Primary button "✦ Auto" in the view header, 36 tall. No menu and no confirmation: it is undoable. States: `idle`; `running` (label "Planning…" in Courses, "Arranging…" in Week, with a 14px spinner, width held, rows keep their old state); `done` (AutoNote appears). AutoNote is a 40px bar under the view header, `--brand-soft`, radius 10: "Planned 4 courses for Spring 2027 · 13 credits." + "Undo" link + ProvenanceTag "From your transcript". It dismisses on next navigation. Partial: "2 courses need an advisor. Review" link. The reveal choreography is in `MOTION.md` §6.

### SearchField and SearchPalette (also Quick add)
Courses and Week view headers: 36px field, ⌕, placeholder "Search courses" (Week: "Add by code or class number"), `kbd` ⌘K. ⌘K anywhere opens the palette (560 wide, top 96, no animation). Sections Courses, Instructors, Buildings; a 5-digit class number matches a section directly and the row's action is "Add §003"; footer kbd hints. Phone: the field is sticky under the view header and opens a full-height search sheet with the keyboard up.

### DetailPanel (course detail, UT Registration Plus quality)
Desktop 480 wide, slides in from the right over `--t-enter`, the list narrows; subject changes swap content with no transition; Esc closes. Phone: BottomSheet at 92%. Sections in order:
1. Head: code Syne 20 `--brand`, StatusMark + word, title 18/600, meta "3 credits · Core". Close ×.
2. Actions: primary "Add to schedule" (adds the course with its first non-conflicting section; the section list below is where you choose) / ghost "Remove from schedule" / disabled "Locked · needs CSCE 2110"; then link-outs "RateMyProf ↗", "Syllabi & CV ↗", "SPOT ↗" (per instructor, following the grade selector; disabled when the section has no instructor, as UTRP does). ↗ appears nowhere else.
3. Needs / Unlocks: two short lists of code chips (Syne 13), each chip re-targets the panel. Rules render as text from the engine ("CSCE 2110 and MATH 1720"). Each code chip carries its own StatusMark, so the prerequisite line is read against the student's own record (done chips are quiet, missing ones are `--warn`). UTRP bolds prerequisite lines in orange (`Description.tsx`); this is the same idea with the student's statuses applied.
4. Description, 14/20 `--ink-2`, 3-line clamp with "More".
5. Grades: section title 15/600, Select "All instructors", "Data source ↗". Figures Avg GPA (Syne 20), students, sections. Six bars A–W in one `--brand` ramp (100/80/60/45/35/25%); hover tooltip with count and percent. Changing instructor crossfades the bars 120ms.
6. Sections this term, ProvenanceTag "Sample". Rows 48: `§003` Syne 13, days and time, instructor ★4.6, building, class number 12.5 `--ink-3` tabular, and an Add button (ghost, 28px; "Added ✓" quiet when in the schedule; "Add anyway" when it conflicts). A conflicting row shows "Conflicts with PHYS 2220" in `--danger` under the time, before any tap. On fine pointers, hovering a row ghosts that section onto the Week grid behind the panel (opacity only, 120ms). Status (open, waitlist, closed) is a 12.5 word, never a chip, and absent while sections are samples.
States: `loading` (head from the row at once; chart and sections shimmer), `error` ("Couldn't load grades. Retry"), `no-grades`, `no-sections` ("No sections listed for Spring 2027 yet").

### ScheduleGrid, ScheduleEvent, WalkRibbon, NoSetTimeStrip
Grid: time gutter 48, Mon–Fri, plus Saturday only when a section in the schedule or a ghost meets on Saturday (the column appears with no animation). Hour rows 56, hairlines `--line`, half-hours dashed. Range: one hour before the earliest class to one hour after the latest, never narrower than 8–5. Event: radius 8, 3px left border `--course-n`, tint fill; code Syne 12, time 11, building 11. Two events that overlap share the column side by side (connected overlap groups, as UTRP's `calendar/utils.ts` does), each with the `conflict` outline. Clicking an event opens the DetailPanel on that course with its section list.
NoSetTimeStrip: under the grid, a 56px row labelled "No set time" (11px uppercase) with the online and asynchronous sections as 140×40 blocks in their department tint. Absent when empty.
WalkRibbon: between two consecutive events in one column, a 2px `--route` line from the end of the first to the start of the second, centered, with a 16px label pill ("4 min", 11px, `--surface`, 1px `--line`). `approx`: dashed. `tight` (walk ≥ gap − 2 min): line and label `--danger`, label 600, tooltip "9 min walk, 10 min gap". `same-building`: no ribbon, a 1px `--line-strong` dotted rule. Ribbons draw only when both events are in the plan; ghosts never get ribbons.
Event states: `selected` (1.5px `--course-n` outline + `--shadow-1`), `locked` (10px lock glyph), `conflict` (`--danger` outline and tint), `ghost` (dashed 1.5px `--course-n` border, no fill, opacity .7, appears with opacity only).

### WeekRail: CourseBlocks, ConstraintRail and OptionsRail (the flipper), ExportMenu
The rail (296) has two parts. Top: "In this schedule", the CourseBlocks: 44px rows with a 3px department-color bar, code Syne 13, `§003` and "Mon Wed Fri 9:00", class number 12.5 `--ink-3` at right; hover reveals lock and remove; drag handle on fine pointers to reorder (order is the export order); clicking the color bar opens a 6-swatch popover to override the department color. "+ Add a course" ghost row at the bottom focuses the view-header search.
Below: Constraints: Time of day segmented [Earlier · Any · Later]; chips (No Fridays, No 8 AMs, Compact days, Short walks, Top-rated profs, Lunch gap); Busy times as chips with × ("Work · Tue 1–5 PM") and "+ Busy time"; two sliders (Earliest start, Max walk); stats strip (credits, earliest, latest, longest day, walking per week as Syne 20 figures). "✦ Auto" primary sits in the view header on every device.
ExportMenu: ghost "Export" in the view header opens a Menu with three rows, each with a one-line description: "Calendar (.ics)" / "Jan 20 – May 7 · holidays skipped"; "Image (.png)" / "The week as a picture"; "Class numbers for myUNT" / "In cart order · 12345, 12398, …". The third opens a 320px popover (phone: sheet) showing the numbers one per line with section and course, and a "Copy" button that crossfades to "Copied" for 1.5s (UTRP's copy→check). Phone: the native share sheet for .ics and .png.
Options (after Auto): header "3 options · best so far" with a 2px indeterminate progress line while the worker runs, then "3 options". Three OptionCards 72: letter badge, one line of figures ("3 days · 35 min walking · 9:00–1:50"), one line of moves ("Moves ENGL 1310, PSYC 1630"), "Use" ghost. Hover ghosts the option onto the grid. Figures that improve while the worker runs crossfade in place (see `MOTION.md` §7). "Back to constraints" link at the top. Phone: Options is a BottomSheet at half.

### DayPanel, StopCard, LegRow, MapPin, UpNext
Desktop: frost panel floating left. Phone: the map fills the screen; DaySheet with detents peek 112, half 50%, full 92%; frost at peek and half, solid at full; map padding bottom equals the sheet height so fly-to centers in the visible area.
- DaySwitcher: segmented Mon–Fri with a 4px dot under days that have classes.
- UpNext (only when the selected day is today and a class is ahead): 56px strip at the top of the list, `--brand-soft`: "Next · ANTH 1010 · GAB 105" and the hero figure "Leave by 11:56 AM" in Syne 24. This is the 8 a.m. answer.
- Summary line 14: "4 stops · 0.8 mi · 17 min walking" + ProvenanceTag "Approx." if any leg is estimated.
- StopCard 60: number badge 26 `--brand` disc Syne 12 white; code Syne 13; title 14; "9:30–10:50 · ENV 120" 12.5. `selected`: 1.5px `--brand` border + `--brand-soft`; selecting flies the camera (`apple-maps-web/camera.md`: 500ms, pitch 45, z ≤ 17.8).
- LegRow between cards: the route ribbon continues from badge center to badge center as a 2px `--route` line; a leg card inset 38: walk glyph, "4 min · 0.2 mi", "Leave by 11:56 AM · 70 min break". `tight`: text 600 and glyph `--danger`, "The walk is 3 min longer than the break." `approx`: dashed ribbon and the tag. `none`: "No walking route. One end isn't on the map." with a grey dotted ribbon.
- MapPin: 28px `--brand` disc, 2.5px white ring, Syne 12 number, a 6px tail dot (lollipop, per v2). `selected` 34px. Route: 7px white casing under a 4px `--route` line, round joins, dashes 8/6 on approximate legs, no animation on the line ever.
- Map controls: 36px frost squares, bottom-right, stacked: +, −, compass, fit.

### Import page (Courses, empty plan)
Specified in §7.

### ScheduleLibrary, ScheduleRow, CompareView
Library at `/schedules`: view header "Schedules · Spring 2027" with a term Select and primary "New schedule". ScheduleRows 64: drag handle (fine pointers), name 14/600 (click to rename inline), "edited 2h ago" 12.5, figures row 12.5 (credits · courses · days · walking · earliest–latest), the active one marked with the accent dot and "Open" disabled as "Active"; overflow Menu (Compare with…, Duplicate, Export…, Rename, Delete with confirm). Checking two rows enables "Compare". Phone: rows with swipe actions (Duplicate, Delete) and the menu.
Compare: two columns with the names as headers; a figures block with deltas (walking "38 → 31 min", `--brand` when better, `--danger` when worse); then a course list where each row shows both sides: same (quiet), added (`--brand-soft`), removed (`--danger-soft` with strikethrough code), section changed ("§003 → §005"). Primary "Open B", ghost "Open A".

### Sign-in page
Wordmark, title "Sign in", one line of value: "Your plans save to your account and follow you between phone and laptop." Fields UNT email, Password. Primary "Sign in". Secondary ghost "Continue as guest". Under the card: "New here? Create account" and "Forgot password?". Errors as 12.5 `--danger` help text under the field, never a red box. No "Create account" tab, no magic-link button.

### Controls
v2 §4 stands for Button, Select, Menu, Segmented, Toggle, Checkbox, Radio, Chip, Slider, Search field, Text field, Date input, Tooltip, kbd, ProgressBar, with these changes: radius for fields is 8 and for buttons is 10 (unchanged); button heights 36 desktop and 44 phone; the Select trigger on coarse pointers wraps a native `<select>` (unchanged). Nothing in the main flows uses a Select except the grade instructor picker and the .ics term preset; everything else that was a dropdown became chips, segmented controls or a menu.

### ProvenanceTag, Toast, EmptyState, Loading
Unchanged from v2 §4. Toast is bottom-center desktop, above the tab bar on phone.

## 7. The import page

Facts the design respects: a web page cannot read the Downloads folder; `showOpenFilePicker({ startIn: "downloads" })` opens a picker already in Downloads on Chrome and Edge and needs a click; elsewhere `<input type=file accept="application/pdf">`; a popup window can be detected closing via `win.closed` polling and page refocus via `visibilitychange`/`focus`.

The page is the Courses lens with an empty plan. No dialog.

| state | what the page shows | primary action |
| --- | --- | --- |
| `idle` | Wordmark-free. Title 18/600 "Bring in your transcript". One line 14 `--ink-2`: "UNTangle reads the PDF on this device. Nothing is uploaded." Below, the quiet alternatives as 13px links: "Pick courses by hand", "I already have the PDF". | "Open myUNT" (opens the popup) |
| `waiting` | Same title; a 36px status row with a 14px spinner: "myUNT is open in another window. Download the unofficial transcript there." The button "Use the downloaded PDF" is present but ghost. | "Use the downloaded PDF" (ghost until return) |
| `returned` (popup closed or page refocused) | The status row becomes "Downloaded it?" with a check-less 16px `--brand` disc; the button turns primary and receives focus so Enter opens the picker. | "Use the downloaded PDF" (primary; opens the picker in Downloads) |
| `drop` (dragging a file anywhere over the page, any state) | Full-page overlay in `--overlay` with a dashed 2px `--surface` frame inset 24px and a centered 18/600 white "Drop the transcript PDF". Appears with opacity 120ms; the frame does not animate. | release |
| `reading` | Title "Reading your transcript". Three 36px steps: "Reading the PDF", "Removing your name and ID", "Matching 14 courses to your degree plan"; each with a 16px disc (done check / spinner / ring). A 12.5 line "This happens in your browser." Ghost "Cancel". | none |
| `review` | Title with the figure: "14 courses found" (the 14 in Syne 24 `--brand`). Summary 12.5: "11 done · 2 taking · 1 didn't match". A list of 40px rows: code, title, term and grade right, StatusMark. The unmatched row is `--danger-soft` with "ELEC 2000 · no match" and two inline ghost buttons "Pick course" (opens the search palette) and "Skip". | "Add 14 courses" |
| `done` | The Courses list renders with the AutoNote "Added 14 courses from your transcript." + Undo. No separate done screen. | (Auto) |
| `error` | Title states what failed: "That file isn't a transcript" or "The PDF has no readable text". Body: the fix: "Download the unofficial transcript from myUNT, not the degree audit." | "Choose another file" + ghost "Open myUNT again" |

Phones: the popup is a new Safari/Chrome tab; on return, `visibilitychange` sets `returned`; the button opens the native picker ("Recents" lists the PDF first on iOS). State lives in `sessionStorage` so backgrounding does not lose it. There is no browser extension anywhere in the product; the PDF arrives only through the picker or a drop.

## 8. Copy rules

- Sentence case everywhere, including buttons and tab labels.
- A button names the verb and the object: "Open myUNT", "Add 14 courses", "Save a version". Never "Submit", "Continue", "OK".
- The verb on a button is the verb in the result: "Save a version" → toast "Saved · Spring 2027 v4 · Undo".
- Status words are one word: Done, Taking, Planned, Covered, Locked, Check.
- Provenance is a tag: From your transcript, Sample, Approx., Degree plan 2024, UNT records 2019–2024.
- Errors state what happened, then the fix, and never apologise.
- Never "AI", "smart", "magic", "optimize". Auto is the verb. Numbers are specific ("17 min walking"), not qualitative ("short walks") except in constraint chips where the student is choosing a preference.
- No sentence describes the product to the student inside the app.

## 9. Phone-first

- Day is the default lens under H2; UpNext is the first thing on screen.
- Viewport `width=device-width, initial-scale=1, viewport-fit=cover`; `100dvh` never `100vh`; `theme-color #f3f5f1`; manifest `display: standalone`, `background_color #f3f5f1`, `theme_color #00512b`.
- Safe areas: TopBar `padding-top: env(safe-area-inset-top)`; BottomTabs and every sheet `padding-bottom: env(safe-area-inset-bottom)`; map control insets add the sheet height.
- Inputs 16px on coarse pointers (stops iOS zoom). `body { overscroll-behavior-y: none }`; scroll containers `overscroll-behavior: contain`.
- `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation` on buttons, rows and tabs, `user-select: none` on tabs, chips and sheet handles.
- Hover styles only inside `@media (hover: hover) and (pointer: fine)`.
- Sheets: pointer capture, a second touch is ignored once a drag began, velocity > 0.11 px/ms dismisses or changes detent regardless of distance, damping 0.3 past the top detent. Scrim only for modal sheets (detail, options, search); none for the DaySheet.
- Thumb zone: primary actions sit in the view header (top) on Courses and Week because the bottom is the tab bar; on Day the sheet's handle and the DaySwitcher are in the thumb zone at peek.

## 10. What UT Registration Plus taught, and what we leave

From the lead's study of UTRP (MIT, commit 1f6fdb0) and vsb.untgrades.app. Adopted, with the UNTangle component that carries it:

| UTRP behavior | UNTangle v3 |
| --- | --- |
| Per-section conflict check, struck-through rows, overlap groups side by side on the grid | Section rows say "Conflicts with X" before Add; grid lays overlaps side by side (ScheduleGrid) |
| Named schedules, up to 10, reorder, rename, duplicate, delete with confirm | ScheduleChip menu and `/schedules` (H9) |
| Course colors by department | H11 |
| Export .png, .ics with RRULE + EXDATE holidays, text of unique numbers | ExportMenu, with the class-number list in cart order (H12) |
| Prerequisite lines highlighted | Needs/Unlocks chips with the student's own StatusMarks |
| Grade distribution with term select and instructor fallback | Grades section; instructor Select with "All instructors" default |
| Labeled link-outs RMP / CES / syllabi | RateMyProf / SPOT / Syllabi & CV, per instructor |
| Quick add by unique number | SearchPalette accepts a class number |
| Async courses in a bottom bar | NoSetTimeStrip |
| Copy → check crossfade | Copy button in the class-number popover |

Left behind: the two-step add behind a chart icon; the map behind Settings; a Mon–Fri-only grid (Saturday appears when needed); a 430px desktop-only popup; local-only storage and `alert()` dialogs; a status legend (StatusMarks carry words). vsb's "Busy times" is kept as a constraint; its Mon–Sun grid is not (Sunday has no UNT sections).

## 11. Rejected

- A single semester canvas (one long page with courses, then grid, then map). Rejected: the three lenses are used at different times and different zoom levels; one scroll would make the 8 a.m. case worse.
- "Today" as a fourth, live lens. Rejected: sections are synthetic and nothing is live; Day on today's weekday with UpNext gives the same answer without promising live data.
- Day first in the phone tab order. Rejected under H3.
- Keeping "Optimize" as the Week verb. Rejected under H4.
- A dialog for import. Rejected under H5.
- The companion extension. Removed from the product; no hidden option, no settings flag.
- Syne headlines, step eyebrows, the wizard footer, per-row status chips and toggles, the departments dropdown, the "Saving…" bar, rainbow grade bars, the six-chip map summary. All still removed per v2 §8.
