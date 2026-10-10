import { sectionMeetingsSummary } from "@/lib/plan-library/diff";
import {
  getActiveCourseCodes,
  getInitialPlannerState,
  mergeTranscriptRecords,
  normalizePlannerState,
  recommendSections,
} from "@/lib/planner";
import { stableHash } from "@/lib/plan-library/snapshot";
import type { SectionReferenceReport } from "@/lib/plan-library/snapshot";
import type { SavedPlanSnapshot } from "@/lib/plan-library/snapshot-types";
import type {
  CourseStatus,
  MajorId,
  OptimizationKey,
  PlannerState,
  TranscriptCourseRecord,
  WeekDay,
} from "@/lib/types";

/**
 * Restore adapter — turns a validated saved-plan snapshot into a sequence of
 * calls on the planner's PUBLIC actions (the same ones the UI uses), never
 * touching planner internals.
 *
 * Dispatch order matters and mirrors what a careful user would click:
 *   reset → major → optimization → active day → transcript records →
 *   course-status diffs → exact section selections.
 * `setOptimization` re-recommends every active course, so it must run before
 * the exact selections are applied; transcript application also moves
 * statuses, so status diffs are computed after it.
 *
 * Stale/inactive/unknown references are NOT dispatched: the planner's
 * normalize step would silently re-recommend them. The adapter reports them
 * so the UI can surface the replacement in the open.
 */

export type RestorePlannerApi = {
  resetPlanner: () => void;
  setSelectedMajor: (id: MajorId | null) => void;
  setOptimization: (optimization: OptimizationKey) => void;
  setActiveDay: (day: WeekDay) => void;
  applyTranscriptRecords: (records: TranscriptCourseRecord[]) => void;
  setCourseStatus: (courseCode: string, status: CourseStatus) => void;
  setSection: (courseCode: string, sectionId: string) => void;
  plannerState: PlannerState;
};

export type RestoreOutcome = {
  /** Course statuses explicitly set (diffs against the post-apply state). */
  appliedStatusCount: number;
  /** Exact section selections dispatched (preserved references only). */
  appliedSectionCount: number;
  mergedTranscriptRecordCount: number;
  staleSkipped: Array<{ courseCode: string; sectionId: string }>;
  inactiveSkipped: Array<{ courseCode: string; sectionId: string }>;
  unknownSkipped: Array<{ courseCode: string; sectionId: string }>;
  preferenceChanges: string[];
};

/** Status updates the provider's `applyTranscriptRecords` performs (replica of
 * the public action's own logic — pure, for preview-time simulation). */
function statusesAfterTranscriptApply(
  courseStatuses: Record<string, CourseStatus>,
  records: TranscriptCourseRecord[],
): Record<string, CourseStatus> {
  const statuses = { ...courseStatuses };
  records.forEach((record) => {
    if (record.appliedStatus === "completed") {
      statuses[record.code] = "completed";
      return;
    }
    if (record.appliedStatus === "inProgress" && (statuses[record.code] ?? "notTaken") !== "completed") {
      statuses[record.code] = "inProgress";
    }
  });
  return statuses;
}

/** Transcript-record annotation the provider's `setCourseStatus("completed")`
 * performs (replica — pure, for preview-time simulation). */
function annotateCompletedRecord(record: TranscriptCourseRecord): TranscriptCourseRecord {
  const marker = "Manually marked done in course review.";
  return {
    ...record,
    prerequisiteSatisfied: true,
    reviewRequired: false,
    rationale: record.rationale.includes(marker) ? record.rationale : `${record.rationale} ${marker}`,
  };
}

function statusOf(statuses: Record<string, CourseStatus>, courseCode: string): CourseStatus {
  return statuses[courseCode] ?? "notTaken";
}

function declaredCodes(...states: PlannerState[]): string[] {
  const codes = new Set<string>();
  states.forEach((state) => {
    Object.entries(state.courseStatuses).forEach(([code, status]) => {
      if (status !== "notTaken") {
        codes.add(code);
      }
    });
  });
  return [...codes].sort((a, b) => a.localeCompare(b));
}

/**
 * Dispatch the restore through the planner's public actions, in order.
 * Returns the outcome counts the UI reports after the restore.
 */
export function dispatchRestore(
  planner: RestorePlannerApi,
  snapshot: SavedPlanSnapshot,
  references: SectionReferenceReport,
): RestoreOutcome {
  const planState = snapshot.state;

  planner.resetPlanner();

  const base = getInitialPlannerState();
  const preferenceChanges: string[] = [];
  if (planState.selectedMajor !== base.selectedMajor) {
    planner.setSelectedMajor(planState.selectedMajor);
    preferenceChanges.push("major");
  }
  if (planState.optimization !== base.optimization) {
    planner.setOptimization(planState.optimization);
    preferenceChanges.push("optimization");
  }
  if (planState.activeDay !== base.activeDay) {
    planner.setActiveDay(planState.activeDay);
    preferenceChanges.push("activeDay");
  }

  if (planState.transcriptRecords.length > 0) {
    planner.applyTranscriptRecords(planState.transcriptRecords);
  }

  // Status diffs against the state the public actions have now produced
  // (base statuses + transcript-applied statuses).
  const afterApplyStatuses = statusesAfterTranscriptApply(base.courseStatuses, planState.transcriptRecords);
  let appliedStatusCount = 0;
  declaredCodes(planState, { ...base, courseStatuses: afterApplyStatuses }).forEach((courseCode) => {
    const target = statusOf(planState.courseStatuses, courseCode);
    if (statusOf(afterApplyStatuses, courseCode) !== target) {
      planner.setCourseStatus(courseCode, target);
      appliedStatusCount += 1;
    }
  });

  let appliedSectionCount = 0;
  const staleSkipped: RestoreOutcome["staleSkipped"] = [];
  const inactiveSkipped: RestoreOutcome["inactiveSkipped"] = [];
  const unknownSkipped: RestoreOutcome["unknownSkipped"] = [];
  references.findings.forEach((finding) => {
    if (finding.status === "preserved") {
      planner.setSection(finding.courseCode, finding.sectionId);
      appliedSectionCount += 1;
      return;
    }
    const skipped = { courseCode: finding.courseCode, sectionId: finding.sectionId };
    if (finding.status === "stale") staleSkipped.push(skipped);
    if (finding.status === "inactive") inactiveSkipped.push(skipped);
    if (finding.status === "unknownCourse") unknownSkipped.push(skipped);
  });

  return {
    appliedStatusCount,
    appliedSectionCount,
    mergedTranscriptRecordCount: planState.transcriptRecords.length,
    staleSkipped,
    inactiveSkipped,
    unknownSkipped,
    preferenceChanges,
  };
}

