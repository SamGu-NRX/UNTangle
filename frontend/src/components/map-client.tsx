"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { NavShell } from "@/components/nav-shell";
import { StatusMark } from "@/components/ui/StatusMark";
import { StaggerGroup } from "@/components/ui/StaggerGroup";
import { Toggle } from "@/components/ui/Toggle";
import { usePlanner } from "@/components/planner-provider";
import { formatTime } from "@/lib/planner";
import {
  buildCampusGeocodeQuery,
  normalizeLocationLabel,
  untCampusBounds,
  untCampusCenter,
} from "@/lib/campus-locations";
import { weekDays } from "@/lib/types";
import type { MapStop, WeekDay } from "@/lib/types";

type RouteSummary = { distanceText: string; durationText: string };
type ResolutionSummary = { resolvedCount: number; unresolvedCount: number; resolving: boolean };
type GeocodedLocation = { lat: number; lng: number; formattedAddress?: string };
type ResolvedMapStop = Omit<MapStop, "lat" | "lng" | "resolutionStatus"> & {
  lat: number;
  lng: number;
  resolutionStatus: "local" | "geocoded";
};

const emptyRouteSummary: RouteSummary = { distanceText: "—", durationText: "—" };
const emptyResolutionSummary: ResolutionSummary = {
  resolvedCount: 0,
  unresolvedCount: 0,
  resolving: false,
};
const geocodeCache: globalThis.Map<string, GeocodedLocation | null> = new globalThis.Map();

function paletteIndex(courseCode: string) {
  let h = 0;
  for (let i = 0; i < courseCode.length; i += 1) {
    h = (h * 31 + courseCode.charCodeAt(i)) >>> 0;
  }
  return (h % 8) + 1;
}

function paletteVars(courseCode: string): CSSProperties {
  const i = paletteIndex(courseCode);
  return {
    ["--ev-bg" as string]: `var(--course-${i}-bg)`,
    ["--ev-border" as string]: `var(--course-${i}-border)`,
    ["--ev-solid" as string]: `var(--course-${i}-solid)`,
  } as CSSProperties;
}

function stopLocationKey(stop: Pick<MapStop, "location">) {
  return normalizeLocationLabel(stop.location);
}

function hasCoordinates(stop: MapStop): stop is MapStop & { lat: number; lng: number } {
  return typeof stop.lat === "number" && typeof stop.lng === "number";
}

function isInsideUntBounds(location: GeocodedLocation) {
  return (
    location.lat >= untCampusBounds.south &&
    location.lat <= untCampusBounds.north &&
    location.lng >= untCampusBounds.west &&
    location.lng <= untCampusBounds.east
  );
}

async function geocodeStop(geocoder: google.maps.Geocoder, stop: MapStop) {
  const response = await geocoder.geocode({
    address: stop.geocodeQuery || buildCampusGeocodeQuery(stop.location),
    bounds: untCampusBounds,
    region: "us",
  });
  const candidates = response.results
    .map((result) => {
      const location = result.geometry.location;
      return {
        lat: location.lat(),
        lng: location.lng(),
        formattedAddress: result.formatted_address,
      };
    })
    .filter((result) => Number.isFinite(result.lat) && Number.isFinite(result.lng));

  return candidates.find(isInsideUntBounds) ?? candidates[0] ?? null;
}

function RouteRenderer({
  stops,
  onSummary,
}: {
  stops: ResolvedMapStop[];
  onSummary: (summary: RouteSummary) => void;
}) {
  const map = useMap();
  const routesLibrary = useMapsLibrary("routes");

  useEffect(() => {
    if (!map || !routesLibrary || stops.length < 2) {
      onSummary(emptyRouteSummary);
      return;
    }

    const directionsService = new routesLibrary.DirectionsService();
    const directionsRenderer = new routesLibrary.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: {
        strokeColor: "#154127",
        strokeOpacity: 0.92,
        strokeWeight: 6,
      },
    });

    directionsService.route(
      {
        origin: { lat: stops[0].lat, lng: stops[0].lng },
        destination: { lat: stops[stops.length - 1].lat, lng: stops[stops.length - 1].lng },
        waypoints: stops.slice(1, -1).map((stop) => ({
          location: { lat: stop.lat, lng: stop.lng },
          stopover: true,
        })),
        travelMode: google.maps.TravelMode.WALKING,
      },
      (response, status) => {
        if (status === "OK" && response?.routes?.[0]) {
          directionsRenderer.setDirections(response);
          const summary = response.routes[0].legs.reduce(
            (acc, leg) => {
              acc.distance += leg.distance?.value ?? 0;
              acc.duration += leg.duration?.value ?? 0;
              return acc;
            },
            { distance: 0, duration: 0 },
          );
          onSummary({
            distanceText: `${(summary.distance / 1609.34).toFixed(2)} mi`,
            durationText: `${Math.round(summary.duration / 60)} min`,
          });
        } else {
          onSummary({ distanceText: "Route unavailable", durationText: "—" });
        }
      },
    );

    return () => {
      directionsRenderer.setMap(null);
    };
  }, [map, onSummary, routesLibrary, stops]);

  return null;
}

