# Screen recipe

Every UI task fills in this template and sends it to the lead before writing code. Code starts when the lead replies "approved". Paste the recipe into the PR description, so the reviewer can compare the screenshots against it.

A recipe is short. If a section runs past ten lines, the feature is probably two features.

## Template

```markdown
### Job story
When <situation>, I want to <motivation>, so I can <outcome>.

### Place
- Lens and surface: <Courses | Week | Day | Library | Preferences | Settings | detail panel>, <surface from surfaces.md>
- Decision-tree answer: <the line in surfaces.md that put it here>
- Steps from the lens's resting screen: <0, 1 or 2>
- Text added to a resting screen: <none, or what it replaces>

### Components
<primitives from components.md; any change needed in components/ui, as a request to the lead>

### States, with exact copy
- Empty: <copy> [<button>]
- Loading: <what shows, and only after 400ms>
- Error: <one line per failure: what happened, what to do> [<button>]
- Success: <what changes on screen; the toast text if there is one>
- Worst case: <long names, zero items, 100+ items, unknown values>

### Wireframes
<ASCII at 390 and at 1440>

### What moves
| Change | MOTION.md §3 row, or "nothing" |
<plus: reduced motion, and the keyboard path, which never animates>

### Accessibility
<the checklist below, each item answered>

### Screenshots for the PR
<list of states at 390 and 1440, all passing visual-qa.md>

### Placeholders and questions
<every default or number with no data behind it; every decision you need from the lead>
```

## Accessibility checklist

- [ ] Every control has an accessible name that includes its object ("Add MATH 3680").
- [ ] Tab reaches every control in reading order; each shows the `--focus` ring.
- [ ] Opening a panel, sheet or view moves focus into it; closing returns focus to what opened it.
- [ ] Nothing animates when the keyboard triggered it.
- [ ] Under `prefers-reduced-motion: reduce`, nothing translates or scales; opacity changes stay at about 120ms.
- [ ] On a coarse pointer every hit area is at least 44px.
- [ ] No status rests on color alone: a glyph shape, a word or hidden text carries it too.
- [ ] Text is `--ink-2` or darker; `--ink-3` is for glyphs and placeholders; `--accent` is never text.
- [ ] Changes the student didn't trigger, such as a result count, reach a polite live region.
- [ ] Inputs are 16px on coarse pointers and set `inputmode` and `autocomplete`.

## Example: smart filters in Week search

This is the recipe for an upcoming feature. Its predicate, `filterSections(sections, filters)`, is a separate pure task with its own fixtures. This recipe covers the screen.

### Job story
When I search for a course to add in Week, I want to hide sections I can't or won't take (full, on a day I work, at the wrong hour, in the wrong format, at another site, or with an instructor whose grades put me off), so I only compare the ones that could really go in my week.

### Place
- Lens and surface: Week, inside the search context panel (a full-screen search layer on phones).
- Decision-tree answer: "Narrows what search shows ... Week search panel, Filters".
- Steps from Week's resting screen: 2 (open search, then Filters).
- Text added to a resting screen: none. One summary row is added to the search panel.

Filters change only what search lists. They never change what Auto picks; that is Preferences.

### Components
`ContextPanel` (desktop) and the shell's phone search layer, `SearchField`, a stretched row button for the Filters summary, `ChipGroup` and `Chip` (seats, days, format, site), `RangeSlider` (time), `Segmented` (grade), `ProvenanceTag`, `Button` (`primary` "Show 23 sections", `link` "Back to defaults" and "Edit filters").

Request to the lead: a `/dev/controls` specimen for `RangeSlider`.

### Controls and defaults

| Group label | Control | Default | Summary words when changed |
|---|---|---|---|
| Seats | Chip "Open seats" | on | "Open seats" (named even at its default, see below) |
| Hide days | Chips Mon to Fri (on means hidden) | all off | "no Friday classes", "no Monday or Friday classes" |
| Time | RangeSlider, 8:00 AM to 10:00 PM, 30-minute steps | full range | "9 AM to 5 PM" |
| Format | Chips In person, Online, Hybrid | all on | "in person only", "no hybrid" |
| Site | Chip "Include other UNT sites" | off | "other UNT sites too" |
| Instructor's average grade | Segmented Any, 2.5 and up, 3.0 and up, 3.5 and up | Any | "3.0 and up" |

