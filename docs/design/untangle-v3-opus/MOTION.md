# UNTangle v3 (Opus direction): motion

Readers: the engineers implementing motion, and whoever reviews it. Every value below runs in the mockups in this folder (`_build` was inlined into each HTML file), so a value can be felt before it is built. Durations are design choices, not measurements; no user testing or device profiling has been done. §10 lists what still needs a real phone.

## 1. Principles

1. **Motion explains where things went.** Every animation answers "where did that come from" or "where did it go". If it answers neither, it doesn't animate.
2. **Frequency decides.** Anything done dozens of times a sitting (switching tabs, typing in search, moving through a list with the keyboard, toggling a chip) changes instantly or with a 120 to 160ms color change. Delight is spent on rare moments: Auto, the first import, choosing a stop on the map.
3. **Start fast, settle softly.** Entrances and responses use a strong ease-out; things already on screen that move use ease-in-out; nothing uses ease-in.
4. **Exits are faster than entrances,** and leave the way they came.
5. **Gestures are physical.** Sheets follow the finger 1:1, carry its velocity into a spring, and can be grabbed mid-flight.
6. **Never move what the student is reading or previewing** because of background work (the optimizer upgrading, tiles loading, a save finishing).
7. **Reduced motion keeps meaning, drops movement:** short crossfades replace slides, flights and FLIP.

## 2. Tokens

These extend the existing names in `frontend/src/app/globals.css` (`--ease-out`, `--ease-in-out`, `--ease-sheet`, `--t-press`, `--t-hover`, `--t-enter`, `--t-exit`, `--t-sheet`, `--ease-out-strong`). Existing values that change are marked in comments.

```css
:root {
  --ease-out: cubic-bezier(.23, 1, .32, 1);        /* entrances, responses, popovers, press release */
  --ease-in-out: cubic-bezier(.77, 0, .175, 1);    /* things on screen that move: FLIP, Auto rows, event swaps */
  --ease-sheet: cubic-bezier(.32, .72, 0, 1);      /* programmatic sheet moves when no spring is available */
  --ease-camera: cubic-bezier(.19, 1, .22, 1);     /* map flights; same curve as the existing --ease-out-strong */

  --t-press: 120ms;   /* :active scale .97 */
  --t-hover: 160ms;   /* color and background */
  --t-enter: 220ms;   /* panels, dialogs, toasts in. Was 200ms; 220 gives the 24px panel slide room to read */
  --t-exit: 150ms;    /* panels, dialogs, toasts out */
  --t-swap: 160ms;    /* crossfade between two contents in one container */
  --t-move: 300ms;    /* FLIP moves: rows, events, compare overlay */
  --t-sheet: 340ms;   /* CSS fallback for sheets. Was 260ms; only used without the spring */
  --t-reveal: 420ms;  /* Auto's row flight, rare */
  --t-camera: 500ms;  /* map flyTo, rare; documented exception to the 300ms UI rule */
}
/* --ease-bounce (cubic-bezier(.34,1.56,.64,1)) is retired: overshoot only comes from springs after a flick. */
```

Springs (Motion, `motion/react`). Use `transform` strings, not the `x`/`y` shorthands, so they stay on the compositor:

```ts
export const spring = {
  settle: { type: "spring", duration: 0.34, bounce: 0 },     // programmatic sheet open, detent snap
  flick:  { type: "spring", duration: 0.34, bounce: 0.14 },  // release with |v| > 0.5 px/ms only
  press:  { type: "spring", duration: 0.2,  bounce: 0 },
} as const;
```

The mockup's rAF spring (`base.js` `spring()`) uses Apple's response and damping form: response 0.34s, damping 1.0 (settle) or 0.86 (flick). `bounce: 0.14` is the Motion equivalent of damping 0.86.

## 3. What animates, and what deliberately doesn't

