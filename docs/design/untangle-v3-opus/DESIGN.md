# UNTangle v3 (Opus direction): design

Readers: the lead choosing between this direction and the parallel Fable one, and the engineers who build the winner. The simplification rules in [`../untangle-v3.md`](../untangle-v3.md#simplification-rules) override this file where they disagree, notably the rail in §4.2, the side columns, stats line, tabs and options bar in §4.3, the itinerary rows in §4.4 and the cards in §4.5. The mockups follow the rules. This file replaces `../untangle-v2/DESIGN.md` where they disagree. Motion lives in `MOTION.md`, build order in `HANDOFF.md`. Every screen named here has a mockup in this folder; open `index.html` for the list, and `screens/` for the 1440x900 and 390x844 captures.

## 1. Direction

**Campus wayfinding for your degree.** UNTangle should read like a well-run campus sign system: a pale ground, dark green signage, and one bright line that shows where you are going.

Three devices carry the identity. Each one encodes something true, so none of them is decoration.

1. **The path line.** The map's route style (a green core with a white casing, and numbered discs with a white ring) appears wherever order is real and nowhere else. It shows the day's walk on the map and in the itinerary, a course's prerequisite chain, the three import steps, and a schedule's version history. Solid means satisfied or upcoming, dashed means not yet met, grey means already passed. A student who learns the line on the map can read it everywhere.
2. **Building plates.** Building codes (`GAB`, `CURY`, `PHYS`) are set as small dark-green plates in Syne caps, the way campus signs show them. The room number follows in body type: `[GAB] 535`. Plates appear on events, sections, stops and itinerary rows.
3. **The leave-by numeral.** The one large piece of type in the product is the time you need to leave, in Syne 700 at 44 to 46px: "Leave Kerr Hall by **8:49**". It answers the 8 a.m. question before anything else does.

What stays from v2: the greens (#00512b, #00a855, #1a2e1a), Syne for the wordmark and course codes, DM Sans (self-hosted, optical-size axis) for everything else, inferred statuses with no per-row status chips, provenance as a small dotted tag, and fast-where-frequent motion.

## 2. Departures from v2

Each item below is a hypothesis: a change made for a stated reason that still needs real students to confirm it.

| v2 | v3 | Why |
| --- | --- | --- |
| Courses grouped by requirement, alphabetical inside | Courses ordered by what you can act on: the term tray, then To check, You can take, Taking now, Later, Done | Of 55 CSCE rows in the v2 capture, most were Locked or Check. The first screen should be the 10 rows a student can act on. |
| A status word on every row, plus a glyph, plus meta | The group header names the status; rows carry a glyph and one meta string | Sam: "the long non-logo text ... not elegant". This cuts the visible words on a 50-row list roughly in half. |
| Split Auto-fill button with a caret menu | One **Auto** button inside the term tray it fills | Sam asked for one Auto button. Putting it in the tray tells you what it fills without a label explaining it. |
| Dropdowns for major, instructor, plan, constraints | No value-choosing dropdowns (rule in §9) | Sam called the dropdowns inelegant. A segmented control or chips show every option at once; a search sheet scales to long lists. |
| "Plans" as one object per term | **Named schedules**, several per term, as tabs above the week | UTRP's strongest pattern (up to 10 named schedules, `ScheduleListItem.tsx`). Students compare "Main" against "Fridays off"; a plan is the wrong noun. |
| Week view with a constraint rail and an Optimize button | A schedule builder with search on the left, the grid in the middle, the registration list and preferences on the right, and **Auto** (UNTangle) or **Build my schedule** (standalone) | It matches vsb's working layout and UTRP's add-from-row flow, and the same surface ships as vsb.untgrades.app v2. |
| Map tab | **Day** tab: the map plus the leave-by hero | A returning student at 8 a.m. needs one answer: when to leave. "Day" also completes a time model: Courses is the degree, Week is a term, Day is today. |
| Landing on Courses | Landing on Day during term when a class is still ahead today; otherwise the last tab used | See §3.2. |
| Import as a dialog with an extension option | A full-page calm flow: one button opens myUNT in a separate window, then one "Use the downloaded PDF" button | Sam's decision tonight. The page holds one step at a time, and dropping the PDF anywhere works. |

## 3. Information architecture

### 3.1 Places

```
UNTangle
├── First visit / import              (no transcript yet)
├── Courses   the whole degree        statuses, term tray + Auto, course detail
├── Week      one term                schedule builder (shared with vsb v2)
├── Day       today                   map, itinerary, leave-by
├── Schedules library                 from the schedule pill: versions, compare, export
└── Sign in                           a sheet over wherever you are
```

The **schedule pill** (`Spring 2027 Main`, the term in a lighter weight) in the header is the only switcher. It shows which named schedule every tab is showing. On desktop it opens the library; on phone it opens a sheet of that term's schedules with a link to the library. Tabs never change which schedule is active.

### 3.2 Landing rule (hypothesis)

On open, the app goes to **Day** when the schedule marked "in session" has a class that hasn't ended yet today. Otherwise it reopens the last tab used. A first visit with no transcript goes to the import page. The rule is deterministic so a student can learn it. If testing shows students are surprised to land on the map, fall back to "last tab used" and keep Day one tap away.

### 3.3 Desktop shell (≥ 760px)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ UNTangle  [Courses|Week|Day]  ⌕ Search courses or class numbers ⌘K   (●Spring 2027 Main)    SG │ 56
├────────────────────────────────────────────────────────────────────────────┤
│ Courses:  rail 264 │ list ≤ 800              │ detail panel 460 (pushes)    │
│ Week:     find 312 │ grid (fluid)            │ registration + prefs 312     │
│ Day:      map full-bleed, frosted panel 384 at 16px inset                   │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Phone shell (< 760px)

```
┌──────────────────────────────┐
│ UNTangle   (Spring 27 Main)   SG│ 52 + safe-top, frosted
│ content (own scroll per tab) │
│                              │
│ [Add] [Prefer] [Auto]        │ Week only: glass action bar, thumb zone
├──────────────────────────────┤
│  Courses    Week     Day     │ 56 + safe-bottom, frosted
└──────────────────────────────┘
```

Day hides the header. The map runs edge to edge, with a frosted day switcher on top and the itinerary in a non-modal glass sheet at three detents (206px, 50%, 86%). The navigation rules are in `07-phone-navigation.html`, a live phone inside an annotated board at 1440 and the bare app at 390:

- Tabs switch instantly and each keeps its own scroll position and sheet. Tapping the current tab scrolls it to the top.
- Detail, sections, preferences and export open as sheets, half height first, then full on drag. Detail sheets dim the background; the Day sheet does not.
- One sheet deep: a second sheet replaces the first sheet's content (a 160ms crossfade) and never stacks.
- Back (gesture, Esc, Android back) closes the top sheet, then pops a pushed screen. Tabs are not history.
- Search covers the screen with the keyboard up and no animation; Cancel returns to exactly where you were.
- Auto, Add, Build and sheet handles sit in the bottom third. Remove and delete sit one level down.

### 3.5 The schedule builder has two homes

Week in UNTangle and the standalone **UNT Schedule Builder** (vsb.untgrades.app v2) are one surface. `03-schedule-builder.html` renders both: `?host=untangle` (the default) and `?host=vsb`.

| | UNTangle host | Standalone host |
| --- | --- | --- |
| Header | UNTangle top bar with tabs and the schedule pill | `[UNT] Schedule Builder`, term segmented control, freshness line "Updated Oct 4 at 2:02 PM", the schedule switcher, and search ("Search 3,048 courses") in the bar |
| Search default | "You can take", from transcript statuses, with status glyphs | Empty, with three example queries; course colors instead of glyphs |
| Primary action | **Auto** | **Build my schedule** |
| Accounts | Signed in or guest | No account needed; saved on the device; share link |
| Day / leave-by alerts | Yes | Walk chips yes; leave-by alerts in .ics only when walking data exists |

The builder components take everything host-specific as props or providers (§8.4), so nothing in `ui/schedule-builder/**` imports UNTangle state.

vsb parity: search by code, title, instructor or class number; Open seats filter; inline Filters panel (days, format, level); TAMS rules toggle; preferences and busy times; Build with three alternatives; click a dotted option on the grid to switch sections; drag an event to snap it to the nearest section; registration list; undo and clear; saved schedules (tabs, New, duplicate, rename, delete); share link; save and open a file; print; add to calendar.

## 4. Core flows

### 4.1 First visit and import (`01-first-visit-import.html`)

One column on the left, max 520px. On desktop the right side shows the thesis: four artifacts on one path line (transcript, what you can take, next term's week, your walk). That is also where the separate myUNT window lands, so it never covers the instructions.

| State | Shows | Primary action |
| --- | --- | --- |
| `first` | Campus switch (UNT or UT Austin), "Start with your transcript", one line on privacy | **Open myUNT** (opens a 480x760 popup near the right edge; UT Austin: "Open UT Direct") |
| `waiting` | "myUNT is open in another window", three steps on the path line (sign in, open the unofficial transcript, download the PDF) | Show the myUNT window, or I have the PDF |
| `returned` | Triggered when `popup.closed` (polled every 500ms) or the window regains focus; on phone, by `visibilitychange` | **Use the downloaded PDF**, autofocused (`showOpenFilePicker({ startIn: "downloads", types: [pdf] })`, else `<input type=file accept=application/pdf>`) |
| drop overlay | Any file dragged over the page: dashed inset frame, "Drop your transcript" with "Read on this device" below it | Drop |
| drop overlay, not a PDF | Same frame in grey: "Only PDF transcripts work" | (none) |
| `reading` | Three steps on the path line: reading the PDF, finding your courses, checking prerequisites; "On this device. Nothing is uploaded." | (none). Shown only if parsing takes ≥ 400ms. |
| `review` | "14 courses found", counts with glyphs, To check first (the unmatched row has Find course and Skip), then terms, then "Your name and student ID were removed" | **Looks right** → Courses, before Auto |
| `wrongfile` | "That PDF is a degree audit" plus the exact myUNT path to the right document | Choose another file, or Open myUNT again |
| `notext` | "This PDF has no readable text" (a scan or photo) | Open myUNT again |
| `blocked` | "Your browser blocked the window" | Open myUNT in a new tab (an `<a target=_blank>`, which counts as a user gesture) |

No extension, no upload, no banner. The flow never shows more than one primary button at a time.

### 4.2 Courses, Auto and course detail (`02-courses.html`)

- **Term tray** first: "Spring 2027" with "0 credits" below it, three dashed placeholder rows, one sentence, and **Auto**. After Auto, the tray lists the courses with their department color and a Remove button, a result line "Planned 5 courses" with Undo, and an "Open in Week" link.
- **Groups**: To check (attention glyph; meta says why, such as "Needs instructor consent"), You can take (subheads by requirement; each row has a 32px `+` that adds to the tray), Taking now, Later (collapsed; meta "Needs CSCE 2110", where the code links to that course), Done (collapsed; "Grade A", "Covered by CSCE 1040").
- **Desktop rail**: major (opens the major search dialog), credit progress (done, taking and a striped planned segment), a section index with counts, and provenance "From transcript, Oct 13". (Removed by rule 8; these move to the page header and the degree dialog.)
- **Course detail** (a 460px side panel that pushes the list; a sheet on phone), modelled on UTRP's popup (`HeadingAndActions.tsx`, `GradeDistribution.tsx`, `Description.tsx`), in this order:
  1. Code (Syne 22, brand), credits tag, title, status line.
  2. **Add to Spring 2027** ("Week picks the best section, or choose one below"), then link-outs RateMyProf ↗, Syllabi and CV ↗, SPOT evaluations ↗. They follow the selected instructor and are disabled under "All instructors" with a reason, as UTRP disables them without an instructor.
  3. **Path**: the prerequisite chain as a horizontal path line (done prerequisites solid with a check and their grade, this course in accent, up to two unlocks dashed). Below it, the catalog rule checked against the student's record: "Catalog rule: MATH 1710 and MATH 1720, C or better. **You meet it** with MATH 1710 (B), MATH 1720 (B)." This is UTRP's bolded prerequisite line, made personal.
  4. **Sections**: a mini week of the active schedule, then section rows. Each row has a one-tap `+`, the time, instructor ★, building plate and seats. Pointing at or tapping a row paints it on the mini week before you add it, in red where it overlaps. A conflicting row shows "Overlaps MATH 2700 on Mon, Wed and Fri" and a red-outlined `+`; a full section shows a lock and "Full, 4 waiting".
  5. **Grades**: instructor chips (no select), figures (average GPA, students, sections), horizontal bars on one green ramp, provenance "UNT grade records 2019–2025" and "Data source ↗". An instructor with no records falls back to all instructors and says so, as UTRP does.
  6. About: the description clamped to three lines, with More.
- **Major picker**: a dialog (a sheet on phone) with a search field, a catalog-year segmented control and a list. It is not a dropdown.

### 4.3 Week: browse, add, build, export (`03-schedule-builder.html`)

Grounded in UTRP's add-from-row and calendar flows and in vsb's three-column layout, with UTRP's two-step add removed.

- **Tabs** for named schedules (Main, Fridays off, + New). Undo, Clear, Export and **Auto** / **Build my schedule** sit on the right.
- **Stats line**: credits, courses, days on campus, first to last class, minutes walking a week, tight walks (attention) and conflicts (danger), with "Sample sections".
- **Find courses** (left): search, Open seats, TAMS rules, Filters. A result expands in place into section rows with a one-tap `+` and conflicts shown before adding. Pointing at a section paints a dashed ghost on the main grid; an overlapping ghost takes the right half of the slot in red, like UTRP's overlap groups (`calendar/utils.ts:492`).
- **Grid**: Mon to Fri (Saturday appears only when something meets then), 8 a.m. to at least 5 p.m., 64px hours on desktop and 52px on phone. Events use the department tint with a 3px left bar, the code in Syne, the time, a building plate and a lock when locked. **Walk chips** sit between consecutive classes with a gap of 30 minutes or less ("4 min", or "8 min" in attention when the walk plus a 2-minute buffer is at least the break). Busy times are hatched. A **No set time** strip below the grid holds online and async sections.
- **Choosing a section on the grid**: select an event and the course's other sections appear as dotted outlines (`§002`), red where they clash. Click one, or drag the event and drop it near one, to switch.
- **Registration list** (right): color, code, section, days and time, class number, conflict or waitlist note, lock, remove, and "Copy class numbers for myUNT".
- **Preferences**: Start after (Any time, 9, 10 or 11 AM), chips (No Fridays, Lunch break, Short walks, Fewer days, Top-rated profs), busy times (add by dragging on the grid).
- **Auto / Build**: shows the best result within 300ms and previews option A on the grid. A strip shows one option at a time ("1 of 3") with one sentence on how it differs from the current week ("Frees Friday, but Monday and Wednesday end at 4:50"), **Details** (the figures, and Save as a new schedule, in the panel), **Next**, **Use this** and a close button (rule 5). Changing a preference while the bar is open updates the options in place.
- **Export** (dialog on desktop, sheet on phone; the same set in both hosts):
  1. **Class numbers for myUNT**, ordered fewest open seats first, with "Copy all 5". This stands in for a registration handoff.
  2. **Calendar file (.ics)**: the term in words ("Spring 2027, Jan 19 to May 7"), weekly RRULE with UNTIL, EXDATE for spring break (Mar 15–19), online classes left out, and optional leave-by alerts in the UNTangle host.
  3. **Picture of the week** (.png).
  4. **Share and back up**: copy share link, print, save file, open a file.

### 4.4 Day (`04-day-map.html`)

- **Hero** states:
  - Before the first class: "Leave Kerr Hall by **8:49**", with "in 12 min" beside it.
  - Within a minute of leaving: "**Leave now**".
  - Between classes: "Leave GAB by 9:54".
  - Tight: "Leave CURY by **10:50**", with "Right as class ends" in attention.
  - After the last class: "Done for today", then "Tomorrow, CSCE 2610 starts at 12:30 in ESSC 255."
  - Another day selected: "On Wednesday, leave Kerr Hall by 8:49".
  - A day with no classes: "No classes Friday".
- **Leave-by** = class start − walk minutes − 2-minute buffer. If that falls at or before the previous class end, the leg is tight. The first leg starts from a **starting point** the student sets once (Kerr Hall here). Location is never requested by default.
- **Itinerary** on the path line: Start → walk leg (minutes, miles, leave-by, break) → numbered stop (code, time, plate, title) → … Past legs and stops turn grey; the next leg is darker and bolder. Online classes appear in a small "Not on the map" row.
- **Map**: north up, pale basemap, route with a white casing, numbered pins with a building-and-room tag. The selected stop gets an accent pin; past stops go grey. Controls: zoom, fit the day, location (disabled until allowed), 3D (street zoom only). Attribution stays visible at every detent. The camera contract is `../apple-maps-web/camera.md`; motion values are in MOTION.md §6.

### 4.5 Schedules library and compare (`05-schedules-library.html`)

- Schedules grouped by term. Each card has a mini week, name, active dot, credits, days, first to last class, when it was edited, and ⋯ (rename, duplicate, export, delete). The in-session term carries "Day uses this term".
- **Detail**: Open in Week, Export, stats in Syne, a week grid, and **History** on the path line (Now, Used option A from Auto, Before Auto saved automatically, Started from your transcript). Selecting a version overlays it as dashed outlines on the grid; Restore is one tap and undoable. Auto's plan-scoped transaction makes the "Before Auto" snapshot free.
- **Compare**: Compare turns on A and B badges on the cards. The comparison has a segmented control with the two names and Both (Both shows A solid and B dashed where they differ, and the events that change move between views), a table of changes (days, earliest, last class, walking, tight walks; better in brand, worse in attention), "Sections that change" with old and new, "Same in both", and **Make B active**.
- Phone: the list pushes to detail (slides in from the right) and compare pushes once two are picked.

### 4.6 Sign in (`06-sign-in.html`)

- A dialog on desktop, a sheet on phone, over the current screen.
- Content: "Sign in", "Keep your schedules on every device. What you made as a guest comes with you.", Email (`autocomplete=username`, `inputmode=email`, no autocapitalize), Password (`current-password`, Show, Forgot it?), a full-width **Sign in**, "New here? Create an account", and "You can use UNTangle without an account. Signing in only syncs."
- "Create an account" switches the title and button in place and reserves the help line, so the form never jumps.
- Errors sit under the field in danger text ("That password doesn't match this email. Try again, or reset it."). No magic-link button and no social buttons.

## 5. Grid, spacing and breakpoints

- 4px base: 4, 8, 12, 16, 20, 24, 32, 40, 48.
- Breakpoints: phone < 760 (tab bar shell), 760 to 1023 (top bar; rails collapse to one column), 1024 to 1199 (two columns; the detail panel overlays), ≥ 1200 (three columns where the view has them).
- Desktop page gutters are 24px; phone gutters are 12px for lists and 8px for the grid.
- Rows: 48px desktop, 58px phone (two lines). Touch targets ≥ 44px on coarse pointers (buttons get `min-height: 44px`).

## 6. Type

DM Sans for UI (variable, optical size automatic); Syne 700/800 for the wordmark, course codes, building plates, pin numbers, Syne figures and the leave-by numeral. No sentence is ever set in Syne.

| Token | Size / line | Weight | Use |
| --- | --- | --- | --- |
| label | 11 / 16, +0.06em caps | 650 | grid day heads, small section labels |
| meta | 13 / 18 | 400 | secondary text (ink-2 minimum) |
| body | 14 / 20 desktop, 15 phone | 400 | rows, paragraphs |
| input | 15 desktop, 16 coarse | 400 | stops iOS zoom |
| title | 18 / 24, −0.005em | 620 | panel titles, tray title |
| h1 | 22 / 28 app, 28 / 34 import, −0.012 to −0.018em | 640–650 | one per screen |
| code | Syne 700, 12–14 rows, 20–22 detail | 700 | course codes |
| figure | Syne 700, 18–20 | 700 | stats |
| numeral | Syne 700, 44–46 / 1, −0.02em, tabular | 700 | leave-by only |
| wordmark | Syne 800, 22 desktop, 19 phone | 800 | header |

`font-variant-numeric: tabular-nums` applies globally, and lining figures apply in Syne.

## 7. Color and elevation tokens

Paste into `frontend/src/app/globals.css` (this replaces the v2 block; the motion tokens are in MOTION.md). Contrast ratios come from the WCAG luminance formula, computed during this pass: ink-2 on ground 5.84:1, ink-2 on white 6.35, ink-3 on white 4.26 (glyphs and placeholders only), attention on its tint 5.01, danger on white 6.54, brand on white 9.49, accent on white 3.12 (never text).

```css
:root {
  --ground: #f4f6f3; --paper: #ffffff; --paper-2: #eef2ed; --paper-3: #e5ebe4;
  --line: #dde6dc; --line-2: #c5d3c4;
  --ink: #1a2e1a;   /* titles, codes */
  --ink-2: #4f654f; /* body and meta, the lightest text allowed */
  --ink-3: #6b806b; /* glyphs, placeholders only */
  --ink-4: #9fb09f; /* disabled, past route, decorative */
  --brand: #00512b; --brand-2: #007a40; --brand-soft: #e3efe6;
  --accent: #00a855; --accent-soft: #dff5e8;          /* focus ring, live dot, taking, selected pin */
  --attention: #8a6100; --attention-soft: #fbf3df;    /* "check" status, tight walks, full sections */
  --danger: #b3261e; --danger-soft: #fbeae8;          /* conflicts, errors */
  --scrim: rgba(16, 32, 18, .36);
  --glass: rgba(255, 255, 255, .84); --glass-edge: rgba(255, 255, 255, .7);

  /* course colors, assigned per schedule and clustered by department (rule below) */
  --c1: #3f7a4f; --c1t: #e6f0e8;  /* moss  */
  --c2: #a3613f; --c2t: #f6ebe4;  /* clay  */
  --c3: #4b6a8a; --c3t: #e6ecf2;  /* slate */
  --c4: #8d7325; --c4t: #f5f0e0;  /* ochre */
  --c5: #7a5272; --c5t: #f1e8f0;  /* plum  */
  --c6: #3d7a7a; --c6t: #e3f0f0;  /* teal  */

  --font-ui: "DM Sans", ui-sans-serif, sans-serif; --font-mark: "Syne", "DM Sans", sans-serif;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 20px; --s6: 24px; --s8: 32px; --s10: 40px; --s12: 48px;
  --r-xs: 4px; --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-xl: 22px; --r-pill: 999px;

  --shadow-1: 0 1px 2px rgba(20, 40, 22, .07);
  --shadow-2: 0 6px 16px -4px rgba(20, 40, 22, .12), 0 1px 3px rgba(20, 40, 22, .07);
  --shadow-3: 0 24px 48px -12px rgba(20, 40, 22, .22), 0 4px 10px rgba(20, 40, 22, .08);

  --topbar-h: 56px; --header-h: 52px; --tabbar-h: 56px;
  --safe-b: env(safe-area-inset-bottom, 0px); --safe-t: env(safe-area-inset-top, 0px);
}
```

**Course colors** follow UTRP's rule (`src/shared/util/colors.ts` `getUnusedColor`), applied to six earthy hues. A course whose department is already in the schedule takes the next free hue adjacent to that department's hue (in ring order 1-3-6-4-2-5), so CSCE courses land on slate and teal. A new department takes the free hue farthest from those in use. Colors persist per schedule and never appear as text under 14px.

**Elevation** has three levels. Level 1 is rows and cards; level 2 is floating panels, pins, popovers and the selected event; level 3 is sheets, dialogs and toasts. The **frosted material** (`--glass` + `blur(22px) saturate(1.7)`) is used only for chrome over moving content: the top bar, phone header, tab bar, Day panel and sheet, map controls and the Week action bar. Never stack glass on glass. `prefers-reduced-transparency: reduce` and missing `backdrop-filter` fall back to solid paper.

## 8. Components

States are listed where an engineer needs them. Names are React component names.

### 8.1 Shell
- **TopBar**: wordmark, ViewTabs (segmented: Courses, Week, Day), SearchTrigger (⌘K, "Search courses or class numbers", which also matches 5-digit class numbers as UTRP's Quick Add does), SchedulePill, Account.
- **PhoneHeader**: wordmark, SchedulePill (`Spring 27 Main`), Account. Hidden on Day.
- **TabBar**: three tabs (Courses `courses`, Week `week`, Day `day` icons) at 56px + safe area, frosted. Active is brand with a 2.1px stroke; inactive is ink-2 (inactive labels are 11px, so ink-3 would fail AA).
- **SchedulePill**: states `active` (accent dot), `saving`, `error` (danger dot, "Not saved" with Retry in the sheet), `guest` ("Saved on this device").

### 8.2 Controls (`components/ui/**`)
- **Button**: primary, secondary, quiet, ink, icon; sizes sm 32, md 40, lg 52; `:active` scale .97; loading holds the width and swaps the label for a spinner with an sr-only verb.
- **Segmented**: equal segments, one pill moved by transform. Used for view tabs, campus, term, start time, and the compare views.
- **Chip** (toggle): 32px pill; on = brand-soft fill, brand 1.5px ring and a check glyph; variant `warn`.
- **SearchField**, **TextField** (label above, help or error below, never a red box around a sentence), **Switch** (40x24).
- **Plate**: building code plate + room. Variant `quiet` (paper-3) for dense lists.
- **StatusGlyph** (18px svg): `done` (filled ink-2 disc, check), `covered` (dashed ring, check), `taking` (half accent), `planned` (brand disc, white dot), `available` (ring), `locked` (lock, ink-4), `check` (attention ring, "!"). Always with an accessible name.
- **ProvenanceTag**: 20px, dotted border, 11px. Once per group or panel.
- **PathLine**: `<ol class="path">` with `.stop` discs; per-item `data-leg="past|todo"`. Vertical and horizontal variants.
- **Toast**: ink, bottom center (above the tab bar on phone), one action, 5s, pauses while hidden.
- **Sheet**: detents, non-modal or modal (scrim), dismissible, glass variant. Physics in MOTION.md §5.
- **Dialog**: centered, origin center, scrim without blur.
- No **Select** or **Menu** for choosing values. The only Menu is the ⋯ overflow (rename, duplicate, export, delete).

### 8.3 Courses
- **TermTray**: states `empty`, `running` (the Auto button holds its width with a spinner), `filled`, `just-filled` (result line with Undo), `over-credit` (attention meta "18 credits, above your usual 15").
- **CourseRow**: `data-s` = available, planned, check, taking, locked, done, covered; `aria-selected` while its detail is open; one action slot (`+` on available, `−` in the tray).
- **CourseGroup**: header button with count, tag, chevron; `data-open`.
- **CourseDetail**: sections as in §4.2. States: `loading` (the header renders from the row at once; the rest shows a 2-line shimmer per section), `no-grades`, `instructor-fallback`, `error` ("Couldn't load grades. Retry").
- **MajorPicker**: search, catalog-year segmented control, options with a check.

### 8.4 Schedule builder (`components/schedule-builder/**`, host-agnostic)
Interface (all host data enters through props or a provider):

```ts
type BuilderHost = {
  brand: ReactNode;                       // UNTangle top bar or "[UNT] Schedule Builder"
  primaryLabel: "Auto" | "Build my schedule";
  terms: Term[]; freshness?: { courses: number; updatedAt: string };
  sections: SectionSource;                // search(q, filters), byCourse(code)
  statusFor?: (courseId: string) => CourseStatus;          // UNTangle only
  suggestions?: () => string[];                            // "You can take", UNTangle only
  walkMinutes?: (fromBuilding: string, toBuilding: string) => number | undefined;
  store: ScheduleStore;                   // local (guest/vsb) or account-backed
  optimizer: OptimizerClient;             // the Web Worker; best-so-far stream
  exporters: { ics: boolean; png: boolean; classNumbers: boolean; share: boolean; leaveByAlerts: boolean };
};
```

Components: **ScheduleTabs**, **StatsLine**, **FindCourses** (SearchField, FilterChips, FiltersPanel, ResultCourse, ResultSection), **WeekGrid** (Event, OptionOutline, Ghost, BusyBlock, WalkChip, NoSetTimeStrip), **OptionsBar**, **RegistrationList**, **Preferences**, **ExportSheet**.

Event states: default, `selected` (2px course-color ring, options visible), `conflict` (danger ring and tint, half width beside its partner), `locked` (lock glyph), `dragging` (level 3 shadow), `ghost` (dashed brand; dashed danger in the right half when it overlaps).

### 8.5 Day
**DayHero** (states in §4.4), **Itinerary** (PathLine with LegRow and StopRow; `past`, `next`, `tight`, `selected`), **MapCanvas** (MapLibre; layers per `../apple-maps-web/route-and-pins.md`), **MapControls**, **DaySwitcher**, **StartingPoint**.

### 8.6 Library
**ScheduleCard** (selected, compare pick A/B, active), **ScheduleDetail**, **VersionList** (PathLine; selected version overlays the grid), **CompareView** (segmented control, overlay grid, delta table, change list).

## 9. Copy rules

1. **No dropdowns for choosing values.** Five or fewer options get a segmented control or chips. More get a search list in a dialog or sheet. ⋯ menus are for actions only.
2. **Short labels, numbers over words.** Buttons are a verb plus an object at most ("Add to Spring 2027", "Use the downloaded PDF"). Meta strings are one fact each. No sentence-long banners.
3. **One name per action.** "Auto" produces "Planned 5 courses"; "Use this" produces "Using option A"; "Removed CSCE 2610" offers Undo.
4. **Say where data came from once.** "Sample sections", "From transcript, Oct 13", "UNT grade records 2019–2025". Never per row.
5. **Errors state what happened and the fix,** in the interface's voice, with no apology. "That PDF is a degree audit. In myUNT, open Academic Records › Unofficial Transcript and download that one."
6. **Privacy in plain words where the worry happens:** "Nothing is uploaded", "UNTangle never sees your password", "Your name and student ID were removed".
7. **Times as people read them:** "9:00–9:50", "Leave by 8:49", "in 12 min", "Right as class ends". No "AM" inside a day's itinerary unless the day crosses noon ambiguously.
8. **No AI wording.** Auto is "Auto"; the optimizer "checked 1,240 weeks". Never "smart", "magic" or "AI".
9. **Sentence case** everywhere, including buttons and headers.

## 10. Phone-first rules

- `viewport-fit=cover`; padding comes from `env(safe-area-inset-*)` on the header, tab bar, sheets and the Week action bar.
- Heights use `100dvh`; the import hero uses `min-height` only.
- Inputs are 16px on coarse pointers; `inputmode` and `autocomplete` are set on every field.
- `-webkit-tap-highlight-color: transparent`; `touch-action: manipulation` on controls; `user-select: none` on controls only.
- `overscroll-behavior: none` on the root, `contain` on every scroll container and sheet body.
- Hover styles live only inside `@media (hover: hover) and (pointer: fine)`. Touch gets `:active` feedback.
- The ghost preview on the grid is pointer-only. On touch, tapping a section row previews it, and the `+` adds it.
- Phone grids show code, plate and walk minutes; times move to the sections sheet.
- The Day sheet's bottom inset is the tab bar height, and the camera padding is measured from the sheet's top (camera.md).
- `theme-color` is `#f4f6f3` (`#eeede9` on Day); the manifest is `standalone`.
- Real-device checks are still owed: sticky hover, input zoom, sheet drag next to iOS back-swipe, keyboard over the sign-in sheet.

## 11. Trade-offs rejected

- **A fourth "Home" or "Now" tab.** It adds a choice, while Day's peek detent already answers the 8 a.m. question.
- **Merging Courses and Week into one screen.** The degree list and the week grid are each dense enough for a full phone screen. The tray links them, and the department color carries over.
- **A browser extension for import.** Sam killed it. A popup plus one picker button is two clicks, needs no install and works in every browser.
- **An in-app iframe of myUNT, BevoFit-style.** myUNT can't be framed or read cross-origin. BevoFit was taken as inspiration for calm, not as the mechanism.
- **Copying UTRP's look** (burnt orange, outline buttons in three colors, a 375ms dialog with a 250ms ease-in exit, `Dialog.tsx:58-65`). The flow is taken; the look and that exit curve are not.
- **Live constraints with no Build button.** Live updates still happen while the options bar is open. An explicit Auto / Build button is kept because vsb users already know it, and an action you trigger is easier to undo than a schedule that changes under you.
- **Stagger-on-load for lists.** Lists run to 100+ rows and are seen dozens of times a day.
- **3D tilt as a default.** It applies only on explicit stop or leg selection at street zoom (camera.md), never on load.
- **Dark mode in this pass.** The tokens are role-named so a dark set can be added; no dark palette has been designed or contrast-checked.

## 12. Decisions for the lead

1. **Day as the in-session landing tab** (§3.2), or always the last tab used.
2. **Rename Map to Day.** If "Day" tests poorly, keep the behavior and call it "Map".
3. **"Schedules" replaces "Plans" in the UI,** including the route (`/plans` → `/schedules` with a redirect).
4. **Standalone branding.** "[UNT] Schedule Builder" keeps vsb's name. Using "UNT" in an unofficial tool's name is a university-trademark question for Sam, not a design call.
5. **Leave-by buffer** of 2 minutes is a guess with no data behind it. Should students be able to change it?
6. **Class-number order** for myUNT: fewest open seats first is a proposal. Check whether myUNT needs linked lecture and lab numbers adjacent.
7. **TAMS rules**: what the toggle filters (TAMS-only sections, required co-enrollment) needs a source from the vsb maintainer.
8. **Over-credit warning** threshold in the tray: 15 is a placeholder with no data behind it.
9. **Version history retention.** The library says "kept for 30 days"; that number is a placeholder until storage cost is known.
