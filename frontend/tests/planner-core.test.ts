/**
 * Behavior-contract tests for frontend/src/lib/planner.ts.
 *
 * Every assertion describes behavior that exists in the CURRENT implementation
 * and must keep holding through the hardening work — this file is the
 * regression contract. All courses/sections come from the real seed data;
 * the only derived fixtures are adjacency probes (see the optionsConflict
 * suite) built from seed sections by shifting meeting times.
 */
import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import {
  doesCourseSatisfyPrerequisite,
  formatTime,
  getInitialPlannerState,
  getMissingPrerequisites,
  mergeTranscriptRecords,
  normalizePlannerState,
  readPlannerStateFromSessionStorage,
  recommendSections,
  resolveSectionPlan,
  summarizeCompletedCourses,
  summarizeCredits,
  summarizeInProgressCourses,
  summarizeMajorProgress,
  summarizeNotTakenCourses,
  writePlannerStateToSessionStorage,
} from "@/lib/planner";
import { optionsConflict, sampleOption } from "@/lib/planner-sections";
import { courses, defaultPlannerState, majors, sections } from "@/lib/seed-data";
import type { PlannerState, TranscriptCourseRecord } from "@/lib/types";

const SESSION_KEY = "untangle-planner-state";

function sectionById(id: string) {
  const section = sections.find((s) => s.id === id);
  if (!section) {
    throw new Error(`seed data is missing section ${id}`);
  }
  return section;
}

// Tests simulate values that arrive from parsed JSON and may be malformed;
// the cast is the point of the test, not a type lie.
function stateWith(over: Record<string, unknown>): PlannerState {
  return { ...defaultPlannerState, ...over } as PlannerState;
}

function makeRecord(over: Partial<TranscriptCourseRecord>): TranscriptCourseRecord {
  return {
    id: "",
    code: "",
    title: "",
    term: "",
    grade: "A",
    credits: 3,
    sourceKind: "unt",
    confidence: 0.9,
    rationale: "",
    duplicateExcluded: false,
    appliedStatus: "completed",
    prerequisiteSatisfied: true,
    reviewRequired: false,
    ...over,
  };
}

