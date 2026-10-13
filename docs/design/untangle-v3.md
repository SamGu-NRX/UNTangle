# UNTangle v3: the build direction

Two designers rethought UNTangle independently: Opus in [`untangle-v3-opus/`](untangle-v3-opus/) and Fable in [`untangle-v3/`](untangle-v3/). This page says which parts ship. Where it is silent, follow the Opus documents. Implementers build from the Opus [HANDOFF](untangle-v3-opus/HANDOFF.md) in its order, with the changes below.

## Simplification rules

Sam, after looking at the app and the first v3 mockups: the panels carry too much, desktop is cluttered, and the sidebars are confusing. These rules answer that. They override the Opus DESIGN, MOTION and HANDOFF documents wherever those disagree, and the Opus mockups are redrawn to follow them (captures from before are in [`screens/before/`](untangle-v3-opus/screens/before/)).

1. **Each lens answers one question, and the answer comes first.** Courses: what should I take next term? (the term tray). Week: when are my classes, and is this the best week? (the grid, plus one line that says either "This week fits your preferences" or what to fix). Day: where am I going next, and when do I leave? (the leave-by time). Everything else is one deliberate step away.
   *Removed:* Week's stats line (credits, courses, days, first to last class, walking minutes, tight walks, conflicts); Day's summary line (classes, miles, walking minutes).
