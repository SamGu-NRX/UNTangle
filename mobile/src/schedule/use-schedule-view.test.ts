import { defaultPlannerState } from "@/lib/seed-data";
import { planningTerm, sampleCatalog } from "@/lib/planner-sections";
import type { ClassDay, MapStop, PlannerApiPayload } from "@/lib/types";

import { catalogFromSections } from "./remote-catalog";
import { sampleSchedule } from "./sample-schedule";
import { loadScheduleView } from "./use-schedule-view";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function sampleResultFor(courseCode: string) {
  const option = sampleCatalog(courseCode);
  if (option.status !== "ready") throw new Error(`No sample sections for ${courseCode}`);
  return option.result;
}

/** A PlannerApiPayload over the bundled defaults with one sample section selected. */
function payloadWithSelection(courseCode: string): PlannerApiPayload {
  const section = sampleResultFor(courseCode).sections[0];
  if (!section) throw new Error(`No sample section for ${courseCode}`);
  const routeStops = Object.fromEntries(
    (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as ClassDay[]).map((day) => [day, [] as MapStop[]]),
  ) as Record<ClassDay, MapStop[]>;
  // A saved plan's course is one the student is taking this term; the shared
  // builders schedule only inProgress courses.
  return {
    ...defaultPlannerState,
    courseStatuses: { ...defaultPlannerState.courseStatuses, [courseCode]: "inProgress" },
    routeStops,
    selectedSections: { [courseCode]: section.id },
  };
}

/** The sample sections reshaped as real data: real provenance, sections dated to the term. */
function realResultFor(courseCode: string) {
  const sample = sampleResultFor(courseCode);
  return {
    ...sample,
    status: "ok" as const,
    availability: "sections" as const,
    provenance: {
      kind: "real" as const,
      source: "vsb.untgrades.app" as const,
      updatedAt: "2026-01-01T00:00:00.000Z",
      note: "Test fixture",
    },
    checkedAt: "2026-01-01T00:00:00.000Z",
    sections: sample.sections.map((section) => ({ ...section, term: planningTerm.id })),
  };
}

/**
 * Fetch mock: /api/planner answers the given 200 body; sections paths answer
 * with the shared sample sections for the requested course, or the same
 * sections marked real when `withReal` is set.
 */
function fetchWith(plannerBody: unknown, withReal = false): (url: string) => Promise<Response> {
  return async (url: string) => {
    if (url.endsWith("/api/planner")) return jsonResponse(plannerBody);
    const after = url.split("/api/sections/")[1];
    if (!after) return jsonResponse({}, 404);
    const [term, subject, number] = after.split("/").map(decodeURIComponent);
    if (term !== planningTerm.id) return jsonResponse({}, 404);
    return jsonResponse(withReal ? realResultFor(`${subject ?? ""} ${number ?? ""}`) : sampleResultFor(`${subject ?? ""} ${number ?? ""}`));
  };
}

describe("sampleSchedule", () => {
  it("builds a labeled sample week with events, blocks, and colors from the shared seed data", () => {
    const sample = sampleSchedule();
    expect(sample.labeledSample).toBe(true);
    expect(sample.events.length).toBeGreaterThan(0);
    expect(sample.blocks.length).toBe(sample.events.length);
    expect(sample.blocks[0]?.code).toBeTruthy();
    expect(sample.colors.size).toBeGreaterThan(0);
    expect(Object.keys(sample.state.selectedSections).length).toBeGreaterThan(0);
  });
});

describe("catalogFromSections", () => {
  it("answers ready for fetched course codes and loading for unknown ones", async () => {
    const codes = Object.keys(sampleSchedule().state.selectedSections);
    const fetched = codes.map(sampleResultFor);
    const catalog = catalogFromSections(fetched);
    for (const code of codes) {
      expect(catalog(code).status).toBe("ready");
    }
    expect(catalog("MATH 1650").status).toBe("loading");
  });
});