describe("normalizePlannerState", () => {
  it("fills absent fields from defaults (normalizing {} yields the initial state)", () => {
    expect(normalizePlannerState({} as PlannerState)).toEqual(getInitialPlannerState());
  });

  it("merges courseStatuses defaults under the incoming state", () => {
    const merged = normalizePlannerState(
      stateWith({ courseStatuses: { "MATH 1710": "inProgress" } }),
    );
    expect(merged.courseStatuses["MATH 1710"]).toBe("inProgress"); // override wins
    expect(merged.courseStatuses["CSCE 1030"]).toBe("notTaken"); // default survives
    expect(merged.courseStatuses["CSCE 1040"]).toBe("notTaken"); // default survives
  });

  it("starts a fresh guest with nothing done or planned", () => {
    expect(Object.values(getInitialPlannerState().courseStatuses).every((status) => status === "notTaken")).toBe(true);
  });

  it("preserves valid selections for active (inProgress) courses with real section ids", () => {
    const state = stateWith({
      courseStatuses: { "MATH 1710": "inProgress", "CSCE 1030": "inProgress" },
      // MATH 1710-001 (MWF 10:00–10:50) and CSCE 1030-001 (MWF 08:00–08:50) do not overlap.
      selectedSections: { "MATH 1710": "math-1710-001", "CSCE 1030": "csce-1030-001" },
    });
    expect(normalizePlannerState(state).selectedSections).toEqual({
      "MATH 1710": "math-1710-001",
      "CSCE 1030": "csce-1030-001",
    });
  });

  it("drops selections for inactive or unknown courses", () => {
    const state = stateWith({
      courseStatuses: { "MATH 1710": "inProgress", "CSCE 1030": "notTaken" },
      selectedSections: {
        "MATH 1710": "math-1710-001", // active course, real section -> kept
        "CSCE 1030": "csce-1030-001", // notTaken -> dropped
        "NOPE 0001": "math-1710-001", // unknown course -> dropped
      },
    });
    const selected = normalizePlannerState(state).selectedSections;
    expect(selected["MATH 1710"]).toBe("math-1710-001");
    expect(selected["CSCE 1030"]).toBeUndefined();
    expect(selected["NOPE 0001"]).toBeUndefined();
  });

  // A pick that no longer resolves is kept and flagged, never swapped for a recommendation.
  it("keeps a pick whose section id does not exist; the plan marks it needs-review", () => {
    const state = normalizePlannerState(
      stateWith({
        courseStatuses: { "MATH 1710": "inProgress" },
        selectedSections: { "MATH 1710": "math-1710-999" },
      }),
    );
    expect(state.selectedSections["MATH 1710"]).toBe("math-1710-999");
    const plan = resolveSectionPlan(state);
    expect(plan.selections["MATH 1710"]).toBe("math-1710-999");
    expect(plan.courses.find((course) => course.code === "MATH 1710")).toMatchObject({ state: "needs-review", section: null });
  });

  it("keeps a pick whose section id belongs to a different course; the plan marks it needs-review", () => {
    const plan = resolveSectionPlan(
      normalizePlannerState(
        stateWith({
          courseStatuses: { "MATH 1710": "inProgress" },
          selectedSections: { "MATH 1710": "csce-1030-001" }, // real section, wrong course
        }),
      ),
    );
    expect(plan.selections["MATH 1710"]).toBe("csce-1030-001");
    expect(plan.courses.find((course) => course.code === "MATH 1710")?.state).toBe("needs-review");
  });

  it("recommends a section for a planned course without a pick, without saving it as a pick", () => {
    const state = normalizePlannerState(stateWith({ courseStatuses: { "MATH 1710": "inProgress" } }));
    expect(state.selectedSections).toEqual({});
    const course = resolveSectionPlan(state).courses.find((entry) => entry.code === "MATH 1710");
    expect(course?.state).toBe("recommended");
    expect(course?.section?.courseCode).toBe("MATH 1710");
  });

  it("coerces an invalid selectedMajor to null and keeps a valid one", () => {
    expect(
      normalizePlannerState(stateWith({ selectedMajor: "underwater-baskets" })).selectedMajor,
    ).toBeNull();
    expect(normalizePlannerState(stateWith({ selectedMajor: "math" })).selectedMajor).toBe("math");
  });

  it("coerces non-array transcriptRecords to an empty array", () => {
    expect(normalizePlannerState(stateWith({ transcriptRecords: "nope" })).transcriptRecords).toEqual([]);
  });
});

describe("recommendSections", () => {
  it("is deterministic across repeated calls with the same arguments", () => {
    const codes = ["CSCE 1030", "CSCE 1040", "MATH 1710"];
    const first = recommendSections("clusterMorning", codes);
    expect(recommendSections("clusterMorning", codes)).toEqual(first);
    expect(recommendSections("clusterMorning", codes)).toEqual(first);
  });

  it("returns selections only for requested course codes, each belonging to its course", () => {
    const result = recommendSections("clusterMorning", ["CSCE 1030", "CSCE 1040", "NOPE 9999"]);
    expect(Object.keys(result).sort()).toEqual(["CSCE 1030", "CSCE 1040"]);
    for (const [code, sectionId] of Object.entries(result)) {
      expect(sectionById(sectionId).courseCode).toBe(code);
    }
  });

  it("preserves conflict-free fixed selections exactly", () => {
    const result = recommendSections(
      "clusterMorning",
      ["CSCE 1030", "CSCE 1040"],
      // CSCE 1030-001: MWF 08:00–08:50; CSCE 1040-005: MWF 12:00–12:50 — no overlap.
      { "CSCE 1030": "csce-1030-001", "CSCE 1040": "csce-1040-005" },
    );
    expect(result).toEqual({ "CSCE 1030": "csce-1030-001", "CSCE 1040": "csce-1040-005" });
  });

  // Current behavior (read from src/lib/planner.ts): when every requested course
  // has a fixed selection there are no free section options left, so the
  // optimizer walk returns immediately and fixed sections are never
  // conflict-checked against each other. A fully fixed conflicting pair is
  // therefore returned as-is — fixed sections win over conflict avoidance, and
  // surfacing the clash is left to the UI.
  it("keeps both sections of a fully fixed conflicting pair (fixed wins over conflicts)", () => {
    const result = recommendSections(
      "clusterMorning",
      ["CSCE 1030", "CSCE 1040"],
      // Both are MWF 08:00–08:50 — a genuine conflict that is still returned.
      { "CSCE 1030": "csce-1030-001", "CSCE 1040": "csce-1040-004" },
    );
    expect(result).toEqual({ "CSCE 1030": "csce-1030-001", "CSCE 1040": "csce-1040-004" });
  });
});

