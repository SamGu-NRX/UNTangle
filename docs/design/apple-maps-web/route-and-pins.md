# Route and pin contract

The student needs to recognize the next building, not learn a map UI. Keep the route, its ordered stops and the matching itinerary selection visible together. The map is supplementary to the stop list, never the only way to choose a destination.

## Visual direction

A quiet campus atlas, using Apple Maps' hierarchy without copying its assets. Let pale building massing provide orientation; let the chosen walk carry the strongest color.

| Token | Value | Use |
| --- | --- | --- |
| Land | `#eeede9` | Warm-grey ground |
| Grass | `#dde8d5` | Campus lawns, distinct from selection green |
| Water | `#c4dfe9` | Water only |
| Building | `#f7f6f2` | Low-rise extrusions, shading toward `#e7e7e2` |
| Ink | `#1a2e1a` | Existing UNTangle text token |
| Selection | `#007a40` | Existing `--brand-700`, chosen itinerary and selected stop |

Use existing Syne 700 for the UNTangle wordmark and DM Sans for panel copy. Map labels use OpenFreeMap's Noto Sans Regular glyphs, not a proprietary Apple font. Keep the itinerary compact, with a 344 CSS-pixel desktop panel and an unobstructed map beside it. On phones, the same list occupies a bottom panel with explicit size controls.

The signature is spatial, not decorative: selecting a numbered stop raises the viewing angle so its building becomes recognizable. No entrance animation, moving route texture or pulsing pins. A search box would be ornamental in this bounded prototype, so there is none.

## Sources and data

`layers.ts` exports `addCampusOverlays`, the layer factories, the image installer and source constants. It imports types only. No UI framework, runtime dependency beyond MapLibre, or API key is needed.

| Source ID | Geometry | Required properties | Feature ID |
| --- | --- | --- | --- |
| `unt-route-legs` | One LineString per leg | `approximate: boolean` | Stable string such as `leg:gab:life:0` |
| `unt-stops` | Point at the destination | `number`, `name`, `code` | Stable stop occurrence ID |
| `unt-location` | Zero or one Point | `stale: boolean` | `me` |
| `unt-location-accuracy` | Zero or one Polygon | `stale: boolean` | `accuracy` |
| `unt-campus-labels` | Point per campus building | `name`, `code`, `priority` | Stable building ID |

The first four sources belong to the runtime overlays. `unt-campus-labels` already belongs to `style.json`; replace its sample collection with the full campus catalogue using `GeoJSONSource.setData`.

