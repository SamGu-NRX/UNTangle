# Components

Every primitive in `frontend/src/components/ui/`, read from the code at the commit that added this page. Props listed are the ones a feature sets; each component also passes through its native element's props. `/dev/controls` (`components/ui/dev/ControlsSpecimen.tsx`) renders the live specimens; the "Specimen" line names its card.

Build features from these. If none fits, ask the lead: `components/ui/**` is lead-owned, and a near-copy in a feature folder is the start of a second design system.

Two rules hold for every primitive:
- Course codes inside any of them use the `.ui-code` class, which `ui.css` renders in DM Sans 600 with tabular numerals (Sam's rule).
- Each primitive already handles focus rings, 44px coarse-pointer hit areas, reduced motion and keyboard-instant behavior. Don't override its transitions or `:focus-visible` styles.

## Actions

### Button, IconButton (`Button.tsx`)
- **Props:** `variant`: `primary`, `secondary`, `quiet` (brand text, no fill), `ink` (ink text, no fill), `destructive`, `link`. `size`: `sm` 32px, `md` 40px, `lg` 52px. `loading` with `loadingLabel`; `icon` (leading glyph). `IconButton` requires `label`, its accessible name, and defaults to `ink`.
- **States:** rest, hover (fine pointers only), press (scale .97, off under reduced motion), focus, disabled, loading (width held, `aria-busy`, keeps focus).
- **Use when:** `primary` for the one main action on a screen (Auto, Use the downloaded PDF). `secondary` for the next one (Open in Week, Show a fix). `quiet` for inline brand actions (Undo). `ink` for Cancel and glyph buttons. `destructive` only inside a confirm dialog. `link` for an action inside a sentence (Import again, Back to defaults).
- **Don't use when:** a screen already has a primary button. Never `SplitButton` (deprecated: v3 has one Auto button) or `variant="ghost"` (the v2 name for `secondary`).
- **Specimen:** Button.

### Menu (`Menu.tsx`)
- **Props:** `label` (accessible name), `items` (`{ id, label, onSelect | href, icon?, shortcut?, destructive?, disabled?, current? }`, plus `{ kind: "separator" }` and `{ kind: "label" }`), `trigger` (render prop; spread its props onto a button), `align`, `header`.
- **States:** closed, open (anchored, 120ms exit), item active, disabled, destructive.
- **Use when:** the ⋯ overflow of one item: Rename, Duplicate, Export, Delete.
- **Don't use when:** choosing a value. That is `Segmented`, `Chip`, or a search list in a dialog (DESIGN.md §9 rule 1). The one exception is the schedule switcher (`surfaces.md`), which moves you to another schedule rather than setting a field, and marks the open one with `current`.
- **Specimen:** Also in components/ui.

## Choosing

### Segmented (`Segmented.tsx`)
- **Props:** `label`, `options` (`{ value, label, disabled? }`), `value` (or `null`), `onValueChange`, `size` (`md`, `sm`), `fullWidth` (phones).
- **States:** selected, focus, disabled option. The pill slides 220ms from a pointer and jumps from the keyboard.
- **Use when:** one choice from two to five short options, all visible: Courses, Week, Day; Start after (Any time, 9 AM, 10 AM, 11 AM); Most credits; Campus.
- **Don't use when:** several can be on at once (`Chip`), or there are more than five options (a search list in a dialog).
- **Specimen:** Segmented.

### Chip, ChipGroup (`Chip.tsx`)
- **Props:** `selected`, `onSelectedChange`, `count` (a quieter fact after the label, such as "10 min"), `size` (`md` 32px, `sm`), `tone` (`warn` for a choice that costs something). `ChipGroup` requires `label`.
- **States:** off, on (brand-soft fill, brand ring, check), hover, press, focus, disabled. Only color changes, over 120ms.
- **Use when:** independent on/off choices shown together: No Fridays, Lunch break, Short walks; days off; filter toggles.
- **Don't use when:** the choices exclude each other (`Segmented`) or the setting is a lasting on/off preference with a description (`Switch`).
- **Specimen:** Chip.

### Switch (`Switch.tsx`)
- **Props:** `checked`, `onChange`, `label`, `description`, `ariaLabel` (when there is no `label`), `disabled`.
- **States:** off, on, focus, disabled. The knob slides from a pointer, jumps from the keyboard.
- **Use when:** a true on/off setting that reads as a sentence: "Leave-by alerts in the calendar file", "Show walking times".
- **Don't use when:** a status with three values, or a filter in a row of others (`Chip`).
- **Specimen:** Switch.

### Checkbox, Radio (`Checkbox.tsx`)
- **Props:** native input props plus `label`, `description`; `Checkbox` also takes `indeterminate`.
- **States:** unchecked, checked, indeterminate, focus, disabled.
- **Use when:** a form with a submit step, or a list where the student selects several rows for one action.
- **Don't use when:** the change applies at once. Use `Chip` or `Switch`.
- **Specimen:** Also in components/ui.

### Slider, RangeSlider (`Slider.tsx`)
- **Props:** `label`, `min`, `max`, `step`, `value`, `onValueChange`, `formatValue`, `minLabel`, `maxLabel`, `ticks`, `disabled`. `RangeSlider` adds `minGap` and `thumbLabels`.
- **States:** rest, dragging (value bubble), keyboard focus (bubble), disabled. Two range thumbs never cross.
- **Use when:** a continuous amount where the exact value matters less than the region: "Longest walk", a time window.
- **Don't use when:** there are five or fewer meaningful stops. A `Segmented` shows them all.
- **Specimen:** Also in components/ui (Slider only; `RangeSlider` has no specimen yet).

### Select (`Select.tsx`)
Legacy. It is a value-choosing dropdown, which v3 removed, and it has no specimen. Don't use it in new UI; existing v1 callers keep it until their lens is rebuilt.

## Text input

### TextField (`TextField.tsx`)
- **Props:** `label` (required), `hideLabel`, `help`, `error`, `leading`, `trailing`, `size`.
- **States:** rest, focus, filled, error (help text turns danger, border turns danger, `aria-invalid`), disabled.
- **Use when:** free text: a schedule name, email, password, a busy time's label.
- **Don't use when:** the value comes from a known list. Search it instead.
- **Specimen:** Search and text fields.

### SearchField, SearchTrigger (`SearchField.tsx`)
- **Props:** `SearchField`: `label`, `loading` (spinner replaces the search glyph), `onClear`, `shortcut`, `size` (`md`, `lg`). `SearchTrigger`: `placeholder`, `shortcut`, `compact`.
- **States:** empty (shortcut hint on fine pointers), typing, filled (clear button), loading.
- **Use when:** `SearchField` filters a list in place, such as search inside the Week panel. `SearchTrigger` is a button drawn as a field that opens search; the top bar owns it.
- **Don't use when:** you want a second global search box. There is one, in the top bar.
- **Specimen:** Search and text fields.

### SearchPalette (`SearchPalette.tsx`)
The ⌘K layer. It opens and closes with no animation, keeps focus in the input, moves through results with ↑ and ↓, opens with Enter, plans with ⌘Enter, and fills the screen below 760px. The shell owns it. Feed it `SearchSection`s; don't mount a second one. No specimen.

### DateInput, DatePicker, TermPresets (`DateInput.tsx`)
- **Props:** `DateInput`: `label`, `value`, `onChange`, `help`, `error`, `min`, `max`, `today`. `DatePicker`: `mode` (`single` or `range`) and `presets`. `TermPresets`: chips that fill a whole term's range in one tap.
- **States:** empty, typed ("1/20/27" is accepted on Enter or blur), picked, out of bounds ("Pick a date on or after Jan 19, 2027."), disabled. Coarse pointers get the native date input.
- **Use when:** a real calendar date: first day of classes, a dated busy time.
- **Don't use when:** a weekday or a time of day. Use chips or a segmented control.
- **Specimen:** Also in components/ui (`DateInput` only).

## Containers

### ContextPanel (`ContextPanel.tsx`)
- **Props:** `open` (true while something is selected), `onClose`, `title` (heading and accessible name, such as "CSCE 2110"), `returnFocus` (the selected item), `children`.
- **States:** closed (renders nothing), open, content swapped (no animation), closing. From 1200px the page slides aside by transform; narrower, the panel overlays. A keyboard open, Escape, or Enter on Close is instant. On phones it renders a `BottomSheet` at 52% and 92%.
- **Use when:** the detail of one selection, or a lens's settings (Preferences, search).
- **Don't use when:** nothing is selected, or the task needs the page blocked (`Dialog`). Never open two.
- **Specimen:** Context panel.

### BottomSheet (`BottomSheet.tsx`)
- **Props:** `open`, `onOpenChange`, `title`, `detents` (default `["92%"]`; detail sheets pass `["52%", "92%"]`), `initialDetent`, `detent` and `onDetentChange` (controlled), `modal`, `dismissible`, `glass`, `closeOnBack`, `returnFocus`, `header`, `initialFocus`.
- **States:** each detent, dragging (follows the finger), settling (spring), dismissing. Reduced motion jumps between detents with a short opacity dip.
- **Focus on open:** a modal sheet opened without `initialFocus` focuses its heading, else its first control after the resize handle, else the sheet. The heading takes `tabindex="-1"` and draws no ring, because it is not a control; the handle stays in the Tab order and shows its ring when a keyboard user reaches it. Only a heading or control that belongs to this sheet counts: anything hidden, inert, or inside a dialog, menu or listbox nested in the sheet is skipped. Because a focused heading sits outside the Tab order, the Tab trap wraps from it: Shift+Tab from a heading before every stop goes to the last stop, and Tab from one after them goes to the first.
- **Use when:** you need a phone sheet that `ContextPanel` or `Dialog` doesn't already give you. The Day itinerary is the non-modal, glass case.
- **Don't use when:** on desktop. Don't stack a second sheet; replace the first sheet's content.
- **Specimen:** Toast, dialog, sheet ("Course sheet", "Day sheet").

### Dialog (`Dialog.tsx`)
- **Props:** `open`, `onOpenChange`, `title`, `ariaLabel` (when untitled), `description`, `footer` (right-aligned buttons), `width` (default 480), `dismissible`, `role` (`alertdialog` for a decision), `initialFocus`.
- **States:** opening (scale .96 to 1 from the center, 220ms), open (page inert), closing (150ms). Instant from the keyboard.
- **Use when:** major picker, Export, Sign in, a destructive confirm ("Delete Fridays off?" with Keep it and Delete).
- **Don't use when:** showing information about a selection (`ContextPanel`), or confirming something a toast's Undo already reverses.
- **Specimen:** Toast, dialog, sheet. `Modal.tsx` is a deprecated wrapper around `Dialog`; don't use it.

### Toast (`Toast.tsx`)
- **API:** `toast(message)` or `toast({ message, action?: { label, onClick }, tone?: "error", duration? })`; `dismissToast(id?)`. The shell mounts the one `<Toaster />`.
- **States:** plain (leaves after 5s, paused while hovered, focused or the tab is hidden), with action (stays until dismissed), error (stays until dismissed). One at a time; a new toast replaces the old.
- **Use when:** confirming an action that just happened: "Removed CSCE 2610" with Undo.
- **Don't use when:** an error belongs to a field (`TextField error`), or the information must persist. New code calls `toast()` from `ui/Toast`, never the legacy `ToastProvider` in `planner-provider.tsx`.
- **Specimen:** Toast, dialog, sheet.

### Tooltip (`Tooltip.tsx`)
- **Props:** `content`, `children` (one element that takes a ref), `side`, `openOnTap`.
- **States:** hidden, waiting 400ms, open; opens at once when another tooltip just closed.
- **Use when:** a supplementary explanation: the source behind a `ProvenanceTag`, "146 students, 35% A" on a grade bar.
- **Don't use when:** it would hold the only copy of an instruction. Phones can't hover.
- **Specimen:** Also in components/ui.

## Domain marks

### StatusGlyph (`StatusGlyph.tsx`)
- **Props:** `status`: `done`, `covered`, `taking`, `planned`, `available`, `locked`, `check`; `label` overrides the default accessible name.
- **Use when:** the course status on a Courses or search row. Each status has its own shape, so none rests on color alone.
- **Don't use when:** anything other than course status. `StatusMark.tsx` is deprecated.
- **Specimen:** Plate, status, provenance.

### Plate (`Plate.tsx`)
- **Props:** `building` ("GAB"), `room` ("535"), `name` (read aloud and shown on hover), `quiet` (paper-3 plate for dense lists).
- **Use when:** a building and room in a detail panel, a section row or a selected Day stop.
- **Don't use when:** a Week event or a Courses row. Rule 4 moved rooms to the panel.
- **Specimen:** Plate, status, provenance.

### ProvenanceTag (`ProvenanceTag.tsx`)
- **Props:** `children` (short text, such as "Sample sections"), `source` (one sentence for the tooltip), `glyph`.
- **Use when:** once per lens or panel, to say where data came from.
- **Don't use when:** per row, or as a general badge.
- **Specimen:** Plate, status, provenance.

### PathLine, PathStop (`PathLine.tsx`)
- **Props:** `PathLine`: `orientation` (`vertical`, `horizontal`), `label`. `PathStop`: `marker` (a number or 14px glyph), `tone` (`default`, `past`, `ring`, `here`), `leg` (`done`, `todo`, `past`, `walk`, `tight`, `late`), `chip` ("4 min").
- **Use when:** order is real: the day's walk, a prerequisite chain, import steps, version history. Tight and late legs add hidden words, so they are never told by color alone.
- **Don't use when:** a plain list with no order. That is a row list.
- **Specimen:** Path line.

### ProgressBar (`ProgressBar.tsx`)
- **Props:** `value`, `max`, `indeterminate`, `aria-label`. `pct` and `label` are v1 props; don't use them.
- **Use when:** work with a real fraction, or an indeterminate wait over 400ms.
- **Don't use when:** degree progress on Courses. That is the sentence "54 of 120 credits" (rule 8).
- **Specimen:** Also in components/ui.

### Kbd, icons (`Kbd.tsx`, `icons.tsx`)
`Kbd` draws a key cap ("⌘K", "esc"). `icons.tsx` holds every glyph the app uses: chevrons, Check, Close, Plus, Minus, Undo, TrayIn (Auto), Walk, More, External, Calendar, Search, the three lens glyphs, and `Spinner`. Add a glyph there, through the lead, rather than importing an icon library.

## Known gaps

- `RangeSlider`, `DatePicker` in range mode, `TermPresets` and `SearchPalette` have no `/dev/controls` specimen.
- `Row` and `FactList` were proposed as primitives and don't exist. Build rows from the anatomy in [surfaces.md](surfaces.md).
