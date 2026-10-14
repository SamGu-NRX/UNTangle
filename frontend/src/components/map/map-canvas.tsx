"use client";

import { LngLatBounds, Map as MapLibreMap, Marker, getVersion, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { activeCampus, type CampusConfig } from "@/lib/campus/config";
import { START_KEY, stopNumbersLabel, type Itinerary, type ItineraryLeg, type ItineraryStop } from "@/lib/map-itinerary";
import type { ClassDay, MapRoutePoint } from "@/lib/types";
import { OSM_CONTRIBUTORS_ATTRIBUTION, campusMapStyle } from "@/components/map/campus-style";
import { startMap } from "@/components/map/start-map";
import {
  ROUTE_HIT_LAYER,
  addRouteOverlay,
  setLegHover,
  setLegSelection,
  setRouteData,
} from "@/components/map/map-layers";
import type { MapSelection } from "@/components/map/selection";

/**
 * Camera padding in CSS px: the measured panel or sheet plus clearance, and
 * the controls, so a framed target lands in visible map. The attribution
 * row is added here, measured, because it grows when expanded.
 */
export type CameraPadding = { top: number; right: number; bottom: number; left: number };

/** The day being framed; a new object asks for a fresh fit, animated unless `instant`. */
export type DayFrame = { day: ClassDay; instant: boolean };

type Props = {
  campus?: CampusConfig;
  itinerary: Itinerary;
  selection: MapSelection;
  onSelect: (selection: MapSelection) => void;
  padding: CameraPadding;
  frame: DayFrame;
  reducedMotion: boolean;
  /** Skip camera moves (the phone sheet is at full height and hides the map). */
  frozen: boolean;
  /** The attribution row's height whenever it changes, so the phone sheet stops below it. */
  onCreditsHeight: (height: number) => void;
};

/*
 * Camera values from the design's camera spec (apple-maps-web/camera.md,
 * MOTION.md §6): north up, a 500 ms flight with a 45° tilt when a stop is
 * chosen, flat views for the whole day and for legs, and instant moves for
 * the keyboard, first render and resizes. They are the design's proposals,
 * not measured optima.
 */
const FLIGHT_MS = 500;
/** How long a flight waits for the phone sheet to start its snap to half (MOTION.md §6). */
const AFTER_SHEET_MS = 60;
const CONTROL_MS = 250;
const STOP_ZOOM = 17.8;
const DAY_MAX_ZOOM = 17.6;
const LEG_MAX_ZOOM = 17.6;
const OVERVIEW_MAX_ZOOM = 15.6;
const STREET_PITCH = 45;
const MAX_PITCH = 50;
const FLAT_BELOW_ZOOM = 16;

/**
 * How far past the routing bounds people may pan, in degrees (about 3.3 km).
 * Was 0.01. A phone's half sheet leaves a strip of map about 210 px tall;
 * fitting a campus-wide day into it zooms out to about z14, where the whole
 * 788 px canvas spans about 6 km. With the old margin MapLibre then pinned
 * the center inside the limit and the day slid under the sheet (390x844,
 * Kerr Hall to ENV). 0.03 is the smallest round margin that framed that day.
 */
const PAN_MARGIN = 0.03;

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
      label: stopNumbersLabel(group.entries.map((entry) => entry.number)),
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
  const stops = itinerary.stops.flatMap((entry) => (entry.placement.kind === "mapped" ? [entry.placement.point] : []));
  return itinerary.start ? [itinerary.start.place.point, ...stops] : stops;
}

/** Every leg the map draws: the walk from the starting point, then the walks between classes. */
/** The padding with the attribution row's measured height added to the bottom. */
function withCredits(map: MapLibreMap, padding: CameraPadding): CameraPadding {
  const container = map.getContainer();
  const credits = container.querySelector(".maplibregl-ctrl-bottom-right")?.getBoundingClientRect().height ?? 0;
  const space = { ...padding, bottom: padding.bottom + Math.round(credits) };
  // Beside the recorded camera (data-zoom, data-center): what the last framing kept clear.
  container.dataset.padding = `${space.top},${space.right},${space.bottom},${space.left}`;
  return space;
}

