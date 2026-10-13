# UNTangle v2: design direction

Direction in one line: **a typeset course catalog you can act on.** The jointv2 identity stays as it is: the UNT greens, Syne for the wordmark and display, DM Sans for everything else, the compact task-first density. What changes is scale and structure. Syne drops from headlines to the things that carry identity (course codes, section numbers, pin numbers, stat figures). The step wizard becomes a shell with three lenses on one plan. The form controls, which today are browser defaults inside a careful page, get drawn to the same standard as the page.

Who reads this: the engineers building tonight and the lead judging screenshots. Mockups are in this folder (`courses.html`, `course-popup.html`, `schedule.html`, `map.html`, `connect.html`, `controls.html`); the build order is in `HANDOFF.md`.

## 1. Principles

1. **The plan is the object; views are lenses.** Courses, Week and Map show one plan. Rule: switching views never loses selection, scroll position, or the open detail panel's subject. There is no "next step" footer; each view's primary action lives in its own header.
2. **Status is inferred, not entered.** Rule: no per-row Done / Taking / Not taken control. Status is computed from the transcript and the prerequisite rules; a student only overrides exceptions, and an override is visibly marked and reversible in one click.
3. **Syne at small sizes only.** Rule: Syne maximum is 24px (the wordmark). Course codes 13px, panel codes 20px, stat figures 20px. No sentence is ever set in Syne.
4. **Provenance is a tag, not a banner.** Rule: data origin ("From transcript", "Sample", "Approx.") is a 20px dotted tag placed once per group header, with a tooltip. The only banner-shaped element in the app is a dismissable first-visit note under the Week header.
5. **Fast where it's frequent, calm where it's rare.** Rule: keyboard actions (⌘K, Esc, arrow keys, view switching) never animate. Panels, sheets and the permission dialog animate under 220ms with transform and opacity only, exits faster than enters.

## 2. Information architecture and app shell

**Decision: three peer views in a persistent shell, with Plans as the plan switcher rather than a fourth step.**

```
Desktop (1440)
┌─────────────────────────────────────────────────────────────────────────────┐
│ UNTangle   [Courses | Week | Map]   ⌕ Search courses  ⌘K     Spring 2027·v3 ▾  SG │ 56px
├─────────────────────────────────────────────────────────────────────────────┤
│ view header (44px): context on the left, the view's primary action on right  │
├─────────────────────────────────────────────────────────────────────────────┤
│ view body: list | week grid | map                     [detail panel 520px]   │
└─────────────────────────────────────────────────────────────────────────────┘

Phone (390)
┌──────────────────────────────┐
│ UNTangle         Spring 27 ▾ │ 48px
│ [search field, when Courses] │
│ view body                    │
│                              │
│ (bottom sheet for details)   │
├──────────────────────────────┤
│  Courses    Week     Map     │ 56px + safe-area
└──────────────────────────────┘
```

Why three, not four. Courses, Week and Map are three ways to look at the same semester, and a student moves between them dozens of times in one sitting. Plans is different: it is a list of *other* plans. Putting it in the segmented control makes it look like a lens when it is a drawer. So the plan name in the top bar is the switcher: click it for a popover listing saved plans with "Compare" and "Open library"; "Open library" goes to `/plans`, which keeps today's library, compare, restore, print and .ics work (Sam likes it) but drops the step framing.

Why the step numbers go. "01 Courses" promises a sequence, and after the first session there is none: a student who just imported a transcript goes to Week, sees a conflict, returns to Courses, swaps a section in Week, checks the walk in Map. A wizard footer ("← Courses / Generate map →") then points the wrong way half the time. The one genuinely sequential moment, first-time setup, is handled by the empty state on Courses and the Connect sheet, not by the shell.

Why ⌘K *and* a list, not ⌘K instead of a list. A command palette retrieves what you already know ("ANTH 1010"); it cannot show a freshman what counts toward the Computer Science core. The list, grouped by degree-plan requirement with "5 of 8 done" counts, is the discovery surface. ⌘K (and the same field on phone) is the retrieval surface: it matches code, title and instructor, and Enter opens the detail panel on that row. The two share one result model so the engineer builds one search.

Why the detail panel is a side panel, not a centered modal. UT Registration Plus uses a modal because the registrar page cannot be reshaped. We can. A side panel keeps the list visible, lets ↑/↓ move between courses with the panel updating in place (no re-animation), and on the Week view lets the alternative you hover ghost onto the grid beside it. On phone the same content is a bottom sheet.

Landing. `/` for a signed-out visitor becomes the Courses view in guest mode with an empty state (Connect to UNT · Upload a PDF · Pick courses by hand). The marketing hero goes; if Sam wants a public page later it lives at `/about` and is not in this scope.

## 3. Tokens

