# Campus camera

Keep north up. Tilting is useful when identifying a destination, but unnecessary for an overview or comparing routes. Do not rotate to each leg's heading; a student should not have to rebuild their mental map after every selection.

## Views and limits

All coordinates below use `[longitude, latitude]`.

| Setting | Value | Reason |
| --- | --- | --- |
| Initial centre | `[-97.1477, 33.2108]` | UNT Denton, before layout-aware fitting |
| Campus overview bounds | `[[-97.1562, 33.2058], [-97.1410, 33.2165]]` | Frames the main campus and all three sample destinations |
| Overview pitch / bearing | `0 / 0` | Flat, north-up orientation |
| Overview maximum fit zoom | `15.6` | Keeps a campus-wide view rather than fitting a single building |
| Stop focus | Up to z17.8, pitch 45°, bearing 0° | Identifies the selected building without an orbit |
| Leg focus | Up to z17.6, pitch 45°, bearing 0° | Fits the leg's full geometry, not only its endpoints |
| Whole itinerary | Up to z17.6, pitch 45° when the flat fit reaches z16.45 and every stop stays in view once tilted, else 0°; bearing 0° | Shows the campus in 3D at street zoom; a day too spread out to fit tilted stays flat and comparable |
| Map zoom limits | `minZoom: 13`, `maxZoom: 19` | Allow orientation and detailed walkway inspection without extreme overzoom |
| Pitch limit | `maxPitch: 50` | Leaves a small margin above the focus angle; avoids a deep horizon |
| Maximum bounds | `[[-97.166, 33.197], [-97.133, 33.225]]` | Keeps this campus-only view near Denton campus while allowing padding |

These are proposed presentation limits, not measured optima or authoritative campus boundaries. OpenFreeMap currently publishes planet tiles through z14; z19 is overzoomed source geometry, not five more levels of survey detail. If the real itinerary leaves these bounds, show a specific out-of-area state or have the lead deliberately widen the product's coverage. Do not silently crop the route.

Start with the overview at duration zero after the panel has its final size. A page-load flight delays the first useful view. Explicit stop or leg activation may tilt the camera. Moving the pointer or tab focus must not.

## Padding is measured space

Measure panel and map rectangles after layout. All padding is in CSS pixels, never device pixels. Include the safe area once, through the measured panel and attribution footer geometry.

Desktop, using the prototype's 344 px panel at x24:

```js
const padding = {
  top: 44,
  right: 88, // Keeps the map controls out of the fitted area.
  bottom: attributionHeight + 32,
  left: panelRect.right - mapRect.left + 28, // 396 px in the nominal layout.
};
```

On phones, the panel extends to just above the attribution footer. Its measured top determines the reserved lower area:

```js
const padding = {
  top: 84, // Space for the compact map controls and the top safe area.
  right: 30,
  bottom: mapRect.bottom - panelRect.top + 20,
  left: 30,
};
```

In an integrated app with taller top chrome or a larger top safe area, replace `84` with the measured bottom of those controls plus clearance. The prototype's values are starting clearances, not a device-independent guarantee.

| Phone detent | Prototype height | Camera policy |
| --- | --- | --- |
| Peek | 188 px, capped by available height | Fit in the visible map above it; panel content can scroll |
| Half | `max(320px, 50dvh)`, capped by available height | Fit with the measured bottom padding |
| Full | `100dvh - attributionHeight - 84px` | Freeze camera. A useful fit is impossible in the remaining strip |

The explicit panel-size select is non-modal. It does not trap focus or pretend to be a draggable sheet. The engineer can apply these same padding rules to the existing sheet detents. A stop or leg activation while full collapses to half before framing, without stealing focus from the chosen list control.

Do not call `fitBounds` with padding that leaves a negative or nearly empty viewport. If the available map is under 120 px wide or 100 px high, keep the itinerary usable and defer fitting. Those limits prevent invalid camera calculations in short landscape windows; they have not been tuned on devices.

Use `ResizeObserver` for panel size changes and react once to a settled detent. Do not animate padding every frame or continually refit during a drag. Resize should reframe instantly, without replaying the focus flight. Do not refit on every tile load, label change or GPS sample.

## Fit and focus

A flat overview can use MapLibre directly:

```js
map.stop();
map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
map.fitBounds(campusBounds, {
  padding,
  maxZoom: 15.6,
  pitch: 0,
  bearing: 0,
  duration: 0,
});
```