- The summary names everything that hides a section. Open seats is on by default and named anyway: unlike a Preference, a filter removes rows from view, and a student looking for a full section must be able to see why it is missing.
- A value of unknown never passes a filter (`docs/architecture/README.md`, "Filters"). A section with unknown seats is hidden while Open seats is on. A section whose instructor has no grade records is hidden unless the grade filter is Any.
- The day chips use the same "on means no classes" reading as Preferences' Days off, so the student learns one model.

### States, with exact copy
- **Default:** the Filters row reads "Filters" and then "Open seats". Under the results: "4 sections hidden by your filters." [Edit filters]. The line is absent when nothing is hidden.
- **Summary overflow:** when the summary doesn't fit on one line, it becomes the first item plus a count: "Open seats and 3 more". It never ellipsizes mid-word.
- **Empty, filters hide everything:** "No sections of CSCE 2110 match your filters." [Edit filters]
- **Empty, every section is full at the defaults:** "Every section of CSCE 2110 is full." [Show full sections] (turns Open seats off).
- **Loading:** under 400ms nothing changes. After 400ms the search glyph becomes a spinner (`SearchField loading`). The previous results stay until new ones arrive; the list never blanks.
- **Error, sections:** "Couldn't load Spring 2027 sections. Check your connection and retry." [Retry]
- **Error, grade records with the grade filter on:** "Grade records didn't load, so no section passes the grade filter. Retry, or set it to Any." [Retry]
- **Success:** each toggle updates the count in the button at once ("Show 23 sections", "Show 1 section"). The button returns to the results with the new summary. No toast: nothing needs undoing, and the summary row confirms the change.
- **Worst case:** a 40-character course title (the name truncates, the time never does); 0 results; a course with 60 sections; all six groups changed (summary overflow); a 360px phone.

### Wireframes

1440, search panel open:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ UNTangle [Courses|Week|Day]  ⌕ Search courses or class numbers ⌘K (Spring 2027 Main) SG │
├─────────────────────────────────────────────────┬───────────────────────────────────────┤
│ Preferences  Nothing before 9 AM  ↶ Export Auto │ Search                              ✕ │
│ This week fits your preferences.                │ [⌕ csce 2110                     ✕ ]  │
│ ┌ MON ──── TUE ──── WED ──── THU ──── FRI ───┐  │ Filters  Open seats and 2 more      > │
│ │ CSCE 2110          ┌╌╌╌╌╌╌╌╌┐              │  │ ───────────────────────────────────── │
│ │ 9:00 to 9:50       ╎ ghost  ╎              │  │ CSCE 2110 Foundations of Data Str...  │
│ │                    └╌╌╌╌╌╌╌╌┘              │  │   §002  Tue and Thu 9:30           +  │
│ │                                            │  │   §003  Mon and Wed 11:00          +  │
│ └────────────────────────────────────────────┘  │ 4 sections hidden by your filters.    │
│                                                 │ Edit filters        (Sample sections) │
└─────────────────────────────────────────────────┴───────────────────────────────────────┘
```

1440, Filters view (the same panel, its title becomes "Filters"):

```
                                                  ┌───────────────────────────────────────┐
                                                  │ Filters                             ✕ │
                                                  │ SEATS                                 │
                                                  │ [✓ Open seats]                        │
                                                  │ HIDE DAYS                             │
                                                  │ [Mon] [Tue] [Wed] [Thu] [✓ Fri]       │
                                                  │ TIME                                  │
                                                  │ ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●    │
                                                  │ Any time                              │
                                                  │ FORMAT                                │
                                                  │ [✓ In person] [Online] [Hybrid]       │
                                                  │ SITE                                  │
                                                  │ [Include other UNT sites]             │
                                                  │ INSTRUCTOR'S AVERAGE GRADE            │
                                                  │ [Any|2.5 and up|3.0 and up|3.5 and up]│
                                                  │ (UNT grade records 2019 to 2025)      │
                                                  │ Back to defaults   [Show 23 sections] │
                                                  └───────────────────────────────────────┘
