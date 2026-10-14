import { describe, expect, it } from "bun:test";
import { exportFileName, hasSavedCopy, versionTime, whenText } from "@/components/schedules-library/view-model";
import { buildSavedPlanSnapshot } from "@/lib/plan-library/snapshot";
import { defaultPlannerState } from "@/lib/seed-data";
import { normalizePlannerState } from "@/lib/planner";
import type { PlannerState } from "@/lib/types";

const capturedAt = "2026-10-10T12:00:00.000Z";

const stateWith = (overrides: Partial<PlannerState>): PlannerState => ({
  ...normalizePlannerState(defaultPlannerState),
  ...overrides,
});

const snapshotOf = (state: PlannerState, name = "Fall plan") =>
  buildSavedPlanSnapshot({
    state,
    name,
    source: { kind: "workingState", detail: "" },
    now: new Date(capturedAt),
  });

describe("schedules library view model", () => {
  it("builds download filenames from the plan name and save date", () => {
    const plan = snapshotOf(stateWith({}), "Fall 2026 Finals!");
    expect(exportFileName(plan)).toBe("untangle-fall-2026-finals-2026-10-10.json");

    const symbolOnly = snapshotOf(stateWith({}), "!!!");
    expect(exportFileName(symbolOnly)).toBe("untangle-plan-2026-10-10.json");
  });

  it("says when a schedule changed the way a person would", () => {
    // Local times, so the calendar-day boundaries hold in any time zone.
    const now = new Date(2026, 9, 13, 10, 44);
    const at = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString();
    expect(whenText("Edited", at(2026, 9, 13, 10, 44), now)).toBe("Edited just now");
    expect(whenText("Edited", at(2026, 9, 13, 10, 42), now)).toBe("Edited 2 min ago");
    expect(whenText("Edited", at(2026, 9, 13, 9, 44), now)).toBe("Edited today");
    expect(whenText("Saved", at(2026, 9, 12, 23, 59), now)).toBe("Saved yesterday");
    expect(whenText("Saved", at(2026, 9, 1, 8, 0), now)).toBe("Saved Oct 1");
    expect(whenText("Saved", at(2025, 11, 30, 8, 0), now)).toBe("Saved Dec 30, 2025");
    expect(whenText("Saved", "not a date", now)).toBe("Saved");
  });

  it("names a version's time, with the day only when it isn't today", () => {
    const now = new Date(2026, 9, 13, 18, 0);
    expect(versionTime(new Date(2026, 9, 13, 10, 41).toISOString(), now)).toBe("Today at 10:41 AM");
    expect(versionTime(new Date(2026, 9, 12, 15, 5).toISOString(), now)).toBe("Oct 12 at 3:05 PM");
  });

  it("knows whether the working schedule already has a saved copy, ignoring timestamps", () => {
    const working = stateWith({ optimization: "compact" });
    expect(hasSavedCopy(working, [snapshotOf(stateWith({ optimization: "clusterNight" }))])).toBe(false);
    expect(hasSavedCopy({ ...working, updatedAt: "2020-01-01T00:00:00.000Z" }, [snapshotOf(working)])).toBe(true);
    expect(hasSavedCopy(working, [])).toBe(false);
  });
});

describe("what Use in Main does with sections it can't keep", () => {
  it("says, per course, whether the section is replaced, unused, or the course leaves", async () => {
    const { skippedSectionLines } = await import("@/components/schedules-library/view-model");
    const { resolveSectionReferences } = await import("@/lib/plan-library/snapshot");
    const base = normalizePlannerState(defaultPlannerState);
    const state: PlannerState = {
      ...base,
      // ANTH 1010 is planned but its section is gone; ANTH 1150 isn't planned; ZZZZ 9999 isn't in the catalog.
      courseStatuses: { ...base.courseStatuses, "ANTH 1010": "inProgress" },
      selectedSections: { "ANTH 1010": "anth-1010-999", "ANTH 1150": "anth-1150-001", "ZZZZ 9999": "zzzz-9999-001" },
    };
    expect(skippedSectionLines(resolveSectionReferences(state))).toEqual([
      "ANTH 1010: its saved section is no longer offered, so Week picks another.",
      "ANTH 1150: not planned this term, so its saved section isn't used.",
      "ZZZZ 9999: not in this catalog, so it leaves the schedule.",
    ]);
  });

  it("says nothing when every saved section carries over", async () => {
    const { skippedSectionLines } = await import("@/components/schedules-library/view-model");
    const { resolveSectionReferences } = await import("@/lib/plan-library/snapshot");
    const base = normalizePlannerState(defaultPlannerState);
    const state = { ...base, courseStatuses: { ...base.courseStatuses, "ANTH 1010": "inProgress" as const }, selectedSections: { "ANTH 1010": "anth-1010-001" } };
    expect(skippedSectionLines(resolveSectionReferences(state))).toEqual([]);
  });
});

describe("which compared schedule Use in Main applies to", () => {
  it("is the one that isn't Main, in either order; B when neither is Main", async () => {
    const { adoptableSide } = await import("@/components/schedules-library/view-model");
    const main = { name: "Main", active: true };
    const copy = { name: "Fridays off", active: false };
    const other = { name: "Short walks", active: false };
    expect(adoptableSide(main, copy)).toBe(copy);
    expect(adoptableSide(copy, main)).toBe(copy);
    expect(adoptableSide(copy, other)).toBe(other);
    expect(adoptableSide(main, main)).toBeNull();
  });
});

describe("what Use in Main does to locks", () => {
  it("names each lock it adds, moves or removes", async () => {
    const { lockChangeLines } = await import("@/components/schedules-library/view-model");
    expect(
      lockChangeLines([
        { courseCode: "ANTH 1010", savedPlan: "anth-1010-002", workingState: null },
        { courseCode: "BIOL 1112", savedPlan: "biol-1112-003", workingState: "biol-1112-001" },
        { courseCode: "CHEM 1410", savedPlan: null, workingState: "chem-1410-001" },
      ]),
    ).toEqual([
      "ANTH 1010: Use in Main locks it to section 002.",
      "BIOL 1112: Use in Main locks it to section 003 instead.",
      "CHEM 1410: Use in Main unlocks its section.",
    ]);
  });
});
