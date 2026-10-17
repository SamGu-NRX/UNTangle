"use client";

import { useEffect } from "react";
import { buildScheduleEvents, writePlannerStateToSessionStorage } from "@/lib/planner";
import { usePlanner } from "@/components/planner-provider";
import { LabChrome } from "@/components/lab/lab-chrome";
import { useDayLegs } from "@/components/lab/use-day-legs";
import { LegMap } from "@/components/lab/leg-map";
import { summarizeDayLegs } from "@/lib/lab/leg-routing";
import { dayLegNotice, formatMeters, formatWalkingMinutes, legLine, pickLongestLeg } from "@/lib/lab/leg-format";
import { labPlannerState } from "@/lib/lab/lab-plans";
import { LabStopCard } from "@/components/lab/stop-card";
import type { WeekDay } from "@/lib/types";

const DAYS: WeekDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];


export function DirectionB() {
  useEffect(() => {
    // Child effects run before the layout provider's bootstrap effect, so a
    // fresh page load hydrates the planner from this fixture.
    writePlannerStateToSessionStorage(labPlannerState);
  }, []);

  const { routeStops, plannerState, setSection, setActiveDay, isLocked } = usePlanner();
  const activeDay = plannerState.activeDay;
  const stops = routeStops[activeDay] ?? [];
  const { legs, state: legState, recheck } = useDayLegs(stops);

  const dayEvents = buildScheduleEvents(plannerState).filter((event) => event.day === activeDay);
  const conflictCount = (courseCode: string): number => {
    const mine = dayEvents.filter((event) => event.courseCode === courseCode);
    if (mine.length === 0) return 0;
    return dayEvents.filter((other) =>
      mine.some((event) => event !== other && event.start < other.end && other.start < event.end),
    ).length;
  };
  const currentSectionId = (courseCode: string): string | undefined =>
    plannerState.selectedSections[courseCode];

  const summary = summarizeDayLegs(legs);
  const longest = pickLongestLeg(legs);
  const notice = dayLegNotice(summary);

  return (
    <LabChrome
      direction="b"
      title="B — Day-first itinerary"
      description="One day at a time, class by class, with the walk between each pair shown inline. Swap sections from any card."
    >
      <div className="lab-itin-wrap">
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

        {stops.length === 0 && <p className="lab-route__empty">No classes on {activeDay} — nothing to walk.</p>}

        {stops.length > 0 && (
          <section aria-label={"Itinerary for " + activeDay} className="lab-itin">
            {legState === "loading" && (
              <p className="lab-route__status" role="status">
                Checking today&rsquo;s route…
              </p>
            )}
            {legState === "error" && (
              <p className="lab-route__status" role="status">
                The route service did not answer. Distances below are straight-line estimates; no walking
                times are shown.
              </p>
            )}
            {legState === "ready" && legs.length > 0 && (
              <>
                <LegMap legs={legs} />
                <p className="lab-itin__summary">
                  {formatMeters(summary.totalDistanceMeters)}
                  {summary.approximateLegs > 0 ? " (approximate)" : ""} total
                  {summary.knownWalkingSeconds !== null
                    ? " · " + formatWalkingMinutes(summary.knownWalkingSeconds)
                    : " · walking time unavailable"}
                  {longest ? ` · longest walk ${formatMeters(longest.distanceMeters)}` : ""}
                </p>
                {notice && (
                  <p className="lab-route__notice" role="note">
                    {notice}
                  </p>
                )}
              </>
            )}

            <ol className="lab-itin__list">
              {stops.map((stop, index) => {
                const leg = index > 0 ? legs[index - 1] : undefined;
                const conflicts = conflictCount(stop.courseCode);
                const current = currentSectionId(stop.courseCode);
                return (
                  <li key={stop.courseCode + "-" + index} className="lab-itin__item">
                    {leg && (
                      <div className={"lab-itin__leg lab-itin__leg--" + leg.status}>
                        <span aria-label={"Walk to the next class"}>{legLine(leg)}</span>
                      </div>
                    )}
                    <LabStopCard
                        state={plannerState}
                        stop={stop}
                        conflicts={conflicts}
                        currentSectionId={current}
                        onSectionChange={setSection}
                        isLocked={isLocked(stop.courseCode)}
                      />
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </div>
    </LabChrome>
  );
}
