import { courses, sections } from "@/lib/seed-data";
import type { Course, CourseSection, CourseStatus, PlannerState } from "@/lib/types";
import type { SavedPlanSnapshot } from "./snapshot-types";

/**
 * Compare a saved plan against the current working schedule.
 *
 * This is a differences-only view: which declared course statuses moved, which
 * selected sections moved (with the exact section id, professor, meeting days,
 * times and rooms from the current catalog), which references no longer
 * resolve anywhere in the catalog, and which planner preferences changed.
 * It intentionally carries no score and no ranking — the planner's optimizer
 * is never asked to judge the plans, only the user is shown what differs.
 */

export type PlanDiffSectionRef = {
  sectionId: string;
  professor: string;
  meetingsSummary: string;
};

export type PlanStatusChange = {
  courseCode: string;
  course: Course | null;
  /** Declared status in the saved plan. */
  from: CourseStatus;
  /** Declared status in the working schedule. */
  to: CourseStatus;
};

export type PlanSectionChange = {
  courseCode: string;
  course: Course | null;
  kind: "added" | "removed" | "changed";
  from: PlanDiffSectionRef | null;
  to: PlanDiffSectionRef | null;
};

export type UnknownPlanReference = {
  courseCode: string;
  sectionId: string;
  side: "savedPlan" | "workingState";
};

export type PlanDiff = {
  statusChanges: PlanStatusChange[];
  sectionChanges: PlanSectionChange[];
  unknownReferences: UnknownPlanReference[];
  optimizationChanged: boolean;
  activeDayChanged: boolean;
  majorChanged: boolean;
  transcriptRecords: {
    savedPlan: number;
    workingState: number;
    changed: boolean;
  };
  /**
   * Field-level accounting. A field is one of: the declared status of a
   * course (over the union of courses declared or referenced on either side),
   * the selected section of a course (over the union of referenced courses),
   * the optimization preference, the active day, the selected major, and the
   * transcript record list. Counts are committed in the plan-library tests.
   */
  comparedFieldCount: number;
  preservedFieldCount: number;
  changedFieldCount: number;
};

function formatClock(time: string): string {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return time;
  }
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function meetingsSummary(section: CourseSection): string {
  const groups = new Map<string, CourseSection["meetings"]>();
  section.meetings.forEach((meeting) => {
    const key = `${meeting.start}|${meeting.end}|${meeting.location}`;
    const group = groups.get(key);
    if (group) {
      group.push(meeting);
    } else {
      groups.set(key, [meeting]);
    }
  });
  return [...groups.values()]
    .map((group) => {
      const first = group[0];
      const days = group.map((meeting) => meeting.day).join("/");
      return `${days} ${formatClock(first.start)}–${formatClock(first.end)} · ${first.location}`;
    })
    .join("; ");
}

function sectionRefOf(state: PlannerState, courseCode: string): PlanDiffSectionRef | null {
  const sectionId = state.selectedSections[courseCode];
  if (!sectionId) {
    return null;
  }
  const section =
    sections.find((entry) => entry.id === sectionId && entry.courseCode === courseCode) ?? null;
  if (!section) {
    // Exact id preserved even though the running catalog cannot resolve it.
    return {
      sectionId,
      professor: "unknown section",
      meetingsSummary: "not in the current catalog",
    };
  }
  return {
    sectionId: section.id,
    professor: section.professor,
    meetingsSummary: meetingsSummary(section),
  };
}

function sectionExistsInCatalog(courseCode: string, sectionId: string): boolean {
  return sections.some((entry) => entry.id === sectionId && entry.courseCode === courseCode);
}

export function diffSavedPlanAgainstWorking(
  savedPlan: SavedPlanSnapshot,
  workingState: PlannerState,
): PlanDiff {
  const savedState = savedPlan.state;
  const statusOf = (state: PlannerState, courseCode: string): CourseStatus =>
    state.courseStatuses[courseCode] ?? "notTaken";

  const codes = new Set<string>();
  Object.entries(savedState.courseStatuses).forEach(([code, status]) => {
    if (status !== "notTaken") {
      codes.add(code);
    }
  });
  Object.entries(workingState.courseStatuses).forEach(([code, status]) => {
    if (status !== "notTaken") {
      codes.add(code);
    }
  });
  Object.keys(savedState.selectedSections).forEach((code) => codes.add(code));
  Object.keys(workingState.selectedSections).forEach((code) => codes.add(code));

  const courseByCode = (code: string): Course | null =>
    courses.find((course) => course.code === code) ?? null;

  const statusChanges: PlanStatusChange[] = [];
  const sectionChanges: PlanSectionChange[] = [];
  const unknownReferences: UnknownPlanReference[] = [];

  let comparedFieldCount = 0;
  let changedFieldCount = 0;

  const sortedCodes = [...codes].sort((a, b) => a.localeCompare(b));
  sortedCodes.forEach((code) => {
    comparedFieldCount += 1;
    const savedStatus = statusOf(savedState, code);
    const workingStatus = statusOf(workingState, code);
    if (savedStatus !== workingStatus) {
      changedFieldCount += 1;
      statusChanges.push({
        courseCode: code,
        course: courseByCode(code),
        from: savedStatus,
        to: workingStatus,
      });
    }

    const savedRef = savedState.selectedSections[code];
    const workingRef = workingState.selectedSections[code];
    if (savedRef || workingRef) {
      comparedFieldCount += 1;
      if (savedRef !== workingRef) {
        changedFieldCount += 1;
        sectionChanges.push({
          courseCode: code,
          course: courseByCode(code),
          kind: savedRef ? (workingRef ? "changed" : "removed") : "added",
          from: sectionRefOf(savedState, code),
          to: sectionRefOf(workingState, code),
        });
      }
      if (savedRef && !sectionExistsInCatalog(code, savedRef)) {
        unknownReferences.push({ courseCode: code, sectionId: savedRef, side: "savedPlan" });
      }
      if (workingRef && !sectionExistsInCatalog(code, workingRef)) {
        unknownReferences.push({ courseCode: code, sectionId: workingRef, side: "workingState" });
      }
    }
  });

  comparedFieldCount += 3;
  const optimizationChanged = savedState.optimization !== workingState.optimization;
  const activeDayChanged = savedState.activeDay !== workingState.activeDay;
  const majorChanged = savedState.selectedMajor !== workingState.selectedMajor;
  if (optimizationChanged) changedFieldCount += 1;
  if (activeDayChanged) changedFieldCount += 1;
  if (majorChanged) changedFieldCount += 1;

  comparedFieldCount += 1;
  const transcriptChanged =
    JSON.stringify(savedState.transcriptRecords) !== JSON.stringify(workingState.transcriptRecords);
  if (transcriptChanged) changedFieldCount += 1;

  return {
    statusChanges,
    sectionChanges,
    unknownReferences,
    optimizationChanged,
    activeDayChanged,
    majorChanged,
    transcriptRecords: {
      savedPlan: savedState.transcriptRecords.length,
      workingState: workingState.transcriptRecords.length,
      changed: transcriptChanged,
    },
    comparedFieldCount,
    preservedFieldCount: comparedFieldCount - changedFieldCount,
    changedFieldCount,
  };
}