Clear persistent padding before the next fit. Current MapLibre docs describe additive padding behavior and an upcoming default change; do not mix calls that retain padding with calls that assume a zero-padding map.

The prototype uses `cameraForBounds` and then `flyTo` for one shared path. This also avoids relying on newer padding options absent from the pinned 5.6.2 renderer:

1. Collect every coordinate of the selected leg. For a stop, use a point-sized bounds and an explicit zoom cap.
2. Call `cameraForBounds(bounds, { padding, bearing: 0, maxZoom })`.
3. Pass only its `center`, `zoom` and `bearing` to `flyTo`, plus the requested pitch. Do not pass the same padding again. The returned centre already accounts for it.
4. The fit computation is flat. For a tilted leg, the prototype starts 0.45 zoom levels farther out as a provisional clearance, then projects every route coordinate after movement.
5. If any projected point falls outside the available map rectangle, jump to the computed flat fit. Visibility beats preserving a decorative tilt. An alternative pitched fit must pass the same projected-coordinate check before adoption.

That 0.45 adjustment is not a proof that every tilted leg fits. The endpoint check is also insufficient for a bent path, which is why the prototype checks all its coordinates. No projected-fit check has been run in a browser here.

The root style's `building-3d` layer fades in between z15.5 and z16.5. A 45° pitch at z15 will still look flat because extrusion paint has not appeared. A close stop view should expose the building massing without requiring a separate 3D scene.

## Timing and interruption

Motion serves spatial consistency: one occasional selection shows how a building relates to the previous view. It is not an entrance effect for the panel.

| Action | Timing |
| --- | --- |
| First render, layout resize, detent change | Instant |
| Pointer or touch stop / leg focus | 500 ms `flyTo` |
| Zoom button, manual 3D toggle (to 45°, at z16 or closer) | 250 ms `easeTo` |
| Hover, selected paint, list keyboard activation | Instant |
| Button press feedback | Existing 120 ms token, transform only |

500 ms is a deliberate exception to the sub-300 ms control rule. A campus camera move spans substantial map distance and changes pitch; it needs time to preserve orientation. This is a design proposal, not an Apple timing measurement or a result from user testing. Keep ordinary controls at 250 ms or below.

Use UNTangle's existing `--ease-out-strong`, `cubic-bezier(0.19, 1, 0.22, 1)`. MapLibre needs a function rather than CSS text. Invert the cubic's x coordinate before evaluating y; applying its y polynomial directly to time is a different curve. The prototype includes that function as `cameraEase`. It starts decisively and settles without a spring or overshoot.

Call `map.stop()` before starting a new camera request. Invalidate any pending post-fit callback first. A later selection wins immediately; do not queue flights or disable controls while flying. A user gesture cancels the pending projected-fit correction so it cannot snap the camera back after a pan.

## Reduced motion and keyboard

Listen to `matchMedia('(prefers-reduced-motion: reduce)')`, including live preference changes.

- Replace every programmed flight or ease with `jumpTo`; pitch is always 0°.
- Set `maxPitch` to 0 and disable the manual tilt control with an explanation.
- Disable double-click and wheel zoom animation; keep explicit zoom buttons available.
- Keep selection, hover and loading feedback instantaneous. The location dot does not pulse.
- Set MapLibre `fadeDuration: 0` and style transitions to zero. Do not force `essential: true` to bypass the preference.
- Keyboard button activation is instant regardless of the motion preference. Arrow-key map panning uses a direct `jumpTo`, not MapLibre's animated keyboard handler.

The prototype disables free rotation and touch pitch. Touch pinch and drag remain direct manipulation. Gesture inertia depends on the renderer version and must be checked on actual phones; do not claim reduced-motion gesture compliance based only on the programmed camera code.

If reduced motion becomes active during a flight, stop immediately, flatten, then leave the camera where it is. Do not replay the full route fit. Preserve the student's selection.

## Acceptance before integration

At 390 px and 1440 px widths, select every stop and both leg directions, interrupt a flight with another selection, then interrupt with a drag. Selected points must remain outside the panel, controls and attribution footer. Repeat with reduced motion enabled before load and toggled during a flight. Test 320 px width, short landscape height and 200% text size. Confirm no unwanted camera reframe while scrolling the panel. A code inspection does not settle the timing or the pitched fitting behavior.