| Interaction | Animates | How |
| --- | --- | --- |
| Tab switch (Courses, Week, Day) on phone or desktop | **No** | Instant. Each tab keeps its scroll position. |
| Segmented pill (view tabs, day, start time, options) | Pill only | transform 220ms `--ease-out` on pointer; instant when activated from the keyboard (`click` with `detail === 0`); labels never move |
| ⌘K palette, phone search layer | **No** | Instant open and close |
| Typing in search, filtering results | **No** | Results replace in place |
| Keyboard ↑/↓ through course rows | **No** | The detail content swaps with no transition |
| Chip, switch, checkbox | Color, knob | background 120ms; knob transform 200ms `--ease-out` |
| Button press | Yes | scale .97, `--t-press`, `--ease-out`; feedback on pointer-down; off under reduced motion (the color change stays) |
| Hover (fine pointers only) | Color | background 160ms `ease` |
| Course detail panel (desktop) | Yes | in: translateX(24px)→0 + opacity, 220ms `--ease-out`; out: 150ms; the list margin changes instantly |
| Detail subject change while open | **No** | Content swap only |
| Sheets (phone) | Yes | spring, §5 |
| Dialog (major picker, export, sign-in) | Yes | in: scale .96→1 + opacity 220ms `--ease-out`, origin center; out: 150ms |
| Second sheet replacing the first | Content | 110ms out, 200ms in, opacity + 2px blur + 2 to 4px translateY |
| Import state changes | Content | same crossfade as above; height snaps |
| Drop overlay | Yes | overlay opacity 140ms; frame scale .985→1, 220ms `--ease-out` |
| Toast | Yes | translateY(8px)→0 + opacity, 220ms in, 150ms out; one at a time |
| Adding or removing a course row (one) | Yes | FLIP of the rows below, `--t-move`, `--ease-in-out`; the new row fades in 160ms |
| Auto | Yes | §8 |
| Week: section switch, option preview, Use this (pointer) | Yes | events FLIP from old to new slot, 300ms `--ease-in-out`; new occurrences fade in 160ms; removed ones disappear |
| Week: ghost preview on hovering a search result | Opacity | 120ms `--ease-out` |
| Week: drag an event | Direct | follows the pointer 1:1; release snaps through a 300ms FLIP or springs back 260ms `--ease-out` |
| Walk chips, conflict rings, stats line | **No** | Recomputed in place |
| Undo from the keyboard (⌘Z / Ctrl+Z) | **No** | Grid and lists update instantly |
| Compare A · Both · B | Yes | events FLIP between layouts, 300ms |
| Map stop or leg selection | Camera | §6 |
| Map day switch | Route + camera | route opacity out 150ms, in 180ms; camera fits the day in 500ms |
| Library push (phone) | Yes | detail translateX(100%)→0, 260ms in and 200ms out, `--ease-sheet`; list shifts −24% and dims to .6 |
| Optimizer upgrade arriving | Text only | status text crossfades; thumbnails and the grid never move under a preview (§9) |
| First render of any list | **No** | No stagger. Lists run to 100+ rows and are seen often. |
| Thesis artifacts on the first-visit page | Yes, once | rise 8px + fade, 420ms `--ease-out`, 60ms stagger; it is the only stagger in the product |

## 4. Enter, exit and shared elements

- **Origin**: popovers come from their trigger; dialogs from the viewport center; sheets from the bottom edge; the library detail from the right. Each exits along the same path.
- **Nothing scales from 0.** Dialogs start at .96, frames at .985, pressed buttons go to .97.
- **Shared elements by FLIP, not crossfade, when the thing is the same object:** a course row moving into the term tray, an event moving to another section, an event moving between compare views. Key elements by identity (`data-key="CSCE 2110-0"`, meaning course plus meeting occurrence), so MWF → TR moves occurrences 0 and 1 to Tuesday and Thursday and fades occurrence 2 out.
- **Crossfades get blur** (2px at the midpoint) when two different contents replace each other in one box, which hides the double image.
- **Heights snap.** Containers never animate height. The content below moves by FLIP (transform) instead.

## 5. Sheet physics

The mockup implementation is `class Sheet` in `_build/base.js`; production keeps `components/map/sheet-physics.ts` and `components/ui/sheet-physics.ts` and extends them as follows.

