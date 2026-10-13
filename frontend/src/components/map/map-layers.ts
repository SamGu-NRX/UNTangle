/**
 * The route overlay: one line per walking leg, drawn as a white casing under
 * a green line with round caps, white chevrons along walkway routes, dashes
 * for straight-line estimates, and small white-ringed dots where each leg
 * meets a building. Adopted from the design direction's apple-maps-web
 * layers.ts. Stops are DOM markers (map-canvas.tsx) rather than the
 * prototype's circle layers: DESIGN.md's lollipop pin with a shared "2–3"
 * label, and a real button that keyboard and screen-reader users can reach.
 */
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import type { Itinerary } from "@/lib/map-itinerary";
import { LABEL_ANCHOR_LAYER } from "@/components/map/campus-style";

// Source, layer and image ids follow the design's route-and-pins.md.
export const ROUTE_SOURCE = "unt-route-legs";
export const ROUTE_ENDS_SOURCE = "unt-route-leg-ends";
export const ROUTE_HIT_LAYER = "unt-route-hit";
const CHEVRON_IMAGE = "unt-route-chevron";

// Keep in sync with --mv-route and --mv-route-active in map.css.
const ROUTE_GREEN = "#007a40";
const ROUTE_ACTIVE = "#00512b";

const selected: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];
const hover: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];
const round = { "line-cap": "round", "line-join": "round" } as const;

const lineWidth: ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  14, ["case", selected, 5, 3.5],
  17, ["case", selected, 7, 5],
  20, ["case", selected, 9, 6],
];
const casingWidth: ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  14, ["case", selected, 8, 6.5],
  17, ["case", selected, 11, 9],
  20, ["case", selected, 13, 10],
];

function routeLayers(): LayerSpecification[] {
  return [
    {
      id: "unt-route-hover",
      type: "line",
      source: ROUTE_SOURCE,
      layout: round,
      paint: { "line-color": "#46564b", "line-width": 17, "line-opacity": ["case", hover, 0.16, 0] },
    },
    {
      id: "unt-route-casing",
      type: "line",
      source: ROUTE_SOURCE,
      layout: round,
      paint: { "line-color": "#ffffff", "line-width": casingWidth, "line-opacity": 0.98 },
    },
    {
      id: "unt-route-solid",
      type: "line",
      source: ROUTE_SOURCE,
      filter: ["==", ["get", "approximate"], false],
      layout: round,
      paint: {
        "line-color": ["case", selected, ROUTE_ACTIVE, ROUTE_GREEN],
        "line-width": lineWidth,
      },
    },
    {
      id: "unt-route-approximate",
      type: "line",
      source: ROUTE_SOURCE,
      filter: ["==", ["get", "approximate"], true],
      layout: round,
      paint: {
        "line-color": ["case", selected, ROUTE_ACTIVE, ROUTE_GREEN],
        "line-width": lineWidth,
        "line-dasharray": [1.2, 1.8],
      },
    },
    {
      id: "unt-route-chevrons",
      type: "symbol",
      source: ROUTE_SOURCE,
      minzoom: 16,
      filter: ["==", ["get", "approximate"], false],
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 76,
        "icon-image": CHEVRON_IMAGE,
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
        // The chevron points along the line's coordinate order, which is the walking direction.
        "icon-keep-upright": false,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: { "icon-opacity": ["case", selected, 1, 0.8] },
    },
    {
      id: "unt-route-ends",
      type: "circle",
      source: ROUTE_ENDS_SOURCE,
      minzoom: 15.5,
      paint: {
        "circle-radius": 4,
        "circle-color": ROUTE_GREEN,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-pitch-alignment": "viewport",
      },
    },
    {
      id: ROUTE_HIT_LAYER,
      type: "line",
      source: ROUTE_SOURCE,
      layout: round,
      paint: { "line-width": 24, "line-opacity": 0 },
    },
  ];
}

function addChevron(map: MapLibreMap) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The route chevron needs a 2D canvas context.");
  }
  context.strokeStyle = "#ffffff";
  context.lineWidth = 4;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(12, 9);
  context.lineTo(20, 16);
  context.lineTo(12, 23);
  context.stroke();
  map.addImage(CHEVRON_IMAGE, context.getImageData(0, 0, 32, 32), { pixelRatio: 2 });
}

const emptyCollection = { type: "FeatureCollection" as const, features: [] };

/** Once per style load. Later itinerary changes go through setRouteData. */
export function addRouteOverlay(map: MapLibreMap) {
  if (!map.hasImage(CHEVRON_IMAGE)) addChevron(map);
  // promoteId lets feature-state address a leg by its itinerary key.
  map.addSource(ROUTE_SOURCE, { type: "geojson", data: emptyCollection, promoteId: "key" });
  map.addSource(ROUTE_ENDS_SOURCE, { type: "geojson", data: emptyCollection });
  const anchor = map.getLayer(LABEL_ANCHOR_LAYER) ? LABEL_ANCHOR_LAYER : undefined;
  for (const layer of routeLayers()) {
    map.addLayer(layer, layer.id === "unt-route-ends" || layer.id === ROUTE_HIT_LAYER ? undefined : anchor);
  }
}

export function setRouteData(map: MapLibreMap, itinerary: Itinerary) {
  const routes = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
  const ends = map.getSource<GeoJSONSource>(ROUTE_ENDS_SOURCE);
  if (!routes || !ends) return;
  const drawn = itinerary.legs.flatMap((leg) =>
    leg.route.kind === "walk" || leg.route.kind === "straight-line"
      ? [{ key: leg.key, approximate: leg.route.kind === "straight-line", geometry: leg.route.geometry }]
      : [],
  );
  routes.setData({
    type: "FeatureCollection",
    features: drawn.map((leg) => ({
      type: "Feature",
      properties: { key: leg.key, approximate: leg.approximate },
      geometry: { type: "LineString", coordinates: leg.geometry.map((p) => [p.lng, p.lat]) },
    })),
  });
  ends.setData({
    type: "FeatureCollection",
    features: drawn
      .filter((leg) => !leg.approximate)
      .flatMap((leg) => [leg.geometry[0], leg.geometry[leg.geometry.length - 1]])
      .map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lng, p.lat] } })),
  });
}

/** Mark the selected leg; MapLibre merges feature-state, so every leg is set every time. */
export function setLegSelection(map: MapLibreMap, itinerary: Itinerary, selectedKey: string | null) {
  if (!map.getSource(ROUTE_SOURCE)) return;
  for (const leg of itinerary.legs) {
    if (leg.route.kind !== "walk" && leg.route.kind !== "straight-line") continue;
    map.setFeatureState(
      { source: ROUTE_SOURCE, id: leg.key },
      { selected: leg.key === selectedKey },
    );
  }
}

export function setLegHover(map: MapLibreMap, key: string | null, previous: string | null) {
  if (!map.getSource(ROUTE_SOURCE)) return;
  if (previous) map.setFeatureState({ source: ROUTE_SOURCE, id: previous }, { hover: false });
  if (key) map.setFeatureState({ source: ROUTE_SOURCE, id: key }, { hover: true });
}
