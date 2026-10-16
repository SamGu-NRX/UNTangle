import { optionsConflict } from "@/lib/planner-sections";
import { courses } from "@/lib/seed-data";
import type { ScheduleEvent } from "@/lib/types";

import { autoRequest, optionSentence, runAuto, SAME_WEEK, weightsOf } from "./auto";
import { dayPlan, rangeWithPeriod, sampleStart, walkMinutes } from "./day-plan";
import {
  conflictsWith,
  courseByCode,
  courseGroups,
  courseState,
  creditsText,
  firstFittingSection,
  samplePicks,
  samplePlannedCodes,
  sampleRecord,
  sectionsOf,
  sectionTimes,
  weekOf,
  type GuestRecord,
} from "./guest-plan";
import {
  busyBlocks,
  busySummary,
  cellKey,
  clearBusy,
  daysText,
  isDayOff,
  leaningText,
  samplePreferences,
  toggleCell,
  toggleDayOff,
  type Preferences,
} from "./preferences";

const record: GuestRecord = { done: { "MATH 1710": "B" }, taking: ["CSCE 1040"] };
const none = new Set<string>();

describe("courseState", () => {
  it("reads done, taking and planned from the record before prerequisites", () => {
    expect(courseState("MATH 1710", record, none)).toEqual({ kind: "done", grade: "B" });
    expect(courseState("CSCE 1040", record, none)).toEqual({ kind: "taking" });
    expect(courseState("ENGL 1310", record, new Set(["ENGL 1310"]))).toEqual({ kind: "planned" });
  });

  it("opens a course when any listed prerequisite is done or in progress", () => {
    // MATH 1720 lists MATH 1710 (done); CSCE 2110 lists CSCE 1040 (taking).
    expect(courseState("MATH 1720", record, none)).toEqual({ kind: "available" });
    expect(courseState("CSCE 2110", record, none)).toEqual({ kind: "available" });
    expect(courseState("ENGL 1310", record, none)).toEqual({ kind: "available" });
  });

  it("locks a course whose prerequisites are all missing and names one the catalog has", () => {
    // MATH 2700 needs MATH 1720, which this record hasn't started.
    expect(courseState("MATH 2700", record, none)).toEqual({ kind: "locked", needs: "MATH 1720" });
  });
});

describe("courseGroups", () => {
  const groups = courseGroups(sampleRecord, new Set(samplePlannedCodes));

  it("puts every done and taking course of the sample record in its group", () => {
    // A record course missing from the catalog would vanish from every group.
    for (const code of [...Object.keys(sampleRecord.done), ...sampleRecord.taking]) expect(courseByCode(code)).toBeDefined();
    expect(groups.done.map((entry) => entry.course.code).sort()).toEqual(Object.keys(sampleRecord.done).sort());
    expect(groups.taking.map((course) => course.code).sort()).toEqual([...sampleRecord.taking].sort());
  });

  it("suggests only major courses that are open and not already planned", () => {
    for (const course of groups.canTake) {
      expect(["CSCE", "MATH"]).toContain(course.department);
      expect(samplePlannedCodes as readonly string[]).not.toContain(course.code);
      expect(courseState(course.code, sampleRecord, new Set(samplePlannedCodes)).kind).toBe("available");
    }
    expect(groups.later.every(({ course }) => courseState(course.code, sampleRecord, none).kind === "locked")).toBe(true);
  });
});

describe("section picking", () => {
  it("starts the sample student on a week with every planned course and no clashes", () => {
    const picks = samplePicks();
    expect(Object.keys(picks).sort()).toEqual([...samplePlannedCodes].sort());
    const chosen = Object.entries(picks).map(([code, id]) => sectionsOf(code).find((section) => section.id === id)!);
    for (let i = 0; i < chosen.length; i += 1) {
      for (let j = i + 1; j < chosen.length; j += 1) expect(optionsConflict(chosen[i], chosen[j])).toBe(false);
    }
  });

  it("names the planned course a section clashes with, and skips the course's own pick", () => {
    const math = sectionsOf("MATH 1710")[0];
    // A section of another course at the same meetings clashes with it.
    const twin = { ...math, id: "twin", courseCode: "XXXX 1000" };
    expect(conflictsWith(twin, { "MATH 1710": math.id })).toEqual(["MATH 1710"]);
    expect(conflictsWith(math, { "MATH 1710": math.id })).toEqual([]);
  });

  it("returns null when every section of a course clashes", () => {
    // Block each CSCE 2610 section with a section of some other course that overlaps it.
    const target = sectionsOf("CSCE 2610");
    expect(target.length).toBeGreaterThan(1);
    const picks: Record<string, string> = {};
    for (const section of target) {
      const blocker = courses
        .filter((course) => course.code !== "CSCE 2610" && !(course.code in picks))
        .flatMap((course) => sectionsOf(course.code))
        .find((candidate) => optionsConflict(candidate, section));
      expect(blocker).toBeDefined();
      picks[blocker!.courseCode] = blocker!.id;
    }
    expect(firstFittingSection("CSCE 2610", picks)).toBeNull();
    expect(firstFittingSection("CSCE 2610", {})).toBe(target[0]);
  });

  it("words one credit in the singular", () => {
    expect(creditsText(1)).toBe("1 credit");
    expect(creditsText(0)).toBe("0 credits");
    expect(creditsText(15)).toBe("15 credits");
  });

  it("counts the credits of the picked courses", () => {
    expect(weekOf({ "MATH 1710": sectionsOf("MATH 1710")[0].id }, new Map()).credits).toBe(3);
    expect(weekOf({}, new Map()).credits).toBe(0);
  });
});

