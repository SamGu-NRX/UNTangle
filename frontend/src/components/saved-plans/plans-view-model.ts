import { diffSavedPlanAgainstWorking } from "@/lib/plan-library/diff";
import type { PlanDiff } from "@/lib/plan-library/diff";
import type { SavedPlanSnapshot } from "@/lib/plan-library/snapshot-types";
import { workingStateFingerprint } from "@/lib/saved-plans/restore-adapter";
import type { PlannerState } from "@/lib/types";

/** Whether the working schedule has drifted from what a saved plan captured. */
export type RestoreDrift = {
  drifted: boolean;
  message: string | null;
};

/**
 * Compare the saved plan's captured working state with the live one using the
 * semantic fingerprint (timestamps ignored). Drift does not block a restore —
 * it is surfaced in the preview so the explicit confirmation is informed.
 */
export function assessRestoreDrift(plan: SavedPlanSnapshot, workingState: PlannerState): RestoreDrift {
  const drifted = workingStateFingerprint(plan.state) !== workingStateFingerprint(workingState);
  return {
    drifted,
    message: drifted
      ? "Your working schedule has changed since this plan was saved. Restoring replaces the current schedule with the saved version."
      : null,
  };
}

/** Differences-only comparison for the compare view; no scores, no rankings. */
export function comparePlan(plan: SavedPlanSnapshot, workingState: PlannerState): PlanDiff {
  return diffSavedPlanAgainstWorking(plan, workingState);
}

/** Download name for an exported plan file. */
export function exportFileName(plan: SavedPlanSnapshot): string {
  const slug = plan.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const day = plan.createdAt.slice(0, 10);
  return `untangle-${slug || "plan"}-${day}.json`;
}

/** Human label for a course status in compare rows. */
export function statusLabel(status: string): string {
  switch (status) {
    case "inProgress":
      return "in progress";
    case "completed":
      return "completed";
    default:
      return "not taken";
  }
}
