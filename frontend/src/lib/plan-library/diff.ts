import { findOption, isTimed, optionIdLabel, sampleCatalog, sectionRef, type SectionCatalog } from "@/lib/planner-sections";
import { normalizePlannerState } from "@/lib/planner";
import { courses } from "@/lib/seed-data";
import type { Section } from "@/lib/sections";
import type { Course, CourseStatus, PlannerState } from "@/lib/types";
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

/** A course whose section lock differs: the locked section id on each side, or null. */
export type PlanLockChange = {
  courseCode: string;
  savedPlan: string | null;
  workingState: string | null;
};

/** A Courses-view fact that differs: credit the student claimed, or a course Auto-fill planned. */
export type PlanCourseFactChange = {
  courseCode: string;
  fact: "manualCredit" | "autoPlanned";
  savedPlan: boolean;
  workingState: boolean;
};

export type PlanDiff = {
  statusChanges: PlanStatusChange[];
  /** Manual credit and Auto provenance: the same statuses can read Done in one and Taking in the other. */
  courseFactChanges: PlanCourseFactChange[];
  lockChanges: PlanLockChange[];
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
   * the optimization preference, the active day, the selected major, the
   * transcript record list, and the section lock of any course locked on
   * either side (plans without locks add no lock fields, so older counts hold). Counts are committed in the plan-library tests.
   */
  comparedFieldCount: number;
  preservedFieldCount: number;
  changedFieldCount: number;
};

