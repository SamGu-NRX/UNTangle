/**
 * The provider's sectionPlan carries instructor evidence: a planned course's
 * history is fetched once (real provenance only) and the displayed
 * recommendation tie-breaks on it — the same evidence Auto's request carries.
 * From the round-5 finding that the provider's resolveSectionPlan call dropped
 * the map, so the recommendations the page shows tie-breaked on section id.
 */
import { afterAll, afterEach, beforeAll, beforeEach, mock, test } from "bun:test";
import type { GradeData } from "@/lib/grades";
import type { CourseHistory, HistoryResult, HistoryTerm } from "@/lib/grades-history/types";
import type { CourseOptions, SectionCatalog } from "@/lib/planner-sections";
import type { SectionStore } from "@/lib/section-store";
import type { CourseSections, Meeting, RealProvenance, Section } from "@/lib/sections/model";
import { installDom, mountPlanner, removeDom, setSession, waitFor } from "./test-dom";

mock.module("@/lib/grades-history/course-history", () => ({
  COURSE_HISTORY_TIMEOUT_MS: 10_000,
  // Every planned course reads the same history: Doe pools to 326 hundredths,
  // Khan to 200 — both accepted, so the course's evidence counts and the
  // stronger instructor must win the cost tie.
  fetchCourseHistory: (): Promise<HistoryResult<CourseHistory>> =>
    Promise.resolve({ status: "ok", source: "untgrades.app", data: HISTORY }),
  fetchMissingHistories: (
    fetchable: ReadonlySet<string>,
    cached: Map<string, Promise<HistoryResult<CourseHistory>>>,
    fetchOne: (code: string) => Promise<HistoryResult<CourseHistory>>,
  ) => {
    for (const code of fetchable) if (!cached.has(code)) cached.set(code, fetchOne(code));
    for (const code of [...cached.keys()]) if (!fetchable.has(code)) cached.delete(code);
    return cached;
  },
}));

// --- grade history: two confident instructors, three graded sections each ---

const DOE_COUNTS = { A: 30, B: 10, C: 5, D: 3, F: 2 };
const KHAN_COUNTS = { A: 10, B: 10, C: 10, D: 10, F: 10 }; // mean 2.0 → 200

/** Letter counts to the full GradeData shape: pass/fail/withdraw columns sit at zero here. */
function gradeData(counts: Record<string, number>): GradeData {
  return {
    gradeA: counts.A ?? 0,
    gradeB: counts.B ?? 0,
    gradeC: counts.C ?? 0,
    gradeD: counts.D ?? 0,
    gradeF: counts.F ?? 0,
    gradeP: 0,
    gradeNP: 0,
    gradeW: 0,
    gradeWF: 0,
    gradeI: 0,
    gradePR: 0,
    gradeNPR: 0,
    gradeZ: 0,
    gradeSuppressed: 0,
    totalEnroll: Object.values(counts).reduce((sum, n) => sum + n, 0),
  };
}

function pastSection(sectionNumber: string, instructorId: string, firstName: string, lastName: string, counts: Record<string, number>) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const grades = gradeData(counts);
  return { sectionNumber, instructor: { id: instructorId, firstName, lastName, name: `${firstName} ${lastName}` }, counts, total, grades };
}

const HISTORY: CourseHistory = {
  course: { subject: "CSCE", number: "1045", title: "Introduction to Computing" },
  terms: [
    { year: "2024", term: "Fall", counts: DOE_COUNTS, total: 50, grades: gradeData(DOE_COUNTS), sections: [pastSection("001", "j-doe", "Jane", "Doe", DOE_COUNTS)] },
    { year: "2025", term: "Fall", counts: KHAN_COUNTS, total: 50, grades: gradeData(KHAN_COUNTS), sections: [pastSection("001", "r-khan", "Ray", "Khan", KHAN_COUNTS)] },
    { year: "2026", term: "Spring", counts: DOE_COUNTS, total: 100, grades: gradeData(DOE_COUNTS), sections: [pastSection("001", "j-doe", "Jane", "Doe", DOE_COUNTS), pastSection("002", "r-khan", "Ray", "Khan", KHAN_COUNTS)] },
    { year: "2026", term: "Fall", counts: DOE_COUNTS, total: 100, grades: gradeData(DOE_COUNTS), sections: [pastSection("001", "j-doe", "Jane", "Doe", DOE_COUNTS), pastSection("002", "r-khan", "Ray", "Khan", KHAN_COUNTS)] },
  ] as HistoryTerm[],
  sectionCount: 5,
  counts: { A: 80, B: 40, C: 25, D: 23, F: 22 },
  total: 250,
  grades: gradeData({ A: 80, B: 40, C: 25, D: 23, F: 22 }),
  gpa: 2.86,
};

// --- one real-provenance course, two identical meetings, different instructors ---

function meeting(): Meeting {
  return {
    room: "204", buildingCode: "NTDP", buildingId: "ntdp", buildingName: "Discovery Park", kind: "building", offCampus: false,
    day: "Mon", startMinutes: 540, endMinutes: 600, dates: { start: null, end: null, raw: "" },
    instructor: { display: "Jane Doe", raw: "Doe,Jane" }, async: false, tba: false,
  };
}

function section(id: string, raw: string, display: string): Section {
  return {
    id, term: "spring-2027", courseCode: "CSCE 1045", sectionCode: "001", classNumbers: ["12345"], option: "1",
    instructor: { display, raw }, seats: { open: 25, total: 40 }, status: "open", rawStatus: "Open",
    session: { label: "Full Term", dates: { start: null, end: null, raw: "" } }, components: [],
    meetings: [meeting()], online: false, async: false, tba: false,
  };
}

const realProvenance: RealProvenance = { kind: "real", source: "vsb.untgrades.app", updatedAt: "2026-10-15T12:00:00Z", note: "" };

// The weak instructor holds the lower id, so the id tie-break keeps it when
// no evidence is supplied; accepted evidence must move the pick to Doe.
const WEAK_ID = "aa-csce-1045-100";
const STRONG_ID = "zz-csce-1045-900";
const sections = [section(WEAK_ID, "Khan,Ray", "Ray Khan"), section(STRONG_ID, "Doe,Jane", "Jane Doe")];

const catalog: SectionCatalog = () =>
  ({
    status: "ready",
    result: {
      term: "202710", courseCode: "CSCE 1045", status: "ok", availability: "sections", diagnostic: null,
      provenance: realProvenance, checkedAt: "2026-10-15T12:00:00Z", sections,
    } as CourseSections,
  }) as CourseOptions;

const store: SectionStore = { catalog, ensure: () => {}, version: () => 1, subscribe: () => () => {} };

const mounted: Array<() => Promise<void>> = [];
beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});
beforeEach(() => {
  window.localStorage.clear();
  setSession(null);
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
});

test("the displayed recommendation tie-breaks on instructor evidence", async () => {
  const planner = await mountPlanner(undefined, store);
  mounted.push(planner.unmount);
  await planner.get().afterHydration();
  await planner.run((p) =>
    p.updateCoursePlan(({ courseStatuses, coursePlan }) => ({
      courseStatuses: { ...courseStatuses, "CSCE 1045": "inProgress" as const },
      coursePlan,
    })),
  );
  await waitFor(() => planner.get().sectionPlan.selections["CSCE 1045"] === STRONG_ID, "evidence moves the recommendation to the stronger instructor");
});
