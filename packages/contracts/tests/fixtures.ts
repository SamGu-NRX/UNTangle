/**
 * One student's saved plan and preferences, typed with the planner's own
 * types so they can only hold values the app can produce today, and the
 * document bodies that plan splits into.
 */
import type {
  AutoTransaction,
  CoursePlan,
  PlannerState,
  SchedulePreferences,
  TranscriptCourseRecord,
} from "../../../frontend/src/lib/types";

const transcriptRecords: TranscriptCourseRecord[] = [
  {
    id: "row-1",
    code: "CSCE 1030",
    title: "Computer Science I",
    term: "Fall 2025",
    grade: "A",
    credits: 4,
    sourceKind: "unt",
    confidence: 0.98,
    rationale: "Matched the course code and term.",
    duplicateExcluded: false,
    appliedStatus: "completed",
    prerequisiteSatisfied: true,
    reviewRequired: false,
  },
  {
    id: "row-2",
    code: "MATH 1710",
    title: "Calculus I",
    term: "Fall 2026",
    grade: "",
    credits: null,
    sourceKind: "current",
    confidence: 0.91,
    rationale: "Enrolled this term.",
    duplicateExcluded: false,
    appliedStatus: "inProgress",
    prerequisiteSatisfied: true,
    reviewRequired: false,
  },
  {
    id: "row-3",
    code: "ENGL 1301",
    title: "Composition I",
    term: "Summer 2024",
    grade: "CR",
    credits: 3,
    sourceKind: "transfer",
    confidence: 0.6,
    rationale: "Transfer credit. Check the UNT equivalent.",
    duplicateExcluded: false,
    appliedStatus: "needsReview",
    prerequisiteSatisfied: false,
    reviewRequired: true,
  },
];

const lastAuto: AutoTransaction = {
  id: "auto-7f3a",
  at: "2026-10-12T15:04:05.000Z",
  major: "cs",
  changes: [
    { code: "CSCE 1040", from: "notTaken", to: "inProgress" },
    { code: "MATH 1720", from: "notTaken", to: "inProgress" },
  ],
  autoPlannedBefore: [],
  summary: "Auto planned 2 courses for Spring 2027.",
  needsCheck: ["CSCE 2100"],
};

const coursePlan: CoursePlan = {
  manualCredit: ["MATH 1650"],
  autoPlanned: ["CSCE 1040", "MATH 1720"],
  lastAuto,
};

const realOption = "vsb:spring-2027:CSCE 1040:6001+6002";

export const savedPlan: PlannerState = {
  courseStatuses: {
    "CSCE 1030": "completed",
    "MATH 1650": "completed",
    "MATH 1710": "inProgress",
    "CSCE 1040": "inProgress",
    "MATH 1720": "inProgress",
    "CSCE 2100": "notTaken",
  },
  selectedSections: { "CSCE 1040": realOption, "MATH 1720": "math-1720-002" },
  optimization: "compact",
  activeDay: "Tue",
  selectedMajor: "cs",
  transcriptRecords,
  updatedAt: "2026-10-12T15:04:05.000Z",
  lockedSections: { "CSCE 1040": realOption },
  coursePlan,
};

export const savedPreferences: SchedulePreferences = {
  constraints: {
    earliestStart: 540,
    latestEnd: 1020,
    daysOff: ["Fri"],
    blocked: [{ id: "block-1", label: "Work", day: "Mon", start: 720, end: 840 }],
    maxCredits: 15,
    walkingBufferMinutes: 10,
    excludedSections: ["math-1720-001"],
    openSeatsOnly: true,
    otherSites: false,
  },
  weights: { fewerDays: 3, compact: 4, mornings: 1, evenings: 0, walking: 2, rating: 0 },
};

// The record holds history only. CSCE 1040 and MATH 1720 are planned, so
// they live in the schedule below, as the migration moves them.
const planned = new Set(["CSCE 1040", "MATH 1720"]);
const historyStatuses = Object.fromEntries(
  Object.entries(savedPlan.courseStatuses).filter(([code]) => !planned.has(code)),
);

export const academicRecord = {
  institutionId: "unt",
  courseStatuses: historyStatuses,
  transcriptRecords: savedPlan.transcriptRecords,
  manualCredit: coursePlan.manualCredit,
  major: savedPlan.selectedMajor,
  catalogId: "unt-2026-27",
};

// The planned courses are the ones marked inProgress without an in-progress
// transcript row: MATH 1710 is being taken now, so it isn't planned.
export const schedule = {
  institutionId: "unt",
  termId: "spring-2027",
  name: "Main",
  courses: ["CSCE 1040", "MATH 1720"],
  selectedSections: savedPlan.selectedSections,
  lockedSections: savedPlan.lockedSections,
  autoPlanned: coursePlan.autoPlanned,
  lastAuto: coursePlan.lastAuto,
};

export const preferences = {
  institutionId: "unt",
  goal: savedPlan.optimization,
  constraints: savedPreferences.constraints,
  weights: savedPreferences.weights,
};

export const version = {
  institutionId: "unt",
  scheduleId: "schedule-main",
  reason: "before-auto",
  schedule,
};
