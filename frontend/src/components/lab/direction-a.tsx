"use client";

import { useEffect } from "react";
import { LabChrome } from "@/components/lab/lab-chrome";
import { ScheduleClient } from "@/components/schedule-client";
import { DayRoutePanel } from "@/components/lab/day-route-panel";
import { writePlannerStateToSessionStorage } from "@/lib/planner";
import { labPlannerState } from "@/lib/lab/lab-plans";

export function DirectionA() {
  useEffect(() => {
    // Child effects run before the layout provider's bootstrap effect, so a
    // fresh page load hydrates the planner from this fixture.
    writePlannerStateToSessionStorage(labPlannerState);
  }, []);

  return (
    <LabChrome
      direction="a"
      title="A — Week grid with integrated day map"
      description="The current week schedule, with a live route panel for the selected day beside it. Swap sections in the grid and the route follows."
    >
      <div className="lab-split">
        <section aria-label="Week schedule" className="lab-split__schedule">
          <ScheduleClient />
        </section>
        <aside aria-label="Walking route for the selected day" className="lab-split__panel">
          <DayRoutePanel />
        </aside>
      </div>
    </LabChrome>
  );
}
