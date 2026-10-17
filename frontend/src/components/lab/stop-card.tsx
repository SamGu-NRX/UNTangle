"use client";

import { labSectionMeetingSummary, labSectionOptions } from "@/lib/lab/lab-plans";
import type { PlannerState, MapStop } from "@/lib/types";

/** One class stop with conflict/lock badges and its section alternatives,
 * computed against the live planner state. */
export function LabStopCard({
  state,
  stop,
  conflicts,
  currentSectionId,
  onSectionChange,
  isLocked,
}: {
  state: PlannerState;
  stop: MapStop;
  conflicts: number;
  currentSectionId?: string;
  onSectionChange: (courseCode: string, sectionId: string) => void;
  isLocked: boolean;
}) {
  return (
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
        {isLocked && <span className="lab-badge">Prerequisite locked</span>}
      </div>
      <details className="lab-itin__sections">
        <summary>Sections</summary>
        <ul role="list">
          {labSectionOptions(state, stop.courseCode).map((option) => (
            <li key={option.sectionId}>
              <button
                type="button"
                className="lab-itin__section"
                aria-pressed={option.sectionId === currentSectionId}
                onClick={() => onSectionChange(stop.courseCode, option.sectionId)}
              >
                <span>
                  {option.sectionId} · {labSectionMeetingSummary(stop.courseCode, option.sectionId)}
                </span>
                <span className="lab-itin__sectionnote">
                  {option.sectionId === currentSectionId
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
  );
}
