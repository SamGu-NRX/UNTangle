# Design guidance for UNTangle

Readers: anyone building UI for UNTangle, including Obvious Autobuild agents. The v3 design specifies the screens it drew. These pages tell you where a new feature goes, what it says, which controls it uses and what it must not do.

## Read these, in this order

| When | Read |
|---|---|
| Before your first UI task | [do-not.md](do-not.md), all of it. It is short. |
| You need to decide where a feature lives | [surfaces.md](surfaces.md), including the decision tree |
| You write any word a student will see | [copy.md](copy.md) |
| You pick a control | [components.md](components.md), then open `/dev/controls` on the dev server (`bun run dev` in `frontend/`) |
| Before you write code | Fill [recipe-template.md](recipe-template.md) and get the lead's approval |
| You take screenshots | [visual-qa.md](visual-qa.md), on every capture set |
| You need a motion value | `untangle-v3-opus/MOTION.md` §3 (what moves), §10 (reduced motion) |
| You need a color, size or spacing value | `frontend/src/app/globals.css`. Never type a hex value or pixel size that has a token. |

## Sam's rules

These override every other design document, these pages included.

1. One fact per row.
2. No mid dots (U+00B7) or other separator glyphs. Design so you never need one.
3. Simplify by moving depth one step away, never by removing a capability.
4. Syne only for the UNTangle wordmark and the standalone "[UNT] Schedule Builder" wordmark. Course codes are DM Sans semibold with tabular numerals.
5. PR screenshots come from the real app, never from mockups.
6. Every screenshot set passes [visual-qa.md](visual-qa.md).
7. Phone hit areas are at least 44px.
8. Focus is always visible.
9. Reduced motion is respected.
10. Keyboard-initiated actions never animate.

## Which document wins

1. Sam's rules above.
2. These pages and `visual-qa.md`.
3. The simplification rules and decisions in [untangle-v3.md](untangle-v3.md).
4. The Opus `DESIGN.md`, `MOTION.md` and `HANDOFF.md`.
5. The mockups and `screens/` captures in `untangle-v3-opus/`.

The mockups are older than these pages. They set course codes, plates and figures in Syne and write ranges as "9:00–9:50". Follow these pages instead: DM Sans, and "9:00 to 9:50".

## What you may not change

The lead owns `components/ui/**`, `app/globals.css`, the shells (top bar, phone header, tab bar), the Day hero and map camera, Auto's reveal, the week grid and the extension's conflict overlay. If your feature needs a change there, say so in your recipe and ask. Don't copy a primitive into your feature folder and edit the copy.
