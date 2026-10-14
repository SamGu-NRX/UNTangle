# Surfaces: where a feature goes

A surface is the kind of container a piece of UI lives in. UNTangle uses seven. Pick the surface before you draw anything, because the surface decides the layout, the motion and the phone behavior for you.

## The seven surfaces

| Surface | Right when | In UNTangle today | Build it with |
|---|---|---|---|
| Row list | Showing a set of things, each with a name and one fact | Courses groups (CSCE 2900, Special Problems in Computer Science, "Needs instructor consent"), the term tray, schedules in the library, section rows in a course's detail | Plain markup on the page, hairline between rows, 48px desktop, 58px phone |
| Context panel, phone sheet | Showing the detail of one selected thing, or one lens's settings | Course detail, a selected Week event ("Keep this section", Remove), Week's Preferences, Week search, schedule detail | `ContextPanel` (it becomes a `BottomSheet` at 52% and 92% on phones by itself) |
| Hero | One answer that matters more than everything else on the screen | Day's "Leave Kerr Hall by 8:49". Nothing else. | Lead-owned. Don't add a hero. |
| Grid | Time laid out across days | Week's grid, the mini week in course detail, the small drawn week on library rows | Lead-owned. Ask for a prop. |
| Dialog | A task with a clear end that needs full attention, or a destructive confirm | Major picker, Export, Sign in, "Delete Fridays off?" | `Dialog` (becomes a sheet on phones) |
| Toast | Confirming an action that just happened, with at most one action | "Removed CSCE 2610" with Undo, "Planned 5 courses" | `toast()` from `ui/Toast` |
| Popover | A short list anchored to the control that opened it | The schedule switcher on desktop, the ⋯ menu (rename, duplicate, export, delete), tooltips | `Menu`, `Tooltip`. On phones the switcher is a sheet. |

The term tray, the week grid and the context panel are the only boxed surfaces on a page (simplification rule 9). Everything else sits on the page ground.

## Rows

Most new features are rows. Row anatomy, left to right:

```
[status glyph]  CODE  Name                                  one fact   [one action]
     optional                                                 optional     optional
```

- The fact is the one the student acts on in that lens: Courses shows the status reason or the grade, Week shows the time, Day shows the time and the building.
- A glyph appears only when it carries status. A row's action is one `IconButton` (`+`, `−`, ⋯).
- The row opens the detail panel. Use a stretched native button for the row and keep the action as a sibling. Never nest a button in a button.
- If the name truncates, the fact must not. Give the fact `white-space: nowrap` and let the name ellipsize.

| Bad | Good |
|---|---|
| `CSCE 2110` Foundations of Data Structures, MWF 9:00, GAB 535, Dr. Kim, 3 credits | `CSCE 2110` Foundations of Data Structures. Sections, rooms and instructors open in the panel. |
| A shadowed card per schedule with credits, days and first-to-last-class figures | A row: small drawn week, "Fridays off", "Edited Oct 4", ⋯ |
| A "Taking now" label on every row in the Taking now group | The group header says it once |
| A colored icon in front of every row | A glyph only on rows whose status differs |

## Where does my feature go

Answer the questions in order and stop at the first match.

```
1. Is it one more fact about one item (a course, section, schedule, stop)?
   ├─ The student acts on it in this lens, and the row has no fact yet ──> the row's fact
   └─ Otherwise ──────────────────────────────────────────────────────> that item's detail panel

2. Is it a control?
   ├─ Changes what Auto picks (start time, days off, walks, credits, busy times) ─> Week, Preferences panel
   ├─ Narrows what search shows (seats, days, format, site, grades) ──────────────> Week search panel, Filters
   ├─ Acts on one item (keep, remove, add, switch section) ─────────────────────> that item's detail panel
   ├─ Acts on one schedule (rename, duplicate, export, delete) ─────────────────> its ⋯ menu
   ├─ About the degree (major, catalog year, import again) ─────────────────────> the degree dialog, from the Courses header
   └─ About the account, this device, data, notifications or campus ────────────> Settings, from the account menu

3. Is it a new set of items?
   ├─ Spans the whole degree ─────────> a group in Courses
   ├─ Belongs to one term ────────────> Week (search results or the No set time strip)
   ├─ Belongs to today ───────────────> Day, with the lead's approval; its main region is the itinerary
   └─ Saved schedules, versions, compare ─> the Schedules library

4. Is it a warning?
   ├─ The student can fix it now ──> one inline line with the fix ("The walk to PHYS 2220 on Monday and Wednesday is tight." Show a fix)
   └─ They can't ──────────────────> a quiet glyph with an accessible description (the amber walk chip, the lock on a kept section)

5. None of the above ──> ask the lead before building. Don't invent a surface.
```

## What each place is for

| Place | The one question it answers | New things go | Never add |
|---|---|---|---|
| Courses | What should I take next term? | A row fact, a group, the degree dialog | A rail, progress tiles, group tags |
| Week | When are my classes, and is this the best week? | The Preferences panel, the search panel, an event's panel | Side columns, a stats line, schedule tabs |
| Day | Where am I going next, and when do I leave? | A selected stop's expanded content | A second panel, miles, a day summary |
| Schedules library | Which saved schedule do I use? | A row fact, a ⋯ menu item, the detail panel | Cards, per-row figures, a schedule count |
| Preferences | What should Auto follow? | One control, and its words in the summary line | Anything Auto ignores |
| Settings | How is my account and this device set up? | One row per setting, grouped under a label | Anything a student changes weekly |
| Detail panel | Everything about the selected item | A section in the panel's fixed order, with depth folded behind "More" | A panel inside the panel, a second panel beside it |

Settings has no page yet. When one is built, it opens from the account menu (`components/shell/AccountMenu.tsx`), never from a new tab.

## Hard rules

- **Nothing new goes in the header.** The desktop top bar holds the wordmark, Courses, Week and Day, search, the schedule switcher and the account. The phone header holds the wordmark, the switcher and the account. That is all it will ever hold.
- **One panel at a time.** A second selection replaces the panel's content without animating. On phones a second sheet replaces the first sheet's content and never stacks.
- **The panel is empty when nothing is selected,** so it renders nothing.
- **Count your text.** `untangle-v3.md` records how much visible text each lens shows above the fold at 1440x900. A feature that adds text to a resting screen moves something else one step away.
- **Count your steps.** Every task's control is at most two clicks from any lens's resting screen (`untangle-v3.md`, "Every task stays within two steps"). State your feature's count in the recipe.

## Phone translation

| Desktop | Phone (under 760px) |
|---|---|
| Context panel | Modal sheet at 52%, then 92% on drag |
| Dialog | Sheet |
| Popover (switcher) | Sheet |
| ⌘K search | Full-screen layer with the keyboard up and a Cancel button, no animation |
| Hover preview of a section | Tap the row to preview; `+` adds |
| Primary actions | Bottom third, in the Week action bar or the sheet's foot |
