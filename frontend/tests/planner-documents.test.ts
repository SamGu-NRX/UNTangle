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

  test("a removed key is removed, and an unchanged body comes back as stored", () => {
    const stored = { courseStatuses: { "CSCE 1030": "completed", "ZZZZ 9999": "completed" }, name: "Spring plan" };
    expect(rebase(stored, { courseStatuses: { "CSCE 1030": "completed" } }, { courseStatuses: {} })).toEqual({
      courseStatuses: { "ZZZZ 9999": "completed" }, name: "Spring plan",
    });
    expect(rebase(stored, { courseStatuses: {} }, { courseStatuses: {} })).toBe(stored);
  });

  test("a code list changes by what the planner added and removed, so codes it can't show stay", () => {
    const stored = { courses: ["CSCE 1040", "ZZZZ 9999"], selectedSections: { "ZZZZ 9999": "zz-001" } };
    const before = { courses: ["CSCE 1040"], selectedSections: {} };
    const after = { courses: ["MATH 1720"], selectedSections: {} };
    expect(rebase(stored, before, after)).toEqual({ courses: ["ZZZZ 9999", "MATH 1720"], selectedSections: { "ZZZZ 9999": "zz-001" } });
  });

  test("a list of rows with ids changes row by row, keeping rows the planner never read", () => {
    const row = (id: string, grade: string) => ({ id, grade });
    const stored = [row("a", "A"), row("hidden", "B"), row("c", "C")];
    expect(rebase(stored, [row("a", "A"), row("c", "C")], [row("a", "B"), row("d", "D")])).toEqual([row("a", "B"), row("hidden", "B"), row("d", "D")]);
  });

  test("any other changed list is the planner's whole", () => {
    expect(rebase({ changes: [{ code: "A" }, { code: "B" }] }, { changes: [{ code: "A" }] }, { changes: [{ code: "C" }] })).toEqual({ changes: [{ code: "C" }] });
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

  test("a row the legacy route accepted but the contract refuses still migrates, losing only what can't be held", () => {
    const [row] = fixtures.savedPlan.transcriptRecords;
    const legacy = {
      ...fixtures.savedPlan,
      // An extra key on a row, the same row twice, and an Auto run that touched a completed course.
      transcriptRecords: [{ ...row, importedFrom: "pdf" }, { ...row }, ...fixtures.savedPlan.transcriptRecords.slice(1)],
      coursePlan: {
        ...fixtures.savedPlan.coursePlan!,
        lastAuto: { ...fixtures.savedPlan.coursePlan!.lastAuto!, changes: [{ code: "CSCE 1040", from: "completed" as const, to: "inProgress" as const }] },
      },
    };
    const [record, schedule] = legacyDocuments(legacy);
    expect(plain(record.body)).toEqual(expectedRecord);
    expect(plain(schedule.body)).toEqual({ ...fixtures.schedule, lastAuto: null });
  });

  test("an empty pick is dropped with its lock, so the row still migrates", () => {
    const legacy = { ...fixtures.savedPlan, selectedSections: { ...fixtures.savedPlan.selectedSections, "MATH 1720": "" }, lockedSections: { ...fixtures.savedPlan.lockedSections, "MATH 1720": "" } };
    const schedule = legacyDocuments(legacy)[1].body as typeof fixtures.schedule;
    expect(schedule.selectedSections).toEqual({ "CSCE 1040": fixtures.savedPlan.selectedSections["CSCE 1040"] });
    expect(schedule.lockedSections).toEqual(fixtures.savedPlan.lockedSections);
  });

  test("the term comes from a real pick, and only a plan without one falls back", () => {
    expect(legacyPlanTerm({ ...fixtures.savedPlan, selectedSections: { "CSCE 1040": "vsb:fall-2026:CSCE 1040:6001" } }, "spring-2027")).toBe("fall-2026");
    expect(legacyPlanTerm({ ...fixtures.savedPlan, selectedSections: { "MATH 1720": "math-1720-002" } }, "spring-2027")).toBe("spring-2027");
  });
});

describe("the sync transport", () => {
  test("a security change in progress is retried after the server's Retry-After, not refused", async () => {
    const { httpSyncIO, RetryLaterError } = await import("@/lib/sync/planner-sync");
    const io = httpSyncIO("student", () => async () =>
      Response.json({ code: "security_change_in_progress" }, { status: 409, headers: { "Retry-After": "7" } }));
    const bytes = JSON.stringify({ documentId: "preferences-unt", kind: "preferences" });
    const error = await io.push("student", bytes).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RetryLaterError);
    expect((error as InstanceType<typeof RetryLaterError>).seconds).toBe(7);
  });
});
