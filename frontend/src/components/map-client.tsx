"use client";

import { useEffect, useMemo, useState } from "react";
import {
  APIProvider,
  AdvancedMarker,
  Map,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { StatusChip } from "@/components/status-chip";
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
        destination: {
          lat: stops[stops.length - 1].lat,
          lng: stops[stops.length - 1].lng,
        },
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
      <div className="flex h-full min-h-[620px] items-center justify-center rounded-[1.8rem] border border-[rgba(16,38,20,0.08)] bg-[linear-gradient(160deg,_rgba(18,34,25,0.92),_rgba(31,55,44,0.88))] p-8 text-center text-white">
        <div className="max-w-md space-y-3">
          <p className="text-xs tracking-[0.24em] text-[#b6d1bf] uppercase">
            Google Maps not configured
          </p>
          <h2 className="font-display text-3xl font-bold tracking-[-0.06em]">
            Add your API key to unlock the live campus map.
          </h2>
          <p className="text-sm leading-7 text-[#dce7df]">
            The route rail and planner logic are already wired. Set
            `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAP_ID` to
            render the embedded walking route.
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
          <AdvancedMarker
            key={`${activeDay}-${stop.courseCode}-${stop.start}`}
            position={{ lat: stop.lat, lng: stop.lng }}
          >
            <div className="rounded-[1rem] border border-white/70 bg-[rgba(17,46,29,0.92)] px-3 py-2 text-white shadow-[0_14px_28px_rgba(17,46,29,0.22)]">
              <p className="text-[10px] font-semibold tracking-[0.16em] text-[#c7ddca] uppercase">
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
  const [routeSummary, setRouteSummary] = useState({
    distanceText: "—",
    durationText: "—",
  });
  const stops = routeStops[plannerState.activeDay];

  const itinerarySummary = useMemo(
    () =>
      stops.map(
        (stop, index) =>
          `${index + 1}. ${stop.courseCode} · ${stop.shortName} · ${formatTime(stop.start)}-${formatTime(stop.end)}`,
      ),
    [stops],
  );

  return (
    <AppShell
      currentStep={3}
      eyebrow="Map"
      title="Finish with a route you can actually use."
      subtitle="The last screen now behaves like a destination instead of an afterthought: the class order, day switching, and walking route live beside a real Google campus map rather than a flat mock screenshot."
      aside={
        <div className="glass-panel p-5">
          <p className="text-xs tracking-[0.24em] text-[var(--muted)] uppercase">
            Map notes
          </p>
          <div className="mt-4 space-y-3 text-sm leading-6 text-[var(--copy)]">
            <p>
              Google routing is used for now to preserve familiar campus detail
              and walking expectations.
            </p>
            <p>
              Custom UNT-aware route logic can replace the current renderer
              later without redesigning the panel layout.
            </p>
          </div>
        </div>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-[1.8rem] border border-[rgba(16,38,20,0.08)] bg-[linear-gradient(180deg,_rgba(255,255,255,0.92),_rgba(244,238,226,0.84))] p-5">
            <p className="text-xs tracking-[0.24em] text-[var(--muted)] uppercase">
              Select day
            </p>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {weekDays.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={`rounded-full px-3 py-2 text-xs font-semibold tracking-[0.14em] uppercase transition-colors duration-150 ${
                    plannerState.activeDay === day
                      ? "bg-[var(--green-800)] text-white"
                      : "bg-white text-[var(--muted)]"
                  }`}
                  onClick={() => setActiveDay(day)}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[1.8rem] border border-[rgba(16,38,20,0.08)] bg-white/80 p-5">
            <div className="flex flex-wrap gap-2">
              <StatusChip label={`${stops.length} stops`} tone="stone" />
              <StatusChip label={routeSummary.distanceText} tone="gold" />
              <StatusChip label={routeSummary.durationText} tone="green" />
            </div>

            <div className="mt-5 space-y-3">
              {stops.length === 0 ? (
                <div className="rounded-[1.4rem] border border-dashed border-[rgba(16,38,20,0.14)] bg-[rgba(16,38,20,0.03)] p-4 text-sm text-[var(--copy)]">
                  No classes are scheduled on this day.
                </div>
              ) : (
                stops.map((stop, index) => (
                  <article
                    key={`${stop.courseCode}-${stop.start}`}
                    className="rounded-[1.4rem] border border-[rgba(16,38,20,0.08)] bg-[linear-gradient(160deg,_rgba(255,255,255,0.96),_rgba(246,240,228,0.88))] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs tracking-[0.18em] text-[var(--muted)] uppercase">
                          Stop {index + 1}
                        </p>
                        <p className="mt-2 text-sm font-semibold text-[var(--green-900)]">
                          {stop.courseCode}
                        </p>
                        <p className="text-sm text-[var(--copy)]">
                          {stop.title}
                        </p>
                      </div>
                      <StatusChip label={stop.shortName} tone="stone" />
                    </div>
                    <p className="mt-3 text-xs text-[var(--muted)]">
                      {formatTime(stop.start)} - {formatTime(stop.end)}
                    </p>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <button
              className="primary-button w-full"
              type="button"
              onClick={() => window.print()}
            >
              Print itinerary
            </button>
            <button
              className="secondary-button w-full"
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
              Download route brief
            </button>
            <Link
              className="secondary-button inline-flex items-center justify-center"
              href="/schedule"
            >
              Back to schedule
            </Link>
          </div>
        </aside>

        <section className="space-y-4">
          <div className="rounded-[1.8rem] border border-[rgba(16,38,20,0.08)] bg-[linear-gradient(160deg,_rgba(255,255,255,0.95),_rgba(240,235,225,0.84))] p-3 shadow-[0_20px_48px_rgba(30,38,22,0.08)]">
            <MapCanvas
              stops={stops}
              activeDay={plannerState.activeDay}
              onSummary={setRouteSummary}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