| Parameter | Value | Why |
| --- | --- | --- |
| Detents (detail, sections, export) | 52 to 56% and 92% of the viewport height, dismissible | Half first keeps the context visible |
| Detents (Day) | 206px, max(320px, 50%), 86%; bottom inset = tab bar; not dismissible | Peek shows the hero and summary |
| Drag start hysteresis | 8px | A tap on a row inside the sheet stays a tap |
| Tracking | 1:1 with `setPointerCapture`; a second pointer is ignored | Apple: touch and content move together |
| Past the top detent | rubber band `(o·d·0.55)/(d+0.55·|o|)`, d = viewport height | Resistance instead of a wall |
| Release velocity | slope of pointer samples in the last 100ms (px/ms) | A pause before letting go reads as slow |
| Projection | `y + v · d/(1−d)`, d = 0.995 (≈ v·199ms) | Momentum picks the detent, not only the release point |
| Flick rule | \|v\| > 0.11 px/ms moves at least one detent in that direction | Matches the existing `FLICK_VELOCITY` |
| Dismiss | projected point > lowest detent + 80px, or a flick down from the lowest detent | |
| Settle | spring, response 0.34s, damping 1.0; damping 0.86 when \|v\| > 0.5 px/ms; the release velocity is handed to the spring | No seam between drag and animation |
| Body scroll | the body scrolls only at the top detent; at scrollTop 0 a downward drag moves the sheet | One gesture, one owner |
| Scrim | modal sheets only; opacity follows `--t-enter` | The Day sheet keeps the map live |
| Interrupt | grabbing a moving sheet cancels the spring and starts from its live transform | Never wait for an animation to finish |

Sheets must be at least 40px taller than the viewport with matching negative margin, so a flick overshoot never shows a gap below.

## 6. Map camera choreography

Follows `../apple-maps-web/camera.md`; these are the motion rules on top.

| Trigger | Camera | Time |
| --- | --- | --- |
| First render, resize, detent change | fit the day, flat, north up | instant (`duration: 0`) |
| Stop selected (list or pin) | center on the building, up to z17.8, pitch 45° at street zoom | `flyTo` 500ms, `--ease-camera` |
| Leg selected | fit every coordinate of the leg, up to z17.6 | 500ms |
| Day switched | old route fades 150ms; new route draws at opacity 0→1 over 180ms; camera fits the new day | 500ms, starting with the fade |
| Zoom buttons, north reset | `easeTo` | 250ms |
| "Fit the day" control | fit the day, clears selection | 500ms |
| Hover over a pin or leg | paint only (halo, width) | instant |

- Padding is measured space: desktop left = panel right − map left + 28; phone bottom = map bottom − sheet top + 20, right = 72 (map controls). Never animate padding; set it, then fly.
- `map.stop()` before every new request. A later selection wins at once; a user drag cancels a flight and any pending correction.
- Selecting from the sheet at its full detent first snaps the sheet to half, then flies 60ms later, so the target lands in visible map.
- Routes never animate dashes or arrows. Past legs turn `#9fb09f` and the next leg darkens to `#00512b` at 7.5px; these are paint changes with no movement.
- Zoom interpolates in log space (`z = z0 · (z1/z0)^e`) so zooming in and out feel the same speed (`04-day-map.html` `flyTo`).

## 7. List reorder

- **One-off add, remove or move**: FLIP of every following row and header, 300ms `--ease-in-out` (260ms for removals and Undo). The added row fades in 160ms; a removed row leaves immediately and the gap closes by FLIP.
- **Group collapse**: instant. Long lists toggle often, and an accordion height animation would be the only height animation in the app.
- **Week events**: the same FLIP, keyed by course plus occurrence.
- Over 30 rows moving at once (a re-sort, switching schedules): no FLIP, swap instantly.

## 8. Auto's reveal

Auto runs a few times a term, so it gets the one choreographed moment. The purpose is spatial: show which courses were picked and where they came from. The sequence below is the one `02-courses.html` plays; `screens/02-auto-midflight-*.png` is a frame from 830ms in.

