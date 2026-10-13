/**
 * The basemap: a quiet, light campus style over OpenFreeMap's OpenMapTiles
 * vector tiles (free, no key, no limits; terms at openfreemap.org/tos).
 *
 * Adopted from the design direction's apple-maps-web/style.json: pale land,
 * white roads with a soft casing, campus landuse a shade apart, building
 * footprints that rise into soft 3D between zoom 15.5 and 16.5, and the
 * campus registry's short codes as building labels. Every color here is a
 * basemap color; route and pin colors live in map.css and map-layers.ts.
 */
import type { StyleSpecification } from "maplibre-gl";
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

/** Layer id the route overlay is inserted beneath, so building labels stay readable over routes. */
export const LABEL_ANCHOR_LAYER = "campus-building-label";

const FONT = ["Noto Sans Regular"];
const nameField = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];
const roadClasses = ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"];

/**
 * Building names come from the campus catalogue: the tiles' building layer
 * has footprints and heights but no names. Priority follows catalogue order,
 * so collisions always drop the same labels.
 */
function campusLabels(campus: CampusConfig) {
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

export function campusMapStyle(campus: CampusConfig): StyleSpecification {
  return {
    version: 8,
    name: `${campus.shortName} campus light`,
    glyphs: OPENFREEMAP_GLYPHS,
    // Style-level transitions off: paint changes (selection, hover) are instant.
    transition: { duration: 0, delay: 0 },
    light: { anchor: "viewport", color: "#ffffff", intensity: 0.28, position: [1.5, 215, 40] },
    sources: {
      openmaptiles: { type: "vector", url: OPENFREEMAP_TILEJSON, attribution: BASEMAP_ATTRIBUTION },
      "unt-campus-labels": { type: "geojson", data: campusLabels(campus) },
    },
    layers: [
      { id: "land", type: "background", paint: { "background-color": "#eeede9" } },
      {
        id: "campus-land",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        filter: ["match", ["get", "class"], ["school", "college", "university"], true, false],
        paint: { "fill-color": "#e7e9e1" },
      },
      {
        id: "grass",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["match", ["get", "class"], ["grass", "wood"], true, false],
        paint: { "fill-color": ["match", ["get", "class"], "wood", "#d7e3cf", "#dde8d5"], "fill-opacity": 0.85 },
      },
      {
        id: "park",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "park",
        paint: { "fill-color": "#dbe7d2", "fill-opacity": 0.7 },
      },
      {
        id: "recreation",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        filter: ["match", ["get", "class"], ["pitch", "recreation_ground", "cemetery"], true, false],
        paint: { "fill-color": "#d8e4ce", "fill-opacity": 0.8 },
      },
      {
        id: "parking",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        minzoom: 14,
        filter: ["==", ["get", "class"], "parking"],
        paint: { "fill-color": "#e2e1dd" },
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
        id: "walkway-casing",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 14,
        filter: ["match", ["get", "class"], ["path", "pedestrian", "track"], true, false],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#d8d9d1", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1.5, 17, 4, 20, 9] },
      },
      {
        id: "walkway-surface",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 14,
        filter: ["match", ["get", "class"], ["path", "pedestrian", "track"], true, false],
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
      {
        id: "building-footprint",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        paint: { "fill-color": "#e0dfda", "fill-outline-color": "#cdcdc6" },
      },
      {
        // Fades in over one zoom level so the flat overview stays legible.
        // The 15.5 to 16.5 band is the design's starting point, not a measured threshold.
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
          "fill-extrusion-opacity": ["interpolate", ["cubic-bezier", 0.23, 1, 0.32, 1], ["zoom"], 15.5, 0, 16.5, 0.9],
          "fill-extrusion-vertical-gradient": true,
        },
      },
      {
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
      },
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
    ],
  } as StyleSpecification;
}