function event(code: string, day: ScheduleEvent["day"], start: string, end: string, buildingId: string): ScheduleEvent {
  return {
    courseCode: code,
    title: code,
    sectionId: `${code}-1`,
    sectionLabel: "001",
    professor: "",
    rating: null,
    location: buildingId,
    buildingId,
    buildingName: buildingId,
    day,
    start,
    end,
    dates: null,
    provenance: "sample",
  };
}

describe("dayPlan", () => {
  it("leaves the starting point the walk plus two minutes before the first class", () => {
    const walk = walkMinutes("uu", "blb")!;
    const plan = dayPlan([event("A 1", "Mon", "10:00", "10:50", "blb")], "Mon", sampleStart, null);
    expect(plan.stops[0].leg.from.id).toBe("uu");
    expect(plan.stops[0].leg.minutes).toBe(walk);
    expect(plan.stops[0].leg.leaveBy).toBe(600 - walk - 2);
    expect(plan.hero).toEqual({ kind: "leave", index: 0, leave: 600 - walk - 2, minutesUntil: null, tight: false });
  });

  it("marks a walk longer than the break late, and never leaves before the earlier class ends", () => {
    const walk = walkMinutes("blb", "env")!;
    expect(walk).toBeGreaterThan(3);
    const plan = dayPlan(
      [event("B 1", "Tue", "11:00", "11:50", "env"), event("A 1", "Tue", "9:00", "10:57", "blb")],
      "Tue",
      sampleStart,
      null,
    );
    expect(plan.stops.map((stop) => stop.event.courseCode)).toEqual(["A 1", "B 1"]);
    expect(plan.stops[1].leg.breakMinutes).toBe(3);
    expect(plan.stops[1].leg.fit).toBe("late");
    expect(plan.stops[1].leg.leaveBy).toBe(10 * 60 + 57);
  });

  it("needs no walk inside one building", () => {
    const plan = dayPlan(
      [event("A 1", "Wed", "9:00", "9:50", "blb"), event("B 1", "Wed", "10:00", "10:50", "blb")],
      "Wed",
      sampleStart,
      null,
    );
    expect(plan.stops[1].leg).toMatchObject({ minutes: 0, leaveBy: null, fit: "ok" });
  });

  it("says no classes on an empty day", () => {
    expect(dayPlan([], "Fri", sampleStart, null)).toEqual({ day: "Fri", stops: [], hero: { kind: "no-classes" } });
  });
});

describe("rangeWithPeriod", () => {
  test("writes the period once when both ends share it", () => {
    expect(rangeWithPeriod(15 * 60, 17 * 60)).toBe("3:00 to 5:00 PM");
    expect(rangeWithPeriod(8 * 60, 9 * 60 + 30)).toBe("8:00 to 9:30 AM");
  });

  test("writes it on each end when the range crosses noon", () => {
    expect(rangeWithPeriod(11 * 60, 13 * 60)).toBe("11:00 AM to 1:00 PM");
    expect(rangeWithPeriod(11 * 60, 12 * 60)).toBe("11:00 AM to 12:00 PM");
  });
});

describe("sectionTimes", () => {
  const sectionAt = (code: string, start: number) => sectionsOf(code).find((section) => section.meetings[0]?.startMinutes === start);

  test("says AM or PM, the way the web writes a range off the grid", () => {
    // CSCE 2100's sample section at noon, which the walkthrough saw as "12:00 to 12:50".
    const noon = sectionAt("CSCE 2100", 12 * 60);
    expect(noon && sectionTimes(noon)).toEqual({ days: "Mon Wed Fri", time: "12:00 to 12:50 PM" });
    const morning = sectionsOf("CSCE 2100").find((section) => (section.meetings[0]?.endMinutes ?? 720) < 720);
    expect(morning && sectionTimes(morning)?.time).toMatch(/^\d{1,2}:\d{2} to \d{1,2}:\d{2} AM$/);
  });

  test("says nothing for a section with no set time", () => {
    const section = sectionsOf("CSCE 2100")[0];
    expect(sectionTimes({ ...section, meetings: [] })).toBeNull();
  });
});

