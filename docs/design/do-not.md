# Do not

Each line is a habit that makes UNTangle look like every other app, and the reason UNTangle doesn't do it. A reviewer may reject a PR for any one of them.

## Layout

- **No shadowed cards for lists.** Rows sit on the page with a hairline between them (rule 9); the `surface-card` utility in `globals.css` exists only for legacy pages.
- **No card inside a card.** The term tray, the week grid and the context panel are the only boxes on a page.
- **No icon on every row.** A glyph appears only when it carries status, so a row with a glyph stands out.
- **Nothing new in the header.** It holds the wordmark, the three lenses, search, the schedule switcher and the account, and that list is closed.
- **No new tab, rail or sidebar.** Sam found the v3 sidebars confusing; the top bar is the only navigation.
- **No second panel, and no panel when nothing is selected.** One selection, one panel, and an empty page edge otherwise.
- **No stat tiles, KPI rows or dashboards.** Rule 5 removed every figure that doesn't change a decision; a tile row brings them back as decoration.
- **No second fact on a row.** The rest goes one step away in the detail panel.
- **No banners.** A warning is one inline line with its fix, or a quiet glyph when there is no fix.
- **No dropdown for choosing a value.** Five options or fewer are a `Segmented` or chips; more is a search list in a dialog. `Menu` is for ⋯ actions only.
- **No dialog for information about a selection.** That is the context panel; dialogs are for tasks with an end.

## Type and color

- **No Syne outside the two wordmarks.** Course codes are DM Sans 600 with tabular numerals (Sam's rule; the mockups predate it).
- **Color only for meaning.** Department tint for courses, attention for "check" and tight walks, danger for conflicts, late walks and errors, brand for the primary action and selection, accent for focus and "taking now". No decorative gradients or colored headers.
- **No new hex values.** Every color is a token in `globals.css`, where its contrast is tested.
- **No `--accent` text and no `--ink-3` text.** Accent is 3.12:1 on white and ink-3 is 4.26:1; both fail body text.
- **No course color as text under 14px.** The six hues are tints for blocks and bars.
- **No mid dots, bullets, pipes or slashes between facts.** Sam's rule; the `no-mid-dots` test catches the mid dot, and reviewers catch the rest.
- **No exclamation marks, apologies or AI words.** See [copy.md](copy.md), "Banned".

## Motion

- **No stagger, except the thesis artifacts on the first-visit page.** Lists run to 100+ rows and are seen many times a day.
- **No animation on keyboard-initiated actions.** Check `event.detail === 0` or `keyboardFocused()` as the primitives do; a keyboard user repeats the action too often to wait for it.
- **No layout-animating properties.** Animate `transform` and `opacity` only; never `height`, `width`, `top`, `left`, `margin`, `padding`, `flex-grow` or grid tracks. Heights snap, and content below moves by FLIP.
- **No `transition: all`, and no transitioned shadows or borders.** Name the properties; shadows and borders repaint, so they change instantly.
- **No `ease-in`, no bounce curve, nothing scaling from 0.** Entrances use `--ease-out`; `--ease-bounce` is retired; dialogs start at .96.
- **No new duration.** Use the `--t-*` tokens and cite the `MOTION.md` §3 row in your recipe. If no row fits, the answer is probably "nothing moves".
- **No movement under reduced motion.** Translate and scale go; opacity changes stay at about 120ms.
- **Nothing moves under the student because of background work.** The optimizer improving, tiles loading or a save finishing never shifts what they are reading or previewing.

## Interaction

- **No hover-only affordance.** Hover styles live inside `(hover: hover) and (pointer: fine)`; phones get a tap and `:active` feedback.
- **No hit area under 44px on a coarse pointer.** The primitives extend theirs with `::after`; do the same for anything custom.
- **No removed focus ring.** `outline: none` only alongside the `--focus` box-shadow, which the primitives already draw.
- **No tooltip holding the only copy of an instruction.** Phones can't hover.
- **No spinner or skeleton for work under 400ms.** It flashes and makes fast work look slow.
- **No toast for a field's error, and never two toasts.** The error goes under the field; a new toast replaces the old one.
- **No glass on glass.** The frosted material is for chrome over moving content only: the top bar, tab bar, Day sheet and map controls.

## Process

- **No mockup screenshots in a PR.** Capture the real app at 390 and 1440, and run [visual-qa.md](visual-qa.md) on every set.
- **No code before an approved recipe.** See [recipe-template.md](recipe-template.md).
- **No private copy of a primitive.** `components/ui/**` is lead-owned; ask for the change.
- **No removed capability.** Simplify by moving depth one step away, and say in the recipe where the moved thing now lives.
