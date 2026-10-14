import type { Hue } from "@/lib/course-colors";
import { eventsOf, weekBlocks, weekColors, type WeekBlock } from "@/lib/plan-library/week";
import { sampleCatalog } from "@/lib/planner-sections";
import { defaultPlannerState, plannedCourseCodes } from "@/lib/seed-data";
import type { PlannerState, ScheduleEvent } from "@/lib/types";

/**
 * The Week and Day screens' signed-out content: a deterministic plan built
 * from the bundled seed data through the same builders the web app uses.
 * Every event it produces carries `provenance: "sample"`, which
 * `usesSampleSections` turns into the on-screen "Sample schedule" label.
 */

/** Planned courses shown in the sample, in seed order, capped for a readable week. */
const SAMPLE_COURSE_LIMIT = 5;

function sampleSelections(codes: readonly string[]): Record<string, string> {
  const selections: Record<string, string> = {};
  for (const code of codes) {
    const option = sampleCatalog(code);
    if (option.status !== "ready") continue;
    const section = option.result.sections[0];
    if (section) selections[code] = section.id;
  }
  return selections;
}

/** A planner state with one sample section picked per planned course. */
export function samplePlannerState(): PlannerState {
  const codes = plannedCourseCodes.slice(0, SAMPLE_COURSE_LIMIT);
  return {
    ...defaultPlannerState,
    // The shared builders schedule only courses the student is taking this
    // term, so the sample marks its planned courses inProgress - a student
    // mid-planning, not a fresh guest.
    courseStatuses: {
      ...defaultPlannerState.courseStatuses,
      ...Object.fromEntries(codes.map((code) => [code, "inProgress" as const])),
    },
    selectedSections: sampleSelections(codes),
  };
}

export type SampleSchedule = {
  state: PlannerState;
  events: ScheduleEvent[];
  blocks: WeekBlock[];
  colors: Map<string, Hue>;
  labeledSample: true;
};

/** The full sample week, computed once per call from the bundled seed data. */
export function sampleSchedule(): SampleSchedule {
  const state = samplePlannerState();
  const events = eventsOf(state, sampleCatalog);
  const blocks = weekBlocks(events);
  return {
    state,
    events,
    blocks,
    colors: weekColors(blocks),
    labeledSample: true,
  };
}