describe("optionsConflict", () => {
  const option = (id: string) => {
    const found = sampleOption(id);
    if (!found) throw new Error(`seed data is missing section ${id}`);
    return found;
  };

  it("detects identical-time same-day meetings", () => {
    // CSCE 1030-001 and CSCE 1040-004 both meet MWF 08:00–08:50.
    expect(optionsConflict(option("csce-1030-001"), option("csce-1040-004"))).toBe(true);
  });

  it("detects partial same-day overlaps", () => {
    // CSCE 1030-002: MWF 13:30–14:50 vs CSCE 1040-001: MWF 14:00–14:50.
    expect(optionsConflict(option("csce-1030-002"), option("csce-1040-001"))).toBe(true);
  });

  it("never conflicts across different days", () => {
    // CSCE 1030-001 meets Mon/Wed/Fri; CSCE 1040-006 meets Tue/Thu.
    expect(optionsConflict(option("csce-1030-001"), option("csce-1040-006"))).toBe(false);
  });

  // The seed catalog has no adjacent meeting pair (back-to-back sections keep a
  // 10-minute gap), so this derives one from a real section by shifting only
  // the meeting start/end. It pins the strict-inequality boundary of the
  // overlap predicate: end === start must NOT count as a conflict.
  it("treats adjacent (end == start) meetings as non-conflicting", () => {
    const base = option("csce-1030-001"); // MWF 08:00–08:50
    const later = option("csce-1040-005"); // MWF 12:00–12:50
    const shifted = (start: number) => ({
      ...later,
      meetings: later.meetings.map((m) => ({ ...m, startMinutes: start, endMinutes: start + 50 })),
    });
    expect(optionsConflict(base, shifted(8 * 60 + 50))).toBe(false);
    expect(optionsConflict(base, shifted(8 * 60 + 49))).toBe(true);
  });
});

