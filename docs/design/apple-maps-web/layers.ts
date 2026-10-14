import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, LineString, Point, Polygon } from "geojson";

/** Adapter input, not the /api/map/route response shape. Validate that response upstream. */
export type RouteProperties = { approximate: boolean };
export type StopProperties = { number: number; name: string; code: string };
export type LocationProperties = { stale: boolean };
export type OverlayData = {
  routes: FeatureCollection<LineString, RouteProperties>;
  stops: FeatureCollection<Point, StopProperties>;
  location: FeatureCollection<Point, LocationProperties>;
  accuracy: FeatureCollection<Polygon, LocationProperties>;
};

export const SOURCES = {
  routes: "unt-route-legs",
  stops: "unt-stops",
  location: "unt-location",
  accuracy: "unt-location-accuracy",
} as const;
export const CHEVRON_IMAGE = "unt-route-chevron";
export const ROUTE_HIT_LAYER = "unt-route-hit";
export const STOP_HIT_LAYER = "unt-stop-hit";
export const BASE_LABEL_ANCHOR = "campus-building-label";

// Keep in sync with the existing --brand-700 and --brand-900 tokens.
const GREEN = "#007a40";
const ACTIVE_GREEN = "#00512b";
const selected: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];
const active: ExpressionSpecification = ["boolean", ["feature-state", "active"], false];
const hover: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];
const emphasized: ExpressionSpecification = ["any", active, selected];
const lineWidth: ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  14, ["case", emphasized, 5, 3.5],
  17, ["case", emphasized, 7, 5],
  20, ["case", emphasized, 9, 6],
];
const casingWidth: ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  14, ["case", emphasized, 8, 6.5],
  17, ["case", emphasized, 11, 9],
  20, ["case", emphasized, 13, 10],
];
const round = { "line-cap": "round", "line-join": "round" } as const;

/** Add in this order, before BASE_LABEL_ANCHOR. Source IDs and layer IDs are reserved. */
export function routeLayers(): LayerSpecification[] {
  return [
    {
      id: "unt-route-hover", type: "line", source: SOURCES.routes, layout: round,
      paint: {
        "line-color": "#46564b", "line-width": 17,
        "line-opacity": ["case", hover, 0.16, 0],
        "line-opacity-transition": { duration: 0 },
      },
    },
    {
      id: "unt-route-casing", type: "line", source: SOURCES.routes, layout: round,
      paint: { "line-color": "#ffffff", "line-width": casingWidth, "line-opacity": 0.98 },
    },
    {
      id: "unt-route-solid", type: "line", source: SOURCES.routes,
      filter: ["==", ["get", "approximate"], false], layout: round,
      paint: {
        "line-color": ["case", emphasized, ACTIVE_GREEN, GREEN],
        "line-width": lineWidth,
        "line-color-transition": { duration: 0 }, "line-width-transition": { duration: 0 },
      },
    },
    {
      id: "unt-route-approximate", type: "line", source: SOURCES.routes,
      filter: ["==", ["get", "approximate"], true], layout: round,
      paint: {
        "line-color": ["case", emphasized, ACTIVE_GREEN, GREEN],
        "line-width": lineWidth,
        // Separate layer works on MapLibre 5.6.2; no feature-dependent dash expression.
        "line-dasharray": [1.2, 1.8],
        "line-color-transition": { duration: 0 }, "line-width-transition": { duration: 0 },
      },
    },
    {
      id: "unt-route-chevrons", type: "symbol", source: SOURCES.routes, minzoom: 16,
      filter: ["==", ["get", "approximate"], false],
      layout: {
        "symbol-placement": "line", "symbol-spacing": 76,
        "icon-image": CHEVRON_IMAGE, "icon-size": 1,
        "icon-rotation-alignment": "map", "icon-pitch-alignment": "map",
        // A right-facing image follows coordinate order. Never flip it to keep text upright.
        "icon-keep-upright": false,
        "icon-allow-overlap": true, "icon-ignore-placement": true,
      },
      paint: { "icon-opacity": ["case", emphasized, 1, 0.8] },
    },
    {
      id: ROUTE_HIT_LAYER, type: "line", source: SOURCES.routes, layout: round,
      paint: { "line-width": 24, "line-opacity": 0 },
    },
  ];
}

