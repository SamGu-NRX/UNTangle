/**
 * The basemap: a quiet, light campus style over OpenFreeMap's OpenMapTiles
 * vector tiles (free, no key, no limits; terms at openfreemap.org/tos).
 *
 * Adopted from the design direction's apple-maps-web/style.json: pale land,
 * white roads with a soft casing, campus landuse a shade apart, buildings
 * that rise into soft 3D between zoom 15.5 and 16.5. Every color here is a
 * basemap color; route and pin colors live in map.css and map-layers.ts.
 *
 * A campus with its own map detail (CampusConfig.mapDetail; UNT) draws its
 * buildings, trees, entrances, parking and labels from that file instead:
 * the tiles merge every building of one height into one shape per tile, so
 * they can't color a building, name it, or tell a real height from their
 * 5 m default. Their flat footprints stay underneath, for the area outside
 * the file. Other campuses keep the tiles' buildings and the registry's pins
 * as labels.
 */
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { CampusConfig } from "@/lib/campus/config";

export const OPENFREEMAP_TILEJSON = "https://tiles.openfreemap.org/planet";
const OPENFREEMAP_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

/** OpenFreeMap requires "OpenFreeMap © OpenMapTiles Data from OpenStreetMap"; the tile source carries it. */
export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

/** Walking routes come from OSM walkways too; this line credits the contributors by name. */
export const OSM_CONTRIBUTORS_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>';

/** The map's own credit line: OSM contributors, plus the campus detail's other sources in words. */
export function campusAttribution(campus: CampusConfig): string {
  return campus.mapDetail ? `${OSM_CONTRIBUTORS_ATTRIBUTION}, ${campus.mapDetail.attribution}` : OSM_CONTRIBUTORS_ATTRIBUTION;
}

/**
 * Layer id the route overlay is inserted beneath (map-layers.ts). With map
 * detail it is the day's class-building labels, the top layer: routes then
 * draw over every other label, and the class labels win every collision.
 */
export const LABEL_ANCHOR_LAYER = "campus-building-label";
/** With map detail: every other campus building's label, under the route. */
export const QUIET_LABEL_LAYER = "campus-building-label-quiet";
/** With map detail: the source of buildings, trees, entrances, lots and labels. */
export const DETAIL_SOURCE = "unt-campus-detail";

const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
const nameField: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];
const roadClasses = ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"];

/**
 * Building tones. Walls take their shade from the style's light, so one
 * color gives a lit roof and darker walls. UNT buildings sit a touch warmer
 * than the town's, landmarks warmer still; a building with one of the day's
 * classes takes a course color through feature-state (building-highlight.ts).
 */
export const BUILDING_TONE = { town: "#e9e7e2", campus: "#f6f2ea", landmark: "#f3e8d6" } as const;

/** Buildings fade in over one zoom level so the flat overview stays legible. The band is the design's, not a measured threshold. */
const extrusionFade: ExpressionSpecification = ["interpolate", ["cubic-bezier", 0.23, 1, 0.32, 1], ["zoom"], 15.5, 0, 16.5, 0.92];

/** A metric radius for circles: `metres` across at every zoom (MapLibre's 512 px tiles, at UNT's latitude). */
function metres(radius: number): ExpressionSpecification {
  const metresPerPixelAtZ0 = (40075016.686 * Math.cos((33.21 * Math.PI) / 180)) / 512;
  return ["interpolate", ["exponential", 2], ["zoom"], 14, (radius / metresPerPixelAtZ0) * 2 ** 14, 20, (radius / metresPerPixelAtZ0) * 2 ** 20];
}

/** The registry's pins as labels, for a campus without its own map detail. Priority follows registry order. */
function registryLabels(campus: CampusConfig) {
  return {
    type: "FeatureCollection" as const,
    features: campus.buildings
      .filter((building) => !building.isOffCampus)
      .map((building, index) => ({
        type: "Feature" as const,
        id: building.id,
        properties: { code: building.shortName, name: building.name, priority: index + 1 },
        geometry: { type: "Point" as const, coordinates: [building.lng, building.lat] },
      })),
  };
}