describe("prerequisite checks", () => {
  // Data contract: this documents the seed shape the behavioral tests rely on.
  it("MATH 1720 lists exactly MATH 1710 as its prerequisite in seed data", () => {
    const math1720 = courses.find((c) => c.code === "MATH 1720");
    expect(math1720?.prerequisites).toEqual(["MATH 1710"]);
  });

  it("reports a prerequisite missing when the course is not completed", () => {
    expect(getMissingPrerequisites("MATH 1720", { "MATH 1710": "notTaken" })).toEqual(["MATH 1710"]);
    expect(doesCourseSatisfyPrerequisite("MATH 1710", { "MATH 1710": "notTaken" })).toBe(false);
  });

  it("reports no missing prerequisites when the course is completed in courseStatuses", () => {
    expect(getMissingPrerequisites("MATH 1720", { "MATH 1710": "completed" })).toEqual([]);
    expect(doesCourseSatisfyPrerequisite("MATH 1710", { "MATH 1710": "completed" })).toBe(true);
  });

  it("lets completed transcript evidence with prerequisiteSatisfied=false override a completed status", () => {
    const records = [
      makeRecord({
        id: "t1",
        code: "MATH 1710",
        term: "Fall 2025",
        appliedStatus: "completed",
        prerequisiteSatisfied: false,
      }),
    ];
    expect(getMissingPrerequisites("MATH 1720", { "MATH 1710": "completed" }, records)).toEqual(["MATH 1710"]);
    expect(doesCourseSatisfyPrerequisite("MATH 1710", { "MATH 1710": "completed" }, records)).toBe(false);
  });

  it("keeps the prerequisite satisfied when completed evidence is marked prerequisiteSatisfied=true", () => {
    const records = [
      makeRecord({
        id: "t1",
        code: "MATH 1710",
        term: "Fall 2025",
        appliedStatus: "completed",
        prerequisiteSatisfied: true,
      }),
    ];
    expect(getMissingPrerequisites("MATH 1720", { "MATH 1710": "completed" }, records)).toEqual([]);
    expect(doesCourseSatisfyPrerequisite("MATH 1710", { "MATH 1710": "completed" }, records)).toBe(true);
  });

  it("satisfies the prerequisite when any completed evidence record is marked satisfied", () => {
    const records = [
      makeRecord({ id: "t1", code: "MATH 1710", term: "Fall 2025", appliedStatus: "completed", prerequisiteSatisfied: false }),
      makeRecord({ id: "t2", code: "MATH 1710", term: "Spring 2026", appliedStatus: "completed", prerequisiteSatisfied: true }),
    ];
    expect(getMissingPrerequisites("MATH 1720", { "MATH 1710": "completed" }, records)).toEqual([]);
  });

  it("ignores transcript evidence whose appliedStatus is not completed", () => {
    const records = [
      makeRecord({ id: "t1", code: "MATH 1710", term: "Fall 2025", appliedStatus: "inProgress", prerequisiteSatisfied: false }),
    ];
    // Evidence only overrides when appliedStatus is "completed"; anything else
    // is invisible to the check, so courseStatuses alone decide.
    expect(doesCourseSatisfyPrerequisite("MATH 1710", { "MATH 1710": "completed" }, records)).toBe(true);
    expect(getMissingPrerequisites("MATH 1720", { "MATH 1710": "completed" }, records)).toEqual([]);
  });

  it("requires a completed courseStatuses entry even when transcript evidence looks satisfied", () => {
    const records = [
      makeRecord({ id: "t1", code: "MATH 1710", term: "Fall 2025", appliedStatus: "completed", prerequisiteSatisfied: true }),
    ];
    expect(doesCourseSatisfyPrerequisite("MATH 1710", { "MATH 1710": "notTaken" }, records)).toBe(false);
    expect(getMissingPrerequisites("MATH 1720", { "MATH 1710": "notTaken" }, records)).toEqual(["MATH 1710"]);
  });
});

describe("mergeTranscriptRecords", () => {
  it("dedupes by id with the last occurrence winning and leaves ids unique", () => {
    const current = [makeRecord({ id: "t1", code: "MATH 1710", term: "Fall 2025", grade: "A" })];
    const incoming = [
      makeRecord({ id: "t2", code: "CSCE 1030", term: "Spring 2026" }),
      makeRecord({ id: "t1", code: "MATH 1710", term: "Spring 2026", grade: "B" }), // duplicate id
      makeRecord({ id: "t3", code: "CSCE 1030", term: "Fall 2024" }),
    ];

    const merged = mergeTranscriptRecords(current, incoming);

    const ids = merged.map((r) => r.id);
    expect(new Set(ids).size).toBe(merged.length);
    expect(merged).toHaveLength(3);
    const duplicate = merged.find((r) => r.id === "t1");
    expect(duplicate?.grade).toBe("B"); // last occurrence (incoming) replaced the original
    expect(duplicate?.term).toBe("Spring 2026");
  });

  // The result is ordered by course code, then by term. Term ordering is
  // intentionally NOT asserted: the term sort policy is changing to
  // chronological, so only code grouping/order is pinned here.
  it("orders the merged list by course code (term order intentionally unasserted)", () => {
    const incoming = [
      makeRecord({ id: "t1", code: "MATH 1710", term: "Fall 2025" }),
      makeRecord({ id: "t2", code: "CSCE 1030", term: "Spring 2026" }),
      makeRecord({ id: "t3", code: "CSCE 1030", term: "Fall 2024" }),
    ];

    const merged = mergeTranscriptRecords([], incoming);
    const codes = merged.map((r) => r.code);
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
  });
});

