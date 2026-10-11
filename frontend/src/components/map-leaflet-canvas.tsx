"use client";

import { divIcon, latLngBounds, type DivIcon } from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import {
  buildCampusGeocodeQuery,
  untCampusCenter,
} from "@/lib/campus-locations";
import {
  createMapDataCaches,
  fetchRouteWithCache,
  planResolveQueue,
  resolveStopsWithCache,
  routeKeyForStops,
  stopLocationKey,
  type ClientRoute,
} from "@/lib/map-client-data";
import { formatTime } from "@/lib/planner";
import type {
  MapRouteDetails,
  MapResolutionSummary,
  MapResolvedLocation,
  MapRouteSummary,
  MapStop,
  WeekDay,
} from "@/lib/types";

type ResolvedMapStop = Omit<MapStop, "lat" | "lng" | "resolutionStatus"> & {
  lat: number;
  lng: number;
  resolutionStatus: "local" | "geocoded";
};

export const emptyRouteSummary: MapRouteSummary = { distanceText: "-", durationText: "-" };
export const emptyResolutionSummary: MapResolutionSummary = {
  resolvedCount: 0,
  unresolvedCount: 0,
  resolving: false,
};
export const emptyRouteDetails: MapRouteDetails = {
  source: null,
  isApproximate: false,
  legs: [],
};

const mapDataCaches = createMapDataCaches();
const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const tileAttribution =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const tileMaxZoom = Number(process.env.NEXT_PUBLIC_MAP_MAX_ZOOM ?? 19);

