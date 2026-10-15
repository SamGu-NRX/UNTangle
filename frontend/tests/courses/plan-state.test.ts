import { describe, expect, mock, test } from "bun:test";
import {
  buildScheduleEvents,
  getInitialPlannerState,
  getPlanningTermCourseCodes,
  normalizePlannerState,
  resolveSectionPlan,
  summarizeCredits,
} from "@/lib/planner";
import { validatePlannerStatePayload } from "@/lib/planner-validation";
import { workingStateFingerprint } from "@/lib/saved-plans/restore-adapter";
import { courseIdFromRoute } from "@/lib/course-route";
import { sampleTranscript } from "@/components/courses/model/sample-transcript";
import type { PlannerState } from "@/lib/types";

mock.module("@/components/courses/courses.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

const base = (patch: Partial<PlannerState>): PlannerState => ({ ...getInitialPlannerState(), ...patch });

describe("planning-term courses", () => {
  // ENGL 1320 is in progress on the sample transcript: the student is taking it now.
  const state = base({
    transcriptRecords: sampleTranscript,
    courseStatuses: {
      ...getInitialPlannerState().courseStatuses,
      "ENGL 1320": "inProgress",
      "MATH 1720": "inProgress",
      "CSCE 1010": "inProgress",
      "PHYS 1710": "inProgress",
      "HIST 2610": "inProgress",
      "CSCE 2610": "inProgress",
    },
  });

  test("inProgress with a current transcript row is Taking, not part of the plan", () => {
    const codes = getPlanningTermCourseCodes(state);
    expect(codes).not.toContain("ENGL 1320");
    expect(codes).toContain("MATH 1720");
  });

  test("Week, Map and the credit summary see only the planning term", () => {
    const planned = getPlanningTermCourseCodes(state);
    expect(summarizeCredits(state)).toBe(planned.length * 3);
    expect(buildScheduleEvents(resolveSectionPlan(normalizePlannerState(state))).some((event) => event.courseCode === "ENGL 1320")).toBe(false);
    expect(normalizePlannerState(state).selectedSections["ENGL 1320"]).toBeUndefined();
  });
});

describe("coursePlan travels with the plan", () => {
  const coursePlan = {
    manualCredit: ["ENGL 1320", "NOPE 9999"],
    autoPlanned: ["MATH 1720"],
    lastAuto: {
      id: "auto-1",
      at: "2026-10-13T12:00:00.000Z",
      major: "cs" as const,
      changes: [{ code: "MATH 1720", from: "notTaken" as const, to: "inProgress" as const }],
      autoPlannedBefore: [],
      summary: "Planned 1 for Spring 2027.",
      needsCheck: ["CSCE 2100"],
    },
  };

  test("normalize keeps well-formed facts for catalog courses and drops the rest", () => {
    const normalized = normalizePlannerState(base({ coursePlan }));
    expect(normalized.coursePlan).toEqual({ ...coursePlan, manualCredit: ["ENGL 1320"] });
  });

  test("a malformed Auto run is dropped rather than trusted", () => {
    const bad = { ...coursePlan, lastAuto: { ...coursePlan.lastAuto, changes: [{ code: "MATH 1720", from: "done", to: "inProgress" }] } };
    expect(normalizePlannerState(base({ coursePlan: bad as never })).coursePlan?.lastAuto).toBeNull();
  });

  test("plans saved before coursePlan existed load with an empty one", () => {
    expect(normalizePlannerState(base({})).coursePlan).toEqual({ manualCredit: [], autoPlanned: [], lastAuto: null });
  });

  test("a coursePlan change counts as an unsaved edit", () => {
    expect(workingStateFingerprint(base({ coursePlan }))).not.toBe(workingStateFingerprint(base({})));
  });

  test("the API rejects a coursePlan that is not an object", () => {
    const payload = { ...base({}), coursePlan: "yes" };
    expect(validatePlannerStatePayload(payload)).toMatchObject({ ok: false });
  });

  test("a fresh guest has nothing done or planned", () => {
    expect(Object.values(getInitialPlannerState().courseStatuses).every((status) => status === "notTaken")).toBe(true);
  });
});

describe("course deep-link codes", () => {
  test("accepts catalog codes in any case", () => {
    expect(courseIdFromRoute("csce", "1030")).toBe("CSCE 1030");
  });

  test("rejects malformed segments without throwing", () => {
    expect(courseIdFromRoute("%", "1030")).toBeNull();
    expect(courseIdFromRoute("CSCE", "abcd")).toBeNull();
    expect(courseIdFromRoute("CSCE", "%25")).toBeNull();
  });

  test("rejects codes the catalog does not carry", () => {
    expect(courseIdFromRoute("CSCE", "3010")).toBeNull();
  });
});

describe("course links", () => {
  test("a code outside the catalog renders as text, never as a link that empties the panel", async () => {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { CourseLink, CourseNavigationContext } = await import("@/components/courses/bits");
    const render = (known: boolean) =>
      renderToStaticMarkup(
        React.createElement(
          CourseNavigationContext.Provider,
          { value: { open: () => {}, isKnown: () => known } },
          React.createElement(CourseLink, { id: "CSCE 3010" }),
        ),
      );
    expect(render(false)).not.toContain("<a");
    expect(render(false)).toContain("not in UNTangle&#x27;s catalog");
    expect(render(true)).toContain('href="/courses/CSCE/3010"');
  });
});

describe("Import transcript", () => {
  test("goes to the import page only when no shell claims the event", async () => {
    const { installDom, removeDom } = await import("../planner/test-dom");
    installDom();
    try {
      const { openConnect } = await import("@/components/courses/CoursesView");
      const visited: string[] = [];
      openConnect((href) => visited.push(href));
      expect(visited).toEqual(["/connect"]);
      const claim = (event: Event) => event.preventDefault();
      window.addEventListener("untangle:open-connect", claim);
      openConnect((href) => visited.push(href));
      window.removeEventListener("untangle:open-connect", claim);
      expect(visited).toEqual(["/connect"]);
    } finally {
      removeDom();
    }
  });
});
