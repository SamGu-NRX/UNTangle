"use client";

import { useEffect } from "react";
import { buildScheduleEvents, writePlannerStateToSessionStorage } from "@/lib/planner";
import { usePlanner } from "@/components/planner-provider";
import { LabChrome } from "@/components/lab/lab-chrome";
import { useDayLegs } from "@/components/lab/use-day-legs";
import { LegMap } from "@/components/lab/leg-map";
import { summarizeDayLegs, type LabLeg } from "@/lib/lab/leg-routing";
import { dayLegNotice, formatMeters, formatWalkingMinutes, pickLongestLeg } from "@/lib/lab/leg-format";
import { labPlannerState, labSectionMeetingSummary, labSectionOptions } from "@/lib/lab/lab-plans";
import type { WeekDay } from "@/lib/types";

const DAYS: WeekDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function legLabel(leg: LabLeg): string {
  if (leg.status === "same-building") {
    return "Same building — no walk needed";
  }
  if (leg.status === "unresolved") {
    return "Location unresolved — no route shown";
  }
  const distance = formatMeters(leg.distanceMeters) + (leg.status === "approximate" ? " (approx.)" : "");
  const time = leg.durationSeconds !== null ? " · " + formatWalkingMinutes(leg.durationSeconds) : " · no walking time";
  const source =
    leg.source === "ors"
      ? "Route © OpenStreetMap contributors via ORS"
      : leg.source === "campus-network"
        ? "Campus walking network"
        : "Straight-line estimate";
  return distance + time + " · " + source;
}

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
                        <span aria-label={"Walk to the next class"}>{legLabel(leg)}</span>
                      </div>
                    )}
                    <article className="lab-itin__card" aria-label={stop.courseCode + " at " + stop.start}>
                      <header className="lab-itin__cardhead">
                        <h3 className="font-display">
                          {stop.courseCode} · {stop.shortName}
                        </h3>
                        <span className="lab-itin__time">
                          {stop.start}–{stop.end}
                        </span>
                      </header>
                      <p className="lab-itin__where">{stop.buildingName}</p>
                      <div className="lab-itin__badges">
                        {conflicts > 0 && (
                          <span className="lab-badge lab-badge--conflict">
                            Overlaps {conflicts} {conflicts === 1 ? "class" : "classes"}
                          </span>
                        )}
                        {isLocked(stop.courseCode) && <span className="lab-badge">Prerequisite locked</span>}
                      </div>
                      <details className="lab-itin__sections">
                        <summary>Sections</summary>
                        <ul role="list">
                          {labSectionOptions(plannerState, stop.courseCode).map((option) => (
                            <li key={option.sectionId}>
                              <button
                                type="button"
                                className="lab-itin__section"
                                aria-pressed={option.sectionId === current}
                                onClick={() => setSection(stop.courseCode, option.sectionId)}
                              >
                                <span>
                                  {option.sectionId} · {labSectionMeetingSummary(stop.courseCode, option.sectionId)}
                                </span>
                                <span className="lab-itin__sectionnote">
                                  {option.sectionId === current
                                    ? "current"
                                    : option.conflictCount > 0
                                      ? option.conflictCount + " " + (option.conflictCount === 1 ? "conflict" : "conflicts")
                                      : "no conflicts"}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </article>
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