/**
 * A leg's ends as the map marks them: the stop pins (on the building's
 * point) or the starting point. A route starts at a walkway node beside the
 * building, so its own geometry can leave a pin outside the fit.
 */
function legEnds(itinerary: Itinerary, leg: ItineraryLeg): MapRoutePoint[] {
  return [leg.fromKey, leg.toKey].flatMap((key) => {
    if (itinerary.start && key === START_KEY) return [itinerary.start.place.point];
    const placement = itinerary.stops.find((entry) => entry.key === key)?.placement;
    return placement?.kind === "mapped" ? [placement.point] : [];
  });
}

function drawnItinerary(itinerary: Itinerary): Itinerary {
  return itinerary.start ? { ...itinerary, legs: [itinerary.start.leg, ...itinerary.legs] } : itinerary;
}

/** Below this much visible map (px) a fit has nothing useful to aim at; camera.md's floor. */
const MIN_FRAME_WIDTH = 120;
const MIN_FRAME_HEIGHT = 100;
/** Keyboard pan step, px, and zoom step, levels. */
const KEY_PAN_PX = 100;
const KEY_ZOOM = 1;

export function MapCanvas({ campus = activeCampus, itinerary, selection, onSelect, padding, frame: dayFrame, reducedMotion, frozen, onCreditsHeight }: Props) {
  const { bounds } = campus;
  const maxBounds = new LngLatBounds(
    [bounds.west - PAN_MARGIN, bounds.south - PAN_MARGIN],
    [bounds.east + PAN_MARGIN, bounds.north + PAN_MARGIN],
  );
  const campusBounds = new LngLatBounds([bounds.west, bounds.south], [bounds.east, bounds.north]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new globalThis.Map<string, { marker: Marker; element: HTMLButtonElement }>());
  const startMarkerRef = useRef<Marker | null>(null);
  /** A selection flight scheduled but not started; a drag or a newer request cancels it. */
  const pendingFlight = useRef<{ timer: ReturnType<typeof setTimeout>; frame: number } | null>(null);
  /** An animated move of ours is running; a padding change waits for it to end. */
  const flying = useRef(false);
  const reframeAfterFlight = useRef(false);
  /** `aim`, for map events bound once at creation. */
  const aimRef = useRef<(animate: boolean) => void>(() => undefined);
  const cancelPendingFlight = () => {
    const pending = pendingFlight.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    cancelAnimationFrame(pending.frame);
    pendingFlight.current = null;
  };
  const [styleReady, setStyleReady] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [pitch, setPitch] = useState(0);

  // Latest values for map event handlers, which are bound once.
  const latest = useRef({ itinerary, selection, onSelect, padding, reducedMotion, frozen, onCreditsHeight });
  latest.current = { itinerary, selection, onSelect, padding, reducedMotion, frozen, onCreditsHeight };

  /* ---------- create the map once ---------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    configureWorker();
    const started = startMap(() => new MapLibreMap({
      container,
      style: campusMapStyle(campus),
      center: [campus.center.lng, campus.center.lat],
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
    }));
    if (!started.ok) {
      setUnavailable(true);
      return;
    }
    const { map } = started;
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.touchPitch.disable();
    // MapLibre's keyboard handler eases every key press. Keyboard moves here
    // are instant instead (keyboard actions never animate).
    map.keyboard.disable();

    const canvas = map.getCanvas();
    canvas.setAttribute("aria-label", "Campus map. Arrow keys pan, plus and minus zoom.");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const pan: Record<string, [number, number]> = {
        ArrowUp: [0, -KEY_PAN_PX],
        ArrowDown: [0, KEY_PAN_PX],
        ArrowLeft: [-KEY_PAN_PX, 0],
        ArrowRight: [KEY_PAN_PX, 0],
      };
      if (Object.hasOwn(pan, event.key) || ["+", "=", "-", "_"].includes(event.key)) cancelPendingFlight();
      if (Object.hasOwn(pan, event.key)) {
        map.panBy(pan[event.key], { duration: 0 });
      } else if (event.key === "+" || event.key === "=") {
        map.jumpTo({ zoom: map.getZoom() + KEY_ZOOM });
      } else if (event.key === "-" || event.key === "_") {
        map.jumpTo({ zoom: map.getZoom() - KEY_ZOOM });
      } else {
        return;
      }
      event.preventDefault();
    };
    canvas.addEventListener("keydown", onKeyDown);

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

    // A drag takes the camera: a flight waiting for the sheet never starts,
    // and no correction follows the one in progress.
    map.on("dragstart", () => {
      cancelPendingFlight();
      reframeAfterFlight.current = false;
    });
    map.on("moveend", () => {
      if (!flying.current) return;
      flying.current = false;
      if (reframeAfterFlight.current && !pendingFlight.current) {
        reframeAfterFlight.current = false;
        aimRef.current(false);
      }
    });

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

    const credits = container.querySelector(".maplibregl-ctrl-bottom-right");
    const creditsObserver = new ResizeObserver(() => latest.current.onCreditsHeight(credits?.getBoundingClientRect().height ?? 0));
    if (credits) creditsObserver.observe(credits);

    const markers = markersRef.current;
    return () => {
      creditsObserver.disconnect();
      cancelPendingFlight();
      canvas.removeEventListener("keydown", onKeyDown);
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      startMarkerRef.current?.remove();
      startMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Reduced motion, including when it turns on mid-session: stop, flatten,
  // stay put, and swap MapLibre's smoothed wheel zoom for stepped jumps.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setMaxPitch(reducedMotion ? 0 : MAX_PITCH);
    if (!reducedMotion) {
      map.scrollZoom.enable();
      return;
    }
    cancelPendingFlight();
    map.stop();
    map.jumpTo({ pitch: 0 });
    map.scrollZoom.disable();
    const container = map.getCanvasContainer();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const around = map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
      map.zoomTo(map.getZoom() + (event.deltaY < 0 ? 0.5 : -0.5), { around, duration: 0 });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [reducedMotion]);

  /* ---------- route lines ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const drawn = drawnItinerary(itinerary);
    setRouteData(map, drawn);
    setLegSelection(map, drawn, selection?.kind === "leg" ? selection.key : null);
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
      // Stop keys contain spaces (course codes), so they're joined with "|".
      element.dataset.stopKeys = pin.stopKeys.join("|");
      element.setAttribute("aria-label", pin.title);
      element.onclick = (event) => {
        event.stopPropagation();
        latest.current.onSelect({ kind: "stop", key: pin.stopKeys[0], instant: event.detail === 0 });
      };
    }
    // pinSignature captures everything about `pins` this effect reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinSignature]);

  useEffect(() => {
    const selectedKey = selection?.kind === "stop" ? selection.key : null;
    for (const { element } of markersRef.current.values()) {
      const isSelected = selectedKey !== null && (element.dataset.stopKeys ?? "").split("|").includes(selectedKey);
      element.dataset.selected = isSelected ? "true" : "false";
      // A keyboard choice changes the pin at once.
      element.dataset.instant = selection?.instant ? "true" : "false";
      element.setAttribute("aria-pressed", isSelected ? "true" : "false");
      // The marker element is the button itself; raise it over its neighbours.
      element.style.zIndex = isSelected ? "2" : "1";
    }
  }, [selection, pinSignature]);

  /* ---------- starting point ---------- */
  const startPoint = itinerary.start?.place.point ?? null;
  const startName = itinerary.start?.place.name ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    startMarkerRef.current?.remove();
    startMarkerRef.current = null;
    if (!startPoint || !startName) return;
    // The ring the itinerary starts from; the list names it, so it's decorative here.
    const element = document.createElement("span");
    element.className = "mv-start-pin";
    element.setAttribute("aria-hidden", "true");
    element.title = startName;
    startMarkerRef.current = new Marker({ element }).setLngLat([startPoint.lng, startPoint.lat]).addTo(map);
  }, [startPoint, startName]);

  /* ---------- camera ---------- */
  const daySignature = itinerary.stops.map((entry) => entry.key).join("|");
  const mappedSignature = mappedPoints(itinerary)
    .map((point) => `${point.lat},${point.lng}`)
    .join("|");

  /**
   * Point the camera at the selection, or at the whole day when nothing is
   * selected, inside the measured padding. `animate` is for pointer choices
   * only, and never under reduced motion.
   */
  const aim = useCallback((animate: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    const { itinerary: current, selection: chosen, padding, reducedMotion: reduce, frozen: hidden } = latest.current;
    const space = withCredits(map, padding);
    const canvas = map.getCanvas().getBoundingClientRect();
    if (
      hidden ||
      canvas.width - space.left - space.right < MIN_FRAME_WIDTH ||
      canvas.height - space.top - space.bottom < MIN_FRAME_HEIGHT
    ) {
      return;
    }
    const move = animate && !reduce;
    map.stop();
    flying.current = move;

    if (chosen?.kind === "stop") {
      const entry = current.stops.find((stop) => stop.key === chosen.key);
      if (entry?.placement.kind === "mapped") {
        const point = entry.placement.point;
        // The padding goes into this calculation only; passing it to flyTo
        // would make it stick to the map and add to every later fit.
        const camera = map.cameraForBounds(new LngLatBounds([point.lng, point.lat], [point.lng, point.lat]), {
          padding: space,
          maxZoom: STOP_ZOOM,
          bearing: 0,
        });
        if (!camera?.center) return;
        if (move) {
          map.flyTo({ center: camera.center, zoom: camera.zoom, pitch: STREET_PITCH, bearing: 0, duration: FLIGHT_MS, easing: cameraEase });
        } else {
          // The keyboard lands where a pointer's flight would, without the flight.
          map.jumpTo({ center: camera.center, zoom: camera.zoom, pitch: reduce ? 0 : STREET_PITCH, bearing: 0 });
        }
        return;
      }
    }

    if (chosen?.kind === "leg") {
      const leg = drawnItinerary(current).legs.find((candidate) => candidate.key === chosen.key);
      const box =
        leg && (leg.route.kind === "walk" || leg.route.kind === "straight-line")
          ? boundsOf([...leg.route.geometry, ...legEnds(current, leg)])
          : null;
      if (box) {
        // Legs stay flat: a tilted fit can push part of a bent path out of view.
        map.fitBounds(box, { padding: space, maxZoom: LEG_MAX_ZOOM, pitch: 0, bearing: 0, duration: move ? FLIGHT_MS : 0, easing: cameraEase });
        return;
      }
    }

    const day = boundsOf(mappedPoints(current));
    map.fitBounds(day ?? campusBounds, {
      padding: space,
      maxZoom: day ? DAY_MAX_ZOOM : OVERVIEW_MAX_ZOOM,
      pitch: 0,
      bearing: 0,
      duration: move ? FLIGHT_MS : 0,
      easing: cameraEase,
    });
  }, []);

  aimRef.current = aim;

  // A new day, or its places arriving (building lookups, the starting
  // point): frame it. Only a day switched from a pointer flies; first
  // render, data arriving and the keyboard are instant.
  const lastDayFrame = useRef(dayFrame);
  useEffect(() => {
    const animate = dayFrame !== lastDayFrame.current && !dayFrame.instant;
    lastDayFrame.current = dayFrame;
    cancelPendingFlight();
    aim(animate);
  }, [dayFrame, daySignature, mappedSignature, aim]);

  // A selection, or its target arriving later (a building lookup, a route):
  // fly there for a pointer choice, jump for a keyboard one. It waits a frame
  // for layout, and after a sheet snap it waits for the sheet to get going.
  const target = (() => {
    if (!selection) return "none";
    if (selection.kind === "stop") {
      const entry = itinerary.stops.find((stop) => stop.key === selection.key);
      return entry?.placement.kind === "mapped" ? `stop:${selection.key}:${entry.placement.point.lat},${entry.placement.point.lng}` : `pending:${selection.key}`;
    }
    const leg = drawnItinerary(itinerary).legs.find((candidate) => candidate.key === selection.key);
    return leg && (leg.route.kind === "walk" || leg.route.kind === "straight-line")
      ? `leg:${selection.key}:${leg.route.geometry.length}`
      : `pending:${selection.key}`;
  })();
  useEffect(() => {
    cancelPendingFlight();
    if (target === "none" || target.startsWith("pending:")) return;
    const chosen = latest.current.selection;
    const pending = {
      frame: 0,
      timer: setTimeout(() => {
        pending.frame = requestAnimationFrame(() => {
          pendingFlight.current = null;
          aim(!chosen?.instant);
        });
      }, chosen?.afterSheet ? AFTER_SHEET_MS : 0),
    };
    pendingFlight.current = pending;
    return cancelPendingFlight;
  }, [target, aim]);

  // The panel or sheet settled at a new size: reframe instantly, without
  // replaying a flight. A flight already on its way used the new padding.
  const paddingSignature = `${padding.top},${padding.right},${padding.bottom},${padding.left},${frozen}`;
  const firstPadding = useRef(true);
  useEffect(() => {
    if (firstPadding.current) {
      firstPadding.current = false;
      return;
    }
    if (pendingFlight.current) return;
    if (flying.current) {
      reframeAfterFlight.current = true;
      return;
    }
    // A student's own pan or zoom keeps the camera; the next selection uses the new padding.
    if (mapRef.current?.isMoving()) return;
    const handle = requestAnimationFrame(() => aim(false));
    return () => cancelAnimationFrame(handle);
  }, [paddingSignature, aim]);

  /* ---------- controls ---------- */
  // Pointer presses move; keyboard presses (detail 0) and reduced motion jump.
  const controlMs = (event: { detail: number }, ms: number) => (reducedMotion || event.detail === 0 ? 0 : ms);
  const zoomBy = (delta: number, event: { detail: number }) => {
    const map = mapRef.current;
    if (!map) return;
    cancelPendingFlight();
    map.stop();
    map.easeTo({ zoom: map.getZoom() + delta, duration: controlMs(event, CONTROL_MS), easing: cameraEase });
  };
  const flatten = (event: { detail: number }) => {
    cancelPendingFlight();
    mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: controlMs(event, CONTROL_MS), easing: cameraEase });
  };
  const fitDay = (event: { detail: number }) => {
    const map = mapRef.current;
    if (!map) return;
    onSelect(null);
    cancelPendingFlight();
    map.stop();
    const box = boundsOf(mappedPoints(itinerary));
    map.fitBounds(box ?? campusBounds, {
      padding: withCredits(map, padding),
      maxZoom: box ? DAY_MAX_ZOOM : OVERVIEW_MAX_ZOOM,
      pitch: 0,
      bearing: 0,
      duration: controlMs(event, FLIGHT_MS),
      easing: cameraEase,
    });
  };

  if (unavailable) {
    return (
      <div className="mv-canvas">
        <div ref={containerRef} className="mv-canvas__map" data-testid="campus-map" data-unavailable="true" />
        <p className="mv-tiles-note" role="status">
          Map unavailable: this browser couldn&rsquo;t start it (WebGL is off or unsupported). Your itinerary and walking times still work.
        </p>
      </div>
    );
  }

  return (
    <div className="mv-canvas">
      <div ref={containerRef} className="mv-canvas__map" data-testid="campus-map" />
      <div className="mv-controls" role="group" aria-label="Map controls">
        <div className="mv-controls__stack">
          <button type="button" className="mv-control" onClick={(event) => zoomBy(1, event)} aria-label="Zoom in">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
          </button>
          <button type="button" className="mv-control" onClick={(event) => zoomBy(-1, event)} aria-label="Zoom out">
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
