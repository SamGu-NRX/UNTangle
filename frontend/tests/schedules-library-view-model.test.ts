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