describe("loadScheduleView", () => {
  it("builds the week from a saved plan's sections", async () => {
    const courseCode = sampleSchedule().events[0]?.courseCode ?? "CSCE 1030";
    const view = await loadScheduleView(
      fetchWith({ state: payloadWithSelection(courseCode), revision: 3, persistent: true }, true),
    );
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.source).toBe("your-plan");
    expect(view.labeledSample).toBe(false);
    expect(view.blocks.length).toBeGreaterThan(0);
    expect(view.colors.size).toBeGreaterThan(0);
    expect(view.stats.days).toBeGreaterThan(0);
  });

  it("falls back to the labeled sample when the planner answers 401", async () => {
    const unauthorized = async (url: string) =>
      url.endsWith("/api/planner") ? jsonResponse({}, 401) : jsonResponse({}, 404);
    const view = await loadScheduleView(unauthorized);
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.source).toBe("sample");
    expect(view.labeledSample).toBe(true);
    expect(view.note).toBe("Sign in to see your saved plan. Showing a sample schedule.");
    expect(view.blocks.length).toBeGreaterThan(0);
  });

  it("falls back to the labeled sample when nothing is saved", async () => {
    const view = await loadScheduleView(
      jest.fn().mockResolvedValue(jsonResponse({ state: null, revision: 0, persistent: false })),
    );
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.source).toBe("sample");
    expect(view.note).toBe("No saved plan found. Showing a sample schedule.");
  });

  it("keeps a partially fetched plan and flags its sample sections", async () => {
    const courseCode = sampleSchedule().events[0]?.courseCode ?? "CSCE 1030";
    const failingSections = async (url: string) => {
      if (url.endsWith("/api/planner")) {
        return jsonResponse({ state: payloadWithSelection(courseCode), revision: 3, persistent: true });
      }
      return jsonResponse({}, 500);
    };
    const view = await loadScheduleView(failingSections);
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.source).toBe("your-plan");
    expect(view.labeledSample).toBe(true);
    expect(view.note).toBe("Some sections come from bundled samples.");
  });

  it("falls back to the labeled sample when the planner cannot be reached", async () => {
    const failing = jest.fn().mockRejectedValue(new Error("offline"));
    const view = await loadScheduleView(failing);
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.source).toBe("sample");
    expect(view.labeledSample).toBe(true);
    expect(view.note).toBe("Couldn't reach UNTangle. Showing a sample schedule.");
    expect(view.blocks.length).toBeGreaterThan(0);
  });

  it("warns about incomplete data when a real saved pick cannot be resolved", async () => {
    const state = payloadWithSelection(sampleSchedule().events[0]?.courseCode ?? "CSCE 1030");
    const realPick = {
      ...state,
      selectedSections: { ...state.selectedSections, "MATH 1650": "vsb:spring-2027:MATH 1650:101" },
    };
    const failingRealSections = async (url: string) => {
      if (url.endsWith("/api/planner")) return jsonResponse({ state: realPick, revision: 3, persistent: true });
      return jsonResponse({}, 500);
    };
    const view = await loadScheduleView(failingRealSections);
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.incomplete).toBe(true);
    expect(view.note).toBe("Some saved sections couldn't be loaded, so this schedule may be incomplete.");
  });

  it("renders a saved plan with no picks as an empty schedule, not a sample", async () => {
    const state = payloadWithSelection(sampleSchedule().events[0]?.courseCode ?? "CSCE 1030");
    const emptyPlan = { ...state, selectedSections: {} };
    const view = await loadScheduleView(
      fetchWith({ state: emptyPlan, revision: 3, persistent: true }, true),
    );
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.source).toBe("your-plan");
    expect(view.labeledSample).toBe(false);
    expect(view.events).toEqual([]);
    expect(view.note).toBe("No sections picked yet - pick them on the web planner.");
  });
});
