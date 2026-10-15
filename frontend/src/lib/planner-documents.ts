/**
 * The planner's state as the three synced documents of
 * docs/architecture/README.md ("Saved state: documents with receipts"), and
 * back. The legacy migration on the server and the signed-in web planner both
 * split a plan here, so a migrated row and a later edit agree on where each
 * fact lives:
 *
 * - academic record: course statuses other than planned courses, transcript
 *   rows, manual credit and the major;
 * - Main schedule: the planned courses (marked in progress without an
 *   in-progress transcript row), picks, kept sections and Auto's last run;
 * - preferences: the goal, constraints and weights.
 *
 * The planner can't hold everything a document can (a catalog id, a
 * schedule's name, a course outside the bundled catalog). A save therefore
 * never rebuilds a body from the planner: it applies the planner's own change
 * to the stored body with `rebase`, so whatever the planner never read is
 * written back as it was.
 */
import { equal } from "@untangle/sync";
import {
  AcademicRecordBodySchema,
  PreferencesBodySchema,
  ScheduleBodySchema,
  type AcademicRecordBody,
  type PreferencesBody,
  type ScheduleBody,
} from "../../../packages/contracts/src/documents";
import { defaultSchedulePreferences, getInitialPlannerState, getPlanningTermCourseCodes, normalizePlannerState } from "@/lib/planner";
import { sectionRef } from "@/lib/planner-sections";
import type { ClassDay, PlannerState, SchedulePreferences } from "@/lib/types";

export const INSTITUTION_ID = "unt";
export const MAIN_SCHEDULE_NAME = "Main";

/**
 * Fixed ids for each kind's first document, so two devices that each create
 * one offline meet as a revision conflict on one id instead of leaving two
 * records. A deleted id is never reused (the server refuses it), so a
 * replacement gets a random id and is found by its kind and term.
 */
export const firstDocumentId = {
  "academic-record": `academic-record-${INSTITUTION_ID}`,
  preferences: `preferences-${INSTITUTION_ID}`,
  schedule: (termId: string) => `main-${INSTITUTION_ID}-${termId}`,
} as const;

export type PlannerBodies = {
  "academic-record": AcademicRecordBody;
  schedule: ScheduleBody;
  preferences: PreferencesBody;
};
export type PlannerKind = keyof PlannerBodies;
export const plannerKinds: readonly PlannerKind[] = ["academic-record", "schedule", "preferences"];

/** The documents as the planner reads them; a missing document reads as starting values. */
export type StoredBodies = { [K in PlannerKind]: PlannerBodies[K] | null };

/**
 * The three bodies for a plan, with starting values for the fields the
 * planner doesn't hold: no catalog id, the name "Main" and `termId`.
 */
export function splitPlanner(state: PlannerState, preferences: SchedulePreferences, termId: string): PlannerBodies {
  const plan = normalizePlannerState(state);
  const planned = getPlanningTermCourseCodes(plan);
  const plannedSet = new Set(planned);
  const coursePlan = plan.coursePlan ?? { manualCredit: [], autoPlanned: [], lastAuto: null };
  // Not taken is what an absent status means, so the record lists only facts.
  const history = Object.entries(plan.courseStatuses).filter(([code, status]) => status !== "notTaken" && !plannedSet.has(code));
  return {
    "academic-record": AcademicRecordBodySchema.parse({
      institutionId: INSTITUTION_ID,
      courseStatuses: Object.fromEntries(history),
      transcriptRecords: plan.transcriptRecords,
      manualCredit: coursePlan.manualCredit,
      major: plan.selectedMajor,
      catalogId: null,
    }),
    schedule: ScheduleBodySchema.parse({
      institutionId: INSTITUTION_ID,
      termId,
      name: MAIN_SCHEDULE_NAME,
      courses: planned,
      selectedSections: plan.selectedSections,
      lockedSections: plan.lockedSections ?? {},
      // Auto's provenance only describes courses still planned; unplanning a course by status alone leaves it behind.
      autoPlanned: coursePlan.autoPlanned.filter((code) => plannedSet.has(code)),
      lastAuto: coursePlan.lastAuto,
    }),
    preferences: PreferencesBodySchema.parse({
      institutionId: INSTITUTION_ID,
      goal: plan.optimization,
      constraints: preferences.constraints,
      weights: preferences.weights,
    }),
  };
}

/** The planner's view of the documents. `activeDay` stays on each device, so the caller supplies it. */
export function joinPlanner(bodies: StoredBodies, activeDay: ClassDay): { state: PlannerState; preferences: SchedulePreferences } {
  const initial = getInitialPlannerState();
  const record = bodies["academic-record"];
  const schedule = bodies.schedule;
  const courseStatuses = { ...initial.courseStatuses, ...record?.courseStatuses };
  // A course the record says is done stays done, even if a schedule still plans it.
  for (const code of schedule?.courses ?? []) {
    if (courseStatuses[code] !== "completed") courseStatuses[code] = "inProgress";
  }
  const goal = bodies.preferences?.goal ?? initial.optimization;
  const state = normalizePlannerState({
    ...initial,
    courseStatuses,
    selectedSections: schedule?.selectedSections ?? {},
    lockedSections: schedule?.lockedSections ?? {},
    transcriptRecords: record?.transcriptRecords ?? [],
    selectedMajor: record?.major ?? null,
    optimization: goal,
    activeDay,
    coursePlan: {
      manualCredit: record?.manualCredit ?? [],
      autoPlanned: schedule?.autoPlanned ?? [],
      lastAuto: schedule?.lastAuto ?? null,
    },
    updatedAt: new Date().toISOString(),
  });
  const preferences = bodies.preferences
    ? { constraints: bodies.preferences.constraints, weights: bodies.preferences.weights }
    : defaultSchedulePreferences(goal);
  return { state, preferences };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Applies the planner's change, `before` to `after` (both read through the
 * planner), to `stored`. Object keys the planner never read keep their stored
 * values at any depth; an array or value the planner changed takes the
 * planner's value whole.
 */
export function rebase(stored: unknown, before: unknown, after: unknown): unknown {
  if (equal(before, after)) return stored;
  if (!isRecord(stored) || !isRecord(before) || !isRecord(after)) return after;
  const next: Record<string, unknown> = {};
  // defineProperty, not assignment: a course code may legally be "__proto__".
  const put = (key: string, value: unknown) =>
    Object.defineProperty(next, key, { value, enumerable: true, configurable: true, writable: true });
  for (const [key, value] of Object.entries(stored)) put(key, value);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Object.hasOwn(after, key)) delete next[key];
    else if (Object.hasOwn(stored, key) && Object.hasOwn(before, key)) put(key, rebase(stored[key], before[key], after[key]));
    else put(key, after[key]);
  }
  return next;
}

/**
 * The term a legacy plan was made for: its real picks' term. A plan with no
 * real picks falls back to `fallback`, the term the planner plans now.
 */
export function legacyPlanTerm(state: PlannerState, fallback: string): string {
  for (const optionId of Object.values(state.selectedSections)) {
    const ref = sectionRef(optionId);
    if (ref.provenance === "real") return ref.term;
  }
  return fallback;
}