function paletteIndex(courseCode: string) {
  let h = 0;
  for (let i = 0; i < courseCode.length; i += 1) {
    h = (h * 31 + courseCode.charCodeAt(i)) >>> 0;
  }
  return (h % 8) + 1;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function markerIcon(stop: ResolvedMapStop, index: number, total: number, showLabels: boolean): DivIcon {
  const label = showLabels ? `<strong>${escapeHtml(stop.shortName)}</strong>` : "";
  const positionClass =
    total > 1 && index === 0
      ? " map-marker--start"
      : total > 1 && index === total - 1
        ? " map-marker--end"
        : "";
  return divIcon({
    className: "unt-map-div-icon",
    html: `<div class="map-marker ${showLabels ? "map-marker--label" : ""}${positionClass} map-marker--course-${paletteIndex(
      stop.courseCode,
    )}"><span>${index + 1}</span>${label}</div>`,
    iconAnchor: [15, 15],
  });
}

function hasCoordinates(stop: MapStop): stop is MapStop & { lat: number; lng: number } {
  return typeof stop.lat === "number" && typeof stop.lng === "number";
}

function routeKey(stops: ResolvedMapStop[]) {
  return routeKeyForStops(stops);
}

function sameStop(a: Pick<ResolvedMapStop, "lat" | "lng">, b: Pick<ResolvedMapStop, "lat" | "lng">) {
  return Math.abs(a.lat - b.lat) < 0.00001 && Math.abs(a.lng - b.lng) < 0.00001;
}

function collapseConsecutiveStops(stops: ResolvedMapStop[]) {
  return stops.filter((stop, index) => index === 0 || !sameStop(stop, stops[index - 1]));
}

function haversineMeters(a: Pick<ResolvedMapStop, "lat" | "lng">, b: Pick<ResolvedMapStop, "lat" | "lng">) {
  const earthRadiusMeters = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

function fallbackRoute(stops: ResolvedMapStop[]): ClientRoute {
  const distanceMeters = stops.reduce(
    (total, stop, index) => total + (index === 0 ? 0 : haversineMeters(stops[index - 1], stop)),
    0,
  );

  return {
    positions: stops.map((stop) => [stop.lat, stop.lng]),
    distanceMeters,
    durationSeconds: 0,
    source: "fallback",
  };
}

function routeSummary(route: ClientRoute): MapRouteSummary {
  const miles = route.distanceMeters / 1609.34;
  if (route.source === "fallback") {
    return {
      distanceText: `~${miles.toFixed(2)} mi`,
      durationText: "route unavailable",
    };
  }

  return {
    distanceText: `${miles.toFixed(2)} mi`,
    durationText: `${Math.round(route.durationSeconds / 60)} min`,
  };
}

function routeDetails(route: ClientRoute | null, stops: ResolvedMapStop[]): MapRouteDetails {
  if (!route || stops.length < 2) {
    return emptyRouteDetails;
  }

  return {
    source: route.source,
    isApproximate: route.source === "fallback",
    legs: stops.slice(1).map((stop, index) => {
      const previous = stops[index];
      return {
        from: `${previous.courseCode} · ${previous.shortName}`,
        to: `${stop.courseCode} · ${stop.shortName}`,
        fromMeta: `${formatTime(previous.end)} from ${previous.buildingName}`,
        toMeta: `${formatTime(stop.start)} at ${stop.buildingName}`,
      };
    }),
  };
}

function MapViewport({ stops }: { stops: ResolvedMapStop[] }) {
  const map = useMap();

  useEffect(() => {
    if (stops.length === 0) {
      map.setView([untCampusCenter.lat, untCampusCenter.lng], 15, { animate: false });
      return;
    }

    if (stops.length === 1) {
      map.setView([stops[0].lat, stops[0].lng], 17, { animate: false });
      return;
    }

    map.fitBounds(latLngBounds(stops.map((stop) => [stop.lat, stop.lng])), {
      animate: false,
      padding: [72, 72],
    });
  }, [map, stops]);

  return null;
}

export function MapLeafletCanvas({
  stops,
  activeDay,
  showLabels,
  onSummary,
  onRouteDetails,
  onResolutionChange,
}: {
  stops: MapStop[];
  activeDay: WeekDay;
  showLabels: boolean;
  onSummary: (summary: MapRouteSummary) => void;
  onRouteDetails: (details: MapRouteDetails) => void;
  onResolutionChange: (summary: MapResolutionSummary) => void;
}) {
  const [resolvedSnapshot, setResolvedSnapshot] = useState<Record<string, MapResolvedLocation | null>>(
    () => Object.fromEntries(mapDataCaches.resolutions),
  );
  const [route, setRoute] = useState<ClientRoute | null>(null);
  const [resolvingCount, setResolvingCount] = useState(0);

  useEffect(() => {
    queueMicrotask(() => setResolvedSnapshot(Object.fromEntries(mapDataCaches.resolutions)));

    const queue = planResolveQueue(stops, mapDataCaches, Date.now());
    if (queue.length === 0) {
      queueMicrotask(() => setResolvingCount(0));
      return;
    }

    const controller = new AbortController();
    queueMicrotask(() => setResolvingCount(queue.length));

    resolveStopsWithCache(stops, mapDataCaches, { signal: controller.signal })
      .then((snapshot) => {
        if (controller.signal.aborted) {
          return; // superseded by a newer resolve; it owns the caches now
        }
        setResolvedSnapshot(snapshot);
        setResolvingCount(0);
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return; // aborted or superseded: the newer request owns the UI
        }
        // Partial successes before the failure are still worth applying;
        // the failure itself stays retryable (TTL'd, never cached as final).
        setResolvedSnapshot(Object.fromEntries(mapDataCaches.resolutions));
        setResolvingCount(0);
      });

    return () => {
      controller.abort();
    };
  }, [stops]);

  const resolvedStops = useMemo(
    () =>
      stops.flatMap<ResolvedMapStop>((stop) => {
        if (hasCoordinates(stop)) {
          return [{ ...stop, lat: stop.lat, lng: stop.lng, resolutionStatus: "local" }];
        }

        const resolved = resolvedSnapshot[stopLocationKey(stop)];
        if (
          typeof resolved?.lat !== "number" ||
          typeof resolved.lng !== "number" ||
          resolved.resolutionStatus === "unresolved"
        ) {
          return [];
        }

        return [
          {
            ...stop,
            buildingId: resolved.buildingId ?? stop.buildingId,
            buildingName: resolved.buildingName,
            shortName: resolved.shortName,
            lat: resolved.lat,
            lng: resolved.lng,
            resolutionStatus: resolved.resolutionStatus,
            geocodeQuery: resolved.geocodeQuery || buildCampusGeocodeQuery(stop.location),
          },
        ];
      }),
    [resolvedSnapshot, stops],
  );

  const routeStops = useMemo(() => collapseConsecutiveStops(resolvedStops), [resolvedStops]);
  const currentRouteKey = useMemo(() => routeKey(routeStops), [routeStops]);
  const unresolvedCount = stops.length - resolvedStops.length;

  useEffect(() => {
    onResolutionChange({
      resolvedCount: resolvedStops.length,
      unresolvedCount,
      resolving: resolvingCount > 0,
    });
  }, [onResolutionChange, resolvedStops.length, resolvingCount, unresolvedCount]);

  useEffect(() => {
    if (routeStops.length < 2) {
      queueMicrotask(() => setRoute(null));
      onSummary(emptyRouteSummary);
      return;
    }

    const cached = mapDataCaches.routes.get(currentRouteKey);
    if (cached) {
      queueMicrotask(() => setRoute(cached));
      onSummary(routeSummary(cached));
      return;
    }

    const controller = new AbortController();
    const fallback = fallbackRoute(routeStops);
    queueMicrotask(() => setRoute(null));

    fetchRouteWithCache(routeStops, mapDataCaches, { signal: controller.signal })
      .then((orsRoute) => {
        if (controller.signal.aborted) {
          return; // superseded by a newer route request
        }
        // A failure is never cached as a fallback — the next attempt for the
        // same stop path retries the real routing service.
        const next = orsRoute ?? fallback;
        setRoute(next);
        onSummary(routeSummary(next));
      })
      .catch(() => {
        // Aborted or superseded: the newer request owns the UI.
      });

    return () => {
      controller.abort();
    };
  }, [currentRouteKey, onSummary, routeStops]);

  useEffect(() => {
    onRouteDetails(routeDetails(route, routeStops));
  }, [onRouteDetails, route, routeStops]);

  return (
    <div className="relative h-full min-h-[620px] overflow-hidden rounded-[1.45rem]">
      <MapContainer
        center={[untCampusCenter.lat, untCampusCenter.lng]}
        zoom={15}
        className="unt-leaflet-map"
        scrollWheelZoom
        zoomControl={false}
        attributionControl
      >
        <TileLayer attribution={tileAttribution} maxZoom={tileMaxZoom} url={tileUrl} />
        <MapViewport stops={resolvedStops} />
        {route?.positions.length ? (
          <>
            <Polyline
              positions={route.positions}
              pathOptions={{
                color: route.source === "ors" ? "#f4fff7" : "#ffffff",
                dashArray: route.source === "ors" ? undefined : "10 12",
                lineCap: "round",
                lineJoin: "round",
                opacity: route.source === "ors" ? 0.82 : 0.72,
                weight: 12,
              }}
            />
            <Polyline
              positions={route.positions}
              pathOptions={{
                color: route.source === "ors" ? "#154127" : "#536258",
                dashArray: route.source === "ors" ? undefined : "10 12",
                lineCap: "round",
                lineJoin: "round",
                opacity: route.source === "ors" ? 0.96 : 0.88,
                weight: route.source === "ors" ? 5 : 4,
              }}
            />
          </>
        ) : null}
        {resolvedStops.map((stop, index) => (
          <Marker
            key={`${activeDay}-${stop.courseCode}-${stop.start}-${stopLocationKey(stop)}`}
            icon={markerIcon(stop, index, resolvedStops.length, showLabels)}
            position={[stop.lat, stop.lng]}
          >
            <Tooltip direction="top" offset={[0, -16]} opacity={0.95}>
              {stop.courseCode} - {stop.buildingName} - {formatTime(stop.start)}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
      {unresolvedCount > 0 || route?.source === "fallback" ? (
        <div className="unt-map-notice">
          {resolvingCount > 0
            ? "Resolving UNT building labels..."
            : unresolvedCount > 0
              ? "Some class locations could not be mapped yet."
              : "Walking route is approximate until routing is configured."}
        </div>
      ) : null}
    </div>
  );
}
