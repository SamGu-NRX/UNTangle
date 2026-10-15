import { describe, expect, test } from "bun:test";
import * as fixtures from "../../packages/contracts/tests/fixtures";
import { legacyDocuments } from "@/lib/document-sync/legacy-migration";
import { defaultSchedulePreferences, normalizePlannerState } from "@/lib/planner";
import { joinPlanner, legacyPlanTerm, rebase, splitPlanner } from "@/lib/planner-documents";

// The contract fixture's record also carries a catalog id and an explicit
// "not taken", neither of which the planner holds or writes.
const history = Object.fromEntries(Object.entries(fixtures.academicRecord.courseStatuses).filter(([code]) => code !== "CSCE 2100"));
const expectedRecord = { ...fixtures.academicRecord, courseStatuses: history, catalogId: null };
/** Bodies carry branded ids; the fixtures are plain JSON. */
const plain = (value: unknown) => value;

describe("splitting a plan into documents", () => {
  test("a saved plan splits the way the contract fixtures say: planned courses move to the schedule", () => {
    const bodies = splitPlanner(fixtures.savedPlan, fixtures.savedPreferences, "spring-2027");
    expect(plain(bodies["academic-record"])).toEqual(expectedRecord);
    expect(plain(bodies.schedule)).toEqual(fixtures.schedule);
    expect(plain(bodies.preferences)).toEqual(fixtures.preferences);
  });

  test("joining the documents gives the plan back", () => {
    const bodies = splitPlanner(fixtures.savedPlan, fixtures.savedPreferences, "spring-2027");
    const joined = joinPlanner(bodies, fixtures.savedPlan.activeDay);
    expect({ ...joined.state, updatedAt: null }).toEqual({ ...normalizePlannerState(fixtures.savedPlan), updatedAt: null });
    expect(joined.preferences).toEqual(fixtures.savedPreferences);
  });

  test("a course the record says is done is never shown as planned, and missing documents read as a fresh plan", () => {
    const bodies = splitPlanner(fixtures.savedPlan, fixtures.savedPreferences, "spring-2027");
    const record = { ...bodies["academic-record"], courseStatuses: { ...bodies["academic-record"].courseStatuses, "CSCE 1040": "completed" as const } };
    expect(joinPlanner({ ...bodies, "academic-record": record }, "Mon").state.courseStatuses["CSCE 1040"]).toBe("completed");
    const empty = joinPlanner({ "academic-record": null, schedule: null, preferences: null }, "Mon");
    expect(Object.values(empty.state.courseStatuses).every((status) => status === "notTaken")).toBe(true);
    expect(empty.preferences).toEqual(defaultSchedulePreferences(empty.state.optimization));
  });
});

describe("rebase", () => {
  test("a save keeps what the planner never read: a catalog id, a course outside the catalog, a field this build doesn't know", () => {
    const before = splitPlanner(fixtures.savedPlan, fixtures.savedPreferences, "spring-2027")["academic-record"];
    const stored = {
      ...before,
      catalogId: "unt-2026-27",
      courseStatuses: { ...before.courseStatuses, "ZZZZ 9999": "completed" },
      futureField: { kept: true },
    };
    const edited = { ...fixtures.savedPlan, courseStatuses: { ...fixtures.savedPlan.courseStatuses, "CSCE 2100": "completed" as const } };
    const after = splitPlanner(edited, fixtures.savedPreferences, "spring-2027")["academic-record"];
    expect(rebase(stored, before, after)).toEqual({
      ...stored,
      courseStatuses: { ...stored.courseStatuses, "CSCE 2100": "completed" },
    });
  });

  test("a removed key is removed, an unchanged body comes back as stored, and a changed array is the planner's", () => {
    const stored = { courseStatuses: { "CSCE 1030": "completed", "ZZZZ 9999": "completed" }, list: ["a", "b"], name: "Spring plan" };
    expect(rebase(stored, { courseStatuses: { "CSCE 1030": "completed" }, list: ["a"] }, { courseStatuses: {}, list: ["a"] })).toEqual({
      courseStatuses: { "ZZZZ 9999": "completed" }, list: ["a", "b"], name: "Spring plan",
    });
    expect(rebase(stored, { list: ["a"] }, { list: ["a"] })).toBe(stored);
    expect(rebase(stored, { list: ["a"] }, { list: ["c"] })).toEqual({ ...stored, list: ["c"] });
  });

  test("a course code named __proto__ is data, not the prototype", () => {
    const result = rebase({ statuses: {} }, { statuses: {} }, JSON.parse('{"statuses":{"__proto__":"completed"}}')) as { statuses: object };
    expect(Object.getPrototypeOf(result.statuses)).toBe(Object.prototype);
    expect(Object.entries(result.statuses)).toEqual([["__proto__", "completed"]]);
  });
});

describe("the legacy row's documents", () => {
  test("keep every field with a home, take the term from the picks, and start preferences from the row's goal", () => {
    const documents = legacyDocuments(fixtures.savedPlan);
    expect(documents.map((document) => [document.documentId, document.kind])).toEqual([
      ["academic-record-unt", "academic-record"],
      ["main-unt-spring-2027", "schedule"],
      ["preferences-unt", "preferences"],
    ]);
    expect(plain(documents[0].body)).toEqual(expectedRecord);
    expect(plain(documents[1].body)).toEqual(fixtures.schedule);
    expect(plain(documents[2].body)).toEqual({ institutionId: "unt", goal: "compact", ...defaultSchedulePreferences("compact") });
  });

  test("the term comes from a real pick, and only a plan without one falls back", () => {
    expect(legacyPlanTerm({ ...fixtures.savedPlan, selectedSections: { "CSCE 1040": "vsb:fall-2026:CSCE 1040:6001" } }, "spring-2027")).toBe("fall-2026");
    expect(legacyPlanTerm({ ...fixtures.savedPlan, selectedSections: { "MATH 1720": "math-1720-002" } }, "spring-2027")).toBe("spring-2027");
  });
});