Paste into `frontend/src/app/globals.css`. Contrast notes are from WCAG relative-luminance math, not a run: `--ink-3` (#6b826b) is 4.2:1 on white and fails AA for small text, so it is restricted to glyphs, dividers and placeholders; `--accent` (#00a855) is 3.1:1 and is never used as text on white. Meta text uses `--ink-2` (5.5:1).

```css
:root {
  /* color roles */
  --bg: #f4f6f4;            /* app canvas */
  --surface: #ffffff;       /* rows, panels, sheets */
  --surface-2: #eef2ee;     /* hovered rows, insets, kbd */
  --surface-3: #e6ece6;     /* pressed rows, segmented track */
  --line: #dde8dd;          /* hairlines */
  --line-strong: #c3d2c3;   /* input borders, active chip border */
  --ink: #1a2e1a;           /* titles, codes, primary text */
  --ink-2: #586e58;         /* body and meta text (min for text) */
  --ink-3: #6b826b;         /* glyphs, placeholders, dividers only */
  --ink-4: #93a593;         /* disabled, locked ring */
  --brand: #00512b;         /* primary buttons, pins, route, planned dot */
  --brand-hover: #007a40;
  --brand-soft: #e4f0e8;    /* selected row, planned tint */
  --accent: #00a855;        /* focus ring, live dot, taking ring (never text) */
  --accent-soft: #e3f6eb;
  --danger: #b3261e;        /* conflict text and ring */
  --danger-soft: #fbeae8;
  --overlay: rgba(26, 46, 26, 0.32);

  /* course colors: one per course in a plan, assigned in plan order, never as text under 14px */
  --course-1: #3f7a4f; --course-1-tint: #e6f0e8;   /* moss */
  --course-2: #a3613f; --course-2-tint: #f6ebe4;   /* clay */
  --course-3: #4b6a8a; --course-3-tint: #e6ecf2;   /* slate */
  --course-4: #8d7325; --course-4-tint: #f5f0e0;   /* ochre */
  --course-5: #7a5272; --course-5-tint: #f1e8f0;   /* plum */
  --course-6: #3d7a7a; --course-6-tint: #e3f0f0;   /* teal */

  /* type */
  --font-body: "DM Sans", system-ui, sans-serif;
  --font-display: "Syne", sans-serif;
  --text-xs: 11px;   --lh-xs: 16px;   /* uppercase labels, tags; letter-spacing .06em */
  --text-sm: 12.5px; --lh-sm: 18px;   /* meta */
  --text-md: 14px;   --lh-md: 20px;   /* rows, body */
  --text-lg: 15px;   --lh-lg: 22px;   /* view header, panel section titles */
  --text-xl: 18px;   --lh-xl: 24px;   /* panel course title */
  --code-sm: 13px;                     /* Syne 700, course code in rows and events */
  --code-lg: 20px;                     /* Syne 700, course code in panel, stat figures */
  --wordmark: 22px;                    /* Syne 800 */

  /* spacing (4px base) */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 20px;
  --s-6: 24px; --s-8: 32px; --s-10: 40px;

  /* radius */
  --r-sm: 6px;    /* chips, inputs, kbd, tags */
  --r-md: 10px;   /* rows, events, buttons */
  --r-lg: 14px;   /* panels, sheets, dialogs, floating map panel */
  --r-pill: 999px;

  /* elevation (green-tinted, quiet) */
  --shadow-1: 0 1px 2px rgba(26,46,26,.06);
  --shadow-2: 0 4px 12px rgba(26,46,26,.08), 0 1px 2px rgba(26,46,26,.06);
  --shadow-3: 0 16px 40px rgba(26,46,26,.14), 0 2px 6px rgba(26,46,26,.08);

  /* motion */
  --ease-out: cubic-bezier(.23, 1, .32, 1);
  --ease-in-out: cubic-bezier(.77, 0, .175, 1);
  --ease-sheet: cubic-bezier(.32, .72, 0, 1);
  --t-press: 120ms; --t-hover: 160ms; --t-enter: 200ms; --t-exit: 150ms; --t-sheet: 260ms;

  /* layout */
  --topbar-h: 56px; --viewhead-h: 44px; --row-h: 44px; --panel-w: 520px;
  --rail-w: 296px; --map-panel-w: 368px; --tabbar-h: 56px;
  --focus: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent);
}
```

## 4. Components

Names are the React component names for the handoff. States are listed as `data-state` values where the engineer needs them.

### AppShell: TopBar, ViewSwitcher, PlanChip, BottomTabs
- TopBar 56px, `--surface`, 1px `--line` bottom. Wordmark Syne 800 22px `--brand`. ViewSwitcher is a segmented control (track `--surface-3`, radius 8, 32px tall; selected pill `--surface` with `--shadow-1`, label DM Sans 600 13px `--ink`; unselected `--ink-2`). The selected pill moves with `transform` over `--t-hover` ease-out; labels never animate.
- Search trigger: 36px tall, 280px wide, `--surface-2`, placeholder "Search courses" + `kbd` ⌘K. On Week and Map it collapses to an icon button.
- PlanChip: plan name 13px 600 + saved-state dot (8px: `--accent` saved, `--ink-4` saving, `--danger` error) + caret. States: `saved | saving | error | guest` ("Guest plan · not saved"). Click opens PlanMenu popover (origin top-right): Rename, Save a copy, list of saved plans with "Compare" and "Open", "Open library".
- BottomTabs (phone): 56px + `env(safe-area-inset-bottom)`, three tabs with 20px glyph and 11px label; selected `--brand`. No animation.

### CourseRow
44px desktop, 52px phone (two lines). Grid: `[status 16] [code Syne 13] [title 14 ink] [credits 12.5 ink-2] ... [right meta 12.5 ink-2] [status label 12.5 ink-2] `.
- `status=done`: filled `--ink-3` disc with white check; right meta "Fall 2025 · A".
- `status=taking`: half-filled `--accent` ring; right meta "This term".
- `status=planned`: filled `--brand` disc; right meta "Spring 2027"; label "Planned". Hover reveals "Remove" ghost button.
- `status=available`: 1.5px `--ink-4` ring; hover reveals "+ Plan" ghost button; right meta empty.
- `status=locked`: 1.5px dotted `--ink-4` ring, title `--ink-2`; right meta "Needs CSCE 2110" with the code as a link that opens that course.
- `override=true` (any status): the status label gets `text-decoration: underline dotted`; tooltip "You set this. Click to reset."
- `selected`: background `--brand-soft`, 2px `--brand` left inset. Hover: `--surface-2`. Focus: `--focus` ring inside the row.
- Click anywhere opens DetailPanel; ↑/↓ moves selection; Enter opens; Space toggles plan on available/planned.

### CourseGroup
Header 36px, uppercase 11px `--ink-2` name ("Core", "Math", "Science", "Electives"), count "5 of 8 done", a ProvenanceTag ("Degree plan 2024"), caret. Collapsible; remembers state.

### AutoControl
Split button in the Courses view header: primary "✦ Auto-fill" + caret. Click runs immediately (no confirm; it is undoable). Caret menu: "From UNT (Connect)", "From a transcript PDF", "Suggest next term only", "Clear auto status". States:
- `idle` (no data): primary and the only emphasized control; the list shows the EmptyState.
- `running`: label "Filling…" with the 14px spinner, button disabled, rows keep their old state (no skeletons).
- `done`: a one-line AutoNote under the view header, `--brand-soft` background, radius 8: "Filled 11 courses from your transcript and planned 4 for Spring 2027." + "Undo" link + ProvenanceTag "From transcript". Dismisses on next navigation.
- `partial`: same note, with "2 courses didn't match your degree plan. Review" link.
Rules the engine exposes to the UI, so the design ports to any school: each course has `needs: Rule[]` and `unlocks: Course[]`; a `Rule` renders as text ("CSCE 2110 and MATH 1720", "MATH 1710 or placement"). The UI never embeds a UNT-specific rule.

### SearchPalette (⌘K)
Centered, 560px wide, top 96px, `--surface`, radius 14, `--shadow-3`, overlay `--overlay` with no blur. Input 48px with ⌕ and `esc` kbd. Sections "Courses", "Instructors", "Buildings". Item 40px: code, title, right meta (status or "Needs X"). Footer kbd hints: ↑↓ move, ↵ open, ⌘↵ plan/unplan. **No open or close animation.** On phone the top search field opens a full-screen sheet with the same list and the keyboard up.

### DetailPanel (course popup)
Desktop: 520px, slides in from the right over `--t-enter` with `translateX(16px) → 0` + opacity; the list narrows (no overlay). Exit 150ms. When the subject changes while open, content swaps with no transition. Phone: BottomSheet at 92%.
Sections in order (mirrors UT Registration Plus):
1. Head: code Syne 20 `--brand`; status glyph + label; title 18/24 600; meta line 12.5 `--ink-2`: "3 credits · Core · Needs **CSCE 2110** and **MATH 1720** · Unlocks **CSCE 4110**, **CSCE 4310**" (codes are links that re-target the panel). Close ×.
2. Actions row, the UNT equivalents of UT Registration Plus's four: primary "Add to Spring 2027" (or ghost "Remove from plan" if planned; disabled "Locked · needs CSCE 2110" if locked), then ghost link-outs "RateMyProf ↗" (search URL for the selected instructor), "Syllabi & CV ↗" (UNT Faculty Information System, `facultyinfo.unt.edu`, public under Texas HB 2504), "SPOT ↗" (course evaluations, same system). Link-outs are per instructor: they follow the instructor chosen in the grade selector, and default to the section's instructor. External links open new tabs and show the ↗ glyph; nothing else in the app uses it.
3. Description: 14/20 `--ink-2`, clamped to 3 lines with "More".
4. Grade distribution: section title 15/22 600, a Select "All instructors" (per-instructor; changing it re-draws bars in place with a 120ms opacity crossfade), and a "Data source ↗" link to the UNT grade-records page. Figures row: Avg GPA (Syne 20), students, sections. Chart: 6 bars A B C D F W, single ramp of `--brand` at 100/80/60/45/35/25% opacity, grid lines `--line`, labels 11px. No rainbow. Hover shows count and percent in a Tooltip.
5. Sections this term: ProvenanceTag "Sample" on the header. Rows 48px: radio, `§003` Syne 13, days/time 14, instructor + rating (★ 4.6 13px), building, "Conflicts with PHYS 1710" in `--danger` when applicable. Selecting a radio updates the plan.
States: `loading` (head renders from the list row immediately; chart and sections show a 2-line shimmer each), `error` ("Couldn't load grades. Retry"), `no-grades` ("No grade records for this course yet").

### ScheduleGrid and ScheduleEvent
Grid: time gutter 48px, 5 day columns, hour rows 56px, hairlines `--line`, half-hour hairlines dashed. Range: one hour before the earliest class to one hour after the latest, never narrower than 8–5. Day header 32px uppercase 11px.
Event: radius 8, 3px left border in `--course-n`, background `--course-n-tint`, padding 6px 8px; line 1 code Syne 12 `--ink`, line 2 time 11px `--ink-2`, line 3 building 11px `--ink-2` (drops at <60px tall).
- `selected`: 1.5px `--course-n` outline + `--shadow-1`.
- `locked`: 10px lock glyph top-right.
- `conflict`: 1.5px `--danger` outline, tint `--danger-soft`.
- `ghost` (hovered alternative): dashed 1.5px `--course-n` border, no fill, opacity .7; appears with opacity only, 120ms; nothing else moves.
- After a swap the old event fades out 120ms and the new one fades in; no FLIP movement.
Phone: columns ≈66px, events show code only (Syne 10) and start time (9px); tap opens the sheet.

### ConstraintChips and OptimizeButton
Left rail "Constraints": Time of day segmented [Earlier · Any · Later]; toggle chips 28px tall, radius pill, `--surface` with `--line-strong` border; selected `--brand-soft` with `--brand` border and text, check glyph. Chips: No Fridays, No 8 AMs, Compact days, Short walks, Top-rated profs, Lunch gap. "Optimize week" primary, enabled only when the chip set differs from the last run; `running` shows spinner; result arrives as Toast "Optimized · 3 sections moved · Undo".
Below: "In this plan" list with section number and a lock toggle that appears on hover (locked ones show it always). Stats strip: 2×3 grid, figures Syne 20 (credits, earliest, latest, longest day, walking/week), labels 11px uppercase. Export: "Print" and ".ics" as two ghost buttons on one line.

### AlternativesCompare
Lives at the top of the DetailPanel when opened from an event. Header "Alternatives for CSCE 2100", ProvenanceTag "Sample". The current section is pinned first in `--brand-soft`. Then exactly three alternatives ranked by the active constraints, each a 2-line row: `§003 · Tue Thu 11:00–12:20 · M. Delgado ★4.6 · GAB 550` / delta line: "No conflicts · same walk" or "Conflicts with PSCI 2305" (`--danger`) or "+6 min walking". Right: "Use" ghost button. Hovering a row paints the `ghost` event on the grid. "Show all 6 sections" link expands to the full list. Phone: same rows in the sheet, ghost preview omitted.

### MapView, MapPanel, StopCard, RouteLeg, MapPin
The reference is Apple Maps, not Google Maps: a calm pale basemap, soft 3D buildings at street zoom, frosted floating panels, a route with a white casing, and card-style legs.
- Desktop: MapLibre GL fills the view below the TopBar. MapPanel floats at 16px inset, `--map-panel-w`, radius 14, `--shadow-2`, max-height `calc(100vh - 56px - 32px)`, internal scroll. Material: `background: rgba(255,255,255,.78); backdrop-filter: blur(24px) saturate(1.4)` with a 1px `rgba(255,255,255,.6)` inner border; `@supports not (backdrop-filter: blur(1px))` falls back to solid `--surface`. The panel is static, so the blur cost is paid once per frame of map movement only; if a device drops frames while panning, the fallback is the solid surface, not a lighter blur. Zoom and compass controls bottom-right: 36px squares in the same frosted material, stacked, radius 10. Attribution bottom-right 11px.
- Basemap (MapLibre style, OpenFreeMap "positron" or "bright" as the base, then overrides): land `#f2f3ef`, water `#cfe1ee`, parks `#dcebd6`, campus/university landuse `#eef1e8`, building fill `#e9ebe6` stroke `#d7dad3`; roads white 2–6px with `#dddfd9` casing; road labels DM Sans Medium 12 `#6b6f66` with a 1.5px white halo; building short codes (GAB, BLB, LANG) as symbol labels at zoom ≥ 15 in DM Sans 600 11 `--ink-2`. At zoom ≥ 16 buildings render as `fill-extrusion` with height from the data or 12m default, color `#e6e8e3`, opacity .9, and the camera pitches to 45° on fly-to; below 16 the pitch returns to 0. Pins and route lines sit on top of extrusions.
- MapPanel: DaySwitcher segmented Mon–Fri (32px); summary line 14px "4 stops · 0.5 mi · 10 min walking" with ProvenanceTag "Approx." when any leg is estimated; then the timeline as cards.
- StopCard 60px, radius 10, `--surface` at 100% (cards are solid, the panel is frosted): number badge 26px `--brand` disc with Syne 12 white number; code Syne 13; title 14; line 2 "9:00–9:50 · LANG 316" 12.5 `--ink-2`. `selected`: 1.5px `--brand` border and `--brand-soft`; selecting flies the map to the pin (MapLibre `flyTo`, 600ms, pitch 45 at zoom 17; this is a camera move, not UI motion). Hover raises the pin (scale 1.1).
- RouteLeg between cards: a 2px `--line-strong` rule from badge center to badge center, with a 28px leg card inset left 38px: walk glyph, "4 min · 0.2 mi" 12.5 `--ink-2`; `same-building`: "Same building · 10 min between"; `approx`: ProvenanceTag "Approx." and the map segment is dashed; `tight` (walk ≥ gap − 2 min): text `--ink` 600 and the glyph `--danger`, "9 min walk, 10 min gap".
- MapPin: 28px `--brand` disc, 2.5px `--surface` ring, `--shadow-2`, Syne 12 white number, a 6px white-ringed tail dot below (Apple's pin reads as a lollipop, not a teardrop). Two stops in one building share a pin labelled "2–3". `selected`: 34px, `--accent` fill. Route line: two layers, a 7px white casing at 90% under a 4px `--brand` line, round joins and caps; approximate segments dashed 8/6 on the inner line only. Start and end get 8px white-ringed dots.
- Phone: map full-screen behind; MapSheet with three detents: peek 112px (handle, DaySwitcher, summary line), half 50%, full 92%. The sheet uses the frosted material at peek and half, solid at full. Map padding bottom equals the sheet height so fly-to centers in the visible area; the map keeps pointer events at peek and half.

### BottomSheet
Phone container for DetailPanel, AlternativesCompare, MapPanel, ConstraintChips. Radius 14 top, `--surface`, `--shadow-3`, handle 36×4 `--line-strong` at 8px. Enter `translateY(100%) → 0` over `--t-sheet` `--ease-sheet`; exit 200ms same curve. Drag: pointer capture, velocity > 0.11 px/ms dismisses, damping past the top detent (0.3 factor). Scrim `--overlay` only for DetailPanel and Alternatives (modal use); none for MapSheet (map stays interactive).

### ConnectSheet (Connect to myUNT)
The model is BevoFit's in-app browser sheet: the student never feels they left the app. A web app cannot read myUNT's pages (no iframe, no cross-origin fetch), so the sheet is a handoff: it opens myUNT's transcript page in a separate window, notices when the student comes back, and takes the downloaded PDF from a file pick (opening in Downloads where the browser allows) or a drop anywhere on the page. A web page can't read the Downloads folder itself. The upload fallback is never more than one tap away in every state.

Container: desktop centered dialog 480px, `transform-origin: center`, enter `scale(.96) + opacity` 200ms ease-out, exit 150ms, scrim `--overlay` without blur. Phone: BottomSheet at 92% with the handle. A 3-step StepDots row at the top (Open · Import · Review; 6px dots, current `--brand`, done `--brand` with a 1px ring, pending `--line-strong`) stays fixed while the content below crossfades between states over 160ms with a 2px blur at the midpoint. The box never animates its height; it snaps.

- `request`: 40px app mark (the wordmark "U" on `--brand-soft`); title 18/24 600 "UNTangle will import your unofficial transcript"; body 14 `--ink-2` "It opens myUNT in a new tab. You download the PDF there; it lands back here." Access list, 3 rows of 36px, glyph + 14 `--ink`: "Reads: course codes, terms and grades from the PDF", "Removes: your name, ID and address before anything is matched", "Keeps: the course list, on this device and in your plan". A quiet 12.5 line: "It never sees your myUNT password." Footer: ghost "Not now" left, primary "Continue" right (autofocus; Enter continues; Esc = Not now). Below the buttons a 12.5 link: "Upload a PDF instead".
- `handoff`: a BrowserCard, which is the in-app-browser feel: 1px `--line` frame, radius 10, a 36px chrome row with three 8px `--line-strong` dots, a URL pill "my.unt.edu › Academic Records › Unofficial Transcript" in `--surface-2`, and a body with the UNT mark and the single primary "Open myUNT ↗". Under it a DropZone 96px: dashed 1.5px `--line-strong`, radius 10, "Drop the transcript PDF here" + ghost "Choose file". Footer: ghost "Back", no primary (the primary is in the card). While waiting after the tab opened, the card body shows a 14px spinner + "Waiting for the download…" and the DropZone stays.
- `progress`: title "Reading your transcript"; 3 steps, 36px each: done = 16px `--brand` check disc, active = 16px spinner at 0.8s/turn, pending = `--ink-4` ring; text 14: "Reading the PDF", "Removing your name and ID", "Matching 14 courses to your degree plan". A 12.5 line: "This happens in your browser. The PDF is not uploaded." Ghost "Cancel". Copy never says "AI".
- `review`: title "14 courses found"; summary 12.5 `--ink-2` "11 done · 2 in progress · 1 didn't match"; a scrolling list (max 320px) of 40px rows: code Syne 13, title 14, term + grade 12.5 right, status glyph. The unmatched row has a `--danger-soft` tint, "ELEC 2000 · no match" and an inline Select "Pick a course" (or "Skip"). Footer: ghost "Cancel", primary "Add 14 courses".
- `done`: 40px `--brand` check disc; title "Added 14 courses"; body "4 are planned for Spring 2027. Adjust any you don't want in Courses."; primary "Go to courses", ghost "Close". Landing on Courses shows the AutoNote.
- `error`: 40px `--danger-soft` disc with a `--danger` glyph; title states the failure ("That file isn't a transcript", "The PDF has no readable text"); body 14 gives the fix ("Download the unofficial transcript from myUNT, not the degree audit."); primary "Choose another file", ghost "Open myUNT again". Nothing in the plan changes on error.
- `upload` (the fallback entry from any state): same as `handoff` without the BrowserCard; the DropZone is the whole body, 160px tall.
Phone specifics: the new tab is Safari, so the sheet must survive backgrounding (state in `sessionStorage`); on return the sheet is where the student left it. The DropZone becomes a 48px primary "Choose the PDF" with the hint "It's in Files › Downloads" 12.5 `--ink-2`.

### ProvenanceTag
20px tall, radius 6, 1px dotted `--line-strong`, text 11px `--ink-2`, 0 6px padding; optional 10px glyph. Values: `From transcript`, `From UNT`, `Sample`, `Approx.`, `UNT records 2019–2024`, `Degree plan 2024`. Tooltip explains the source in one sentence. Appears once per group header or panel section, never per row, never full-width.

### Toast
Bottom-center, 44px, `--ink` background, white 13px text, radius 10, `--shadow-3`; optional action in `--accent-soft` color. Enter `translateY(8px) + opacity` 200ms ease-out; exit 150ms; one at a time; pauses on hover and when the tab is hidden.

### EmptyState, ErrorState, Loading
- EmptyState (Courses, no data): 480px card centered at 120px from the view header, title 15/22 600 "Start with what you've taken", three 56px option rows: "Connect to UNT" (primary row, `--brand-soft`), "Upload a transcript PDF", "Pick courses by hand". No illustration.
- EmptyState (Week, no planned courses): "Nothing planned yet. Add courses in Courses or run Auto-fill." with a "Go to Courses" link; the grid still renders.
- ErrorState (inline): 14 `--ink` sentence stating what failed and the one fix, with a "Retry" ghost button; `--danger-soft` background only for conflict rows and the fallback dialog. Auth errors render under the field as 12.5 `--danger` help text, not a red box.
- Loading: shimmer `--surface-2`/`--surface-3` 1.2s linear only for rows that have no cached data; buttons show a 14px inline spinner; no full-page spinners except the first load of a plan (centered 20px spinner, no copy).

### Controls (ui/)
Today the page is careful and the controls inside it are browser defaults: a native `<select>` with the OS caret, radio cards, a stock toggle. These are the replacements. All of them share: 36px tall (32px small), radius 8 for fields and 10 for buttons, 1px `--line-strong` border, `--surface` fill, 14px text (16px on coarse pointers so iOS does not zoom), focus `--focus`, disabled = `--surface-2` fill + `--ink-4` text + no hover, `:active` scale .97 over 120ms on anything pressable. Mockup: `controls.html`.

- **Button.** Primary `--brand` text white, hover `--brand-hover`; ghost `--surface` + `--line-strong`, hover `--surface-2`; quiet (no border) hover `--surface-2`; destructive ghost with `--danger` text; link `--brand` 13px 600 underline on hover. Icon button 36 or 32 square. Split button: primary with a 28px caret segment separated by a 1px `rgba(255,255,255,.25)` rule. Loading: label swaps to a 14px spinner + verb ("Filling…") with the width held.
- **Select.** Trigger looks like a field with the value 14 `--ink` and a 16px chevron `--ink-3` at right; hover border `--ink-4`; open: border `--brand`. The menu is a Listbox popover anchored to the trigger (`transform-origin` top-left), `--surface`, radius 10, `--shadow-2`, 1px `--line`, 4px padding, min-width = trigger, max-height 320 with internal scroll; options 32px, radius 6, 13px, hover `--surface-2`, selected 600 weight with a 14px `--brand` check at right; optional 12px meta on the right of an option ("4 sections"); typeahead; Home/End. Enter `scale(.97) + opacity` 160ms, exit 120ms. On coarse pointers the trigger wraps a native `<select>` (the OS picker is the right control on a phone) styled identically, chevron included.
- **Dropdown menu.** Same popover as Listbox. Items 32px with an optional 16px glyph at left and a `kbd` shortcut at right; separators 1px `--line` with 4px margins; a destructive item in `--danger`; a disabled item `--ink-4`. Used by PlanChip, AutoControl's caret, and every "⋯" overflow.
- **Segmented control.** Track `--surface-3`, radius 8, 32px (28 small), 2px padding; segments 13px 600, `--ink-2`, min-width 56; the selected pill is one element, `--surface`, radius 6, `--shadow-1`, text `--ink`, moving with `transform` over 160ms ease-out; segments themselves never animate. Full-width on phone with equal segments. Used by ViewSwitcher, DaySwitcher, Earlier/Any/Later.
- **Toggle.** 36×20 pill track; off `--line-strong`, on `--brand`; knob 16px `--surface` with `--shadow-1`, `translateX(16px)` over 160ms ease-out; label at left 14 `--ink`, optional description 12.5 `--ink-2` under it; hit area the whole row. Only for true binary settings; never for a status with three values.
- **Checkbox and radio.** 16px; checkbox radius 4, checked `--brand` fill with a white check, indeterminate a white 8×2 bar; radio ring 1.5px `--line-strong`, checked `--brand` ring with a 6px `--brand` dot. Transitions 120ms on background only.
- **Chip.** 28px pill, 13px; off `--surface` + `--line-strong`; on `--brand-soft` + `--brand` border and text with a 12px check at left that appears with the state (no slide); counting chips show "· 3" meta. A chip group wraps with 6px gaps.
- **Slider.** Track 4px pill `--line-strong`, filled part `--brand`; thumb 18px `--surface`, 1.5px `--brand` border, `--shadow-1`; hover `scale(1.1)`; active `scale(1.15)` plus a value bubble above (`--ink` background, white Syne 12, radius 6, 4px tail) that appears with opacity 120ms; keyboard arrows step, Shift steps ×5; min/max labels 11px `--ink-2` under the ends; optional ticks 1px `--line-strong`. Range variant has two thumbs and fills between. Used for "Earliest start" and "Max walk between classes".
- **Search field.** Field with ⌕ 16px `--ink-3` at left, placeholder `--ink-3`, `kbd` ⌘K at right on desktop; a 20px clear × replaces the kbd when non-empty; loading swaps ⌕ for a 14px spinner; 40px on phone. Focus opens the SearchPalette on desktop and the search sheet on phone.
- **Text field.** Label 12.5 600 `--ink` above with 4px gap; help or error 12.5 under; error border `--danger`, text `--danger`; leading or trailing adornments 16px `--ink-3`. Never a red box around a sentence.
- **Date input.** A text field showing "Jan 20, 2027" with a 16px calendar glyph; typing accepts `1/20/27`; click opens a DatePicker popover (origin top-left): month header 15/600 with ‹ › 28px quiet icon buttons, weekday row 11px uppercase `--ink-2`, day cells 32px radius 6, today 1px `--brand` ring, selected `--brand` fill white, a range fills `--brand-soft` between the two dates with the ends in `--brand`. Above the calendar, TermPresets chips ("Spring 2027 · Jan 20–May 7", "Summer 2027", "Fall 2027") fill both dates in one tap, so the .ics dialog's first field is a chip, not a blank date. Presets come from the school config. On coarse pointers the field wraps native `<input type="date">`.
- **Tooltip.** 24px, `--ink` background, white 12px, radius 6, max-width 240; 400ms delay on the first, instant on adjacent ones; opacity 125ms; never contains the only copy of an instruction.
- **kbd.** 11px, `--surface-2`, radius 4, 1px `--line`, 18px tall.
- **ProgressBar.** 4px pill track `--surface-3`, fill `--brand`; indeterminate is a 30% segment sliding at 1.2s linear (constant motion is the one place linear is right).
- **Numbers.** `font-variant-numeric: tabular-nums` on every column of numbers, times and credits.

## 5. Mobile and installable behavior

The phone build should feel installed, not like a site in Safari. These are the rules; most are a line each.

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; `<meta name="theme-color" content="#f4f6f4">`; `apple-mobile-web-app-capable` yes and `apple-mobile-web-app-status-bar-style` default; a manifest with `display: standalone`, `background_color #f4f6f4`, `theme_color #00512b`, 192/512 icons and an apple-touch-icon.
- Safe areas: TopBar adds `padding-top: env(safe-area-inset-top)`; BottomTabs and every BottomSheet add `padding-bottom: env(safe-area-inset-bottom)`; the map's bottom control inset includes the sheet height plus the safe area.
- Height is `100dvh`, never `100vh`.
- Inputs on coarse pointers are 16px, which is what stops iOS from zooming on focus; the desktop size stays 14.
- `body { overscroll-behavior-y: none }` so pull-to-refresh does not fight the sheet; scrolling containers get `overscroll-behavior: contain` and `-webkit-overflow-scrolling: touch`.
- `-webkit-tap-highlight-color: transparent`; `touch-action: manipulation` on buttons, tabs and rows; `user-select: none` on tabs, chips and the sheet handle so a long press does not select text.
- Hover styles only inside `@media (hover: hover) and (pointer: fine)`.
- Sheets use pointer capture and velocity dismissal (> 0.11 px/ms), damping past the top detent, and ignore a second touch once a drag has started.
- `@media (display-mode: standalone)` hides the "Add to Home Screen" hint on the Courses empty state.
- The new tab from ConnectSheet returns to a sheet that is still open: state lives in `sessionStorage`, re-hydrated on `visibilitychange`.

## 6. Motion

| Interaction | Animates? | Properties | Duration / easing |
| --- | --- | --- | --- |
| Button press | yes | transform scale .97 | 120ms ease-out |
| Row hover | background only | background-color | 160ms ease |
| ViewSwitcher pill | yes | transform | 160ms ease-out; content swap is instant |
| ⌘K open/close | **no** | | |
| View change (Courses→Week) | **no** | | |
| List filter/sort | **no** | | |
| DetailPanel enter / exit | yes | translateX 16px→0 + opacity | 200ms / 150ms ease-out |
| DetailPanel subject change | **no** | | |
| BottomSheet enter / exit / drag settle | yes | translateY | 260ms / 200ms / 240ms ease-sheet |
| ConnectSheet enter / exit | yes | scale .96→1 + opacity, origin center | 200ms / 150ms ease-out |
| ConnectSheet state change | yes | opacity + 2px blur crossfade | 160ms ease |
| Popover, Listbox, Dropdown, DatePicker | yes | scale .97→1 + opacity, origin at trigger | 160ms / 120ms ease-out |
| Segmented pill, Toggle knob | yes | transform | 160ms ease-out |
| Slider thumb hover / value bubble | yes | transform / opacity | 120ms ease-out |
| Checkbox, radio, chip state | background only | background-color | 120ms ease |
| Tooltip | yes | opacity | 125ms; instant when adjacent |
| Grade chart instructor change | yes | opacity crossfade of bars | 120ms ease |
| Toast | yes | translateY 8px + opacity | 200ms / 150ms ease-out |
| Ghost event on alternative hover | yes | opacity | 120ms ease-out |
| Event swap | yes | opacity out, opacity in | 120ms each, no movement |
| Map fly-to | yes (MapLibre) | camera | 600ms, MapLibre default |
| Map sheet detents | yes | translateY | 240ms ease-sheet |
| Stagger on first list render | **no** (lists are often 100+ rows) | | |

Rules: only `transform` and `opacity` (plus `background-color` on hover). Exits are faster than enters. Nothing scales from 0. `@media (prefers-reduced-motion: reduce)`: all translate and scale become none; opacity transitions stay at 120ms; MapLibre `flyTo` becomes `jumpTo`.

## 7. Screens

### Courses, 1440
TopBar 56. View header 44: left "Computer Science, BS" 15/600 + "42 of 120 credits" 12.5 + a 120×4 progress bar; right AutoControl + ghost "Import PDF". AutoNote (when present) 36px. List is max 880px, left-aligned at 32px when the panel is open, centered when closed. Groups: Core, Math, Science, Electives. Rows 44px, 1px `--line` between. DetailPanel 520 on the right, full height below TopBar.

### Courses, 390
TopBar 48 (wordmark, PlanChip). Search field 40px sticky under the bar with ⌕ and "Search courses". A 36px row: AutoControl small + "Import" link. Groups and 52px two-line rows (line 1: glyph, code, status label right; line 2: title, meta). BottomTabs. Detail is a BottomSheet.

### Week, 1440
View header: left "Spring 2027 · 16 credits" + ProvenanceTag "Sample sections"; right ghost "Print", ghost ".ics". Dismissable first-visit note (36px, `--surface-2`) under the header: "Sections are samples. Check the official schedule before you register. Dismiss". Left rail 296 (Constraints, In this plan, Stats, nothing else). Grid fills the remainder. Selecting an event opens DetailPanel at 400px (narrower than Courses) from the right; the grid compresses. Below 1200px the panel overlays.

### Week, 390
View header 40: "Spring 2027 · 16 cr" + "Optimize" button that opens the constraints sheet. Stats strip 32px: "9:00–4:50 · 38 min walking · longest Thu". Grid: 32px gutter, 5×~66px columns, events code-only. Tap event → sheet with AlternativesCompare.

### Map, 1440
Map full-bleed below TopBar. MapPanel floating left. Controls bottom-right. Selected stop = flown-to pin. Legs with minutes. Footer inside the panel: ghost "Print day", ghost "Open in Google Maps ↗" (deep link with waypoints; works without a key).

### Map, 390
Map full-screen (the BottomTabs stay). MapSheet at peek: handle, DaySwitcher, summary. Drag to half for the timeline. Pins numbered; selected stop flies with bottom padding equal to the sheet height.

### Connect
ConnectSheet states as above, opened from the Courses empty state, the AutoControl menu, or the Import button. On `done`, land on Courses with the AutoNote. `connect.html` shows request, handoff, progress and review at desktop, and request plus handoff at phone.

### Plans (kept, re-skinned, not mocked)
Same library behavior; headline becomes the view header; actions become primary "Restore" + overflow menu (Compare, Duplicate, Export, Rename, Archive); diff rows get the course code in Syne 13. The .ics dialog's date fields use the Date input with TermPresets so the common case is one tap.

## 8. Remove from today's UI

- Step numbers and "STEP N —" eyebrows (`ui/StepBar.tsx`, `nav-shell.tsx`).
- Every Syne headline above 24px, including the landing hero and the per-view titles.
- Full-width "Sample data" banners (`planner-sample-notice.tsx`) → ProvenanceTag.
- "Saving… / Saved" full-width bar → PlanChip state.
- The sticky wizard footer ("← Courses / Generate map →").
- Per-row Not taken / Taking / Done chips, the row toggle, and the "Details" text link (`courses-client.tsx`, `ui/StatusMark.tsx` becomes the glyph only).
- Optimization radio cards → ConstraintChips.
- Syne 32px stat figures that wrap ("8:30 AM") → Syne 20 tabular.
- The five-chip map summary ("4 stops / 4 mapped / ~0.98 mi / route unavailable / approximate") → one line + ProvenanceTag.
- "Show stop labels" toggle (labels are always on).
- Rainbow grade bars → single brand ramp.
- Six-row "Completed" import stepper and "Analysis notes" → three steps inside PermissionSheet.
- Leaflet raster tiles → MapLibre GL vector style.
- Backdrop blur on modals → flat `--overlay`.
- The six-action row on plan cards → primary + overflow.
- Native `<select>` elements on desktop, the stock toggle, and the "All departments" filter dropdown → the Controls above (`ui/Select.tsx`, `ui/Toggle.tsx`).
- Blank `mm/dd/yyyy` date inputs in the .ics dialog → Date input with TermPresets.
- Any copy that describes the product to the user ("UNTangle plans your UNT semester end-to-end…").

## 9. Decisions for Sam

1. Landing: agree that `/` becomes the guest Courses view with an empty state, and the marketing copy moves to a future `/about`?
2. Plans as a switcher in the top bar (with `/plans` kept as the library) rather than a fourth tab. If you want it as a tab, it is a one-line change to ViewSwitcher, but I recommend against it.
3. Auto-fill sets suggested courses to Planned directly (undoable) rather than marking them "Suggested" and waiting. This is the "fills everything in" reading of your note.
4. SPOT (UNT's course evaluations) as the second external link, standing in for UT's CES. Confirm there is a public URL pattern to deep-link, otherwise it drops to a catalog link.
5. Map provider: OpenFreeMap "positron" is the default. If you would rather self-host tiles, nothing in the design changes. 3D buildings need a source with building heights; OpenFreeMap's OpenMapTiles schema has `render_height`, so this should work without extra data, but it is unverified against Denton coverage.
6. The companion extension: dropped (Sam, 2026-10-13). The handoff is the myUNT window plus the file pick or drop.
7. SPOT deep links: the Faculty Information System is public, but whether evaluations can be linked per course rather than per instructor is unverified. The popup links per instructor regardless.

## Lead decisions on §9 (2026-10-13, defaults until Sam overrides)

1. `/` becomes the guest Courses view with an empty state; marketing copy moves to a future `/about`. Yes.
2. Plans opens from the PlanChip menu; `/plans` stays as the library route. Yes.
3. Auto-fill sets suggestions to Planned directly, undoable, with the AutoNote. Yes.
4. Link-outs are per instructor:
   - RateMyProf search URL;
   - facultyinfo.unt.edu profile for Syllabi & CV, and SPOT through the same profile;
   - per-course SPOT deep links stay unverified, so don't build them.
5. No browser extension (Sam, 2026-10-13): installing one was too much to ask. myUNT opens in a separate window and the
   student brings the downloaded PDF back by file pick or a drop anywhere on the page.
