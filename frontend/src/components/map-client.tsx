"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  APIProvider,
  AdvancedMarker,
  Map,
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
const geocodeCache = new Map<string, GeocodedLocation | null>();

function paletteIndex(courseCode: string) {
  let h = 0;
  for (let i = 0; i < courseCode.length; i++) h = (h * 31 + courseCode.charCodeAt(i)) >>> 0;
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

function stopLocationKey(stop: MapStop) {
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
        strokeColor: "#00512b",
        strokeOpacity: 0.9,
        strokeWeight: 4,
      },
    });

    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) return;
    directionsService.route(
      {
        origin: { lat: first.lat, lng: first.lng },
        destination: { lat: last.lat, lng: last.lng },
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

function MapCanvas({
  stops,
  activeDay,
  onSummary,
}: {
  stops: MapStop[];
  activeDay: WeekDay;
  onSummary: (summary: { distanceText: string; durationText: string }) => void;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
  const resolvedStops = useMemo(() => stops.filter(isResolvedStop), [stops]);
  const center = useMemo(() => {
    const first = resolvedStops[0];
    return first ? { lat: first.lat, lng: first.lng } : { lat: 33.210042, lng: -97.145061 };
  }, [resolvedStops]);

  if (!apiKey) {
    return (
      <div
        style={{
          minHeight: 540,
          height: "100%",
          borderRadius: "var(--r-xl)",
          border: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          textAlign: "center",
          background: "linear-gradient(160deg, var(--brand-900), #002d18)",
          color: "#fff",
        }}
      >
        <div style={{ maxWidth: 460 }}>
          <p className="editorial-label" style={{ color: "rgba(255,255,255,0.6)" }}>
            Google Maps not configured
          </p>
          <h2 className="font-display" style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: 8 }}>
            Add an API key to render the live route.
          </h2>
          <p style={{ marginTop: 10, lineHeight: 1.6, fontSize: "0.9rem", color: "rgba(255,255,255,0.78)" }}>
            Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> and{" "}
            <code>NEXT_PUBLIC_GOOGLE_MAP_ID</code> to enable the embedded walking map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <Map
        defaultCenter={center}
        defaultZoom={16}
        mapId={mapId}
        gestureHandling="greedy"
        disableDefaultUI={true}
        style={{ minHeight: 540, height: "100%", width: "100%", borderRadius: "var(--r-xl)" }}
      >
        {stops.map((stop, index) => (
          <AdvancedMarker
            key={`${activeDay}-${stop.courseCode}-${stop.start}`}
            position={{ lat: stop.lat, lng: stop.lng }}
          >
            <div className="map-marker" style={paletteVars(stop.courseCode)}>
              {index + 1}
            </div>
          </AdvancedMarker>
        ))}
        <RouteRenderer stops={stops} onSummary={onSummary} />
      </Map>
    </APIProvider>
  );
}

export function MapClient() {
  const { plannerState, routeStops, setActiveDay } = usePlanner();
  const [routeSummary, setRouteSummary] = useState({ distanceText: "—", durationText: "—" });
  const stops = routeStops[plannerState.activeDay];
  const summaryDisplay = stops.length < 2 ? { distanceText: "—", durationText: "—" } : routeSummary;

  // Day-tab indicator
  const tabRefs = useRef<Record<WeekDay, HTMLButtonElement | null>>({} as Record<WeekDay, HTMLButtonElement | null>);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const el = tabRefs.current[plannerState.activeDay];
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [plannerState.activeDay]);

  const itinerarySummary = useMemo(
    () =>
      stops.map(
        (stop, index) =>
          `${index + 1}. ${stop.courseCode} · ${stop.shortName} · ${formatTime(stop.start)}-${formatTime(stop.end)}`,
      ),
    [stops],
  );

  const [showLabels, setShowLabels] = useState(true);

  return (
    <NavShell step={2} back={{ href: "/schedule", label: "Schedule" }}>
      <div style={{ display: "grid", gap: 18 }}>
        <header>
          <p className="editorial-label">Step 3 — Map</p>
          <h1
            className="font-display"
            style={{
              marginTop: 4,
              fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)",
              fontWeight: 800,
              color: "var(--brand-900)",
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
            }}
          >
            Finish with a route you can actually use.
          </h1>
        </header>

        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(0, 280px) minmax(0, 1fr)" }}>
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
                <StatusMark label={summaryDisplay.distanceText} tone="review" />
                <StatusMark label={summaryDisplay.durationText} tone="completed" />
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
                      <article key={`${stop.courseCode}-${stop.start}`} className="stop-item">
                        <span className="stop-num">{index + 1}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p className="stop-name">{stop.courseCode}</p>
                          <p className="stop-meta">
                            {stop.shortName} · {formatTime(stop.start)}–{formatTime(stop.end)}
                          </p>
                        </div>
                      </article>
                    ))}
                  </StaggerGroup>
                </div>
              )}
            </section>

            <section className="surface-card" style={{ padding: "0.85rem 0.95rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--ink)", fontWeight: 600 }}>
                  Show stop labels
                </span>
                <Toggle
                  on={showLabels}
                  onChange={setShowLabels}
                  ariaLabel="Toggle stop labels on map"
                />
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
            <MapCanvas stops={stops} activeDay={plannerState.activeDay} onSummary={setRouteSummary} />
          </section>
        </div>
      </div>
    </NavShell>
  );
}
