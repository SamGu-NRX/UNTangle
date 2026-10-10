import type { MajorId, OptimizationKey, PlannerState } from "@/lib/types";

/**
 * Saved-plan library — snapshot contract (schema version 1).
 *
 * A snapshot is a faithful, self-describing copy of a planner state plus
 * enough identity to detect drift:
 *
 * - source identity: where the plan came from (working schedule, import,
 *   duplication) and when it was captured;
 * - catalog identity: a fingerprint over the exact catalog slice the plan
 *   references, so a saved plan whose sections no longer match the running
 *   catalog is *visible* as stale instead of being silently re-recommended;
 * - selected sections: the planner's own `selectedSections` map, preserved
 *   verbatim — validation never swaps a section id for another one;
 * - declared assumptions: what the plan declared about the student's record
 *   at save time (statuses, major, optimization, transcript evidence, and
 *   the prerequisite evaluation under the policies in effect at save time).
 *   Restore never re-derives these; it compares them.
 */

export const SAVED_PLAN_SCHEMA_VERSION = 1;

export type PlanSourceKind = "workingState" | "import" | "duplicate";

export type SavedPlanSource = {
  kind: PlanSourceKind;
  detail: string;
  capturedAt: string;
};

export type SavedPlanCatalogIdentity = {
  /** FNV-1a fingerprint over the referenced catalog slice at save time. */
  fingerprint: string;
  referencedCourseCount: number;
  referencedSectionCount: number;
};

export type SavedPlanAssumptions = {
  /**
   * Declared course-status counts at save time (per status). These are the
   * plan's assumptions about the record; restore compares, never re-derives.
   */
  declaredStatusCounts: Record<string, number>;
  major: MajorId | null;
  optimization: OptimizationKey;
  transcriptRecordCount: number;
  /**
   * Prerequisite evaluation per declared (completed/in-progress) course at
   * save time, computed by the planner's existing prerequisite policy.
   * Preserved verbatim so a restored plan can show what it assumed.
   */
  prerequisiteOutstanding: Record<string, string[]>;
};

export type SavedPlanSnapshot = {
  schemaVersion: typeof SAVED_PLAN_SCHEMA_VERSION;
  planId: string;
  name: string;
  createdAt: string;
  /** When the planner state inside this snapshot was captured. */
  snapshotTakenAt: string;
  archivedAt: string | null;
  source: SavedPlanSource;
  catalog: SavedPlanCatalogIdentity;
  /** The planner state, in the planner's own shape, preserved verbatim. */
  state: PlannerState;
  assumptions: SavedPlanAssumptions;
};
