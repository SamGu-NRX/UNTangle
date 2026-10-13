# UNTangle v3: the build direction

Two designers rethought UNTangle independently: Opus in [`untangle-v3-opus/`](untangle-v3-opus/) and Fable in [`untangle-v3/`](untangle-v3/). This page says which parts ship. Where it is silent, follow the Opus documents. Implementers build from the Opus [HANDOFF](untangle-v3-opus/HANDOFF.md) in its order, with the changes below.

## Why Opus is the base

Both designs reached the same structure on their own: three lenses over one plan (Courses for the degree, Week for the term, Day for today), Day as the phone's morning home, named schedules, adding a section in one tap with the conflict shown first, walk time between classes, a "No set time" strip, the popup-window import, and one builder serving UNTangle and vsb v2. Opus carries that structure further and proved it:

- **Week matches vsb's layout.** Find courses, the grid, and a registration list with "Copy class numbers for myUNT". Students moving from vsb.untgrades.app find what they know.
- **Courses is ordered by what a student can do:** the term tray (where Auto lives), To check, You can take, Taking now, Later, Done. Each row carries one glyph and one fact.
- **Day leads with the answer:** "Leave Kerr Hall by 8:49 · in 12 min".
- **No dropdowns for choosing values.** Five options or fewer become a segmented control or chips; longer lists open a search sheet. This answers Sam's complaint that the dropdowns looked inelegant.
- **Verified.** Axe is clean on every mockup at 1440×900 and 390×844, and the prep-for-prod findings were fixed.

## What comes from Fable

1. **The walk is drawn.** One 2px green line is the route on the map, the connector between stops in Day, and the connector between consecutive classes in Week, with the minutes chip sitting on it. It turns red as "late" when the walk is longer than the break, and amber as "tight" within two minutes. Walking time is what no other UNT planner has, so it is the visual that repeats ([Fable DESIGN, H2](untangle-v3/DESIGN.md)).
2. **One app, branded by host.** `brand.ts` picks the name and defaults by hostname. On vsb.untgrades.app it is "UNT Schedule Builder" with no account, the Find column open, a term picker and the data-freshness line. On untangleapp.vercel.app it is UNTangle.
3. **The best-so-far upgrade animates in place.** When the optimizer improves a figure, it crossfades through a 2px blur with no reflow. Opus's rule also holds: never swap the grid while the student is previewing an option. Offer "A better option is ready · Show" instead.

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

## Placeholders with no data behind them

Label these in code as starting values and revisit with real use:

- the 2-minute leave-by buffer;
- class numbers ordered fewest open seats first;
- what the TAMS toggle filters, which needs vsb's definition from Dylan;
- the over-load warning at 15 credits;
- 30-day version history.

## Fixes found when rendering the mockups

- **Fable phone header:** the plan chip wraps "Spring 2027" onto two lines, and the search field runs past the edge. Opus's header doesn't, so use it.
- **Fable Week rail:** the lock and remove icons fall onto their own line, and "48 min walking / wk" wraps. Use Opus's registration list.
- **Dev bars:** both sets of mockups have a state bar that covers part of the phone sheet. It's a mockup aid, not part of the design.