| t (ms) | What happens |
| --- | --- |
| 0 | Press: scale .97. The label becomes a spinner with the width held. |
| 0 to ~450 | The engine runs (the mockup waits 450ms). Nothing else moves. |
| 450 | Picked rows in "You can take" tint brand-soft (background 120ms). |
| 610 | State commits. Tray rows exist but are hidden; the tray's new height takes effect while every row and header below moves into its new place by FLIP (320ms `--ease-in-out`). |
| 690 + 55·i | Clone of picked row i flies from its list position to its tray slot: translate only, 420ms `--ease-in-out`, a level 2 shadow while moving. Rows starting below the viewport start from its bottom edge. |
| each landing | The real tray row appears and the tray's credit count rises by that course's credits (0 → 3 → 6 … → 15). |
| ~1330 | Result line "Planned 5 courses · Undo" fades in, 200ms. |

**Undo** reverses it: rows FLIP back to their list positions in 260ms with no stagger (exits are faster), and the toast says "Spring 2027 is back to how it was".

**Reduced motion**: no flight and no FLIP. Tray rows fade in over 160ms, 30ms apart, and the count jumps to 15.

## 9. The optimizer upgrading in place

- The best result so far arrives within 300ms. The OptionsBar shows "Best so far" with an accent dot, and option A previews on the grid (an event FLIP).
- When the worker finds better options, the status text crossfades to "Best found · checked 1,240 weeks" and the A · B · C deltas update in place.
- If the student is previewing the option that improved, **don't swap the grid.** Show "A better option B is ready · Show". Swapping the grid under someone mid-decision breaks principle 6. (This rule is specified here but not mocked; the mockup shows only the status-text upgrade.)
- Changing a preference while the bar is open shows "Updating" and repeats the same flow; the grid keeps the current preview until the new best arrives.

## 10. Reduced motion

`prefers-reduced-motion: reduce`, listened to live with `matchMedia(...).addEventListener("change")`:

| Normal | Reduced |
| --- | --- |
| Sheet springs, slides | jump to the detent with a 140ms opacity dip to .6 and back |
| Panel slide 24px | opacity only, 120ms |
| Dialog scale .96 | opacity only, 120ms |
| Toast rise | opacity only, 120ms |
| FLIP (rows, events, compare) | instant, with new items fading in 120 to 160ms |
| Auto flight | crossfade, §8 |
| Map flyTo / easeTo | `jumpTo`, pitch 0, `maxPitch: 0`, `fadeDuration: 0` |
| Route day switch | instant redraw |
| Library push | 150ms crossfade |
| Thesis stagger | none |
| Spinners | no rotation: opacity pulses .5 ↔ 1 over 1.2s |

`prefers-reduced-transparency: reduce` makes every glass surface solid paper (base.css). It is independent of reduced motion.

## 11. Performance rules

- Animate `transform` and `opacity` only. The two exceptions are background or border color on hover and press, and the map camera, which MapLibre renders.
- No `transition: all`. Name the properties. Shadows and borders change instantly; they repaint, so they are never transitioned.
- Write transforms directly on the moving element, never through a CSS variable on a parent (a variable on a parent recalculates styles for every child).
- Drag and spring frames write `style.transform` in `requestAnimationFrame` only; nothing reads layout inside the loop except the one measurement at drag start.
- FLIP measures once before and once after a single DOM mutation; never interleave reads and writes per row.
- Over 30 moving rows: skip FLIP (§7).
- One `backdrop-filter` surface per layer, never nested. If camera panning drops frames on an older phone, the first thing to remove is the panel blur (`../apple-maps-web/NOTES.md`).
- `will-change: transform` only on sheets and the Auto flyers, and only while moving.
- Toasts and keyboard-reachable state use CSS transitions, not keyframes, so they retarget when triggered twice.

## 12. Checked and not checked

- **Checked here:** every mockup at 1440x900 and 390x844 in Playwright Chromium 1.64. Mid-animation frames confirm the Auto flight (830ms) and a map flight (170ms into `flyTo`). The reduced-motion pass is in `screens/*-reduced-*.png` (see HANDOFF.md).
- **Not checked:** real-device feel (sheet drag versus iOS edge swipe, momentum, tap delay), 60fps under load, MapLibre camera timing with real tiles, and screen-reader announcement order. Those are acceptance items in HANDOFF.md.