const ground: LayerSpecification[] = [
  { id: "land", type: "background", paint: { "background-color": "#eeede9" } },
  {
    id: "campus-land",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "landuse",
    filter: ["match", ["get", "class"], ["school", "college", "university"], true, false],
    paint: { "fill-color": "#e8eae2" },
  },
  {
    id: "grass",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "landcover",
    filter: ["match", ["get", "class"], ["grass", "wood"], true, false],
    paint: { "fill-color": ["match", ["get", "class"], "wood", "#d4e2cb", "#dce8d3"], "fill-opacity": 0.9 },
  },
  {
    id: "park",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "park",
    paint: { "fill-color": "#dbe7d2", "fill-opacity": 0.7 },
  },
  {
    // Sports fields a shade deeper than lawns, running tracks a muted clay, both outlined in white close in.
    id: "recreation",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "landuse",
    filter: ["match", ["get", "class"], ["pitch", "recreation_ground", "cemetery", "stadium", "track", "playground"], true, false],
    paint: {
      "fill-color": ["match", ["get", "class"], "track", "#e6d9cc", "stadium", "#e3e6dc", "#d2e3c6"],
      "fill-opacity": 0.95,
    },
  },
  {
    id: "recreation-line",
    type: "line",
    source: "openmaptiles",
    "source-layer": "landuse",
    minzoom: 16,
    filter: ["match", ["get", "class"], ["pitch", "track"], true, false],
    paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 16, 0.6, 19, 1.6], "line-opacity": 0.8 },
  },
  { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#c4dfe9" } },
  {
    id: "waterway",
    type: "line",
    source: "openmaptiles",
    "source-layer": "waterway",
    minzoom: 12,
    paint: { "line-color": "#c4dfe9", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 18, 4] },
  },
];

const roads: LayerSpecification[] = [
  {
    id: "road-casing",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    filter: ["match", ["get", "class"], roadClasses, true, false],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#d7d6d1",
      "line-width": [
        "interpolate", ["exponential", 1.5], ["zoom"],
        12, 2,
        16, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 14, ["secondary", "tertiary"], 11, 7],
        19, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 44, ["secondary", "tertiary"], 34, 22],
      ],
    },
  },
  {
    id: "road-surface",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    filter: ["match", ["get", "class"], roadClasses, true, false],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": [
        "interpolate", ["exponential", 1.5], ["zoom"],
        12, 1,
        16, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 12, ["secondary", "tertiary"], 9, 5],
        19, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 41, ["secondary", "tertiary"], 31, 19],
      ],
    },
  },
  {
    // Footway areas the tiles carry (paved courtyards); the detail file adds plazas mapped as area:highway.
    id: "plaza",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "transportation",
    minzoom: 15,
    filter: ["all", ["==", ["geometry-type"], "Polygon"], ["match", ["get", "class"], ["path", "pedestrian"], true, false]],
    paint: { "fill-color": "#f6f4ee" },
  },
  {
    id: "walkway-casing",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    minzoom: 14,
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["match", ["get", "class"], ["path", "pedestrian", "track"], true, false]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#d8d9d1", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1.5, 17, 4, 20, 9] },
  },
  {
    id: "walkway-surface",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    minzoom: 14,
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["match", ["get", "class"], ["path", "pedestrian", "track"], true, false]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#fafaf6", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.7, 17, 2.6, 20, 7] },
  },
  {
    id: "rail",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    minzoom: 13,
    filter: ["==", ["get", "class"], "rail"],
    paint: { "line-color": "#c5c4be", "line-width": 1.5, "line-dasharray": [3, 2] },
  },
];

const tileFootprints: LayerSpecification = {
  id: "building-footprint",
  type: "fill",
  source: "openmaptiles",
  "source-layer": "building",
  minzoom: 13,
  paint: { "fill-color": "#e0dfda", "fill-outline-color": "#cdcdc6" },
};

