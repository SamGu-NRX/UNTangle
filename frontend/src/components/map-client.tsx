"use client";

import { useEffect, useMemo, useState } from "react";
import { APIProvider, AdvancedMarker, Map, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import Link from "next/link";
import { StatusChip } from "@/components/status-chip";
import { WorkflowShell } from "@/components/workflow-shell";
import { usePlanner } from "@/components/planner-provider";
import { formatTime } from "@/lib/planner";
import { weekDays } from "@/lib/types";
import type { MapStop, WeekDay } from "@/lib/types";

function RouteRenderer({
  stops,
  onSummary,
}: {
  stops: MapStop[];
  onSummary: (summary: { distanceText: string; durationText: string }) => void;
}) {
  const map = useMap();
  const routesLibrary = useMapsLibrary("routes");

  useEffect(() => {
    if (!map || !routesLibrary || stops.length < 2) {
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
          const firstLeg = response.routes[0].legs.reduce(
            (summary, leg) => {
              summary.distance += leg.distance?.value ?? 0;
              summary.duration += leg.duration?.value ?? 0;
              return summary;
            },
            { distance: 0, duration: 0 },
          );

          onSummary({
            distanceText: `${(firstLeg.distance / 1609.34).toFixed(2)} mi`,
            durationText: `${Math.round(firstLeg.duration / 60)} min`,
          });
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
  const center = useMemo(
    () =>
      stops[0]
        ? { lat: stops[0].lat, lng: stops[0].lng }
        : { lat: 33.210042, lng: -97.145061 },
    [stops],
  );

  if (!apiKey) {
    return (
      <div className="flex h-full min-h-[620px] items-center justify-center rounded-[1.8rem] border border-[color:var(--line)] bg-[linear-gradient(160deg,_rgba(24,48,36,0.96),_rgba(42,74,57,0.9))] p-8 text-center text-white">
        <div className="max-w-md space-y-3">
          <p className="text-xs uppercase tracking-[0.24em] text-[#b6d1bf]">Google Maps not configured</p>
          <h2 className="font-display text-3xl font-bold tracking-[-0.06em]">
            Add your API key to unlock the live campus map.
          </h2>
          <p className="text-sm leading-7 text-[#dce7df]">
            The route rail and planner logic are already wired. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
            and `NEXT_PUBLIC_GOOGLE_MAP_ID` to render the embedded walking route.
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
        className="h-full min-h-[620px] w-full rounded-[1.8rem]"
      >
        {stops.map((stop, index) => (
          <AdvancedMarker key={`${activeDay}-${stop.courseCode}-${stop.start}`} position={{ lat: stop.lat, lng: stop.lng }}>
            <div className="rounded-[1rem] border border-white/70 bg-[rgba(17,46,29,0.92)] px-3 py-2 text-white shadow-[0_14px_28px_rgba(17,46,29,0.22)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#c7ddca]">
                Stop {index + 1}
              </p>
              <p className="mt-1 text-sm font-semibold">{stop.shortName}</p>
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

  const itinerarySummary = useMemo(
    () =>
      stops.map(
        (stop, index) =>
          `${index + 1}. ${stop.courseCode} · ${stop.shortName} · ${formatTime(stop.start)}-${formatTime(stop.end)}`,
      ),
    [stops],
  );

  return (
    <WorkflowShell
      step={2}
      eyebrow="Map"
      title="Finish with a route you can actually use."
      description="The itinerary should stay readable even before the map loads. Pick a day, verify the stop order, then print or export only when the route looks right."
    >
      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="surface-panel px-5 py-5">
            <p className="editorial-label">Select day</p>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {weekDays.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors duration-150 ${
                    plannerState.activeDay === day
                      ? "bg-[color:var(--green-800)] text-white"
                      : "border border-[color:var(--line)] bg-[rgba(255,255,255,0.78)] text-[color:var(--muted)]"
                  }`}
                  onClick={() => setActiveDay(day)}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <div className="surface-panel px-5 py-5">
            <div className="flex flex-wrap gap-2">
              <StatusChip label={`${stops.length} stops`} tone="stone" />
              <StatusChip label={summaryDisplay.distanceText} tone="gold" />
              <StatusChip label={summaryDisplay.durationText} tone="green" />
            </div>

            <div className="mt-5 space-y-3">
              {stops.length === 0 ? (
                <div className="subtle-panel border-dashed px-4 py-4 text-sm text-[color:var(--copy)]">
                  No classes are scheduled on this day.
                </div>
              ) : (
                stops.map((stop, index) => (
                  <article key={`${stop.courseCode}-${stop.start}`} className="subtle-panel px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">Stop {index + 1}</p>
                        <p className="mt-2 text-sm font-semibold text-[color:var(--green-900)]">{stop.courseCode}</p>
                        <p className="text-sm text-[color:var(--copy)]">{stop.title}</p>
                      </div>
                      <StatusChip label={stop.shortName} tone="stone" />
                    </div>
                    <p className="mt-3 text-xs text-[color:var(--muted)]">
                      {formatTime(stop.start)} - {formatTime(stop.end)}
                    </p>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="surface-panel flex flex-col gap-3 px-5 py-5">
            <button className="primary-button w-full" type="button" onClick={() => window.print()}>
              Print itinerary
            </button>
            <button
              className="secondary-button w-full"
              type="button"
              onClick={() => {
                const blob = new Blob([itinerarySummary.join("\n")], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `untangle-${plannerState.activeDay.toLowerCase()}-route.txt`;
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download route brief
            </button>
            <Link className="secondary-button" href="/schedule">
              Back to schedule
            </Link>
          </div>
        </aside>

        <section className="space-y-4">
          <div className="surface-panel p-3">
            <MapCanvas stops={stops} activeDay={plannerState.activeDay} onSummary={setRouteSummary} />
          </div>
        </section>
      </div>
    </WorkflowShell>
  );
}