/** Append after basemap labels. Pins and location must stay legible above route paint. */
export function pointLayers(): LayerSpecification[] {
  return [
    {
      id: "unt-location-accuracy-fill", type: "fill", source: SOURCES.accuracy,
      paint: { "fill-color": ["case", ["get", "stale"], "#7c8490", "#2879da"], "fill-opacity": 0.1 },
    },
    {
      id: "unt-location-accuracy-edge", type: "line", source: SOURCES.accuracy,
      paint: { "line-color": ["case", ["get", "stale"], "#7c8490", "#2879da"], "line-width": 1, "line-opacity": 0.35 },
    },
    {
      id: "unt-stop-halo", type: "circle", source: SOURCES.stops,
      paint: {
        "circle-radius": ["case", selected, 23, hover, 22, 18],
        "circle-color": ["case", selected, GREEN, "#46564b"],
        "circle-opacity": ["case", selected, 0.17, hover, 0.14, 0],
        "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport",
      },
    },
    {
      id: "unt-stop-disc", type: "circle", source: SOURCES.stops,
      paint: {
        "circle-radius": ["case", selected, 17, 14],
        "circle-color": ["case", selected, GREEN, "#46564b"],
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 3,
        "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport",
      },
    },
    {
      id: "unt-stop-number", type: "symbol", source: SOURCES.stops,
      layout: {
        "text-field": ["to-string", ["get", "number"]], "text-font": ["Noto Sans Regular"],
        "text-size": 14, "text-allow-overlap": true, "text-ignore-placement": true,
        "text-pitch-alignment": "viewport", "text-rotation-alignment": "viewport",
      },
      paint: { "text-color": "#ffffff" },
    },
    {
      id: STOP_HIT_LAYER, type: "circle", source: SOURCES.stops,
      paint: { "circle-radius": 22, "circle-opacity": 0, "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport" },
    },
    {
      id: "unt-location-ring", type: "circle", source: SOURCES.location,
      paint: { "circle-radius": 13, "circle-color": "#ffffff", "circle-opacity": 0.8, "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport" },
    },
    {
      id: "unt-location-dot", type: "circle", source: SOURCES.location,
      paint: {
        "circle-radius": 7, "circle-color": ["case", ["get", "stale"], "#7c8490", "#176cd2"],
        "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
        "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport",
      },
    },
  ];
}

/** Original right-facing white chevron. No sprite dependency or glyph direction ambiguity. */
export function addChevron(map: MapLibreMap): void {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("UNTangle route chevron requires a 2D canvas context.");
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(12, 9);
  ctx.lineTo(20, 16);
  ctx.lineTo(12, 23);
  ctx.stroke();
  map.addImage(CHEVRON_IMAGE, ctx.getImageData(0, 0, 32, 32), { pixelRatio: 2 });
}

function withKeys<T extends FeatureCollection>(collection: T): T {
  return { ...collection, features: collection.features.map((feature) => ({ ...feature, properties: { ...feature.properties, key: feature.id } })) };
}

/** Call once per style load. Use GeoJSONSource.setData for later route/location updates (pass them through the same keys). */
export function addCampusOverlays(map: MapLibreMap, data: OverlayData): void {
  if (!map.getLayer(BASE_LABEL_ANCHOR)) {
    throw new Error(`UNTangle overlays require basemap layer '${BASE_LABEL_ANCHOR}'.`);
  }
  for (const id of Object.values(SOURCES)) {
    if (map.getSource(id)) throw new Error(`UNTangle overlay source '${id}' already exists.`);
  }
  const layers = [...routeLayers(), ...pointLayers()];
  for (const { id } of layers) {
    if (map.getLayer(id)) throw new Error(`UNTangle overlay layer '${id}' already exists.`);
  }
  if (map.hasImage(CHEVRON_IMAGE)) throw new Error(`UNTangle image '${CHEVRON_IMAGE}' already exists.`);
  for (const [name, collection] of Object.entries(data)) {
    const ids = new Set<string | number>();
    for (const feature of collection.features) {
      if (feature.id === undefined || ids.has(feature.id)) {
        throw new Error(`UNTangle '${name}' requires a unique explicit feature.id on every feature.`);
      }
      ids.add(feature.id);
    }
  }
  addChevron(map);
  // MapLibre keeps only numeric feature ids: a string id such as "gab" reaches
  // queryRenderedFeatures and feature-state as undefined. Copy each id into a `key`
  // property and promote it, so string and numeric ids both address their feature.
  map.addSource(SOURCES.routes, { type: "geojson", data: withKeys(data.routes), lineMetrics: false, promoteId: "key" });
  map.addSource(SOURCES.stops, { type: "geojson", data: withKeys(data.stops), promoteId: "key" });
  map.addSource(SOURCES.location, { type: "geojson", data: data.location });
  map.addSource(SOURCES.accuracy, { type: "geojson", data: data.accuracy });
  for (const layer of routeLayers()) map.addLayer(layer, BASE_LABEL_ANCHOR);
  for (const layer of pointLayers()) map.addLayer(layer);
}

export type InteractiveSource = typeof SOURCES.routes | typeof SOURCES.stops;
export type InteractionState = { hover?: boolean; selected?: boolean; active?: boolean };

/** Merges state. The caller must clear the previous ID when focus or hover moves. */
export function setInteraction(
  map: MapLibreMap,
  target: { source: InteractiveSource; id: string | number },
  state: InteractionState,
): void {
  map.setFeatureState(target, state);
}
