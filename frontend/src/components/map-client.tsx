"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NavShell } from "@/components/nav-shell";
import { StatusMark } from "@/components/ui/StatusMark";
import { StaggerGroup } from "@/components/ui/StaggerGroup";
import { Toggle } from "@/components/ui/Toggle";
import { usePlanner } from "@/components/planner-provider";
import { formatTime } from "@/lib/planner";
import { weekDays } from "@/lib/types";
import type { MapResolutionSummary, MapRouteDetails, MapRouteSummary, WeekDay } from "@/lib/types";

const emptyRouteSummary: MapRouteSummary = { distanceText: "-", durationText: "-" };
const emptyResolutionSummary: MapResolutionSummary = {
  resolvedCount: 0,
  unresolvedCount: 0,
  resolving: false,
};
const emptyRouteDetails: MapRouteDetails = {
  source: null,
  isApproximate: false,
  legs: [],
};

const MapCanvas = dynamic(
  () => import("@/components/map-leaflet-canvas").then((module) => module.MapLeafletCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="unt-map-loading">
        <span className="spinner" aria-hidden="true" />
        <span>Loading campus map...</span>
      </div>
    ),
  },
);

export function MapClient() {
  const { plannerState, routeStops, setActiveDay } = usePlanner();
  const [routeSummary, setRouteSummary] = useState<MapRouteSummary>(emptyRouteSummary);
  const [routeDetails, setRouteDetails] = useState<MapRouteDetails>(emptyRouteDetails);
  const [resolutionSummary, setResolutionSummary] = useState<MapResolutionSummary>(emptyResolutionSummary);
  const [showLabels, setShowLabels] = useState(true);
  const stops = useMemo(
    () => routeStops[plannerState.activeDay] ?? [],
    [plannerState.activeDay, routeStops],
  );
  const summaryDisplay = resolutionSummary.resolvedCount < 2 ? emptyRouteSummary : routeSummary;
  const firstPopulatedDay = useMemo(
    () => weekDays.find((day) => (routeStops[day] ?? []).length > 0),
    [routeStops],
  );
  const manualDaySelection = useRef(false);

  const tabRefs = useRef<Record<WeekDay, HTMLButtonElement | null>>({} as Record<WeekDay, HTMLButtonElement | null>);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const el = tabRefs.current[plannerState.activeDay];
    if (el) {
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, [plannerState.activeDay]);

  useEffect(() => {
    if (
      !manualDaySelection.current &&
      stops.length === 0 &&
      firstPopulatedDay &&
      firstPopulatedDay !== plannerState.activeDay
    ) {
      setActiveDay(firstPopulatedDay);
    }
  }, [firstPopulatedDay, plannerState.activeDay, setActiveDay, stops.length]);

  useEffect(() => {
    queueMicrotask(() => {
      setRouteSummary(emptyRouteSummary);
      setRouteDetails(emptyRouteDetails);
    });
  }, [plannerState.activeDay, stops]);

  const itinerarySummary = useMemo(
    () =>
      stops.map(
        (stop, index) =>
          `${index + 1}. ${stop.courseCode} | ${stop.location} | ${formatTime(stop.start)}-${formatTime(stop.end)}`,
      ),
    [stops],
  );

  return (
    <NavShell step={2}>
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
                    onClick={() => {
                      manualDaySelection.current = true;
                      setActiveDay(day);
                    }}
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
                {routeDetails.source ? (
                  <StatusMark
                    label={routeDetails.isApproximate ? "approximate" : "walking route"}
                    tone={routeDetails.isApproximate ? "review" : "completed"}
                  />
                ) : null}
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
                  {routeDetails.legs.length > 0 ? (
                    <div className="route-leg-list" aria-label="Route legs">
                      {routeDetails.legs.map((leg, index) => (
                        <div key={`${leg.from}-${leg.to}-${index}`} className="route-leg">
                          <span className="route-leg__dot">{index + 1}</span>
                          <div style={{ minWidth: 0 }}>
                            <p className="route-leg__title">
                              {leg.from} to {leg.to}
                            </p>
                            <p className="route-leg__meta">
                              {leg.fromMeta} | {leg.toMeta}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
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
              onRouteDetails={setRouteDetails}
              onResolutionChange={setResolutionSummary}
            />
          </section>
        </div>
      </div>
    </NavShell>
  );
}
