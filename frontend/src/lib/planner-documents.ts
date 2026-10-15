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
  AutoTransactionSchema,
  PreferencesBodySchema,
  ScheduleBodySchema,
  TranscriptCourseRecordSchema,
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
  const lastAuto = AutoTransactionSchema.safeParse(plan.coursePlan?.lastAuto ?? null);
  const planned = getPlanningTermCourseCodes(plan);
  const plannedSet = new Set(planned);
  const coursePlan = plan.coursePlan ?? { manualCredit: [], autoPlanned: [], lastAuto: null };
  // Not taken is what an absent status means, so the record lists only facts.
  const history = Object.entries(plan.courseStatuses).filter(([code, status]) => status !== "notTaken" && !plannedSet.has(code));
  return {
    "academic-record": AcademicRecordBodySchema.parse({
      institutionId: INSTITUTION_ID,
      courseStatuses: Object.fromEntries(history),
      transcriptRecords: contractRows(plan.transcriptRecords),
      manualCredit: coursePlan.manualCredit,
      major: plan.selectedMajor,
      catalogId: null,
    }),
    schedule: scheduleBody({
      institutionId: INSTITUTION_ID,
      termId,
      name: MAIN_SCHEDULE_NAME,
      courses: planned,
      selectedSections: Object.fromEntries(Object.entries(plan.selectedSections).filter(([, optionId]) => optionId !== "")),
      lockedSections: plan.lockedSections ?? {},
      // Auto's provenance only describes courses still planned; unplanning a course by status alone leaves it behind.
      autoPlanned: coursePlan.autoPlanned.filter((code) => plannedSet.has(code)),
      lastAuto: lastAuto.success ? lastAuto.data : null,
    }),
    preferences: PreferencesBodySchema.parse({
      institutionId: INSTITUTION_ID,
      goal: plan.optimization,
      constraints: preferences.constraints,
      weights: preferences.weights,
    }),
  };
}

/**
 * Transcript rows as the contract holds them. The legacy route kept a row's
 * extra keys and could store two rows with one id (the id hashes code, term,
 * grade and source, so such rows say the same thing); the first is kept.
 */
function contractRows(rows: PlannerState["transcriptRecords"]): AcademicRecordBody["transcriptRecords"] {
  const keys = Object.keys(TranscriptCourseRecordSchema.shape) as Array<keyof AcademicRecordBody["transcriptRecords"][number]>;
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (seen.has(row.id)) return [];
    seen.add(row.id);
    return [Object.fromEntries(keys.map((key) => [key, row[key]])) as AcademicRecordBody["transcriptRecords"][number]];
  });
}

/**
 * The schedule body. Auto's last run is only an Undo record, and the legacy
 * route accepted runs the contract refuses (a change from "completed"); such
 * a run is dropped rather than leaving the student's plan unsyncable.
 */
function scheduleBody(body: Omit<ScheduleBody, "institutionId" | "termId"> & { institutionId: string; termId: string }): ScheduleBody {
  const parsed = ScheduleBodySchema.safeParse(body);
  return parsed.success ? parsed.data : ScheduleBodySchema.parse({ ...body, lastAuto: null });
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

const isCodeList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const isRowList = (value: unknown): value is Array<Record<string, unknown> & { id: string }> =>
  Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.id === "string");

/**
 * Applies the planner's change, `before` to `after` (both read through the
 * planner), to `stored`, so what the planner never read is written back
 * unchanged:
 * - object keys the planner never read keep their stored values, at any depth;
 * - a list of codes (courses, manual credit, days off) changes by the codes
 *   the planner added or removed, so a code it can't show stays;
 * - a list of rows with ids (transcript rows, busy times) changes row by row;
 * - any other value the planner changed takes the planner's value whole.
 */
export function rebase(stored: unknown, before: unknown, after: unknown): unknown {
  if (equal(before, after)) return stored;
  if (isCodeList(stored) && isCodeList(before) && isCodeList(after)) {
    const removed = new Set(before.filter((code) => !after.includes(code)));
    const added = after.filter((code) => !before.includes(code) && !stored.includes(code));
    return [...stored.filter((code) => !removed.has(code)), ...added];
  }
  if (isRowList(stored) && isRowList(before) && isRowList(after)) {
    const was = new Map(before.map((row) => [row.id, row]));
    const now = new Map(after.map((row) => [row.id, row]));
    const kept = stored.flatMap((row) => {
      const next = now.get(row.id);
      if (!next) return was.has(row.id) ? [] : [row];
      return [rebase(row, was.get(row.id) ?? row, next)];
    });
    const storedIds = new Set(stored.map((row) => row.id));
    return [...kept, ...after.filter((row) => !storedIds.has(row.id))];
  }
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