2. **The top bar is the only navigation:** Courses, Week, Day, search, the schedule switcher and the account. A desktop page has one main region and at most one contextual panel. The panel opens when something is selected, closes with Esc, and is empty when nothing is selected. From 1200px wide the main region sits centered and the panel pushes it aside; narrower, the panel slides over the right edge; on a phone it is a sheet. Day's itinerary is Day's main region, laid over the map, and a selected stop expands in place instead of opening a second panel.
   *Removed:* the Courses rail (major, progress bar, section index, provenance); Week's Find column and its registration and preferences column; Week's row of schedule tabs (the switcher in the top bar now lists the term's schedules, New schedule, and Clear); Day's "See the week" link.
3. **Settings sit behind one control per lens, summarized in one line.** Week's constraints are a Preferences button whose summary names only the choices that differ from the defaults, in plain words ("Nothing before 9 AM, work Tue and Thu 3:00–5:00"). It opens the panel (a sheet on phone). Defaults: any start time, no days off, short walks on, no lunch break, no credit limit, no busy times. These are starting values with no data behind them; check what students actually set. Locks are set from the event: select it, then "Keep this section".
   *Removed:* the always-open Preferences block; the lock buttons in the registration list.
4. **A row is a name plus one fact,** the one the student acts on in that lens. Courses: the status reason ("Needs CSCE 2110", "Needs instructor consent") or, for Done, the grade. Week: the time. Day: the time and the building. Section numbers, instructors, rooms, class numbers and distances belong to the detail panel.
   *Removed:* section and meeting time from Courses tray rows; building plates and rooms from Week events; course titles and rooms from Day stops (shown when a stop is selected); class numbers from section rows (they are in Export); the repeated "Taking now" on every Taking row; the term on Done rows.
5. **A number appears only when it changes a decision.** Alternatives show one option at a time, described in one sentence by how it differs from the current week ("Frees Friday, but Monday and Wednesday end at 4:50"), with Use this and Next. Details opens the side-by-side figures in the panel.
   *Removed:* the bar of options A, B and C and its "Best so far, checked 1,240 weeks" status; counts on open groups (a collapsed group keeps its count, because it decides whether to open it); miles on every walk and for the day; the schedule count and per-card stats in the library; the "Sections" figure in grades.
6. **Warnings appear inline only when the student can act,** in one plain line with the action ("The walk to PHYS 2220 on Monday and Wednesday is tight." Show a fix). Anything else is a quiet glyph with an accessible description: the amber walk chip, the lock on a kept section, "Few seats" in the export list.
   *Removed:* "Conflicts with another class" and "Full, waitlist" notes on registration rows; "Sample sections" repeated per surface (once per lens now).
7. **Day:** the hero says the next class, where, and the leave-by time ("Leave Kerr Hall by 8:49", "in 12 min", "CSCE 2110 starts at 9:00 in GAB 535."). A stop row shows the time and the building. A walk shows only its minutes on the drawn line, and adds one line ("Leave right at 10:50", "3 min late") only when it is tight or late. Today comes first; a stepper reaches the other days.
   *Removed:* miles, leave-by and break length on every walk; the start row with "Change starting point" (now in the first walk's detail); the online class row (it has no time or place, so it lives in Week's No set time strip); the five-day segmented control; the page-level Google Maps button (now "Directions" inside a selected stop).
8. **Courses:** progress is one line in the page header ("54 of 120 credits"), next to the degree name, which opens the degree dialog (major, catalog year, transcript date, Import again). The term tray comes first; the groups follow as collapsible headers in one column. To check and You can take start open; Taking now, Later and Done start closed.
   *Removed:* the left rail; group tags ("Degree plan 2026–27", "Fall 2026", "From transcript"); the tray footer ("Mon–Fri, 9:00–1:50, 1 online").
9. **Fewer boxes.** No card inside a card; spacing, weight and color separate things before borders do. The term tray, the week grid and the contextual panel are the only surfaces. Rows sit on the page with a hairline between them. Main regions stop at 720px (Courses), 960px (Week) and 560px (Schedules).
   *Removed:* the tray's inner row box; group row boxes; Week's three cards; the library's schedule cards (now rows with a small drawn week).
10. **Kept from the decisions below:** three lenses over one plan, Auto, the drawn walk line, one-tap add with the conflict shown first, magic link first, brand by host, and the motion tokens. The two new motions (the panel and Next) are in [MOTION §3](untangle-v3-opus/MOTION.md#3-what-animates-and-what-deliberately-doesnt).

**No mid dots anywhere** (the U+00B7 character), and no other separator glyph in their place. Facts are rephrased into a sentence or separated by layout: the schedule pill sets the term in a lighter weight before the name, with no glyph between.

### Visible text above the fold

Counted by [`_build/count.mjs`](untangle-v3-opus/_build/count.mjs) at 1440×900 on each lens's resting state: every visible text node on screen, leaving out the map canvas and mockup notes on both sides. The target was a drop of at least 40%.

| Lens | Before | After | Change |
|---|---|---|---|
| Courses (after Auto) | 71 | 40 | −44% |
| Week, UNTangle host | 129 | 64 | −50% |
| Week, vsb host | 114 | 64 | −44% |
| Day | 54 | 30 | −44% |
| Schedules | 76 | 23 | −70% |

### Every task stays within two steps

A step is one click or tap that changes what is shown; typing a search is not counted. The figure is how many steps it takes, from each lens's resting screen on desktop, until the control for the task is on screen.

| Task | From Courses | From Week | From Day | Where it lives |
|---|---|---|---|---|
| Add a course | 0 | 1 | 1 | `+` on a You can take row; top-bar search opens results with `+` on each section |
| Check why a course is locked | 1 | 2 | 2 | Open Later: the reason is the row's fact. The detail adds the prerequisite path |
| Run Auto | 0 | 0 | 1 | Auto in the term tray (Courses) and the Week header |
| Change a preference | 2 | 1 | 2 | Week's Preferences button |
| Compare and use an alternative | 2 | 1 | 2 | Auto (or Show a fix) puts the sentence, Next and Use this on screen; Details adds the figures |
| Keep (lock) a section | 2 | 1 | 2 | Select the event; "Keep this section" in the panel |
| Copy class numbers | 2 | 1 | 2 | Week's Export dialog, first section |
| See when to leave | 1 | 1 | 0 | Day's hero |
| Switch schedule | 1 | 1 | 1 | The schedule pill in the top bar |

On a phone the tab bar replaces the top-bar tabs and the counts hold, with two differences: Week's Preferences is the summary line at the top of Week, and Add and Auto sit in the bottom action bar.

## Why Opus is the base

Both designs reached the same structure on their own: three lenses over one plan (Courses for the degree, Week for the term, Day for today), Day as the phone's morning home, named schedules, adding a section in one tap with the conflict shown first, walk time between classes, a "No set time" strip, the popup-window import, and one builder serving UNTangle and vsb v2. Opus carries that structure further and proved it:

- **Week matches vsb's working parts.** Search, the grid, and "Copy class numbers for myUNT" are all there, so students moving from vsb.untgrades.app find what they know. (Rule 2 above moves search to the top bar and class numbers to Export; the side columns are gone.)
- **Courses is ordered by what a student can do:** the term tray (where Auto lives), To check, You can take, Taking now, Later, Done. Each row carries one glyph and one fact.
- **Day leads with the answer:** "Leave Kerr Hall by 8:49", with "in 12 min" beside it.
- **No dropdowns for choosing values.** Five options or fewer become a segmented control or chips; longer lists open a search sheet. This answers Sam's complaint that the dropdowns looked inelegant.
- **Verified.** Axe is clean on every mockup at 1440×900 and 390×844, and the prep-for-prod findings were fixed.

## What comes from Fable

1. **The walk is drawn.** One 2px green line is the route on the map, the connector between stops in Day, and the connector between consecutive classes in Week, with the minutes chip sitting on it. It turns red as "late" when the walk is longer than the break, and amber as "tight" within two minutes. Walking time is what no other UNT planner has, so it is the visual that repeats ([Fable DESIGN, H2](untangle-v3/DESIGN.md)).
2. **One app, branded by host.** `brand.ts` picks the name and defaults by hostname. On vsb.untgrades.app it is "UNT Schedule Builder" with no account, the Find column open, a term picker and the data-freshness line. On untangleapp.vercel.app it is UNTangle.
3. **The best-so-far upgrade animates in place.** When the optimizer improves a figure, it crossfades through a 2px blur with no reflow. Opus's rule also holds: never swap the grid while the student is previewing an option. Offer "A better week is ready" with a Show button instead.

## Motion

Both systems share the same four curves, so use the Opus [MOTION](untangle-v3-opus/MOTION.md) tokens and table, with these settled:

- **Week section swaps:** the event moves to its new slot (FLIP, 300ms) when the student uses a pointer, and changes instantly from the keyboard.
- **Auto's reveal** is the one choreographed moment: picked rows fly into the tray, following Opus §8. Under reduced motion it becomes a crossfade.
- **Reduced motion is gentler, not none.** Movement goes, and opacity changes stay at about 120ms.

## Decisions taken (defaults until Sam says otherwise)

| Question | Decision |
|---|---|
| Sign-in | Magic link first, password second (Sam). Production refuses to start without an email provider. |
| Phone landing | Day during term when a class is still ahead today; otherwise the last lens used. |
| Names | "Day" replaces "Map". "Schedules" replaces "Plans", and `/plans` redirects to `/schedules`. |
| Standalone name | "UNT Schedule Builder", vsb's current name. Whether an unofficial tool may use "UNT" is Sam's call with Dylan. |
| Share links | The schedule is encoded in the URL; nothing is stored or revocable. |
| Extension | None, anywhere. |
| AI agents | WebMCP tools (slice 10) expose the same actions; writes need the student's confirmation. |
| Preference defaults | Any start time, no days off, short walks on, no credit limit, no busy times. These are starting values with no data behind them (see the list below). |
| Schedule tabs | None. The top-bar switcher is the only switcher; the Schedules compare view covers side-by-side. |
| vsb host | No Find column (search is reached from the top bar), no Help or "Sign in to sync", and on phone the term picker sits in the switcher sheet. The Week slice still checks the DESIGN.md §3.5 vsb parity list item by item. |
| Day | A previous/next stepper replaces the five-day control. Online classes with no set time show only in Week. The labeled capture of the live map stands until the map pass lands. |
| Panel push (1200px and wider) | Opening the panel moves the page left by `transform` only, never by reflowing, using `--t-enter`/`--t-exit` with `--ease-out`. Opening from the keyboard is instant. Under reduced motion the page doesn't move and only the panel fades. The selected item stays visible after the shift. |
| Readings of rules 2, 3 and 5 | Day's itinerary is Day's main region, and a selected stop expands in place. A section is kept from the selected event's panel. The alternative strip also carries Details and a close button. |
| Mid dots | Rows carry one fact, and a separator glyph is a sign a screen is doing too much (Sam). Where facts were joined, keep the one the student needs at that spot and move the rest to the detail panel or drop it; a comma list of facts is the same clutter. A phrase stays joined only when it reads as one idea ("Leave Kerr Hall by 8:49"). `frontend/tests/no-mid-dots.test.ts` fails on a mid dot anywhere in `frontend/src`, as a tripwire. |

## Placeholders with no data behind them

Label these in code as starting values and revisit with real use:

- the Week preference defaults (any start time, no days off, short walks on, no credit limit);
- the 2-minute leave-by buffer;
- class numbers ordered fewest open seats first;
- what the TAMS toggle filters, which needs vsb's definition from Dylan;
- the over-load warning at 15 credits;
- 30-day version history.

## Fixes found when rendering the mockups

- **Fable phone header:** the plan chip wraps "Spring 2027" onto two lines, and the search field runs past the edge. Opus's header doesn't, so use it.
- **Fable Week rail:** the lock and remove icons fall onto their own line, and "48 min walking / wk" wraps. Neither design's Week rail survives rule 2.
- **Dev bars:** both sets of mockups have a state bar that covers part of the phone sheet. It's a mockup aid, not part of the design.
