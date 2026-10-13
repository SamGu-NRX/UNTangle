# UNTangle v3: motion system

Who reads this: the implementer of the tokens slice first (they paste §2), then every view implementer (they read the row for their interaction in §3 and the recipe in §5–§9). Values here are design proposals. None has been timed on a device; the acceptance checks in `HANDOFF.md` are where they get judged.

## 1. Principles

1. **Frequency decides.** Lens switching, ⌘K, arrow keys, Esc, Undo, typing: never animate. Panels, sheets, menus, toasts: standard, under 300ms. First-visit moments (import review, the first Auto): the delight budget, still under 1s total.
2. **Name the purpose or don't animate.** Every row in §3 has one of: feedback, spatial consistency, state indication, preventing a jarring change, delight (first-time only).
3. **Transform and opacity only.** Plus `clip-path` for the Auto wash and `background-color` for hover. Never width, height, top, left, margin or padding. Accordions are the one tolerated height animation and this product has none.
4. **Exits are faster than enters.** Enter 200, exit 150. Popovers 160/120. Sheets 260/200.
5. **Nothing appears from nothing.** Entrances start at `scale(.97)` or `translate(8–16px)` with opacity, never `scale(0)`.
6. **Interruptible by construction.** CSS transitions, not keyframes, for anything a student can trigger twice in a second (toasts, chips, swaps, options). Springs only where a gesture carries velocity (sheet release).
7. **The map camera is the one slow thing.** 500ms, because it moves across a campus and changes pitch; everything else stays under 300ms. (From `apple-maps-web/camera.md`.)
8. **Reduced motion means gentler, not none.** Translate and scale become none; opacity stays at 120ms; the camera jumps; the route never animates anyway.

## 2. Tokens

