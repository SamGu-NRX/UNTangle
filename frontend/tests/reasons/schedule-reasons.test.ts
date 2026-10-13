import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import type { OptimizeRequest, OptWeights, RankedSchedule } from "@/lib/optimizer/types";
import { DEFAULT_MAX_REASONS, MIN_GRADE_HISTORY_SECTIONS, scheduleReasons } from "@/lib/reasons";
import type { CourseHistory, GradeCounts } from "@/lib/grades-history/types";
import type { Reason, ReasonKind, ScheduleReasonsInput } from "@/lib/reasons/types";

const zeroWeights: OptWeights = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };
const noConstraints = { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null };

function section(id: string, courseCode: string, meetings: OptimizeRequest["courses"][number]["sections"][number]["meetings"], rating = 4) {
  return { id, courseCode, rating, meetings };
}

function request(courses: OptimizeRequest["courses"], weights: OptWeights, overrides: Partial<OptimizeRequest> = {}): OptimizeRequest {
  return {
    courses,
    locks: {},
    excluded: [],
    constraints: noConstraints,
    weights,
    walkingTime: () => ({ seconds: 960, source: "campus-network" }),
    ...overrides,
  };
}

function at(day: OptimizeRequest["courses"][number]["sections"][number]["meetings"][number]["day"], start: number, end: number, buildingId: string | null) {
  return { day, start, end, buildingId };
}

function courseHistory(sectionCount: number): CourseHistory {
  const counts: GradeCounts = { A: 62, B: 20, C: 10, D: 4, F: 2, W: 1, Z: 1 };
  return {
    course: { subject: "BIOL", number: "2040", title: "Micro" },
    terms: [],
    sectionCount,
    gpa: 3.1,
    counts,
    total: 100,
    grades: {
      gradeA: 62,
      gradeB: 20,
      gradeC: 10,
      gradeD: 4,
      gradeF: 2,
      gradeP: 0,
      gradeNP: 0,
      gradeW: 1,
      gradeWF: 0,
      gradeI: 0,
      gradePR: 0,
      gradeNPR: 0,
      gradeZ: 1,
      gradeSuppressed: 0,
      totalEnroll: 100,
    },
  };
}

const KINDS: ReasonKind[] = ["preference-met", "trade-off", "comparison", "grade-history", "walking", "seats"];

function assertEvidence(reason: Reason): void {
  expect(reason.sentence.length).toBeGreaterThan(0);
  expect(reason.sentence.endsWith(".")).toBe(true);
  expect(KINDS).toContain(reason.kind);
  expect(reason.strength).toBeGreaterThanOrEqual(0);
  expect(reason.strength).toBeLessThanOrEqual(1);
  // Strict: no reason without evidence.
  expect(reason.evidence.numbers.length).toBeGreaterThan(0);
  for (const number of reason.evidence.numbers) {
    expect(number.label.length).toBeGreaterThan(0);
  }
  for (const fact of reason.evidence.facts) {
    expect(fact.length).toBeGreaterThan(0);
  }
}