describe("preferences", () => {
  const blank: Preferences = { ...samplePreferences, busy: {} };

  it("paints and clears one hour", () => {
    const painted = toggleCell(blank, "Mon", 9);
    expect(painted.busy).toEqual({ [cellKey("Mon", 9)]: "Busy" });
    expect(toggleCell(painted, "Mon", 9).busy).toEqual({});
  });

  it("gives a day back without erasing the busy times painted on it", () => {
    const work = toggleCell(blank, "Tue", 15);
    const off = toggleDayOff(work, "Tue");
    expect(isDayOff(off, "Tue")).toBe(true);
    const back = toggleDayOff(off, "Tue");
    expect(isDayOff(back, "Tue")).toBe(false);
    expect(back.busy).toEqual(work.busy);
  });

  it("merges consecutive hours with one label into one block, and summarizes repeats by day", () => {
    expect(busyBlocks(samplePreferences)).toEqual([
      { day: "Tue", start: 900, end: 1020, label: "Work" },
      { day: "Thu", start: 900, end: 1020, label: "Work" },
    ]);
    const [row] = busySummary(samplePreferences);
    expect(row).toEqual({ label: "Work", days: ["Tue", "Thu"], start: 900, end: 1020 });
    expect(clearBusy(samplePreferences, row).busy).toEqual({});
  });

  it("writes days as a sentence", () => {
    expect(daysText(["Mon"])).toBe("Mon");
    expect(daysText(["Tue", "Thu"])).toBe("Tue and Thu");
    expect(daysText(["Mon", "Wed", "Fri"])).toBe("Mon, Wed and Fri");
  });

  it("words a leaning's value and clamps out-of-range values", () => {
    expect(leaningText("time", -1).value).toBe("Earlier");
    expect(leaningText("walking", 9).value).toBe("Most");
  });
});

describe("Auto", () => {
  it("maps time of day onto one of mornings or evenings", () => {
    const at = (time: number) => weightsOf({ ...samplePreferences, leanings: { ...samplePreferences.leanings, time } });
    expect(at(-2)).toMatchObject({ mornings: 4, evenings: 0 });
    expect(at(-1)).toMatchObject({ mornings: 2, evenings: 0 });
    expect(at(0)).toMatchObject({ mornings: 0, evenings: 0 });
    expect(at(2)).toMatchObject({ mornings: 0, evenings: 4 });
  });

  it("returns options that keep every hard limit and every kept section", () => {
    const picks = samplePicks();
    const kept = Object.keys(picks)[0];
    const prefs: Preferences = { ...samplePreferences, maxCredits: 21, kept: [kept] };
    const result = runAuto(picks, prefs);
    expect(result.kind).toBe("options");
    if (result.kind !== "options") return;
    for (const option of result.options) {
      expect(option.picks[kept]).toBe(picks[kept]);
      const week = weekOf(option.picks, new Map());
      for (const block of week.blocks) {
        expect(block.start).toBeGreaterThanOrEqual(prefs.startAfter!);
        const work = (block.day === "Tue" || block.day === "Thu") && block.start < 1020 && block.end > 900;
        expect(work).toBe(false);
      }
      expect(option.moves).toEqual(Object.keys(picks).filter((code) => option.picks[code] !== picks[code]));
    }
  });

  it("words each option with the web Week's trade-off line, not a list of what moves", () => {
    const picks = samplePicks();
    const result = runAuto(picks, samplePreferences);
    expect(result.kind).toBe("options");
    if (result.kind !== "options") return;
    // The web's describeAlternative: the best gain, then the worst cost. The
    // sample student leans toward mornings, so earlier starts are no cost.
    expect(result.options.map((option) => option.sentence)).toEqual(["Ends by 1:50.", "Frees Tuesday and Thursday.", "Frees Tuesday and Thursday."]);
  });

  it("says the week is already Auto's best when an option moves nothing", () => {
    const picks = samplePicks();
    expect(optionSentence(picks, picks, [], samplePreferences)).toBe(SAME_WEEK);
  });

  it("says nothing fits when the credit limit is below the planned courses", () => {
    const result = runAuto(samplePicks(), { ...samplePreferences, maxCredits: 3 });
    expect(result.kind).toBe("none");
    if (result.kind === "none") expect(result.why).toEqual(expect.any(String));
  });

  it("finishes the sample plan inside its 300ms budget with a proven answer", () => {
    const { optimize } = jest.requireActual("@/lib/optimizer/optimize");
    const result = optimize(autoRequest(samplePicks(), { ...samplePreferences, maxCredits: 21 }));
    expect(result.status).toBe("optimal");
  });
});
