// D/P/CR semantics port for the degree-plan experiment.
//
// This is a deliberate, independent re-expression of the app's planner rules
// (frontend/src/lib/planner.ts) restricted to what a multi-semester plan can
// touch. Where the app has a quirk, the port reproduces the quirk and the
// tests pin it. The single-semester implementation is NOT modified and is NOT
// imported from here.

// Statuses: the app's exact string values (types.ts CourseStatus).
export const STATUS = {
  DONE: "completed", // D — UI "Done"
  PLANNED: "inProgress", // P — UI "Taking"
  REMAINING: "notTaken", // CR — UI "Not taken"
};

// Port of planner.ts doesCourseSatisfyPrerequisite, quirk included:
// a completed course satisfies a prerequisite UNLESS transcript evidence for
// that course exists and none of the evidence records carries
// prerequisiteSatisfied — then it does NOT satisfy, despite the completed
// status. Nothing else (in-progress, not-taken, unknown) satisfies.
export function prerequisiteSatisfied(
  courseCode,
  courseStatuses,
  transcriptRecords = [],
) {
  if (courseStatuses[courseCode] !== STATUS.DONE) return false;
  const evidence = transcriptRecords.filter(
    (record) => record.code === courseCode && record.appliedStatus === STATUS.DONE,
  );
  if (evidence.length === 0) return true;
  return evidence.some((record) => record.prerequisiteSatisfied);
}

// Port of planner.ts getMissingPrerequisites/isCourseLocked, over the FULL
// app edge list (prereqRefs) so lock state matches the app exactly — an
// uncataloged prereq code counts as missing (statuses can never mark it
// completed), and a self-referencing edge counts as missing until the course
// itself is completed.
export function missingPrerequisites(courseCode, universe, courseStatuses, transcriptRecords = []) {
  const course = universe.find((entry) => entry.code === courseCode);
  if (!course) return [];
  const refs = course.prereqRefs ?? course.prereqs;
  return refs.filter(
    (prereqCode) => !prerequisiteSatisfied(prereqCode, courseStatuses, transcriptRecords),
  );
}

export function isLocked(courseCode, universe, courseStatuses, transcriptRecords = []) {
  return missingPrerequisites(courseCode, universe, courseStatuses, transcriptRecords).length > 0;
}

// Pinned choices: the user's D/P/CR assignments are ground truth.
// - D courses are done; the planner never re-takes or re-orders them.
// - P courses are in the current term (term 0) and are immovable; they count
//   against the current term's credit load and complete at its end.
// - CR courses are the only courses a plan may schedule.
// - User-pinned section selections (planner.ts fixedSelections) are
//   single-semester artifacts; a multi-semester plan preserves the pinned
//   P course SET, not its section ids. Recorded, not silently dropped.
export function initialPlanState(universe, courseStatuses, { transcriptRecords = [] } = {}) {
  const known = new Set(universe.map((course) => course.code));
  const pinned = { done: [], planned: [], remaining: [] };
  for (const code of known) {
    const status = courseStatuses[code] ?? STATUS.REMAINING;
    if (status === STATUS.DONE) pinned.done.push(code);
    else if (status === STATUS.PLANNED) pinned.planned.push(code);
    else pinned.remaining.push(code);
  }
  pinned.done.sort();
  pinned.planned.sort();
  pinned.remaining.sort();

  // A D course the app would treat as NOT satisfying its prereqs (the
  // transcript-evidence quirk) still counts as completed for placement — the
  // user has the credit — but the quirk is recorded on the state so plans
  // carry it visibly.
  const evidenceGatedDone = pinned.done.filter(
    (code) =>
      transcriptRecords.some(
        (record) => record.code === code && record.appliedStatus === STATUS.DONE,
      ) &&
      !transcriptRecords.some(
        (record) => record.code === code && record.appliedStatus === STATUS.DONE && record.prerequisiteSatisfied,
      ),
  );

  // Locked-now: remaining courses whose catalog prereqs are unsatisfied under
  // app semantics at term 0 (these unlock only as earlier terms complete them,
  // or never, when a prereq is uncataloged and no equivalence is assumed).
  const lockedNow = pinned.remaining.filter((code) =>
    isLocked(code, universe, courseStatuses, transcriptRecords),
  );

  return {
    pinned,
    lockedNow,
    evidenceGatedDone,
    currentTermLoad: pinned.planned.reduce(
      (total, code) => total + universe.find((entry) => entry.code === code).creditHours,
      0,
    ),
  };
}
