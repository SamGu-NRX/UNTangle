# Web map implementation notes

## What the browser can reproduce

MapLibre can render a quiet vector basemap, white road casings, zoom-dependent label hierarchy, extruded building footprints and a selected route with numbered stops. A modest pitch change, legible selection state and a panel that leaves the destination visible do more for this task than adding realistic textures.

The frosted panel uses one 16 px backdrop blur over a mostly opaque background. Without backdrop-filter support, it becomes solid. Reduced transparency also removes the blur. UNTangle retains its existing Syne wordmark and DM Sans panel typography; the map uses Noto Sans glyphs. No Apple fonts, icons, map tiles or screenshots are included.

This is not Apple's renderer or cartographic database. OSM heights may be absent, estimated or stale. Extruded footprints do not provide photogrammetry, detailed façades, trees, indoor floors, entrance knowledge or Apple's landmark models. Missing building heights stay flat rather than receiving an invented height. OpenFreeMap's current source maxzoom is 14; close zooms reuse that geometry.

Browser camera animation and native sheet gestures can approach the same visual hierarchy, but cannot promise Apple's latency, gesture arbitration, haptics or background navigation. The supplied phone panel uses a native select for its size, not a simulated drag handle. The engineer should keep the existing map-v2 sheet's gesture ownership and apply the camera padding contract to its detents.

The prototype draws illustrative GAB → LIFE → BLB geometry. Its first leg demonstrates the solid routed style and the second demonstrates the dashed fallback style. Neither is a verified walkway route. There are no fabricated travel times. Production must consume the offline engine's per-leg geometry, distance and minutes from `/api/map/route`.

The location sample is explicitly synthetic. The page does not request geolocation permission or claim to provide navigation. Real geolocation requires user consent and an appropriate secure browser context. Routing data alone does not certify accessible entrances, crossings, temporary closures or step-free access.

## Opening and adopting the prototype

Open `index.html` directly in a browser with network access. It embeds snapshots of `style.json` and the runtime layer definitions, so it does not fetch adjacent files over `file://`. MapLibre JS and CSS, fonts, sprites and map tiles still load from public HTTPS endpoints. No key, local server, package installation or application backend is required.

`style.json` and `layers.ts` are the adoption assets. The embedded copies in `index.html` are a portable demonstration, not a second source of truth. If either adoption asset changes, refresh the corresponding embedded JSON before comparing the prototype. The JSON script IDs are `base-style` and `overlay-layers`.

The base vector source is `openmaptiles`. The campus name source is `unt-campus-labels`, initially containing three sample buildings. Replace that collection with the application's full catalogue. Keep its stable building IDs and deterministic label priority.

Keep the overlay source names, layer IDs and feature-state keys listed in `route-and-pins.md`. The route insertion anchor is `campus-building-label`. Do not reuse unverified tile feature IDs for campus selection; route and stop state belongs to the application's own GeoJSON features.

The code targets MapLibre GL JS 5.6.2, pinned in both CDN URLs. This is a reproducible prototype version, not a claim that it is the latest release. Confirm the engineer's installed MapLibre version before adoption. The separate dashed layer avoids relying on feature-dependent dash arrays introduced in newer versions.

## Phone performance budget

These are proposed acceptance targets, not benchmark results. No phone profiling has established that they are met.

| Resource | Starting budget | Why |
| --- | --- | --- |
| Remote vector sources | One | Every basemap layer reuses the same tile requests |
| Visible source tiles | Aim for at most 16 flat and 24 at 45° on a phone | Pitch exposes more ground and can expand the tile cover; count actual requests and rendered tiles |
| Unused tile cache | `maxTileCacheSize: 48` per source | Bounds retained tiles after panning; this is not a hard cap on active tiles or total GPU memory |
| Canvas resolution | `pixelRatio: min(devicePixelRatio, 2)` | Reduces fragment work on DPR 3+ screens, at a possible sharpness cost |
| Building passes | One extrusion layer, z15.5+, pitch no higher than 50° | Avoids duplicate meshes, deep horizons and multiple depth passes |
| Other scene data | Five small GeoJSON sources | Campus labels, legs, stops, location point and accuracy polygon |
| Frosted UI | One panel, 16 px blur | Avoids a full-screen blur or several overlapping filtered panels |
| Camera rendering | Aim for 60 fps, investigate sustained frames above 33 ms | A target for feel-testing, not a measured rate |

MapLibre still renders visible tiles even when the cache is full. `maxTileCacheSize` does not impose a download quota. Count canonical source tiles as well as overscaled render tiles so z19 does not falsely appear to provide new source detail. Avoid adding a second vector source merely for the building layer.

Extrusion cost depends on footprint count, vertex count, visible screen area and alpha blending. Opacity 0.9 does not mean 90% of the geometry work. The z15.5 fade is a visual transition; hiding the layer is the reliable way to skip its drawing cost. There is no terrain, shadow map, ambient animation or continuously repainted location pulse in this design.

If an older phone cannot keep camera interaction responsive, first remove panel blur, then offer a flat-building mode with `building-3d` hidden. Keep the footprint layer, all route geometry and all stop controls. Do not make a routing decision from device capability. Avoid an antialiasing override or `preserveDrawingBuffer` merely to produce screenshots.

`prefers-reduced-motion` replaces programmed camera movement with instantaneous flat views, disables tilt, and removes CSS transitions. Rendering a static map still costs tile decoding, glyph placement and GPU memory; reduced motion is not a performance mode. Gesture inertia requires a separate runtime check against the adopted renderer version.

