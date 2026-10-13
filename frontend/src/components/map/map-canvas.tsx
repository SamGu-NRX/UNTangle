"use client";

import { LngLatBounds, Map as MapLibreMap, Marker, getVersion, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { activeCampus } from "@/lib/campus/config";
import type { Itinerary, ItineraryStop } from "@/lib/map-itinerary";
import type { MapRoutePoint } from "@/lib/types";
import { OSM_CONTRIBUTORS_ATTRIBUTION, campusMapStyle } from "@/components/map/campus-style";
import {
  ROUTE_HIT_LAYER,
  addRouteOverlay,
  setLegHover,
  setLegSelection,
  setRouteData,
} from "@/components/map/map-layers";
import type { MapSelection } from "@/components/map/selection";

export type CameraInsets = { top: number; right: number; bottom: number; left: number };

type Props = {
  itinerary: Itinerary;
  selection: MapSelection;
  onSelect: (selection: MapSelection) => void;
  /** Space covered by the panel or sheet, so the camera centers in what's visible. */
  insets: CameraInsets;
  reducedMotion: boolean;
};

/*
 * Camera values from the design's camera spec (apple-maps-web/camera.md):
 * north up, a 500 ms flight with a 45° tilt when a stop is chosen, flat
 * views for the whole day and for legs, and instant moves everywhere else.
 * They are the design's proposals, not measured optima.
 */
const FLIGHT_MS = 500;
const CONTROL_MS = 250;
const STOP_ZOOM = 17.8;
const DAY_MAX_ZOOM = 17.6;
const LEG_MAX_ZOOM = 17.6;
const OVERVIEW_MAX_ZOOM = 15.6;
const STREET_PITCH = 45;
const MAX_PITCH = 50;
const FLAT_BELOW_ZOOM = 16;

/** How far past the routing bounds people may pan, in degrees (about 1.1 km). */
const PAN_MARGIN = 0.01;
const { bounds } = activeCampus;
const maxBounds = new LngLatBounds(
  [bounds.west - PAN_MARGIN, bounds.south - PAN_MARGIN],
  [bounds.east + PAN_MARGIN, bounds.north + PAN_MARGIN],
);
const campusBounds = new LngLatBounds([bounds.west, bounds.south], [bounds.east, bounds.north]);

/**
 * UNTangle's strong ease-out, cubic-bezier(0.19, 1, 0.22, 1), as a function
 * of time for MapLibre: solve the curve's x for t, then return its y.
 */
function cameraEase(time: number): number {
  const x1 = 0.19;
  const y1 = 1;
  const x2 = 0.22;
  const y2 = 1;
  const bezier = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  let low = 0;
  let high = 1;
  let t = time;
  for (let step = 0; step < 24; step += 1) {
    t = (low + high) / 2;
    if (bezier(t, x1, x2) < time) low = t;
    else high = t;
  }
  return bezier(t, y1, y2);
}

let workerConfigured = false;
function configureWorker() {
  if (workerConfigured) return;
  setWorkerUrl(`/api/map/worker?v=${getVersion()}`);
  workerConfigured = true;
}

type Pin = {
  key: string;
  point: MapRoutePoint;
  stopKeys: string[];
  label: string;
  title: string;
};

/** "1", "2–3", "1, 4": stops in one building share one pin. */
function pinLabel(numbers: number[]): string {
  const parts: string[] = [];
  let start = numbers[0];
  let previous = numbers[0];
  for (const value of [...numbers.slice(1), Number.NaN]) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start}–${previous}`);
    start = value;
    previous = value;
  }
  return parts.join(", ");
}

function pinsFor(stops: ItineraryStop[]): Pin[] {
  const byPlace = new Map<string, { point: MapRoutePoint; entries: ItineraryStop[]; name: string }>();
  for (const entry of stops) {
    if (entry.placement.kind !== "mapped") continue;
    const key = `${entry.placement.buildingId ?? ""}@${entry.placement.point.lat},${entry.placement.point.lng}`;
    const group = byPlace.get(key) ?? { point: entry.placement.point, entries: [], name: entry.placement.buildingName };
    group.entries.push(entry);
    byPlace.set(key, group);
  }
  return [...byPlace.entries()].map(([key, group]) => {
    const classes = group.entries.map((entry) => `${entry.number}, ${entry.stop.courseCode}`).join("; ");
    return {
      key,
      point: group.point,
      stopKeys: group.entries.map((entry) => entry.key),
      label: pinLabel(group.entries.map((entry) => entry.number)),
      title: `${group.name}. Stop ${classes}`,
    };
  });
}

function boundsOf(points: MapRoutePoint[]): LngLatBounds | null {
  if (points.length === 0) return null;
  const result = new LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat]);
  for (const point of points) result.extend([point.lng, point.lat]);
  return result;
}

function mappedPoints(itinerary: Itinerary): MapRoutePoint[] {
  return itinerary.stops.flatMap((entry) => (entry.placement.kind === "mapped" ? [entry.placement.point] : []));
}

function withMargin(insets: CameraInsets, margin: number) {
  return {
    top: insets.top + margin,
    right: insets.right + margin,
    bottom: insets.bottom + margin,
    left: insets.left + margin,
  };
}

export function MapCanvas({ itinerary, selection, onSelect, insets, reducedMotion }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new globalThis.Map<string, { marker: Marker; element: HTMLButtonElement }>());
  const [styleReady, setStyleReady] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [pitch, setPitch] = useState(0);

  // Latest values for map event handlers, which are bound once.
  const latest = useRef({ itinerary, onSelect, insets, reducedMotion });
  latest.current = { itinerary, onSelect, insets, reducedMotion };

  /* ---------- create the map once ---------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    configureWorker();
    const map = new MapLibreMap({
      container,
      style: campusMapStyle(activeCampus),
      center: [activeCampus.center.lng, activeCampus.center.lat],
      zoom: 15.4,
      minZoom: 13,
      maxZoom: 19,
      maxPitch: latest.current.reducedMotion ? 0 : MAX_PITCH,
      maxBounds,
      attributionControl: { compact: true, customAttribution: OSM_CONTRIBUTORS_ATTRIBUTION },
      // North stays up: no drag, twist or keyboard rotation, and no touch
      // tilt. The camera tilts only when a stop is chosen.
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: latest.current.reducedMotion ? 0 : 150,
      // The design's phone budget (apple-maps-web/NOTES.md, proposed, not
      // measured): cap the canvas at 2x and bound the unused-tile cache.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      maxTileCacheSize: 48,
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.touchPitch.disable();
    map.keyboard.disableRotation();

    const canvas = map.getCanvas();
    canvas.setAttribute("aria-label", "Campus map. Arrow keys pan, plus and minus zoom.");

    map.on("load", () => {
      addRouteOverlay(map);
      setStyleReady(true);
      container.dataset.ready = "true";
    });

    // The camera as plain attributes: what a browser test (or a curious
    // developer) can read without reaching into MapLibre.
    const recordCamera = () => {
      const center = map.getCenter();
      container.dataset.zoom = map.getZoom().toFixed(2);
      container.dataset.pitch = map.getPitch().toFixed(1);
      container.dataset.center = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    };
    map.on("moveend", recordCamera);
    recordCamera();

    map.on("error", (event) => {
      // Tile or glyph requests that fail leave the map usable: stops and
      // routes are ours and still draw. Say so instead of failing silently.
      const message = String((event.error as Error | undefined)?.message ?? "");
      if (/tile|glyph|source|fetch|Failed/i.test(message)) setTilesFailed(true);
    });

    map.on("pitchend", () => setPitch(map.getPitch()));

    // Flat again below street zoom, so the overview reads like a plan.
    map.on("zoomend", () => {
      if (map.getZoom() < FLAT_BELOW_ZOOM && map.getPitch() > 0 && !map.isMoving()) {
        map.easeTo({ pitch: 0, duration: latest.current.reducedMotion ? 0 : CONTROL_MS, easing: cameraEase });
      }
    });

    let hovered: string | null = null;
    map.on("mousemove", ROUTE_HIT_LAYER, (event) => {
      const key = event.features?.[0]?.properties?.key;
      if (typeof key !== "string" || key === hovered) return;
      setLegHover(map, key, hovered);
      hovered = key;
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", ROUTE_HIT_LAYER, () => {
      setLegHover(map, null, hovered);
      hovered = null;
      map.getCanvas().style.cursor = "";
    });
    map.on("click", ROUTE_HIT_LAYER, (event) => {
      const key = event.features?.[0]?.properties?.key;
      if (typeof key === "string") latest.current.onSelect({ kind: "leg", key });
    });

    const markers = markersRef.current;
    return () => {
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Reduced motion turned on mid-session: stop, flatten, stay put.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setMaxPitch(reducedMotion ? 0 : MAX_PITCH);
    if (reducedMotion) {
      map.stop();
      map.jumpTo({ pitch: 0 });
    }
  }, [reducedMotion]);

  /* ---------- route lines ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    setRouteData(map, itinerary);
    setLegSelection(map, itinerary, selection?.kind === "leg" ? selection.key : null);
  }, [itinerary, selection, styleReady]);

  /* ---------- pins ---------- */
  const pins = pinsFor(itinerary.stops);
  const pinSignature = pins.map((pin) => `${pin.key}:${pin.label}:${pin.stopKeys.join(",")}`).join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const wanted = new Set(pins.map((pin) => pin.key));
    for (const [key, { marker }] of markers) {
      if (!wanted.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }
    for (const pin of pins) {
      let entry = markers.get(pin.key);
      if (!entry) {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "mv-pin";
        element.innerHTML = '<span class="mv-pin__disc"></span><span class="mv-pin__tail" aria-hidden="true"></span>';
        const marker = new Marker({ element, anchor: "bottom" }).setLngLat([pin.point.lng, pin.point.lat]).addTo(map);
        entry = { marker, element };
        markers.set(pin.key, entry);
      }
      const { element } = entry;
      const disc = element.querySelector(".mv-pin__disc");
      if (disc) disc.textContent = pin.label;
      element.dataset.pinKey = pin.key;
      element.dataset.stopKeys = pin.stopKeys.join(" ");
      element.setAttribute("aria-label", pin.title);
      element.onclick = (event) => {
        event.stopPropagation();
        latest.current.onSelect({ kind: "stop", key: pin.stopKeys[0] });
      };
    }
    // pinSignature captures everything about `pins` this effect reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinSignature]);

  useEffect(() => {
    const selectedKey = selection?.kind === "stop" ? selection.key : null;
    for (const { element } of markersRef.current.values()) {
      const isSelected = selectedKey !== null && (element.dataset.stopKeys ?? "").split(" ").includes(selectedKey);
      element.dataset.selected = isSelected ? "true" : "false";
      element.setAttribute("aria-pressed", isSelected ? "true" : "false");
      // The marker element is the button itself; raise it over its neighbours.
      element.style.zIndex = isSelected ? "2" : "1";
    }
  }, [selection, pinSignature]);

  /* ---------- camera ---------- */
  const daySignature = itinerary.stops.map((entry) => entry.key).join("|");
  const mappedSignature = mappedPoints(itinerary)
    .map((point) => `${point.lat},${point.lng}`)
    .join("|");

  // Frame the whole day when the day (or where its stops sit) changes. The
  // first frame and day switches are instant; only chosen stops fly.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.stop();
    const box = boundsOf(mappedPoints(latest.current.itinerary));
    const padding = withMargin(latest.current.insets, 44);
    if (box) {
      map.fitBounds(box, { padding, maxZoom: DAY_MAX_ZOOM, pitch: 0, bearing: 0, duration: 0 });
    } else {
      map.fitBounds(campusBounds, { padding, maxZoom: OVERVIEW_MAX_ZOOM, pitch: 0, bearing: 0, duration: 0 });
    }
  }, [daySignature, mappedSignature]);

  // Fly to what was selected, from the list or the map. Deferred a frame so
  // the panel or sheet has settled and the insets are current.
  useEffect(() => {
    if (!selection) return;
    const frame = requestAnimationFrame(() => {
      const map = mapRef.current;
      if (!map) return;
      const { itinerary: current, insets: currentInsets, reducedMotion: reduce } = latest.current;
      map.stop();
      if (selection.kind === "stop") {
        const entry = current.stops.find((stop) => stop.key === selection.key);
        if (!entry || entry.placement.kind !== "mapped") return;
        const point = entry.placement.point;
        // Center the stop in the space the panel or sheet leaves visible. The
        // padding goes into this calculation only; passing it to flyTo would
        // make it stick to the map and add to every later fit.
        const camera = map.cameraForBounds(new LngLatBounds([point.lng, point.lat], [point.lng, point.lat]), {
          padding: withMargin(currentInsets, 40),
          maxZoom: STOP_ZOOM,
          bearing: 0,
        });
        if (!camera?.center) return;
        if (reduce) {
          map.jumpTo({ center: camera.center, zoom: camera.zoom, pitch: 0, bearing: 0 });
        } else {
          map.flyTo({
            center: camera.center,
            zoom: camera.zoom,
            pitch: STREET_PITCH,
            bearing: 0,
            duration: FLIGHT_MS,
            easing: cameraEase,
          });
        }
        return;
      }
      const leg = current.legs.find((candidate) => candidate.key === selection.key);
      if (!leg || (leg.route.kind !== "walk" && leg.route.kind !== "straight-line")) return;
      const box = boundsOf(leg.route.geometry);
      // Legs stay flat: a tilted fit can push part of a bent path out of view.
      if (box) {
        map.fitBounds(box, {
          padding: withMargin(currentInsets, 56),
          maxZoom: LEG_MAX_ZOOM,
          pitch: 0,
          bearing: 0,
          duration: reduce ? 0 : FLIGHT_MS,
          easing: cameraEase,
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [selection]);

  /* ---------- controls ---------- */
  const controlMs = reducedMotion ? 0 : CONTROL_MS;
  const zoomBy = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.stop();
    map.easeTo({ zoom: map.getZoom() + delta, duration: controlMs, easing: cameraEase });
  };
  const flatten = () => {
    mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: controlMs, easing: cameraEase });
  };
  const fitDay = () => {
    const map = mapRef.current;
    if (!map) return;
    onSelect(null);
    map.stop();
    const box = boundsOf(mappedPoints(itinerary));
    map.fitBounds(box ?? campusBounds, {
      padding: withMargin(insets, 44),
      maxZoom: box ? DAY_MAX_ZOOM : OVERVIEW_MAX_ZOOM,
      pitch: 0,
      bearing: 0,
      duration: controlMs,
      easing: cameraEase,
    });
  };

  return (
    <div className="mv-canvas">
      <div ref={containerRef} className="mv-canvas__map" data-testid="campus-map" />
      <div className="mv-controls" style={{ bottom: insets.bottom + 16 }} role="group" aria-label="Map controls">
        <div className="mv-controls__stack">
          <button type="button" className="mv-control" onClick={() => zoomBy(1)} aria-label="Zoom in">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
          </button>
          <button type="button" className="mv-control" onClick={() => zoomBy(-1)} aria-label="Zoom out">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
          </button>
        </div>
        <button
          type="button"
          className="mv-control"
          onClick={flatten}
          aria-label="Flatten the map"
          disabled={pitch < 1}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path className="mv-compass-n" d="M8 2.5 10.2 8H5.8Z" />
            <path className="mv-compass-s" d="M8 13.5 5.8 8h4.4Z" />
          </svg>
        </button>
        <button type="button" className="mv-control" onClick={fitDay} aria-label="Show the whole day">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></svg>
        </button>
      </div>
      {tilesFailed ? (
        <p className="mv-tiles-note" role="status">
          The basemap didn&rsquo;t load. Your stops and walking routes are still drawn.
        </p>
      ) : null}
    </div>
  );
}
