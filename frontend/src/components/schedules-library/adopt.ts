import type { SchedulePreferences } from "@/lib/types";
import { buildSavedPlanSnapshot, resolveSectionReferences } from "@/lib/plan-library/snapshot";
import type { SavedPlanSnapshot } from "@/lib/plan-library/snapshot-types";
import type { SectionCatalog } from "@/lib/planner-sections";
import { dispatchRestore, workingStateFingerprint, type RestorePlannerApi } from "@/lib/saved-plans/restore-adapter";

/** The planner calls "Use in Main" and its Undo make (planner-provider's context). */
export type AdoptPlanner = RestorePlannerApi & {
  planEpoch: number;
  sectionCatalog: SectionCatalog;
  schedulePreferences: SchedulePreferences;
  setSchedulePreferences: (update: (current: SchedulePreferences) => SchedulePreferences) => void;
};

/**
 * One "Use in Main": what Main and the Week preferences were before, and,
 * once the restore has committed, the plan it left (`landed`) and the
 * replacement count it ran at.
 */
export type Adoption = { before: SavedPlanSnapshot; preferences: SchedulePreferences; epoch: number; landed: string | null };

/**
 * Fills Main from a saved copy through #37's restore path (reset, then the
 * public setters), which also sets the goal's preset weights. What Main and
 * the preferences held first is kept for Undo.
 */
export function adoptCopy(planner: AdoptPlanner, snapshot: SavedPlanSnapshot): Adoption {
  const before = buildSavedPlanSnapshot({
    state: planner.plannerState,
    name: "Main",
    source: { kind: "workingState", detail: "Main before a restore" },
  });
  const adoption: Adoption = { before, preferences: planner.schedulePreferences, epoch: planner.planEpoch, landed: null };
  dispatchRestore(planner, snapshot, resolveSectionReferences(snapshot.state, planner.sectionCatalog));
  return adoption;
}

/** Call on each commit after adoptCopy: records the plan the restore left, once it has replaced Main. */
export function noteLanded(adoption: Adoption, planner: Pick<AdoptPlanner, "planEpoch" | "plannerState">) {
  if (adoption.landed !== null || planner.planEpoch === adoption.epoch) return;
  adoption.epoch = planner.planEpoch;
  adoption.landed = workingStateFingerprint(planner.plannerState);
}

/**
 * Puts Main and the preferences back as they were, but only while Main is
 * exactly what the restore left: any change since, here or from another tab,
 * refuses it. Returns whether it undid.
 */
export function undoAdoption(planner: AdoptPlanner, adoption: Adoption): boolean {
  const unchanged =
    adoption.landed !== null &&
    planner.planEpoch === adoption.epoch &&
    workingStateFingerprint(planner.plannerState) === adoption.landed;
  if (!unchanged) return false;
  dispatchRestore(planner, adoption.before, resolveSectionReferences(adoption.before.state, planner.sectionCatalog));
  // The restore set the goal's preset weights; the student's own come back after it.
  planner.setSchedulePreferences(() => adoption.preferences);
  return true;
}