describe("scheduleReasons", () => {
  // Two courses, each with two options. The gap-free same-day pairs are the
  // cheapest: {s1, c1} walks 0 seconds (both in LANG), {s0, c0} walks 960
  // (LANG to LAB). The optimizer itself ranks them, so every comparison is
  // relative to its actual alternatives.
  const walkingRequest = () =>
    request(
      [
        {
          code: "MATH 1650",
          credits: 3,
          sections: [section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG")]), section("s1", "MATH 1650", [at("Mon", 780, 840, "LANG")])],
        },
        {
          code: "CHEM 2370",
          credits: 3,
          sections: [section("c0", "CHEM 2370", [at("Mon", 600, 660, "LAB")]), section("c1", "CHEM 2370", [at("Mon", 840, 900, "LANG")])],
        },
      ],
      { ...zeroWeights, compact: 1, walking: 2 },
    );

  test("every reason carries evidence: the exact facts and numbers it rests on", () => {
    const result = optimize(walkingRequest());
    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;
    for (const schedule of result.schedules) {
      for (const reason of scheduleReasons({ schedule, alternatives: result.schedules, request: walkingRequest() })) {
        assertEvidence(reason);
      }
    }
  });

  test("a comparison is relative to the optimizer's actual alternatives, in its own numbers", () => {
    const result = optimize(walkingRequest());
    if (result.status !== "optimal") throw new Error("expected optimal");
    const first = result.schedules[0];
    const reasons = scheduleReasons({ schedule: first, alternatives: result.schedules, request: walkingRequest() });
    // 960 seconds between LANG and LAB: exactly 16 minutes.
    expect(reasons.some((reason) => reason.kind === "comparison" && reason.sentence === "It means 16 minutes less of walking a week than the next option.")).toBe(true);
  });

  test("trade-offs are stated honestly, with both sides' numbers as evidence", () => {
    // The winner pairs MATH with the back-to-back CHEM lab in LAB: a
    // 16-minute cross-building walk, no idle time. The runner-up stays in
    // LANG but leaves a 3-hour gap. The winner ranks first and still says
    // what it gives up, with both schedules' numbers as evidence.
    const req = request(
      [
        {
          code: "MATH 1650",
          credits: 3,
          sections: [section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG")])],
        },
        {
          code: "CHEM 2370",
          credits: 3,
          sections: [section("c0", "CHEM 2370", [at("Mon", 600, 660, "LAB")]), section("c1", "CHEM 2370", [at("Mon", 780, 840, "LANG")])],
        },
      ],
      { ...zeroWeights, compact: 1, walking: 2 },
    );
    const result = optimize(req);
    if (result.status !== "optimal") throw new Error("expected optimal");
    const first = result.schedules[0];
    const reasons = scheduleReasons({ schedule: first, alternatives: result.schedules, request: req });
    const tradeOff = reasons.find((reason) => reason.kind === "trade-off");
    expect(tradeOff).toBeDefined();
    expect(tradeOff!.sentence).toBe("It means 16 minutes more of walking a week than the next option.");
    expect(tradeOff!.preference).toBe("walking");
    const labels = tradeOff!.evidence.numbers.map((number) => number.label).join(" ");
    expect(labels).toContain("this schedule");
    expect(labels).toContain("next option");
  });

  test("a ranked-first schedule still names what it gives up", () => {
    // fewerDays 3 vs compact 1: one day on campus wins even with a 2-hour gap.
    const req = request(
      [
        {
          code: "MATH 1650",
          credits: 3,
          sections: [section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG")]), section("s1", "MATH 1650", [at("Tue", 540, 600, "LANG")])],
        },
        {
          code: "CHEM 2370",
          credits: 3,
          sections: [section("c0", "CHEM 2370", [at("Mon", 720, 780, "LANG")])],
        },
      ],
      { ...zeroWeights, fewerDays: 3, compact: 1 },
    );
    const result = optimize(req);
    if (result.status !== "optimal") throw new Error("expected optimal");
    const reasons = scheduleReasons({ schedule: result.schedules[0], alternatives: result.schedules, request: req });
    expect(reasons.some((reason) => reason.kind === "comparison" && reason.sentence === "It means 1 fewer day on campus each week than the next option.")).toBe(true);
    expect(reasons.some((reason) => reason.kind === "trade-off" && reason.sentence === "It means 120 minutes more of idle time between classes than the next option.")).toBe(true);
  });

  test("reasons rank by the student's stated preferences", () => {
    const req = (weights: OptWeights) =>
      request(
        [
          {
            code: "MATH 1650",
            credits: 3,
            sections: [section("s0", "MATH 1650", [at("Mon", 480, 540, "LANG")], 3), section("s1", "MATH 1650", [at("Mon", 780, 840, "LANG")], 4)],
          },
        ],
        weights,
      );

    // Morning weight dominates: the top reason is about mornings.
    const earlyWeights: OptWeights = { ...zeroWeights, mornings: 4, rating: 1 };
    const earlyResult = optimize(req(earlyWeights));
    if (earlyResult.status !== "optimal") throw new Error("expected optimal");
    const early = scheduleReasons({ schedule: earlyResult.schedules[0], alternatives: earlyResult.schedules, request: req(earlyWeights) });
    expect(early[0].preference).toBe("mornings");
    // Flip the weights and the top reason follows the stated preference.
    const ratedWeights: OptWeights = { ...zeroWeights, mornings: 1, rating: 4 };
    const ratedResult = optimize(req(ratedWeights));
    if (ratedResult.status !== "optimal") throw new Error("expected optimal");
    const rated = scheduleReasons({ schedule: ratedResult.schedules[0], alternatives: ratedResult.schedules, request: req(ratedWeights) });
    expect(rated[0].preference).toBe("rating");
  });

  test("at most 3 reasons by default, and maxReasons is honored", () => {
    const result = optimize(walkingRequest());
    if (result.status !== "optimal") throw new Error("expected optimal");
    const input: ScheduleReasonsInput = { schedule: result.schedules[0], alternatives: result.schedules, request: walkingRequest() };
    expect(scheduleReasons(input).length).toBeLessThanOrEqual(DEFAULT_MAX_REASONS);
    expect(scheduleReasons({ ...input, maxReasons: 1 }).length).toBe(1);
    expect(scheduleReasons({ ...input, maxReasons: 0 }).length).toBe(0);
    expect(() => scheduleReasons({ ...input, maxReasons: -1 })).toThrow();
  });

  test("with no stated preferences and nothing supplied, there is nothing to say", () => {
    const req = request(
      [
        {
          code: "MATH 1650",
          credits: 3,
          sections: [section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG")]), section("s1", "MATH 1650", [at("Mon", 780, 840, "LANG")])],
        },
      ],
      zeroWeights,
    );
    const result = optimize(req);
    if (result.status !== "optimal") throw new Error("expected optimal");
    const reasons = scheduleReasons({ schedule: result.schedules[0], alternatives: result.schedules, request: req });
    expect(reasons).toEqual([]);
  });

  test("walking reasons keep unknown walks unknown and label the assumption", () => {
    const req = request(
      [
        {
          code: "MATH 1650",
          credits: 3,
          sections: [section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG")])],
        },
        {
          code: "CHEM 2370",
          credits: 3,
          sections: [section("c0", "CHEM 2370", [at("Mon", 600, 660, "LAB")])],
        },
      ],
      { ...zeroWeights, walking: 1 },
      { walkingTime: () => ({ source: "unknown", seconds: null }) },
    );
    const result = optimize(req);
    if (result.status !== "optimal") throw new Error("expected optimal");
    const reasons = scheduleReasons({ schedule: result.schedules[0], alternatives: result.schedules, request: req });
    const walking = reasons.find((reason) => reason.kind === "walking");
    expect(walking).toBeDefined();
    expect(walking!.sentence).toBe("walk time is unknown for 1 back-to-back pair, and the estimate assumes 10 minutes for it.");
    expect(walking!.preference).toBe("walking");
    const labels = walking!.evidence.numbers.map((number) => number.label).join(" ");
    expect(labels).toContain("unknown walks");
    expect(labels).toContain("assumed seconds per unknown walk");
    expect(walking!.evidence.facts.join(" ")).toContain("not a measurement");
  });

  test("seat reasons come from supplied counts, and unknown seats say nothing", () => {
    const result = optimize(walkingRequest());
    if (result.status !== "optimal") throw new Error("expected optimal");
    const input: ScheduleReasonsInput = {
      schedule: result.schedules[0],
      alternatives: result.schedules,
      request: walkingRequest(),
      seats: { c1: { open: 0, total: 30 }, s1: { open: null, total: null } },
    };
    const seats = scheduleReasons(input).filter((reason) => reason.kind === "seats");
    expect(seats.length).toBe(1);
    expect(seats[0].sentence).toBe("Section c1 of CHEM 2370 has no open seats left.");
    expect(
      scheduleReasons({ ...input, seats: { c1: { open: null, total: null } } }).some((reason) => reason.kind === "seats"),
    ).toBe(false);
  });

  test("grade history appears only above the minimum section count, and never predicts", () => {
    const req = request(
      [
        {
          code: "BIOL 2040",
          credits: 3,
          sections: [section("b0", "BIOL 2040", [at("Mon", 540, 600, "LANG")]), section("b1", "BIOL 2040", [at("Mon", 780, 840, "LANG")])],
        },
      ],
      zeroWeights,
    );
    const result = optimize(req);
    if (result.status !== "optimal") throw new Error("expected optimal");
    const input: ScheduleReasonsInput = {
      schedule: result.schedules[0],
      alternatives: result.schedules,
      request: req,
      gradeHistory: { "BIOL 2040": courseHistory(MIN_GRADE_HISTORY_SECTIONS - 1) },
    };
    expect(scheduleReasons(input).some((reason) => reason.kind === "grade-history")).toBe(false);
    const full = scheduleReasons({ ...input, gradeHistory: { "BIOL 2040": courseHistory(MIN_GRADE_HISTORY_SECTIONS) } });
    const history = full.find((reason) => reason.kind === "grade-history");
    expect(history).toBeDefined();
    expect(history!.sentence).toBe("Across 10 past sections of BIOL 2040, 82% of recorded grades were an A or B (GPA 3.10).");
    expect(history!.evidence.facts.join(" ")).toContain("descriptive only");
  });

  test("a schedule outside the alternatives is a programming error", () => {
    const result = optimize(walkingRequest());
    if (result.status !== "optimal") throw new Error("expected optimal");
    const outsider: RankedSchedule = { ...result.schedules[0] };
    expect(() =>
      scheduleReasons({ schedule: outsider, alternatives: result.schedules, request: walkingRequest() }),
    ).toThrow("reasons: schedule must be one of the alternatives");
  });
});
