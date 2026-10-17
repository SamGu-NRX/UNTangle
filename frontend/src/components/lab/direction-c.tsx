"use client";

import { useEffect, useState } from "react";
import { buildScheduleEvents, writePlannerStateToSessionStorage } from "@/lib/planner";
import { usePlanner } from "@/components/planner-provider";
import { LabChrome } from "@/components/lab/lab-chrome";
import { useDayLegs } from "@/components/lab/use-day-legs";
import { LegMap } from "@/components/lab/leg-map";
import { LabStopCard } from "@/components/lab/stop-card";
import { summarizeDayLegs } from "@/lib/lab/leg-routing";
import { dayLegNotice, formatMeters, legLine, pickLongestLeg } from "@/lib/lab/leg-format";
import { labPlannerState } from "@/lib/lab/lab-plans";
import type { WeekDay } from "@/lib/types";

const DAYS: WeekDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

type SheetState = "peek" | "half" | "full";

export function DirectionC() {
  useEffect(() => {
    // Child effects run before the layout provider's bootstrap effect, so a
    // fresh page load hydrates the planner from this fixture.
    writePlannerStateToSessionStorage(labPlannerState);
  }, []);

  const { routeStops, plannerState, setSection, setActiveDay, isLocked } = usePlanner();
  const activeDay = plannerState.activeDay;
  const stops = routeStops[activeDay] ?? [];
  const { legs, state: legState, recheck } = useDayLegs(stops);
  const [sheet, setSheet] = useState<SheetState>("peek");

  const dayEvents = buildScheduleEvents(plannerState).filter((event) => event.day === activeDay);
  const conflictCount = (courseCode: string): number => {
    const mine = dayEvents.filter((event) => event.courseCode === courseCode);
    if (mine.length === 0) return 0;
    return dayEvents.filter((other) =>
      mine.some((event) => event !== other && event.start < other.end && other.start < event.end),
    ).length;
  };

  const summary = summarizeDayLegs(legs);
  const notice = dayLegNotice(summary);
  const longest = pickLongestLeg(legs);

  const cycle = () =>
    setSheet((current) => (current === "peek" ? "half" : current === "half" ? "full" : "peek"));

  return (
    <LabChrome
      direction="c"
      title="C — Map first, bottom sheet"
      description="A phone-shaped stage: the day's route sketch fills the view and a bottom sheet snaps from a one-line summary to legs to full class cards. Use the handle button or Escape."
    >
      <div
        className="lab-stage"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setSheet("peek");
          }
        }}
      >
        <div className="lab-stage__map">
          {legState === "ready" && legs.length > 0 ? (
            <LegMap legs={legs} showLabels />
          ) : (
            <p className="lab-route__status" role="status">
              {legState === "loading"
                ? "Checking today\u2019s route…"
                : "No route to draw for " + activeDay + " — add or move classes on other directions."}
            </p>
          )}
        </div>

        <section className={"lab-sheet lab-sheet--" + sheet} aria-label={"Day plan sheet for " + activeDay}>
          <button
            type="button"
            className="lab-sheet__handle"
            aria-expanded={sheet !== "peek"}
            aria-controls="lab-sheet-body"
            onClick={cycle}
          >
            <span className="lab-sheet__grip" aria-hidden="true"></span>
            <span className="lab-sr">
              Day plan sheet — {sheet === "peek" ? "collapsed to summary" : sheet === "half" ? "legs visible" : "expanded to classes"}
            </span>
          </button>
          <div id="lab-sheet-body" className="lab-sheet__body">
            <p className="lab-sheet__summary">
              <strong>{activeDay}</strong> · {stops.length} {stops.length === 1 ? "class" : "classes"} ·{" "}
              {legState === "ready" && legs.length > 0
                ? formatMeters(summary.totalDistanceMeters) + (summary.approximateLegs > 0 ? " (approx.)" : "")
                : legState === "loading"
                  ? "checking route…"
                  : "no route yet"}
            </p>
            {notice && (
              <p className="lab-route__notice" role="note">
                {notice}
              </p>
            )}
            {legState === "ready" && longest && legs.length > 0 && (
              <p className="lab-route__longest">
                Longest walk: {longest.from.shortName} → {longest.to.shortName},{" "}
                {formatMeters(longest.distanceMeters)}
                {longest.status === "approximate" ? " (approximate)" : ""}
              </p>
            )}
            <div role="group" aria-label="Choose day" className="lab-days">
              {DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={"lab-days__tab" + (day === activeDay ? " lab-days__tab--active" : "")}
                  aria-pressed={day === activeDay}
                  onClick={() => setActiveDay(day)}
                >
                  {day}
                </button>
              ))}
              <button type="button" className="lab-route__reload" onClick={recheck}>
                Recheck route
              </button>
            </div>
            {legState === "ready" && legs.length > 0 && (
              <ol className="lab-sheet__legs">
                {legs.map((leg, index) => (
                  <li key={index} className={"lab-route__leg lab-route__leg--" + leg.status}>
                    <span className="lab-route__leg-label">
                      {leg.from.shortName} → {leg.to.shortName}
                    </span>
                    <span className="lab-route__leg-detail">{legLine(leg)}</span>
                  </li>
                ))}
              </ol>
            )}
            <ol className="lab-sheet__cards">
              {stops.map((stop, index) => {
                const leg = index > 0 ? legs[index - 1] : undefined;
                return (
                  <li key={stop.courseCode + "-" + index} className="lab-itin__item">
                    {leg && (
                      <div className={"lab-itin__leg lab-itin__leg--" + leg.status}>
                        <span>{legLine(leg)}</span>
                      </div>
                    )}
                    <LabStopCard
                      state={plannerState}
                      stop={stop}
                      conflicts={conflictCount(stop.courseCode)}
                      currentSectionId={plannerState.selectedSections[stop.courseCode]}
                      onSectionChange={setSection}
                      isLocked={isLocked(stop.courseCode)}
                    />
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      </div>
    </LabChrome>
  );
}