/**
 * Pure preview of the state the dispatch sequence above will produce, using
 * the same pure planner helpers the provider composes (getInitialPlannerState,
 * recommendSections, mergeTranscriptRecords, normalizePlannerState). The
 * authoritative result is always the real planner state read back after the
 * dispatch; this simulation exists so the confirmation preview can show the
 * exact sections the planner will keep before anything is applied.
 */
export function simulateRestoredState(
  snapshot: SavedPlanSnapshot,
  references: SectionReferenceReport,
): PlannerState {
  const planState = snapshot.state;
  let state = getInitialPlannerState();

  // setOptimization re-recommends all active courses; replicate its full
  // replacement semantics before any exact selection is applied.
  state = {
    ...state,
    selectedMajor: planState.selectedMajor,
    activeDay: planState.activeDay,
    optimization: planState.optimization,
    selectedSections: recommendSections(planState.optimization, getActiveCourseCodes(state)),
  };

  const statusesAfterRecords = statusesAfterTranscriptApply(state.courseStatuses, planState.transcriptRecords);
  state = {
    ...state,
    courseStatuses: statusesAfterRecords,
    transcriptRecords: mergeTranscriptRecords(state.transcriptRecords ?? [], planState.transcriptRecords),
  };

  declaredCodes(planState, { ...state, courseStatuses: statusesAfterRecords }).forEach((courseCode) => {
    const target = statusOf(planState.courseStatuses, courseCode);
    if (statusOf(statusesAfterRecords, courseCode) !== target) {
      state = { ...state, courseStatuses: { ...state.courseStatuses, [courseCode]: target } };
      if (target === "completed") {
        state = {
          ...state,
          transcriptRecords: state.transcriptRecords.map((record) =>
            record.code === courseCode ? annotateCompletedRecord(record) : record,
          ),
        };
      }
    }
  });

  references.preserved.forEach((finding) => {
    state = {
      ...state,
      selectedSections: { ...state.selectedSections, [finding.courseCode]: finding.sectionId },
    };
  });

  return normalizePlannerState(state);
}

/** Human-readable dispatch plan for the confirmation preview. */
export function describeRestoreSteps(
  snapshot: SavedPlanSnapshot,
  references: SectionReferenceReport,
): string[] {
  const planState = snapshot.state;
  const steps: string[] = [];
  steps.push("Reset the working schedule to the planner default");
  steps.push(
    planState.selectedMajor
      ? `Set your major to “${planState.selectedMajor}”`
      : "Clear the selected major",
  );
  steps.push(`Set the schedule optimization preference to “${planState.optimization}”`);
  steps.push(`Set the active day to ${planState.activeDay}`);
  steps.push(
    planState.transcriptRecords.length > 0
      ? `Apply ${planState.transcriptRecords.length} transcript record(s)`
      : "Apply no transcript records (this plan has none)",
  );

  const afterApplyStatuses = statusesAfterTranscriptApply(
    getInitialPlannerState().courseStatuses,
    planState.transcriptRecords,
  );
  const statusDiffs: string[] = [];
  declaredCodes(planState, { ...getInitialPlannerState(), courseStatuses: afterApplyStatuses }).forEach(
    (courseCode) => {
      const target = statusOf(planState.courseStatuses, courseCode);
      if (statusOf(afterApplyStatuses, courseCode) !== target) {
        statusDiffs.push(`${courseCode} → ${target}`);
      }
    },
  );
  steps.push(
    statusDiffs.length > 0
      ? `Declare course statuses: ${statusDiffs.join(", ")}`
      : "Declare no course-status changes (they already match)",
  );

  if (references.preserved.length > 0) {
    const selections = references.preserved
      .map((finding) =>
        finding.section
          ? `${finding.courseCode} → ${finding.sectionId} (${sectionMeetingsSummary(finding.section)})`
          : `${finding.courseCode} → ${finding.sectionId}`,
      )
      .join("; ");
    steps.push(`Select the exact saved sections: ${selections}`);
  } else {
    steps.push("Select no exact sections (none of the saved selections survive in the current catalog)");
  }
  return steps;
}

/**
 * Fingerprint of the semantic fields of a working state (timestamps excluded).
 * The restore confirmation re-checks it so a schedule that changed between
 * preview and confirm cannot be replaced silently.
 */
export function workingStateFingerprint(state: PlannerState): string {
  return stableHash(
    JSON.stringify({
      courseStatuses: state.courseStatuses,
      selectedSections: state.selectedSections,
      optimization: state.optimization,
      activeDay: state.activeDay,
      selectedMajor: state.selectedMajor,
      transcriptRecords: state.transcriptRecords,
    }),
  );
}
