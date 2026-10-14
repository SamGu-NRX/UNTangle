import { describe, expect, test } from "bun:test";
import { courseHref, searchCourses } from "@/components/shell/course-search";
import { hasStartedPlan, landing, readClock, type LandingInput, type PlanProgress } from "@/components/shell/home-entry";
import { chipStatusLabel, chipTone } from "@/components/shell/plan-status";
import { lensForPath, shellModeFor, withQuery } from "@/components/shell/routes";
import { SAVE_LABELS, type PlannerSaveStatus } from "@/components/planner-provider";

describe("shell routes", () => {
  test("sign-in, password reset, print and /dev render without the shell", () => {
    for (const path of ["/auth", "/forgot-password", "/schedule/print", "/dev/controls"]) {
      expect(shellModeFor(path)).toBe("bare");
    }
  });

  test("every lens and library route renders inside the shell", () => {
    for (const path of ["/", "/courses", "/courses/import", "/courses/CSCE/2100", "/schedule", "/day", "/schedules", "/about", "/instructors/42"]) {
      expect(shellModeFor(path)).toBe("app");
    }
  });

  test("prefixes match whole segments only", () => {
    expect(shellModeFor("/authors")).toBe("app");
    expect(shellModeFor("/developer")).toBe("app");
    expect(lensForPath("/days")).toBeNull();
    expect(lensForPath("/schedules")).toBeNull();
  });

  test("the /map and /plans redirects keep the query", () => {
    expect(withQuery("/day", {})).toBe("/day");
    expect(withQuery("/day", { campus: "unt" })).toBe("/day?campus=unt");
    expect(withQuery("/schedules", { a: ["1", "2"], b: undefined, q: "x y&z" })).toBe("/schedules?a=1&a=2&q=x+y%26z");
  });

  test("routes map to the three lenses; / is the Courses entry", () => {
    expect(lensForPath("/")).toBe("courses");
    expect(lensForPath("/courses/import")).toBe("courses");
    expect(lensForPath("/schedule")).toBe("week");
    expect(lensForPath("/day")).toBe("day");
    expect(lensForPath("/schedules")).toBeNull();
  });
});

describe("landing", () => {
  // Spring 2027 dates; 2027-02-03 is a Wednesday.
  const term = { start: "2027-01-19", end: "2027-05-07" };
  const meetings = [
    { day: "Wed", end: "09:50" },
    { day: "Wed", end: "14:20" },
    { day: "Thu", end: "11:50" },
  ] as const;
  const base: LandingInput = {
    started: true,
    phone: true,
    lastLens: "week",
    clock: { date: "2027-02-03", weekday: "Wed", minutes: 8 * 60 + 37 },
    term,
    meetings,
  };

  test("in session with a class still ahead today, the phone opens on Day", () => {
    expect(landing(base)).toBe("day");
    // A class that has started but not ended still counts.
    expect(landing({ ...base, clock: { ...base.clock, minutes: 14 * 60 } })).toBe("day");
  });

  test("once today's last class has ended, the last lens used", () => {
    expect(landing({ ...base, clock: { ...base.clock, minutes: 14 * 60 + 20 } })).toBe("week");
  });

  test("on a weekend with no class that day, the last lens used; with one ahead, Day", () => {
    const saturday = { date: "2027-02-06", weekday: "Sat", minutes: 9 * 60 } as const;
    expect(landing({ ...base, clock: saturday })).toBe("week");
    expect(landing({ ...base, clock: saturday, meetings: [...meetings, { day: "Sat", end: "12:00" }] })).toBe("day");
  });

  test("outside the term, or with nothing scheduled today, the last lens used", () => {
    expect(landing({ ...base, clock: { ...base.clock, date: "2026-10-14" } })).toBe("week");
    expect(landing({ ...base, clock: { ...base.clock, date: "2027-05-12" } })).toBe("week");
    expect(landing({ ...base, meetings: [] })).toBe("week");
    expect(landing({ ...base, clock: { ...base.clock, weekday: "Fri" } })).toBe("week");
  });

  test("the term's first and last days are in session", () => {
    expect(landing({ ...base, clock: { ...base.clock, date: term.start } })).toBe("day");
    expect(landing({ ...base, clock: { ...base.clock, date: term.end } })).toBe("day");
  });

  test("desktop always reopens the last lens used", () => {
    expect(landing({ ...base, phone: false })).toBe("week");
  });

  test("with no lens used yet, Courses", () => {
    expect(landing({ ...base, phone: false, lastLens: null })).toBe("courses");
  });

  test("a first visit with no transcript goes to the import entry", () => {
    expect(landing({ ...base, started: false })).toBe("import");
  });

  test("readClock reads the local date, weekday and minutes", () => {
    expect(readClock(new Date(2027, 1, 3, 8, 37))).toEqual({ date: "2027-02-03", weekday: "Wed", minutes: 517 });
    expect(readClock(new Date(2027, 1, 7, 0, 5))).toEqual({ date: "2027-02-07", weekday: "Sun", minutes: 5 });
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