/** The tiles' buildings in 3D, for a campus without its own detail. */
const tileExtrusions: LayerSpecification = {
  id: "building-3d",
  type: "fill-extrusion",
  source: "openmaptiles",
  "source-layer": "building",
  minzoom: 15.5,
  filter: ["!=", ["get", "hide_3d"], true],
  paint: {
    "fill-extrusion-color": [
      "interpolate", ["linear"], ["to-number", ["get", "render_height"], 0],
      0, "#f7f6f2",
      45, "#e7e7e2",
    ],
    "fill-extrusion-height": ["max", 0, ["to-number", ["get", "render_height"], 0]],
    "fill-extrusion-base": [
      "min",
      ["max", 0, ["to-number", ["get", "render_height"], 0]],
      ["max", 0, ["to-number", ["get", "render_min_height"], 0]],
    ],
    "fill-extrusion-opacity": extrusionFade,
    "fill-extrusion-vertical-gradient": true,
  },
};

const kind = (value: string | string[]): ExpressionSpecification =>
  Array.isArray(value) ? ["match", ["get", "k"], value, true, false] : ["==", ["get", "k"], value];

/** Builds a tone by tier: 0 town, 1 UNT, 2 landmark (build-map-detail.ts). */
const toneByTier: ExpressionSpecification = [
  "match", ["get", "t"],
  2, BUILDING_TONE.landmark,
  1, BUILDING_TONE.campus,
  BUILDING_TONE.town,
];

/** The campus detail under the buildings: parking lots, plazas, then tree canopies. */
function detailGround(): LayerSpecification[] {
  return [
    {
      id: "detail-parking",
      type: "fill",
      source: DETAIL_SOURCE,
      minzoom: 14,
      filter: kind("pk"),
      paint: { "fill-color": "#e5e4e0", "fill-outline-color": "#dcdbd6" },
    },
    {
      id: "detail-plaza",
      type: "fill",
      source: DETAIL_SOURCE,
      minzoom: 15,
      filter: kind("pz"),
      paint: { "fill-color": "#f6f4ee" },
    },
  ];
}

function detailBuildings(): LayerSpecification[] {
  const highlighted: ExpressionSpecification = ["to-color", ["feature-state", "color"], toneByTier];
  return [
    {
      // Every outline, flat, so a building with no known height still reads as a building.
      id: "detail-footprint",
      type: "fill",
      source: DETAIL_SOURCE,
      minzoom: 14,
      filter: kind("b"),
      paint: {
        // A class building keeps its course color here too: below the 3D zoom, and when it has no height.
        "fill-color": ["to-color", ["feature-state", "color"], ["case", ["==", ["get", "t"], 0], "#e3e2dd", "#dfdcd3"]],
        "fill-outline-color": "#d2d0c9",
      },
    },
    {
      // A faint offset disc under each crown, toward the light's far side, so trees read as volumes.
      id: "detail-tree-shadows",
      type: "circle",
      source: DETAIL_SOURCE,
      minzoom: 16,
      filter: kind("tr"),
      paint: {
        "circle-radius": metres(4),
        "circle-color": "#8fa77f",
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 16, 0, 16.8, 0.28],
        "circle-translate": ["interpolate", ["exponential", 2], ["zoom"], 16, ["literal", [0.4, 0.6]], 19, ["literal", [3.2, 4.8]]],
        "circle-blur": 0.4,
        "circle-pitch-alignment": "map",
        "circle-pitch-scale": "map",
      },
    },
    {
      id: "detail-trees",
      type: "circle",
      source: DETAIL_SOURCE,
      minzoom: 15.5,
      filter: kind("tr"),
      paint: {
        // OSM trees carry no crown size; 4 m is a modest canopy so a row of them stays a row, not a hedge.
        "circle-radius": metres(4),
        "circle-color": "#bcd4ab",
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 15.5, 0, 16.2, 0.9],
        "circle-stroke-color": "#a9c597",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 16, 0, 18, 0.8],
        "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 15.5, 0, 16.2, 1],
        "circle-pitch-alignment": "map",
        "circle-pitch-scale": "map",
      },
    },
    {
      id: "detail-tree-rows",
      type: "line",
      source: DETAIL_SOURCE,
      minzoom: 15.5,
      filter: kind("trl"),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#bcd4ab", "line-width": metres(8), "line-opacity": 0.9 },
    },
    {
      id: "detail-entrances",
      type: "circle",
      source: DETAIL_SOURCE,
      minzoom: 17.5,
      filter: kind("en"),
      paint: {
        "circle-radius": ["case", ["==", ["get", "m"], 1], 3.2, 2.4],
        "circle-color": "#ffffff",
        "circle-stroke-color": "#7f8d80",
        "circle-stroke-width": 1.2,
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: "detail-building-3d",
      type: "fill-extrusion",
      source: DETAIL_SOURCE,
      minzoom: 15.5,
      filter: ["all", kind(["b", "p"]), [">", ["get", "h"], 0]],
      paint: {
        "fill-extrusion-color": highlighted,
        "fill-extrusion-height": ["get", "h"],
        "fill-extrusion-base": ["coalesce", ["get", "b"], 0],
        "fill-extrusion-opacity": extrusionFade,
        "fill-extrusion-vertical-gradient": true,
      },
    },
  ];
}