function MapViewport({ stops }: { stops: ResolvedMapStop[] }) {
  const map = useMap();

  useEffect(() => {
    if (!map) {
      return;
    }

    if (stops.length === 0) {
      map.setCenter(untCampusCenter);
      map.setZoom(15);
      return;
    }

    if (stops.length === 1) {
      map.panTo({ lat: stops[0].lat, lng: stops[0].lng });
      map.setZoom(17);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    stops.forEach((stop) => bounds.extend({ lat: stop.lat, lng: stop.lng }));
    map.fitBounds(bounds, 72);
  }, [map, stops]);

  return null;
}

function MapContent({
  stops,
  activeDay,
  showLabels,
  onSummary,
  onResolutionChange,
}: {
  stops: MapStop[];
  activeDay: WeekDay;
  showLabels: boolean;
  onSummary: (summary: RouteSummary) => void;
  onResolutionChange: (summary: ResolutionSummary) => void;
}) {
  const geocodingLibrary = useMapsLibrary("geocoding");
  const geocoder = useMemo(
    () => (geocodingLibrary ? new geocodingLibrary.Geocoder() : null),
    [geocodingLibrary],
  );
  const [geocodedLocations, setGeocodedLocations] = useState<Record<string, GeocodedLocation | null>>(
    () => Object.fromEntries(geocodeCache),
  );

  useEffect(() => {
    if (!geocoder) {
      return;
    }

    const queue = stops.filter((stop) => !hasCoordinates(stop) && !geocodeCache.has(stopLocationKey(stop)));
    if (queue.length === 0) {
      return;
    }

    let cancelled = false;
    void Promise.all(
      queue.map(async (stop) => {
        const key = stopLocationKey(stop);
        try {
          geocodeCache.set(key, await geocodeStop(geocoder, stop));
        } catch {
          geocodeCache.set(key, null);
        }
      }),
    ).then(() => {
      if (!cancelled) {
        setGeocodedLocations(Object.fromEntries(geocodeCache));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [geocoder, stops]);

  const resolvedStops = useMemo(
    () =>
      stops.flatMap<ResolvedMapStop>((stop) => {
        if (hasCoordinates(stop)) {
          return [{ ...stop, lat: stop.lat, lng: stop.lng, resolutionStatus: "local" }];
        }

        const cached = geocodedLocations[stopLocationKey(stop)];
        if (!cached) {
          return [];
        }

        return [
          {
            ...stop,
            lat: cached.lat,
            lng: cached.lng,
            buildingName: cached.formattedAddress ?? stop.buildingName,
            resolutionStatus: "geocoded",
          },
        ];
      }),
    [geocodedLocations, stops],
  );

  const resolving = stops.some((stop) => !hasCoordinates(stop) && !geocodeCache.has(stopLocationKey(stop)));
  const unresolvedCount = stops.length - resolvedStops.length;

  useEffect(() => {
    onResolutionChange({
      resolvedCount: resolvedStops.length,
      unresolvedCount,
      resolving: Boolean(geocoder && resolving),
    });
  }, [geocoder, onResolutionChange, resolvedStops.length, resolving, unresolvedCount]);

  return (
    <>
      <MapViewport stops={resolvedStops} />
      {resolvedStops.map((stop, index) => (
        <AdvancedMarker
          key={`${activeDay}-${stop.courseCode}-${stop.start}-${stopLocationKey(stop)}`}
          position={{ lat: stop.lat, lng: stop.lng }}
        >
          <div
            className={`map-marker ${showLabels ? "map-marker--label" : ""}`}
            style={paletteVars(stop.courseCode)}
          >
            <span>{index + 1}</span>
            {showLabels ? <strong>{stop.shortName}</strong> : null}
          </div>
        </AdvancedMarker>
      ))}
      <RouteRenderer stops={resolvedStops} onSummary={onSummary} />
      {unresolvedCount > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 16,
            zIndex: 1,
            border: "1px solid rgba(255,255,255,0.72)",
            borderRadius: "1rem",
            background: "rgba(17,46,29,0.9)",
            color: "#fff",
            padding: "0.75rem 0.9rem",
            fontSize: "0.82rem",
            boxShadow: "0 16px 32px rgba(17,46,29,0.18)",
          }}
        >
          {resolving ? "Resolving UNT building labels..." : "Some class locations could not be mapped yet."}
        </div>
      ) : null}
    </>
  );
}

function MapCanvas({
  stops,
  activeDay,
  showLabels,
  onSummary,
  onResolutionChange,
}: {
  stops: MapStop[];
  activeDay: WeekDay;
  showLabels: boolean;
  onSummary: (summary: RouteSummary) => void;
  onResolutionChange: (summary: ResolutionSummary) => void;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || undefined;

  useEffect(() => {
    if (!apiKey) {
      onResolutionChange({
        resolvedCount: stops.filter(hasCoordinates).length,
        unresolvedCount: stops.filter((stop) => !hasCoordinates(stop)).length,
        resolving: false,
      });
    }
  }, [apiKey, onResolutionChange, stops]);

  if (!apiKey) {
    return (
      <div className="flex h-full min-h-[620px] items-center justify-center rounded-[1.8rem] border border-[color:var(--line)] bg-[linear-gradient(160deg,_rgba(24,48,36,0.96),_rgba(42,74,57,0.9))] p-8 text-center text-white">
        <div className="max-w-md space-y-3">
          <p className="text-xs uppercase tracking-[0.24em] text-[#b6d1bf]">Google Maps not configured</p>
          <h2 className="font-display text-3xl font-bold">Add an API key to render the live campus map.</h2>
          <p className="text-sm leading-7 text-[#dce7df]">
            Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>. A map ID is optional; unresolved UNT
            building labels use the Google Maps JavaScript geocoding library.
          </p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <div className="relative h-full min-h-[620px] overflow-hidden rounded-[1.8rem]">
        <GoogleMap
          defaultCenter={untCampusCenter}
          defaultZoom={16}
          mapId={mapId}
          gestureHandling="greedy"
          disableDefaultUI={true}
          className="h-full min-h-[620px] w-full"
        >
          <MapContent
            stops={stops}
            activeDay={activeDay}
            showLabels={showLabels}
            onSummary={onSummary}
            onResolutionChange={onResolutionChange}
          />
        </GoogleMap>
      </div>
    </APIProvider>
  );
}

export function MapClient() {
  const { plannerState, routeStops, setActiveDay } = usePlanner();
  const [routeSummary, setRouteSummary] = useState<RouteSummary>(emptyRouteSummary);
  const [resolutionSummary, setResolutionSummary] = useState<ResolutionSummary>(emptyResolutionSummary);
  const [showLabels, setShowLabels] = useState(true);
  const stops = useMemo(
    () => routeStops[plannerState.activeDay] ?? [],
    [plannerState.activeDay, routeStops],
  );
  const summaryDisplay = resolutionSummary.resolvedCount < 2 ? emptyRouteSummary : routeSummary;

  const tabRefs = useRef<Record<WeekDay, HTMLButtonElement | null>>({} as Record<WeekDay, HTMLButtonElement | null>);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const el = tabRefs.current[plannerState.activeDay];
    if (el) {
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, [plannerState.activeDay]);

  const itinerarySummary = useMemo(
    () =>
      stops.map(
        (stop, index) =>
          `${index + 1}. ${stop.courseCode} | ${stop.location} | ${formatTime(stop.start)}-${formatTime(stop.end)}`,
      ),
    [stops],
  );

  return (
    <NavShell step={2} back={{ href: "/schedule", label: "Schedule" }}>
      <div style={{ display: "grid", gap: 18 }}>
        <header>
          <p className="editorial-label">Step 3 - Map</p>
          <h1
            className="font-display"
            style={{
              marginTop: 4,
              fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)",
              fontWeight: 800,
              color: "var(--brand-900)",
              lineHeight: 1.05,
            }}
          >
            Finish with a route you can actually use.
          </h1>
        </header>

        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
            alignItems: "start",
          }}
        >
          <aside style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <section className="surface-card" style={{ padding: "0.85rem 0.95rem" }}>
              <p className="editorial-label" style={{ marginBottom: 8 }}>
                Day
              </p>
              <div className="day-tabs" role="tablist">
                <span
                  className="day-tab__indicator"
                  style={{ transform: `translateX(${indicator.left - 4}px)`, width: indicator.width }}
                />
                {weekDays.map((day) => (
                  <button
                    key={day}
                    type="button"
                    role="tab"
                    aria-selected={plannerState.activeDay === day}
                    ref={(el) => {
                      tabRefs.current[day] = el;
                    }}
                    className="day-tab"
                    data-active={plannerState.activeDay === day ? "true" : "false"}
                    onClick={() => setActiveDay(day)}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </section>

            <section className="surface-card" style={{ padding: "0.85rem 0.95rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <StatusMark label={`${stops.length} stops`} tone="neutral" />
                <StatusMark label={`${resolutionSummary.resolvedCount} mapped`} tone="completed" />
                <StatusMark label={summaryDisplay.distanceText} tone="review" />
                <StatusMark label={summaryDisplay.durationText} tone="completed" />
                {resolutionSummary.unresolvedCount > 0 ? (
                  <StatusMark
                    label={
                      resolutionSummary.resolving
                        ? `${resolutionSummary.unresolvedCount} resolving`
                        : `${resolutionSummary.unresolvedCount} unresolved`
                    }
                    tone="danger"
                  />
                ) : null}
              </div>

              {stops.length === 0 ? (
                <div
                  style={{
                    padding: "0.95rem",
                    border: "1px dashed var(--line-strong)",
                    borderRadius: "var(--r-md)",
                    fontSize: "0.85rem",
                    color: "var(--copy)",
                  }}
                >
                  No classes scheduled on {plannerState.activeDay}.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <StaggerGroup>
                    {stops.map((stop, index) => (
                      <article key={`${stop.courseCode}-${stop.start}-${stop.location}`} className="stop-item">
                        <span className="stop-num">{index + 1}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p className="stop-name">{stop.courseCode}</p>
                          <p className="stop-meta">
                            {stop.location} | {formatTime(stop.start)}-{formatTime(stop.end)}
                          </p>
                        </div>
                        <StatusMark
                          label={stop.resolutionStatus === "local" ? stop.shortName : "lookup"}
                          tone={stop.resolutionStatus === "local" ? "neutral" : "review"}
                        />
                      </article>
                    ))}
                  </StaggerGroup>
                </div>
              )}
            </section>

            <section className="surface-card" style={{ padding: "0.85rem 0.95rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: "0.85rem", color: "var(--ink)", fontWeight: 600 }}>
                  Show stop labels
                </span>
                <Toggle on={showLabels} onChange={setShowLabels} ariaLabel="Toggle stop labels on map" />
              </div>
            </section>

            <section className="surface-card" style={{ padding: "0.85rem 0.95rem", display: "grid", gap: 8 }}>
              <button className="btn-primary" type="button" onClick={() => window.print()}>
                Print itinerary
              </button>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => {
                  const blob = new Blob([itinerarySummary.join("\n")], {
                    type: "text/plain;charset=utf-8",
                  });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `untangle-${plannerState.activeDay.toLowerCase()}-route.txt`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download brief
              </button>
            </section>
          </aside>

          <section className="surface-card" style={{ padding: 6, overflow: "hidden" }}>
            <MapCanvas
              stops={stops}
              activeDay={plannerState.activeDay}
              showLabels={showLabels}
              onSummary={setRouteSummary}
              onResolutionChange={setResolutionSummary}
            />
          </section>
        </div>
      </div>
    </NavShell>
  );
}
