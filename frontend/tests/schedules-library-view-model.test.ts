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

describe("downloading a schedule file", () => {
  it("revokes the file's URL only in a later task, after the click", async () => {
    const { downloadFile } = await import("@/components/schedules-library/view-model");
    const events: string[] = [];
    const queued: Array<() => void> = [];
    downloadFile(new Blob(["{}"]), "untangle-main.json", {
      createObjectURL: () => (events.push("create"), "blob:1"),
      revokeObjectURL: (url) => events.push(`revoke ${url}`),
      createLink: () => ({
        href: "",
        download: "",
        click() {
          events.push(`click ${this.href} as ${this.download}`);
        },
        remove: () => events.push("remove"),
      }),
      later: (run) => queued.push(run),
    });
    expect(events).toEqual(["create", "click blob:1 as untangle-main.json", "remove"]);
    queued.forEach((run) => run());
    expect(events.at(-1)).toBe("revoke blob:1");
  });
});

describe("notice lines", () => {
  it("get keys that differ even when two lines say the same thing", async () => {
    const { keyedLines } = await import("@/components/schedules-library/view-model");
    const keyed = keyedLines(["Unreadable: bad", "Unreadable: bad", "Other"]);
    expect(new Set(keyed.map((line) => line.key)).size).toBe(3);
    expect(keyed.map((line) => line.text)).toEqual(["Unreadable: bad", "Unreadable: bad", "Other"]);
  });
});

describe("reading the library for an identity", () => {
  function fakeStore(available: boolean) {
    const reads: string[] = [];
    return {
      reads,
      store: {
        available,
        list: () => (reads.push("list"), { ok: true as const, doc: { storeSchemaVersion: 1 as const, revision: 1, plans: [], unreadable: [] }, notices: [] }),
        listQuarantined: () => (reads.push("listQuarantined"), [{ key: "untangle.saved-plans.corrupt-guest:1", size: 3 }]),
      },
    };
  }

  it("shows loading and reads nothing until the planner has prepared an identity", async () => {
    const { readLibraryView } = await import("@/components/schedules-library/view-model");
    const { store, reads } = fakeStore(false);
    expect(readLibraryView(store, false)).toEqual({ phase: "loading", storeAvailable: false, storageDisabled: false, quarantined: [] });
    expect(reads).toEqual([]);
  });

  it("once prepared, reads the library and its quarantined keys, and only then reports storage turned off", async () => {
    const { readLibraryView } = await import("@/components/schedules-library/view-model");
    const ready = fakeStore(true);
    expect(readLibraryView(ready.store, true)).toMatchObject({ phase: "ready", storeAvailable: true, storageDisabled: false, quarantined: [{ size: 3 }] });
    expect(ready.reads).toEqual(["list", "listQuarantined"]);
    expect(readLibraryView(fakeStore(false).store, true)).toMatchObject({ storageDisabled: true });
  });
});

describe("a copy saved with no name", () => {
  it("is Copy of Main, then Copy of Main 2, skipping names in use in any case", async () => {
    const { defaultCopyName } = await import("@/components/schedules-library/view-model");
    expect(defaultCopyName(["Main"], "Main")).toBe("Copy of Main");
    expect(defaultCopyName(["Main", "Copy of Main"], "Main")).toBe("Copy of Main 2");
    expect(defaultCopyName(["Main", "copy of main", "Copy of Main 2", "Fridays off"], "Main")).toBe("Copy of Main 3");
    // A gap left by a deleted copy is reused.
    expect(defaultCopyName(["Main", "Copy of Main 2"], "Main")).toBe("Copy of Main");
  });
});

describe("using a copy that is already Main", () => {
  it("is the same plan when only timestamps differ, and not once a course differs", async () => {
    const { samePlan } = await import("@/components/schedules-library/view-model");
    const main = stateWith({ courseStatuses: { ...stateWith({}).courseStatuses, "ENGL 1310": "inProgress" } });
    expect(samePlan(main, { ...main, updatedAt: "2027-01-01T00:00:00.000Z" })).toBe(true);
    expect(samePlan(main, { ...main, courseStatuses: { ...main.courseStatuses, "ANTH 1010": "inProgress" } })).toBe(false);
  });
});

describe("a week's walking, as Week's Details counts it", () => {
  // Made-up buildings with times from the table, so every figure can be worked out on paper.
  const SECONDS: Record<string, number> = { "gab>cury": 360, "cury>phys": 540, "wh>essc": 600, "phys>lang": 300 };
  const travel = (from: string, to: string) => {
    if (from === "gab" && to === "ntdp") return { seconds: 1200, shuttle: true };
    const seconds = SECONDS[`${from}>${to}`];
    return seconds === undefined ? null : { seconds, shuttle: false };
  };
  const at = async (code: string, days: Array<"Mon" | "Tue" | "Wed" | "Thu" | "Fri">, from: string, until: string, building: string) => {
    const { meeting, section } = await import("./schedule-builder/fixtures");
    return section({ courseCode: code, meetings: days.map((day) => meeting({ day, at: from, until, building })) });
  };

  it("adds up walks across ten-minute breaks and counts a tight one", async () => {
    const { weekWalking } = await import("@/components/schedules-library/view-model");
    const week = [
      await at("CSCE 2110", ["Mon", "Wed", "Fri"], "9:00", "9:50", "gab"),
      await at("MATH 2700", ["Mon", "Wed", "Fri"], "10:00", "10:50", "cury"),
      await at("PHYS 2220", ["Mon", "Wed"], "11:00", "11:50", "phys"),
    ];
    // Mon and Wed: 6 + 9 minutes; Fri: 6. CURY to PHYS takes 9 of a 10-minute break, under two to spare: tight.
    expect(weekWalking(week, travel)).toEqual({ walkMinutes: 36, tightWalks: 2, unknownWalks: 0 });
  });

  it("leaves out breaks over 30 minutes, which Week draws no walk for", async () => {
    const { weekWalking } = await import("@/components/schedules-library/view-model");
    const week = [await at("PHYS 2220", ["Mon"], "11:00", "11:50", "phys"), await at("MATH 2700", ["Mon"], "15:30", "16:50", "lang")];
    expect(weekWalking(week, travel)).toEqual({ walkMinutes: 0, tightWalks: 0, unknownWalks: 0 });
  });

  it("counts a walk with no known time apart, instead of as no walking", async () => {
    const { weekWalking } = await import("@/components/schedules-library/view-model");
    const week = [
      await at("A 1", ["Mon"], "9:00", "9:50", "gab"),
      await at("B 1", ["Mon"], "10:00", "10:50", "cury"),
      await at("C 1", ["Mon"], "11:00", "11:50", "nowhere"),
    ];
    // GAB to CURY is 6 minutes; CURY to a building with no walking time is the unknown one.
    expect(weekWalking(week, travel)).toEqual({ walkMinutes: 6, tightWalks: 0, unknownWalks: 1 });
  });

  it("doesn't count a shuttle ride as walking, though it can still be tight", async () => {
    const { weekWalking } = await import("@/components/schedules-library/view-model");
    const week = [await at("A 1", ["Mon"], "9:00", "9:50", "gab"), await at("B 1", ["Mon"], "10:00", "10:50", "ntdp")];
    expect(weekWalking(week, travel)).toEqual({ walkMinutes: 0, tightWalks: 1, unknownWalks: 0 });
  });
});