/**
 * Building labels from the detail file: "General Academic Building (GAB)",
 * shortened to the code below z17 (z16 for the day's class buildings).
 * Landmarks show from z15, the rest from z15.5. The day's class buildings
 * move to LABEL_ANCHOR_LAYER (bold, on top, under their pins);
 * building-highlight.ts sets both filters. Steps sit on whole zooms because
 * MapLibre evaluates layout at each tile's whole zoom: a step at 16.6 acts
 * as 17 anyway.
 */
function detailLabels(): LayerSpecification[] {
  const nameOrCode: ExpressionSpecification = ["coalesce", ["get", "cd"], ["get", "n"]];
  const quietText: ExpressionSpecification = [
    "step", ["zoom"],
    ["case", ["==", ["get", "t"], 2], ["get", "n"], ""],
    15.5, ["case", ["==", ["get", "t"], 2], ["get", "n"], nameOrCode],
    17, ["get", "n"],
  ];
  return [
    {
      id: QUIET_LABEL_LAYER,
      type: "symbol",
      source: DETAIL_SOURCE,
      minzoom: 15,
      filter: kind("lb"),
      layout: {
        "text-field": quietText,
        "text-font": FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 15, 11, 18, 13],
        "text-max-width": 9,
        "text-padding": 4,
        "symbol-sort-key": ["get", "p"],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": ["case", ["==", ["get", "t"], 2], "#3d4a3f", "#59615a"],
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
        "text-halo-blur": 0.25,
      },
    },
    {
      id: LABEL_ANCHOR_LAYER,
      type: "symbol",
      source: DETAIL_SOURCE,
      minzoom: 14,
      filter: ["all", kind("lb"), ["in", ["get", "c"], ["literal", []]]],
      layout: {
        "text-field": ["step", ["zoom"], nameOrCode, 16, ["get", "n"]],
        "text-font": FONT_BOLD,
        "text-size": ["interpolate", ["linear"], ["zoom"], 14, 11.5, 18, 14],
        // Below the building's point: the lollipop pin stands above it.
        "text-anchor": "top",
        "text-offset": [0, 0.7],
        "text-max-width": 10,
        "text-padding": 2,
        "symbol-sort-key": ["get", "p"],
        "text-allow-overlap": false,
      },
      paint: { "text-color": "#1a2e1a", "text-halo-color": "#ffffff", "text-halo-width": 2, "text-halo-blur": 0.25 },
    },
  ];
}