function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const period = hours >= 12 && hours < 24 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes % 60).padStart(2, "0")} ${period}`;
}

function meetingsSummary(section: Section): string {
  const groups = new Map<string, { start: number; end: number; room: string; days: string[] }>();
  section.meetings.filter(isTimed).forEach((meeting) => {
    const key = `${meeting.startMinutes}|${meeting.endMinutes}|${meeting.room}`;
    const group = groups.get(key) ?? { start: meeting.startMinutes, end: meeting.endMinutes, room: meeting.room, days: [] };
    group.days.push(meeting.day);
    groups.set(key, group);
  });
  const timed = [...groups.values()].map(
    (group) => `${group.days.join("/")} ${formatClock(group.start)}–${formatClock(group.end)} in ${group.room}`,
  );
  return timed.length > 0 ? timed.join("; ") : "no set time";
}

function sectionRefOf(state: PlannerState, courseCode: string, catalog: SectionCatalog): PlanDiffSectionRef | null {
  const sectionId = state.selectedSections[courseCode];
  if (!sectionId) {
    return null;
  }
  const section = findOption(catalog, courseCode, sectionId);
  if (!section) {
    // Exact id preserved even though nothing loaded resolves it.
    return {
      sectionId,
      professor: "unknown section",
      meetingsSummary: sectionRef(sectionId).provenance === "real" ? optionIdLabel(sectionId) : "not in the current catalog",
    };
  }
  return {
    sectionId: section.id,
    professor: section.instructor.display ?? "Instructor not listed",
    meetingsSummary: meetingsSummary(section),
  };
}

/**
 * Whether a reference resolves now. A real option whose course options have
 * not loaded (or fell back to samples) cannot be judged, so it is not called
 * unknown.
 */
function sectionResolves(catalog: SectionCatalog, courseCode: string, sectionId: string): boolean {
  if (findOption(catalog, courseCode, sectionId)) return true;
  const loaded = catalog(courseCode);
  return sectionRef(sectionId).provenance === "real" && !(loaded.status === "ready" && loaded.result.provenance.kind === "real");
}

/** `catalog` is the planner's loaded options; the bundled samples by default. */
export function diffSavedPlanAgainstWorking(
  savedPlan: SavedPlanSnapshot,
  workingState: PlannerState,
  catalog: SectionCatalog = sampleCatalog,
): PlanDiff {
  return diffPlannerStates(savedPlan.state, workingState, catalog);
}

/**
 * Two library schedules compared as the planner would load them. A saved or
 * imported file can carry values the planner doesn't know (any string passes
 * as a status on import); normalizing first reads those the way loading
 * would, so no sentence names an unknown status.
 */
export function diffLibraryPlans(a: PlannerState, b: PlannerState, catalog: SectionCatalog = sampleCatalog): PlanDiff {
  return diffPlannerStates(normalizePlannerState(a), normalizePlannerState(b), catalog);
}

/** The same comparison between any two plans: `savedState` plays the saved plan's side. */
export function diffPlannerStates(
  savedState: PlannerState,
  workingState: PlannerState,
  catalog: SectionCatalog = sampleCatalog,
): PlanDiff {
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
          from: sectionRefOf(savedState, code, catalog),
          to: sectionRefOf(workingState, code, catalog),
        });
      }
      if (savedRef && !sectionResolves(catalog, code, savedRef)) {
        unknownReferences.push({ courseCode: code, sectionId: savedRef, side: "savedPlan" });
      }
      if (workingRef && !sectionResolves(catalog, code, workingRef)) {
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

  const lockChanges: PlanLockChange[] = [];
  const savedLocks = savedState.lockedSections ?? {};
  const workingLocks = workingState.lockedSections ?? {};
  [...new Set([...Object.keys(savedLocks), ...Object.keys(workingLocks)])]
    .sort((a, b) => a.localeCompare(b))
    .forEach((code) => {
      comparedFieldCount += 1;
      const saved = savedLocks[code] ?? null;
      const working = workingLocks[code] ?? null;
      if (saved !== working) {
        changedFieldCount += 1;
        lockChanges.push({ courseCode: code, savedPlan: saved, workingState: working });
      }
    });

  const courseFactChanges: PlanCourseFactChange[] = [];
  (["manualCredit", "autoPlanned"] as const).forEach((fact) => {
    const saved = new Set(savedState.coursePlan?.[fact] ?? []);
    const working = new Set(workingState.coursePlan?.[fact] ?? []);
    [...new Set([...saved, ...working])].sort((a, b) => a.localeCompare(b)).forEach((code) => {
      comparedFieldCount += 1;
      if (saved.has(code) !== working.has(code)) {
        changedFieldCount += 1;
        courseFactChanges.push({ courseCode: code, fact, savedPlan: saved.has(code), workingState: working.has(code) });
      }
    });
  });

  comparedFieldCount += 1;
  const transcriptChanged =
    JSON.stringify(savedState.transcriptRecords) !== JSON.stringify(workingState.transcriptRecords);
  if (transcriptChanged) changedFieldCount += 1;

  return {
    statusChanges,
    courseFactChanges,
    lockChanges,
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

/** One sentence per Courses-view fact that differs, for the compare panel. */
export function describeCourseFactChanges(changes: PlanCourseFactChange[]): string[] {
  return changes.map(({ courseCode, fact, savedPlan }) => {
    const where = savedPlan ? "in the plan but not in the working schedule" : "in the working schedule but not in the plan";
    return fact === "manualCredit"
      ? `${courseCode} is marked as credit you have ${where}`
      : `${courseCode} was planned by Auto-fill ${where}`;
  });
}

/** One sentence per lock difference, shared by the compare panel and the restore preview. */
export function describeLockChanges(changes: PlanLockChange[]): string[] {
  return changes.map(({ courseCode, savedPlan, workingState }) => {
    if (savedPlan && workingState) {
      return `${courseCode} is locked to ${savedPlan} in the plan but to ${workingState} in the working schedule`;
    }
    if (savedPlan) {
      return `${courseCode} is locked to ${savedPlan} in the plan but not locked in the working schedule`;
    }
    return `${courseCode} is locked to ${workingState} in the working schedule but not in the plan`;
  });
}

const STATUS_WORDS: Record<CourseStatus, string> = { completed: "done", inProgress: "in progress", notTaken: "not taken" };

/**
 * What else differs between schedule A (the diff's saved side) and B, beyond
 * sections and the week's figures, one sentence each: course statuses, credit
 * the student claimed, what Auto planned, locks, and the goal and major.
 * The library's compare shows these behind "More differences".
 */
export function describeOtherDifferences(diff: PlanDiff, a: string, b: string): string[] {
  const lines: string[] = [];
  for (const change of diff.statusChanges) {
    lines.push(`${change.courseCode} is ${STATUS_WORDS[change.from]} in ${a} and ${STATUS_WORDS[change.to]} in ${b}.`);
  }
  for (const change of diff.courseFactChanges) {
    const only = change.savedPlan ? a : b;
    lines.push(
      change.fact === "manualCredit"
        ? `${change.courseCode} is marked as credit you have in ${only} only.`
        : `${change.courseCode} was planned by Auto in ${only} only.`,
    );
  }
  for (const change of diff.lockChanges) {
    const side = (name: string, id: string | null) => (id ? `locked to ${id} in ${name}` : `not locked in ${name}`);
    lines.push(`${change.courseCode} is ${side(a, change.savedPlan)} and ${side(b, change.workingState)}.`);
  }
  if (diff.optimizationChanged) lines.push(`${a} and ${b} have different schedule goals.`);
  if (diff.majorChanged) lines.push(`${a} and ${b} are for different majors.`);
  if (diff.transcriptRecords.changed) lines.push(`${a} and ${b} hold different transcript records.`);
  return lines;
}
