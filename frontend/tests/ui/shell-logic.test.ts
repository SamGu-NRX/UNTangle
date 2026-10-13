import { describe, expect, test } from "bun:test";
import { courseHref, searchCourses } from "@/components/shell/course-search";
import { hasStartedPlan, type PlanProgress } from "@/components/shell/home-entry";
import { chipStatusLabel, chipTone } from "@/components/shell/plan-status";
import { shellModeFor, viewForPath } from "@/components/shell/routes";
import { SAVE_LABELS, type PlannerSaveStatus } from "@/components/planner-provider";

describe("shell routes", () => {
  test("sign-in, password reset, print and /dev render without the shell", () => {
    for (const path of ["/auth", "/forgot-password", "/schedule/print", "/dev/controls"]) {
      expect(shellModeFor(path)).toBe("bare");
    }
  });

  test("every view and library route renders inside the shell", () => {
    for (const path of ["/", "/courses", "/courses/import", "/courses/CSCE/2100", "/schedule", "/map", "/plans", "/about", "/instructors/42"]) {
      expect(shellModeFor(path)).toBe("app");
    }
  });

  test("prefixes match whole segments only", () => {
    expect(shellModeFor("/authors")).toBe("app");
    expect(shellModeFor("/developer")).toBe("app");
    expect(viewForPath("/mapping")).toBeNull();
  });

  test("routes map to the three views; / is the Courses entry", () => {
    expect(viewForPath("/")).toBe("courses");
    expect(viewForPath("/courses/import")).toBe("courses");
    expect(viewForPath("/schedule")).toBe("week");
    expect(viewForPath("/map")).toBe("map");
    expect(viewForPath("/plans")).toBeNull();
  });
});

describe("plan chip", () => {
  test("every save status maps to a dot tone", () => {
    const expected: Record<PlannerSaveStatus, string> = {
      saved: "saved",
      saving: "saving",
      pending: "saving",
      "not-saved": "error",
      failed: "error",
      "signed-out": "error",
    };
    for (const [status, tone] of Object.entries(expected)) {
      expect(chipTone(status as PlannerSaveStatus)).toBe(tone as ReturnType<typeof chipTone>);
    }
  });

  test("status labels drop the trailing ellipsis except while saving", () => {
    expect(chipStatusLabel("saving", SAVE_LABELS.saving)).toBe("Saving…");
    expect(chipStatusLabel("failed", SAVE_LABELS.failed)).toBe("Saving failed");
    expect(chipStatusLabel("not-saved", SAVE_LABELS["not-saved"])).toBe("Not saved");
    expect(chipStatusLabel("saved", SAVE_LABELS.saved)).toBe("Saved");
  });
});

describe("course search", () => {
  const catalog = [
    { code: "ANTH 1010", title: "Introduction to Anthropology", creditHours: 3 },
    { code: "CSCE 2100", title: "Computing Foundations I", creditHours: 3 },
    { code: "CSCE 3110", title: "Data Structures and Algorithms", creditHours: 3 },
    { code: "CSCE 4110", title: "Algorithms", creditHours: 3 },
  ];

  test("code matches rank first, with or without the space", () => {
    expect(searchCourses(catalog, "csce21").map((r) => r.code)).toEqual(["CSCE 2100"]);
    expect(searchCourses(catalog, "CSCE 3").map((r) => r.code)).toEqual(["CSCE 3110"]);
  });

  test("title prefix beats a title containing the words", () => {
    expect(searchCourses(catalog, "algorithms").map((r) => r.code)).toEqual(["CSCE 4110", "CSCE 3110"]);
    expect(searchCourses(catalog, "data alg").map((r) => r.code)).toEqual(["CSCE 3110"]);
  });

  test("empty queries return nothing and results carry credits", () => {
    expect(searchCourses(catalog, "   ")).toEqual([]);
    expect(searchCourses(catalog, "anth")[0]).toMatchObject({ id: "ANTH 1010", meta: "3 cr" });
  });

  test("courseHref matches the course detail route", () => {
    expect(courseHref("CSCE 2100")).toBe("/courses/CSCE/2100");
  });
});

describe("first visit vs returning student", () => {
  const defaults = {
    courseStatuses: { "CSCE 1030": "completed", "MATH 1710": "notTaken" } satisfies PlanProgress["courseStatuses"],
    selectedSections: { "CSCE 1030": "CSCE1030-001" },
    lockedSections: {},
    optimization: "clusterMorning",
  };
  const fresh: PlanProgress = {
    selectedMajor: null,
    transcriptRecords: [],
    courseStatuses: { ...defaults.courseStatuses },
    selectedSections: { ...defaults.selectedSections },
    lockedSections: {},
    optimization: defaults.optimization,
  };

  test("the seeded state alone is a first visit", () => {
    expect(hasStartedPlan(fresh, defaults)).toBe(false);
  });

  test("a chosen major, an import or a changed status counts as started", () => {
    expect(hasStartedPlan({ ...fresh, selectedMajor: "computer-science" }, defaults)).toBe(true);
    expect(hasStartedPlan({ ...fresh, transcriptRecords: [{ code: "CSCE 1030" }] }, defaults)).toBe(true);
    expect(hasStartedPlan({ ...fresh, courseStatuses: { ...fresh.courseStatuses, "MATH 1710": "inProgress" } }, defaults)).toBe(true);
    expect(hasStartedPlan({ ...fresh, courseStatuses: { "CSCE 1030": "notTaken" } }, defaults)).toBe(true);
  });

  test("section, lock and optimization edits alone count as started", () => {
    expect(hasStartedPlan({ ...fresh, selectedSections: { "CSCE 1030": "CSCE1030-003" } }, defaults)).toBe(true);
    expect(hasStartedPlan({ ...fresh, lockedSections: { "CSCE 1030": "CSCE1030-001" } }, defaults)).toBe(true);
    expect(hasStartedPlan({ ...fresh, optimization: "compact" }, defaults)).toBe(true);
  });

  test("seed sections and a missing lock map are still a first visit", () => {
    expect(hasStartedPlan({ ...fresh, lockedSections: undefined }, defaults)).toBe(false);
  });

  test("the real seed, normalised, is a first visit", async () => {
    const { getInitialPlannerState } = await import("@/lib/planner");
    expect(hasStartedPlan(getInitialPlannerState(), getInitialPlannerState())).toBe(false);
  });
});

describe("plan menu", () => {
  const base = { saveFailed: false, isRegistered: false, recent: [], onRetry: () => {} };

  test("Save a copy is disabled, and refuses, until the plan has loaded", async () => {
    const { planMenuEntries } = await import("@/components/shell/PlanChip");
    let copies = 0;
    const entries = planMenuEntries({ ...base, planLoaded: false, onCopy: () => (copies += 1) });
    const copy = entries.find((e) => e.id === "copy");
    expect(copy && "disabled" in copy ? copy.disabled : undefined).toBe(true);
    if (copy && "onSelect" in copy) copy.onSelect?.();
    expect(copies).toBe(0);

    const ready = planMenuEntries({ ...base, planLoaded: true, onCopy: () => (copies += 1) }).find((e) => e.id === "copy");
    expect(ready && "disabled" in ready ? ready.disabled : undefined).toBe(false);
    if (ready && "onSelect" in ready) ready.onSelect?.();
    expect(copies).toBe(1);
  });
});