describe("summaries", () => {
  // Data contract: documents the seed shape the behavioral tests rely on.
  it("the CS major core is the expected five-course list", () => {
    const csMajor = majors.find((m) => m.id === "cs");
    expect(csMajor?.coreCourseCodes).toEqual([
      "CSCE 1030",
      "CSCE 1040",
      "CSCE 2100",
      "MATH 1710",
      "MATH 1720",
    ]);
  });

  it("counts statuses from the state itself and credits from in-progress courses", () => {
    const state = stateWith({
      courseStatuses: {
        ...defaultPlannerState.courseStatuses,
        "CSCE 1030": "completed",
        "CSCE 1040": "completed",
        "MATH 1710": "inProgress",
      },
    });
    expect(summarizeCompletedCourses(state)).toBe(2);
    expect(summarizeInProgressCourses(state)).toBe(1);
    expect(summarizeNotTakenCourses(state)).toBe(653); // 656 catalog courses minus 3 accounted for
    // Credits summarize in-progress work only; MATH 1710 carries 3 credit hours.
    expect(summarizeCredits(state)).toBe(3);
  });

  it("summarizes major progress from the state's selectedMajor", () => {
    const state = stateWith({
      selectedMajor: "cs",
      courseStatuses: {
        ...defaultPlannerState.courseStatuses,
        "CSCE 1030": "completed",
        "CSCE 1040": "completed",
      },
    });
    expect(summarizeMajorProgress(state)).toEqual({ completed: 2, total: 5, pct: 40 });
    expect(summarizeMajorProgress(stateWith({ selectedMajor: "other" }))).toEqual({
      completed: 0,
      total: 0,
      pct: 0,
    });
    expect(summarizeMajorProgress(stateWith({ selectedMajor: null }))).toEqual({
      completed: 0,
      total: 0,
      pct: 0,
    });
  });
});

describe("session storage", () => {
  // DOM lib types declare a global `window`, so cast through unknown to swap
  // it for happy-dom's Window.
  const globalWithWindow = globalThis as unknown as { window?: Window | undefined };

  function withBrowserWindow(run: () => void) {
    globalWithWindow.window = new Window();
    try {
      run();
    } finally {
      delete globalWithWindow.window;
    }
  }

  it("round-trips state through sessionStorage after normalization", () => {
    withBrowserWindow(() => {
      // Malformed major/transcript fields exercise normalization on write and read.
      const state = stateWith({
        selectedMajor: "underwater-baskets",
        transcriptRecords: "nope",
        courseStatuses: { ...defaultPlannerState.courseStatuses, "MATH 1710": "inProgress" },
        selectedSections: { "MATH 1710": "math-1710-001" },
      });

      writePlannerStateToSessionStorage(state);
      expect(globalWithWindow.window?.sessionStorage.getItem(SESSION_KEY)).toBeString();

      const restored = readPlannerStateFromSessionStorage();
      expect(restored).not.toBeNull();
      expect(restored).toEqual(normalizePlannerState(state));
    });
  });

  it("returns null for corrupted JSON", () => {
    withBrowserWindow(() => {
      globalWithWindow.window?.sessionStorage.setItem(SESSION_KEY, "{not valid json");
      expect(readPlannerStateFromSessionStorage()).toBeNull();
    });
  });

  it("returns null when nothing is stored", () => {
    withBrowserWindow(() => {
      expect(readPlannerStateFromSessionStorage()).toBeNull();
    });
  });

  it("reads null and writes without throwing when window is undefined (SSR)", () => {
    expect(globalWithWindow.window).toBeUndefined();
    expect(readPlannerStateFromSessionStorage()).toBeNull();
    expect(() => writePlannerStateToSessionStorage(getInitialPlannerState())).not.toThrow();
  });
});

describe("formatTime", () => {
  it("formats known 24-hour values as 12-hour clock strings", () => {
    expect(formatTime("08:00")).toBe("8:00 AM");
    expect(formatTime("13:30")).toBe("1:30 PM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatTime("00:15")).toBe("12:15 AM");
  });
});