```

390, search layer and Filters view:

```
┌────────────────────────────────────┐   ┌────────────────────────────────────┐
│ [⌕ csce 2110              ✕] Cancel│   │ Filters                            │
│ Filters  Open seats and 2 more   > │   │ SEATS                              │
│ ────────────────────────────────── │   │ [✓ Open seats]                     │
│ CSCE 2110 Foundations of Data S... │   │ HIDE DAYS                          │
│   §002  Tue and Thu 9:30        +  │   │ [Mon] [Tue] [Wed] [Thu] [✓ Fri]    │
│   §003  Mon and Wed 11:00       +  │   │ TIME                               │
│ 4 sections hidden by your filters. │   │ ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━●     │
│ Edit filters                       │   │ FORMAT  ...  SITE  ...  GRADE ...  │
│                                    │   │ (scrolls)                          │
│ ┌ keyboard ──────────────────────┐ │   │ ────────────────────────────────── │
│ └────────────────────────────────┘ │   │ Back to defaults [Show 23 sections]│
└────────────────────────────────────┘   └────────────────────────────────────┘
```

The phone foot is sticky, in the thumb zone, with a 52px (`lg`) primary button. The grade control is `fullWidth` on phones. Back (gesture, Esc, Android back) leaves Filters for the results before it closes search.

### What moves

| Change | MOTION.md §3 row |
|---|---|
| Open Filters, or Show 23 sections back to results | "Detail subject change while open": nothing, the content swaps |
| Toggle a chip | "Chip, switch, checkbox": background 120ms |
| Pick a grade | "Segmented pill": 220ms from a pointer, instant from the keyboard |
| Drag the time thumbs | Direct manipulation: the thumb follows the pointer, nothing eases |
| Count and results update | "Typing in search, filtering results": nothing |
| Point at a section row | "Week: ghost preview on hovering a search result": opacity 120ms (fine pointers only) |
| Phone search layer opens | "⌘K palette, phone search layer": nothing |

Reduced motion: the chip color change stays; the segmented pill jumps. Keyboard: every change above is instant.

### Accessibility
- The Filters row is one button named "Filters, Open seats, no Friday classes, in person only". Activating it focuses the first chip; Show N sections returns focus to the Filters row.
- Group names: `ChipGroup label="Hide days"`; each day chip's name is "Hide sections that meet on Friday". `RangeSlider thumbLabels={["Earliest start", "Latest end"]}`; `formatValue` gives "9:00 AM".
- The hidden-count line and the button count reach a polite live region, debounced to the last change, so dragging the slider doesn't flood a screen reader.
- Hidden sections are named in words, never only by graying a row.
- Chips get their 44px hit area from the primitive; the phone foot button is 52px.
- Escape on desktop closes the whole panel (`ContextPanel` owns Escape), and focus returns to the search trigger.

### Screenshots for the PR
Each at 1440x900 and 390x844, from the real app with sample sections, each passing [visual-qa.md](visual-qa.md):
1. Search panel at the defaults, with the hidden-count line.
2. Filters view at the defaults.
3. Filters view with four groups changed, and the summary it produces (overflowing on phone).
4. No sections match.
5. Every section is full.
6. The grade records error.
7. Keyboard focus on a day chip.
8. The Filters view at 360x780, because the grade control is the densest row.

### Placeholders and questions
- Open seats on by default, the 8 AM to 10 PM time range and the 2.5, 3.0 and 3.5 grade steps have no data behind them. Label them in code as starting values.
- Where filters persist: this recipe keeps them on this device, per term, until the lead decides whether they belong in the `preferences` document.
- TAMS rules is out of scope until Dylan defines what it filters.