A repeated visit to GAB needs a different stop occurrence ID from the first visit. Do not use its building ID as both stop IDs. All features require explicit, unique `feature.id` values within their source. Do not enable `generateId`; array reorderings would move selection to another feature. MapLibre keeps only numeric ids, so `addCampusOverlays` copies each id into a `key` property and sets `promoteId: "key"` on the route and stop sources (the app's `map-layers.ts` does the same); later `setData` calls must carry `key` too.

The route adapter must preserve the API's coordinate order from departure to arrival. Use each `/api/map/route` leg's geometry, distance and minutes independently. Validate its actual response shape in the application adapter; `OverlayData` is a rendering interface, not a claim about that endpoint's schema. Require finite WGS84 coordinates in `[longitude, latitude]` order, at least two coordinates per line, and an explicit boolean fallback flag. Reject malformed geometry instead of silently drawing a straight shortcut.

Populate `approximate` from the engine's fallback result, not a distance heuristic. Do not merge adjoining legs into one feature, reverse coordinates for convenience, or infer entrances from building centroids. Keep route `lineMetrics: false`; MapLibre documents different dash scaling when it is enabled.

## Layer order and values

Add route layers in the order below, immediately before `campus-building-label`. That anchor follows `building-3d`. Append the point layers after basemap labels. This keeps the basemap names readable while the stops stay above the line paint.

| Layer ID | Specification |
| --- | --- |
| `unt-route-hover` | 17 px neutral line, opacity 0.16 only on hover |
| `unt-route-casing` | White, opacity 0.98. Widths at z14 / z17 / z20 are 6.5 / 9 / 10 px, or 8 / 11 / 13 px when active or selected |
| `unt-route-solid` | `approximate === false`. UNT green; widths 3.5 / 5 / 6 px. Active or selected uses `#00512b` and 5 / 7 / 9 px |
| `unt-route-approximate` | `approximate === true`. Same colors and widths, dash array `[1.2, 1.8]` in line-width units |
| `unt-route-chevrons` | Solid legs only, z16+. `symbol-placement: line`, 76 px spacing, original right-facing white image |
| `unt-route-hit` | Transparent 24 px line, used only for picking |
| `unt-location-accuracy-fill` | True geographic uncertainty polygon, blue at opacity 0.10 |
| `unt-location-accuracy-edge` | 1 px blue boundary at opacity 0.35 |
| `unt-stop-halo` | Hidden normally. Radius 22 px on hover, 23 px on selection. Neutral hover, green selection |
| `unt-stop-disc` | 14 px radius, or 17 px selected. 3 px white ring. Neutral `#46564b`, selected `#007a40` |
| `unt-stop-number` | 14 px white Noto Sans Regular, viewport aligned, numeric text from `number` |
| `unt-stop-hit` | Transparent circle of radius 22 px, giving a 44 px picking diameter |
| `unt-location-ring` | 13 px white circle at opacity 0.8 |
| `unt-location-dot` | 7 px blue circle with a 2 px white ring |

All route line layers use rounded caps and joins. Widths interpolate with zoom. The continuous white casing separates the dashes from busy map detail; the green stroke still carries the fallback pattern. Selection never turns a dashed leg solid.

These dimensions are design starting points, not measured phone optima. The inactive leg remains green because it is part of the chosen itinerary. Unselected map buildings, POIs and ordinary stop pins do not use the brand accent.

`unt-route-chevron` is a 32 × 32 image registered with `pixelRatio: 2`. Its painted arrow points right. `icon-rotation-alignment: map` and `icon-keep-upright: false` keep it following coordinate order, including east-to-west legs. A text arrow can flip to remain readable and imply the wrong travel direction, so do not replace the image with `text-field: ">"`. No chevrons appear on fallback legs.

Do not animate dashes or arrows. The route must look traversable, not already moving.

## Selection and hover

Only paint properties read feature-state. Filters and layout properties read feature properties. This avoids unsupported feature-state use in filters, text content and symbol placement.

| Key | Source | Meaning |
| --- | --- | --- |
| `hover` | Route legs or stops | Pointer is over this feature; clear on leave |
| `selected` | Route legs or stops | User explicitly chose this stop or leg |
| `active` | Route legs | Current itinerary leg; persists when a destination is selected |

`active` and `selected` both increase route width and darken its stroke. Stop selection increases radius and exposes a halo. Those size changes and the panel's explicit selected state make color a redundant cue rather than the only one.

```ts
import { addCampusOverlays, setInteraction, SOURCES } from "./layers";

// After the basemap style loads, using validated application data.
addCampusOverlays(map, overlayData);

setInteraction(map, { source: SOURCES.routes, id: previousLegId }, { active: false });
setInteraction(map, { source: SOURCES.routes, id: nextLegId }, { active: true });
setInteraction(map, { source: SOURCES.stops, id: stopOccurrenceId }, { selected: true });
```

Clear the previous selected or hovered ID before setting the next. MapLibre merges state updates. Omitting `hover` from an update does not clear it. Reapply state after a route replacement or style reload. Remove state for deleted IDs so an unrelated future route cannot inherit it.

`addCampusOverlays` rejects duplicate source, image and layer IDs, missing anchor layers and duplicate or absent feature IDs. Call it once per new style. If the application uses `setStyle`, either retain the existing overlays and update them, or recreate them after `style.load`; do not register both `load` and `style.load` installers for the same style. The helper deliberately does not guess whether it owns an existing source.

For hit testing, query only `unt-stop-hit` and `unt-route-hit`, with stops taking precedence. If several stop hit areas overlap, use the nearest projected centre and keep all alternatives available in the list. Do not register a separate click handler on every overlapping paint layer.

Gate hover handling on `(hover: hover) and (pointer: fine)`. Hover must not move the camera. A click, tap or list activation selects. Bind every canvas action to a native button in the itinerary; rendered map features are not accessible DOM controls. Keep button focus where it was, set `aria-pressed`, and announce the selected building or leg in a polite live region.

## Location and uncertainty

Keep location sources empty until the student explicitly requests their location and permission succeeds. Do not request permission on mount. A denial leaves routing usable and offers a manual start stop. The standalone sample deliberately requests no geolocation permission.

The accuracy polygon uses the browser's accuracy radius in metres, projected into geographic coordinates. It is not a fixed-radius screen circle. Discard an unusable fix; do not present a zero-size accuracy ring as certainty. The caller owns the timestamp and stale-fix policy. When stale, set `stale: true` on both collections, switch to grey and show "Last known location" with the timestamp in the panel.

No heartbeat animation. No heading cone without a reliable heading. No claimed live navigation, arrival detection or automatic rerouting in this prototype.

## Basemap names and integration checks

The live OpenFreeMap TileJSON lists `building`, `render_height`, `render_min_height` and `hide_3d`. Its building layer does not list name fields. The separate campus source is therefore required, not an optional polish layer. Basemap campus labels show codes at z15.5, full names from z16.6, and allow collisions to suppress lower-priority labels. Selected stop details remain in the itinerary even when a map label cannot fit.

Use the full campus catalogue in production. The style includes only GAB, LIFE and BLB as sample labels, using the coordinates in this worktree's campus catalogue. Those are building centroids, not verified accessible entrances.

Before adopting the layers, verify two opposite coordinate directions for chevrons, dashed active legs, repeated building visits, state after `setData`, and selected pins at 45° pitch. Inspect route visibility beside tall extrusions. If depth occlusion makes a walkway unreadable, switch that view to flat buildings; do not draw a fabricated route over a roof. Source inspection cannot establish the renderer's final occlusion behavior.