For integration acceptance, measure on an older iPhone and a mid-range Android at normal and reduced motion settings. Exercise repeated leg selection, a tilted pan, full-to-half sheet changes, long names and route replacement. Record dropped frames and memory while identifying whether rendering, tile decoding or backdrop blur is responsible. Do not call these budgets tuned until those runs exist.

## Data access and availability

The official quick-start guide and live Liberty style supplied these URLs on 2026-10-13:

- TileJSON: `https://tiles.openfreemap.org/planet`
- Glyphs: `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`
- Sprite base: `https://tiles.openfreemap.org/sprites/ofm_f384/ofm`

Use the stable TileJSON URL. Its current dated tile path is an implementation detail that will change with data updates. Do not hardcode that path or a z14 tile URL into the application.

The live TileJSON lists every source-layer used here: `landuse`, `landcover`, `park`, `water`, `waterway`, `transportation`, `building`, `transportation_name`, `poi` and `place`. It lists `render_height`, `render_min_height` and `hide_3d` on `building`, but no name field. This is why campus building labels come from a separate source.

Layer names and the height schema are confirmed at the service metadata level. Actual UNT tile content, exact class values around these buildings, naming coverage and height quality remain unverified. A documented source layer can still contain no useful feature in a particular campus tile.

OpenFreeMap advertises a free public instance without registration, API keys or map-view limits. Its service is provided as-is and may change or stop. A free hosted endpoint is not a service-level guarantee. Do not bulk-prefetch the planet or assume offline redistribution permission follows from having no key. Preserve the itinerary when tiles fail and show a specific retry path.

The prototype also depends on the unpkg CDN and Google Fonts hosting. Those services are not required by the adoption assets; the production app can use its installed MapLibre package and existing font loading. Free, open-source components do not make their hosting infrastructure open-source or self-controlled.

## Attribution

OpenFreeMap's required text is:

> OpenFreeMap © OpenMapTiles Data from OpenStreetMap

Its documentation says the OpenFreeMap name is optional but appreciated. This design keeps it. Preserve working links:

```html
<a href="https://openfreemap.org/">OpenFreeMap</a>
<a href="https://www.openmaptiles.org/">© OpenMapTiles</a>
Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
```

`style.json` includes that attribution on the source; MapLibre's normal attribution control can display it automatically. The standalone page instead sets `attributionControl: false` and renders the full equivalent attribution in a persistent footer, outside the panel. Its height participates in camera padding. Keep it visible at every detent, at narrow widths and in screenshots. Do not hide it behind a sheet or omit it because tiles have already been cached. The footer also credits MapLibre.

## Licences

| Part | Licence and obligation |
| --- | --- |
| MapLibre GL JS 5.6.2 | BSD-3-Clause. Retain its copyright, conditions and disclaimer in distributions |
| OpenFreeMap project | MIT. The tile data and included assets retain their own licences |
| OpenStreetMap database | ODbL 1.0. Credit OpenStreetMap and link to its copyright/licence page; derived database distribution can carry further obligations |
| OpenMapTiles | Code BSD-3-Clause; design CC BY 4.0. Preserve OpenMapTiles attribution |
| Noto Sans map glyphs | SIL Open Font License 1.1 |
| DM Sans and Syne UI fonts | SIL Open Font License 1.1. Retain licence files when self-hosting or redistributing |
| OpenFreeMap sprite icons | Upstream licence inventory lists Maki as CC0 and its right-arrow asset as public domain. This style declares the official sprite but does not use its POI icons |
| Route chevron | Original canvas drawing in `layers.ts`, not Apple's artwork or the upstream sprite arrow |

The basemap layer definitions here are new rather than a recolored copy of the complete Liberty style. Liberty was used to check service URLs and schema. If the engineer copies additional Liberty cartography, retain its upstream BSD and CC BY notices as described in OpenFreeMap's licence inventory. Do not interpret MIT coverage of the hosting project as relicensing every included style or dataset.

This folder does not assign a new licence to UNTangle's own code. The repository's current `LICENSE` text is not a standard licence grant; the owner must choose one before distributing UNTangle itself as an open-source project. That decision is separate from using these open-source mapping components.

## References

- [OpenFreeMap quick start](https://openfreemap.org/quick_start/)
- [OpenFreeMap attribution and public-instance description](https://openfreemap.org/)
- [OpenFreeMap live TileJSON](https://tiles.openfreemap.org/planet)
- [OpenFreeMap live Liberty style](https://tiles.openfreemap.org/styles/liberty)
- [OpenFreeMap licence inventory](https://github.com/hyperknot/openfreemap/blob/main/LICENSE.md)
- [OpenFreeMap service terms](https://openfreemap.org/tos/)
- [MapLibre style layer specification](https://maplibre.org/maplibre-style-spec/layers/)
- [MapLibre fit-bounds options](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/FitBoundsOptions/)
- [MapLibre map options](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/)
- [OpenStreetMap copyright and ODbL](https://www.openstreetmap.org/copyright)
- [DM Sans OFL](https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt)
- [Syne OFL](https://github.com/google/fonts/blob/main/ofl/syne/OFL.txt)

Context7 was attempted but returned its monthly quota limit. Endpoint and schema checks used the official pages and live metadata instead. Browser rendering, TypeScript compilation, physical-device performance and assistive-technology behavior still require integration acceptance; JSON parsing alone does not verify them.
