/**
 * The students the degree-check tests read, as planner transcript rows.
 *
 * The finished four-year plan is the "Four-year degree plan (example)" on
 * the 2026-2027 Computer Science, BS catalog page, with each placeholder
 * cell filled from the catalog's own lists exactly as
 * packages/ingest/tests/degree-audit.test.ts fills it (the ingest test
 * checks every fill against the derived requirement). It adds up to the
 * page's 120 hours.
 */
import { getInitialPlannerState, normalizePlannerState } from "@/lib/planner";
import type { CourseStatus, PlannerState, TranscriptCourseRecord } from "@/lib/types";

export function row(code: string, term: string, grade: string, credits: number, inProgress = false): TranscriptCourseRecord {
  return {
    id: `fixture-${code.replace(" ", "-")}-${term.replace(" ", "-")}`.toLowerCase(),
    code,
    title: code,
    term,
    grade,
    credits,
    sourceKind: inProgress ? "current" : "unt",
    confidence: 1,
    rationale: "Test fixture",
    duplicateExcluded: false,
    appliedStatus: inProgress ? "inProgress" : "completed",
    prerequisiteSatisfied: true,
    reviewRequired: false,
  };
}

/** The student-auto journey's transcript (output/playwright/student-auto/fixtures/make-transcript.mjs). */
export const journeyTranscript = [row("MATH 1710", "Fall 2025", "B", 3), row("ENGL 1310", "Fall 2025", "A", 3), row("CSCE 1040", "Spring 2026", "A", 3)];

/** The plan by semester, as [code, hours]. XFRE 1000 and XFRE 1001 stand for free electives no list names. */
const PLAN: [string, number][][] = [
  [["CSCE 1010", 3], ["MATH 1710", 4], ["HIST 2610", 3], ["ENGL 1310", 3], ["ANTH 1150", 3]],
  [["CSCE 1015", 1], ["CSCE 1030", 3], ["TECM 2700", 3], ["HIST 2620", 3], ["XFRE 1000", 2]],
  [["CSCE 1040", 3], ["EENG 2710", 3], ["TECM 4180", 3], ["PHYS 1710", 3], ["PHYS 1730", 1], ["CSCE 4350", 3]],
  [["CSCE 2100", 3], ["CSCE 2110", 3], ["CSCE 2610", 3], ["ANTH 2400", 3], ["PHYS 2220", 3], ["PHYS 2240", 1]],
  [["CSCE 3550", 3], ["CSCE 3600", 3], ["CSCE 3530", 3], ["CSCE 2120", 3], ["XFRE 1001", 3]],
  [["CSCE 3444", 3], ["CSCE 4110", 3], ["CSCE 2130", 3], ["CSCE 4115", 3], ["CSCE 4201", 3]],
  [["CSCE 4010", 3], ["CSCE 4901", 3], ["PSCI 2306", 3], ["ANTH 1010", 3], ["CSCE 4210", 3]],
  [["CSCE 4902", 3], ["PSCI 2305", 3], ["AGER 2250", 3], ["CSCE 4230", 3], ["CSCE 4240", 3]],
];

/** Every semester finished with a B, Fall 2022 to Spring 2026. */
export const completedPlan = PLAN.flatMap((semester, index) =>
  semester.map(([code, hours]) => row(code, `${index % 2 === 0 ? "Fall" : "Spring"} ${2022 + Math.ceil(index / 2)}`, "B", hours)),
);

/**
 * The same plan with its last semester in progress this term (Fall 2026):
 * 105 hours finished and 15 in progress. A current-term row prints 0.000
 * earned on the transcript, and the importer keeps that 0.
 */
export const finalTerm = PLAN.flatMap((semester, index) =>
  semester.map(([code, hours]) => {
    const term = `${index % 2 === 0 ? "Spring" : "Fall"} ${2023 + Math.floor(index / 2)}`;
    return index === PLAN.length - 1 ? row(code, term, "IP", 0, true) : row(code, term, "B", hours);
  }),
);

/** A planner state with this record and major, statuses set as the importer sets them. */
export function plannerWith(transcript: readonly TranscriptCourseRecord[], major: PlannerState["selectedMajor"], extra: { manualCredit?: string[]; statuses?: Record<string, CourseStatus> } = {}): PlannerState {
  const base = getInitialPlannerState();
  const statuses: Record<string, CourseStatus> = { ...base.courseStatuses };
  for (const record of transcript) statuses[record.code] = record.appliedStatus === "completed" ? "completed" : "inProgress";
  return normalizePlannerState({
    ...base,
    selectedMajor: major,
    transcriptRecords: [...transcript],
    courseStatuses: { ...statuses, ...extra.statuses },
    coursePlan: { manualCredit: extra.manualCredit ?? [], autoPlanned: [], lastAuto: null },
  });
}