const registryLabelLayer: LayerSpecification = {
  id: LABEL_ANCHOR_LAYER,
  type: "symbol",
  source: "unt-campus-labels",
  minzoom: 15.5,
  layout: {
    "text-field": ["step", ["zoom"], ["get", "code"], 16.6, ["get", "name"]],
    "text-font": FONT,
    "text-size": ["interpolate", ["linear"], ["zoom"], 15.5, 12, 18, 14],
    // Below the building's point: the lollipop pins stand above it.
    // (The design's style puts labels above, for centered circle pins.)
    "text-anchor": "top",
    "text-offset": [0, 0.7],
    "text-max-width": 11,
    "text-padding": 5,
    "symbol-sort-key": ["get", "priority"],
    "text-allow-overlap": false,
  },
  paint: { "text-color": "#343b35", "text-halo-color": "#ffffff", "text-halo-width": 1.7, "text-halo-blur": 0.25 },
};

const basemapLabels: LayerSpecification[] = [
  {
    id: "road-label",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "transportation_name",
    minzoom: 14,
    filter: ["match", ["get", "class"], roadClasses, true, false],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 350,
      "text-field": nameField,
      "text-font": FONT,
      "text-size": ["interpolate", ["linear"], ["zoom"], 14, 10, 18, 12],
      "text-max-angle": 25,
    },
    paint: { "text-color": "#676b64", "text-halo-color": "#ffffff", "text-halo-width": 1.3 },
  },
  {
    id: "park-label",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "park",
    minzoom: 15,
    layout: { "text-field": nameField, "text-font": FONT, "text-size": 11, "text-max-width": 10, "text-padding": 16 },
    paint: { "text-color": "#586653", "text-halo-color": "#eef3e9", "text-halo-width": 1 },
  },
  {
    id: "poi-label",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 17.5,
    filter: [
      "all",
      ["==", ["geometry-type"], "Point"],
      ["<=", ["to-number", ["get", "rank"], 99], 6],
      ["match", ["get", "class"], ["library", "hospital", "bus", "cafe"], true, false],
    ],
    layout: {
      "text-field": nameField,
      "text-font": FONT,
      "text-size": 11,
      "text-max-width": 9,
      "text-padding": 24,
      "symbol-sort-key": ["to-number", ["get", "rank"], 99],
    },
    paint: { "text-color": "#666963", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
  },
  {
    id: "place-label",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "place",
    maxzoom: 15,
    filter: ["match", ["get", "class"], ["city", "town", "suburb", "neighbourhood"], true, false],
    layout: {
      "text-field": nameField,
      "text-font": FONT,
      "text-size": ["interpolate", ["linear"], ["zoom"], 10, 14, 14, 17],
      "text-padding": 24,
    },
    paint: { "text-color": "#596158", "text-halo-color": "#eeede9", "text-halo-width": 2 },
  },
];

export function campusMapStyle(campus: CampusConfig): StyleSpecification {
  const detail = campus.mapDetail;
  const sources: StyleSpecification["sources"] = {
    openmaptiles: { type: "vector", url: OPENFREEMAP_TILEJSON, attribution: BASEMAP_ATTRIBUTION },
  };
  if (detail) {
    // promoteId lets feature-state address every outline and part of one registry building by its id.
    sources[DETAIL_SOURCE] = { type: "geojson", data: detail.url, promoteId: "c" };
  } else {
    sources["unt-campus-labels"] = { type: "geojson", data: registryLabels(campus) };
  }
  const layers: LayerSpecification[] = detail
    ? [...ground, ...detailGround(), ...roads, tileFootprints, ...detailBuildings(), ...basemapLabels, ...detailLabels()]
    : [...ground, ...roads, tileFootprints, tileExtrusions, registryLabelLayer, ...basemapLabels];
  return {
    version: 8,
    name: `${campus.shortName} campus light`,
    glyphs: OPENFREEMAP_GLYPHS,
    // Style-level transitions off: paint changes (selection, hover, highlights) are instant.
    transition: { duration: 0, delay: 0 },
    // Anchored to the map so walls keep their shading as the camera moves: light from the south-west,
    // lit roofs and west faces, shaded north and east faces.
    light: { anchor: "map", color: "#ffffff", intensity: 0.36, position: [1.15, 215, 38] },
    sources,
    layers,
  };
}