Paste into `globals.css` next to the color tokens in `DESIGN.md` §5.

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);       /* enters, exits, presses */
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);   /* on-screen movement (bars, pill) */
  --ease-sheet: cubic-bezier(0.32, 0.72, 0, 1);     /* sheets and detents (Ionic's iOS curve) */
  --ease-camera: cubic-bezier(0.19, 1, 0.22, 1);    /* map flights; MapLibre needs the function form, see §7 */
  --t-press: 120ms;    /* button and row press */
  --t-hover: 160ms;    /* hover color, segmented pill, toggle knob */
  --t-pop: 160ms;      /* menus, listboxes, popovers enter (exit --t-exit) */
  --t-enter: 200ms;    /* panels, notes, toasts enter */
  --t-exit: 150ms;     /* panels, notes, toasts, popovers exit */
  --t-sheet: 260ms;    /* sheet enter and programmatic detent change; exit 200ms */
  --t-swap: 120ms;     /* opacity crossfades: bars, event swap, figures */
  --t-camera: 500ms;   /* map flyTo for a stop or leg */
}
@media (prefers-reduced-motion: reduce) {
  :root { --t-press: 0ms; --t-hover: 120ms; --t-pop: 120ms; --t-enter: 120ms; --t-exit: 120ms; --t-sheet: 0ms; --t-camera: 0ms; }
}
```

Motion (motion.dev) spring for the sheet release after a drag, with the drag velocity passed in:

```ts
export const sheetSpring = { type: "spring", stiffness: 420, damping: 42, mass: 1 } as const; // no bounce; settles ≈ 260ms
export const sheetFlick  = { type: "spring", stiffness: 520, damping: 46, mass: 1 } as const; // after a fast flick
```

## 3. What animates and what deliberately does not

| Interaction | Animates? | Purpose | Properties | Timing |
| --- | --- | --- | --- | --- |
| Lens switch (tabs, segmented, ⌘1/2/3) | no | | | content swaps at once; only the segmented pill slides |
| Segmented pill, DaySwitcher pill | yes | state indication | transform | 160ms ease-out |
| ⌘K palette open/close | no | | | |
| Keyboard: ↑/↓ selection, Enter open, Esc close, ⌘Z undo | no | | | |
| Button / row press | yes | feedback | transform scale(.97) | 120ms ease-out; none under reduced motion |
| Hover on rows, chips, menu items | background only | feedback | background-color | 160ms ease; gated to `(hover: hover) and (pointer: fine)` |
| Chip, checkbox, toggle state | yes | state indication | background-color; toggle knob transform | 120–160ms |
| Menu, listbox, popover | yes | preventing a jarring change | opacity + scale(.97→1), origin at trigger | 160ms / 120ms ease-out |
| DetailPanel (desktop) enter / exit | yes | spatial consistency (comes from the right, where it lives) | opacity + translateX(16px→0) | 200 / 150ms ease-out |
| DetailPanel subject change (↑/↓ or a code chip) | no | | content swaps in place | |
| Bottom sheet enter / exit | yes | spatial consistency | translateY(100%→0) | 260 / 200ms ease-sheet |
| Sheet detent change (programmatic) | yes | state indication | translateY | 260ms ease-sheet |
| Sheet release after drag | yes | feedback | translateY via spring with velocity | `sheetSpring` / `sheetFlick` |
| Scrim | yes | preventing a jarring change | opacity | 200 / 150ms |
| Toast | yes | spatial consistency (enters and leaves through the bottom) | opacity + translateY(8px) | 200 / 150ms; one at a time; pauses on hover and hidden tab |
| AutoNote | yes | state indication | opacity + translateY(4px) | 200ms; exit 150ms |
| Auto reveal in Courses | yes | state indication, first-time delight | clip-path wash on `::before`, staggered | §6 |
| Auto in Week: options appear | yes | preventing a jarring change | opacity + 2px blur crossfade of the rail face | 160ms |
| Best-so-far figure upgrade | yes | state indication | opacity .5 + blur(2px) then back, in place | 120ms each way, §6 |
| Option hover → ghost on grid | yes | state indication | opacity 0→.75 | 120ms; nothing else moves |
| Section swap on the grid | yes | preventing a jarring change | old event opacity→0, new event opacity 0→1 at its new place | 120ms each; no FLIP, no movement |
| Pick-on-grid ghosts appear | yes | state indication | opacity | 120ms |
| Grade bars, instructor change | yes | preventing a jarring change | opacity crossfade; bar heights do not tween | 120ms |
| Copy → Copied | yes | feedback | opacity + scale(.9→1) swap of the two labels | 160ms; reverts after 1.5s |
| Import page state change | yes | preventing a jarring change | opacity + blur(2px) crossfade; height snaps | 160ms |
| Drop overlay | yes | state indication | opacity | 120ms; the dashed frame does not move |
| Reading steps | yes | state indication | spinner rotation only | 0.8s linear |
| Map flyTo for a stop or leg | yes | spatial consistency | camera | 500ms ease-camera; §7 |
| Map zoom buttons, fit, north | yes | feedback | camera | 250ms easeTo |
| Pin select | yes | state indication | circle radius (paint) | 160ms; no pulse, ever |
| Route line | no | | | never animates: no dashes marching, no draw-on |
| List reorder (CourseBlocks drag) | yes | spatial consistency | transform (FLIP on the siblings) | 160ms ease-in-out; §8 |
| Row add / remove in lists | no height animation | | opacity 120ms on the row; siblings reflow at once | |
| First render of any list | no | | lists can be 100+ rows | |
| Saturday column appearing | no | | | |

## 4. Enter and exit recipes

Panels and notes use `@starting-style` so there is no mount flag:

```css
.panel-in { opacity: 1; transform: none; transition: opacity var(--t-enter) ease, transform var(--t-enter) var(--ease-out); }
@starting-style { .panel-in { opacity: 0; transform: translateX(16px); } }
.panel-in[data-leaving] { opacity: 0; transform: translateX(16px); transition-duration: var(--t-exit); }
```

Popovers scale from the trigger. Modals (the import error dialog is the only one) stay centered:

```css
.menu { transform-origin: var(--transform-origin, top right); }
.menu[data-starting-style], .menu[data-ending-style] { opacity: 0; transform: scale(.97); }
```

Sheets:

```css
.sheet { transform: translateY(0); transition: transform var(--t-sheet) var(--ease-sheet); }
.sheet[data-state=closed] { transform: translateY(100%); transition-duration: 200ms; }
.sheet[data-dragging] { transition: none; }
```

Shared-element motion: there is none between lenses. The plan is one object and the lenses are instant; a shared-element flight from a course row to a grid event would imply the student is "travelling" between views, which the IA says they are not. The one shared element is the route ribbon's color and width, which is identical in Week, Day and the map, so the eye recognises it without motion.

## 5. Sheet physics

- Detents (phone): peek 112px, half `max(320px, 50dvh)`, full `100dvh − 8%`. The DaySheet is non-modal (no scrim, map stays interactive). Detail, Options, Export, Search sheets are modal with a scrim.
- Drag: pointer capture on `pointerdown`; ignore a second pointer once a drag began; `touch-action: none` on the sheet chrome, `pan-y` on the scrolling body; the body's drag starts the sheet only when `scrollTop === 0`.
- During the drag: set `transform` directly on the sheet element, never a CSS variable on a parent (that recalculates every child).
- Damping past the top detent: `h = max + (h − max) × 0.3`.
- Release: velocity `v = Δy / Δt` in px/ms. If `|v| > 0.11`, go one detent in the direction of travel (or dismiss, for a modal sheet dragged down) regardless of distance; otherwise snap to the nearest detent. Settle with `sheetSpring` carrying `v`, or `--t-sheet` ease-sheet when Motion is not on that surface.
- The map's bottom padding equals the settled sheet height; refit once per settled detent, never per frame (`camera.md`).
- Reduced motion: detent changes and dismissals are instant; the scrim still fades 120ms.

## 6. Auto's reveal

Courses. Click "✦ Auto" → the button holds its width and shows a 14px spinner with "Planning…"; rows keep their state (no skeletons). When the engine returns (target under 400ms; the worker's first result), for each row that became Planned, in list order:

```css
.row::before { content: ""; position: absolute; inset: 0; background: var(--brand-soft); clip-path: inset(0 100% 0 0); opacity: 0; }
.row.wash::before { animation: wash 900ms var(--ease-out) both; animation-delay: calc(var(--i) * 40ms); }
@keyframes wash { 0% { clip-path: inset(0 100% 0 0); opacity: 1 } 30% { clip-path: inset(0 0 0 0); opacity: 1 } 100% { clip-path: inset(0 0 0 0); opacity: 0 } }
```

Stagger 40ms, capped at the first 8 rows (later rows change state at once). The StatusMark and the word change at `--i × 40ms` with no transition. The AutoNote enters at the same moment as the first wash. Undo reverts with no animation. Keyframes are acceptable here because the wash cannot be re-triggered mid-flight (the button is disabled while running). Reduced motion: no clip-path sweep; the wash is a 400ms opacity fade of the tint.

Week. Click "✦ Auto" → "Arranging…"; within 300ms the rail flips to Options (160ms opacity + blur crossfade), three OptionCards render with the worker's first figures, option A's ghosts appear on the grid (opacity 120ms), and the 2px progress line runs indeterminate. When a better result arrives, only the figures that changed crossfade in place:

```js
el.classList.add('swap');            // .swap { opacity: .5; filter: blur(2px); transition: opacity 120ms ease, filter 120ms ease }
setTimeout(() => { el.textContent = next; el.classList.remove('swap'); }, 120);
```

Cards never reorder while the worker runs; the letter is the identity. When the worker finishes, the header drops "best so far" and the progress line fills and stops. "Use" applies the option: the moved events swap (120ms out, 120ms in at the new place) and the toast "Using option B · 2 sections moved · Undo" appears.

## 7. Map camera choreography

Follow `apple-maps-web/camera.md` exactly; this section only restates the motion rules in one place.

- Stop or leg activation by pointer or touch: `map.stop()`, then `flyTo` for 500ms with `cameraEase`, pitch 45°, bearing 0, zoom ≤ 17.8 (stop) or ≤ 17.6 (leg). Keyboard activation in the list: `jumpTo`.
- Fit the day (overview, day change, resize, detent settle): `jumpTo` / `fitBounds` with duration 0.
- Zoom buttons, north reset: `easeTo` 250ms.
- A new selection during a flight wins immediately. A user gesture during a flight cancels it and cancels the pending projected-fit correction.
- Hover never moves the camera. Pins never pulse. The route never animates.
- `cameraEase` is the cubic-bezier(0.19, 1, 0.22, 1) evaluated by inverting x, not by applying the y polynomial to time:

```ts
export function cameraEase(t: number): number {
  // cubic-bezier(0.19, 1, 0.22, 1): solve x(u) = t for u by Newton's method, then return y(u)
  const [x1, y1, x2, y2] = [0.19, 1, 0.22, 1];
  const bx = (u: number) => 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u ** 2 * (1 - u) + u ** 3;
  const by = (u: number) => 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u ** 2 * (1 - u) + u ** 3;
  const dbx = (u: number) => 3 * x1 * (1 - u) ** 2 - 6 * x1 * u * (1 - u) + 6 * x2 * u * (1 - u) - 3 * x2 * u ** 2 + 3 * u ** 2;
  let u = t;
  for (let i = 0; i < 6; i++) { const d = dbx(u); if (Math.abs(d) < 1e-6) break; u -= (bx(u) - t) / d; }
  return by(Math.min(1, Math.max(0, u)));
}
```

- Reduced motion: every flight becomes `jumpTo`, pitch 0, `maxPitch` 0, `fadeDuration: 0`; listen for live preference changes and stop any flight in progress.

## 8. List reorder

CourseBlocks in the Week rail and ScheduleRows in the library reorder by drag on fine pointers (handle) and by a Menu on coarse ones (Move up / Move down). Use FLIP with transforms only: measure, reorder DOM, apply inverse translate, then transition to none over 160ms `--ease-in-out`. The dragged item follows the pointer with `transform` and `--shadow-2`; siblings move with the same 160ms. Drop: 160ms settle. Reduced motion: siblings jump; the dragged item still follows the pointer (that is direct manipulation, not animation).

## 9. Performance rules

- Only `transform`, `opacity`, `clip-path`, `filter: blur(≤2px)` and `background-color` are transitioned. Blur is limited to 2px and to elements under 400px wide (the figures and the rail face), never to the grid or the map.
- `will-change: transform` only on the sheet while it is being dragged (set on `pointerdown`, removed on settle).
- Frost panels (`backdrop-filter: blur(24px)`) are static elements over the map; the cost is paid per map frame, not per UI frame. If a device drops frames while panning, the fallback is the solid surface, not a lighter blur.
- Never drive a child's transform from a parent's CSS variable during a gesture.
- CSS for predetermined motion (panels, sheets, menus, wash); WAAPI or Motion only for the spring release and FLIP reorders.
- Any Motion `animate` uses the full `transform` string, not `x`/`y`.
- Lists over 40 rows virtualise; no stagger, ever, on list mount.
- Fonts: `font-display: swap` with `size-adjust` on the fallback so the segmented pill and codes do not jump on load.

## 10. Feel checks the implementer must do (not from code)

Play at 5× in DevTools: the Auto wash (does the tint leave before the eye wants it to?), the best-so-far crossfade (does a number ever look like two numbers?), the event swap (any sense of motion between the two places is a bug), the sheet release after a flick on a real iPhone (should feel like Apple Maps' sheet, no bounce), and the camera flight to a tilted stop (the building must be recognisable before the flight ends). Look again the next day.
