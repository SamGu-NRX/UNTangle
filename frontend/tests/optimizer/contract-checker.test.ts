import { describe, expect, it } from "bun:test";
import { checkSchedule, checkResult, runChecker, verifyIis, type Violation } from "../../src/lib/optimizer/checker";
import type { OptimizeRequest, OptimizedSchedule, OptimizerSection, ScoreBreakdown, WalkingTimeFn } from "../../src/lib/optimizer/types";

/** Deterministic walking: same building 0; known pairs a fixed pseudo-distance. */
const walking: WalkingTimeFn = (from, to) => {
  if (from === to) return { seconds: 0, source: "campus-network" };
  const known = new Set(["life", "chem", "matt"]);
  if (known.has(from) && known.has(to)) return { seconds: 300, source: "straight-line" };
  return { seconds: null, source: "unknown" };
};

function section(id: string, courseCode: string, credits: number, meetings: OptimizerSection["meetings"], extra: Partial<OptimizerSection> = {}): OptimizerSection {
  return { id, courseCode, credits, meetings, ...extra };
}

/** Two courses: A = {a1, a2, a3, a4}, B = {b1, b2, b3}. Hand-crafted times. */
function baseRequest(): OptimizeRequest {
  return {
    sections: [
      section("a1", "A 1", 3, [{ day: "Mon", start: 540, end: 600, buildingId: "life" }], { instructorRating: 4 }),
      section("a2", "A 1", 4, [{ day: "Mon", start: 660, end: 720, buildingId: "chem" }]),
      section("a3", "A 1", 3, [{ day: "Mon", start: 570, end: 630, buildingId: "matt" }]),
      section("a4", "A 1", 3, [{ day: "Tue", start: 540, end: 600, buildingId: "life" }]),
      section("b1", "B 2", 3, [{ day: "Mon", start: 600, end: 660, buildingId: "matt" }], { historicalGpa: 3 }),
      section("b2", "B 2", 3, [{ day: "Mon", start: 540, end: 600, buildingId: "matt" }]),
      section("b3", "B 2", 3, [{ day: "Mon", start: 630, end: 690, buildingId: "life" }]),
    ],
    requestedCourseCodes: ["A 1", "B 2"],
    lockedSectionIds: [],
    excludedSectionIds: [],
    hardConstraints: {},
    softWeights: {
      perGapMinute: 1, perWalkingSecond: 0.5, perEarlyStartMinute: 1, perLateEndMinute: 1,
      perDayOnCampus: 10, perRatingPoint: 1, perGpaPoint: 1, perUnknownWalking: 25,
    },
    k: 3,
    timeBudgetMs: 1000,
    walkingTime: walking,
  };
}

/** Hand-verified valid schedule: a1 (Mon 540-600 life) + b1 (Mon 600-660 matt). */
function validBreakdown(): ScoreBreakdown {
  return {
    gapMinutes: 0, walkingSeconds: 300, earlyStartMinutes: 0, lateEndMinutes: 0,
    daysOnCampus: 1, ratingSum: 4, gpaSum: 3, unknownWalkingPairs: 0,
    cost: 0.5 * 300 + 10 * 1 - 1 * 4 - 1 * 3, // 150 + 10 - 4 - 3 = 153
  };
}

function validSchedule(): OptimizedSchedule {
  return { sectionIds: ["a1", "b1"], byCourse: { "A 1": "a1", "B 2": "b1" }, breakdown: validBreakdown() };
}

function rules(violations: Violation[]): string[] {
  return [...new Set(violations.map((v) => v.rule))];
}

describe("valid schedule", () => {
  it("hand-verified schedule produces zero violations", () => {
    expect(checkSchedule(baseRequest(), ["a1", "b1"])).toEqual([]);
  });
});

describe("per-rule mutations", () => {
  it("overlap", () => {
    const violations = checkSchedule(baseRequest(), ["a3", "b1"]); // a3 570-630 vs b1 600-660
    expect(rules(violations)).toEqual(["overlap"]);
    expect(violations[0].ids.sort()).toEqual(["a3", "b1"]);
  });

  it("maxCredits", () => {
    const req = baseRequest();
    req.hardConstraints = { maxCredits: 5 };
    const violations = checkSchedule(req, ["a2", "b1"]); // 4 + 3 = 7 > 5
    expect(rules(violations)).toEqual(["maxCredits"]);
  });

  it("earliestStart", () => {
    const req = baseRequest();
    req.hardConstraints = { earliestStart: 600 };
    const violations = checkSchedule(req, ["a1", "b1"]); // a1 starts 540
    expect(rules(violations)).toEqual(["earliestStart"]);
    expect(violations[0].ids).toEqual(["a1"]);
  });

  it("latestEnd", () => {
    const req = baseRequest();
    req.hardConstraints = { latestEnd: 600 };
    const violations = checkSchedule(req, ["a2", "b2"]); // a2 ends 720; b2 ends 600
    expect(rules(violations)).toEqual(["latestEnd"]);
    expect(violations[0].ids).toEqual(["a2"]);
  });

  it("daysOff", () => {
    const req = baseRequest();
    req.hardConstraints = { daysOff: ["Mon"] };
    const violations = checkSchedule(req, ["a1", "b1"]);
    expect(rules(violations)).toEqual(["daysOff"]);
  });

  it("blockedTimeRanges", () => {
    const req = baseRequest();
    req.hardConstraints = { blockedTimeRanges: [{ day: "Mon", start: 690, end: 720 }] };
    const violations = checkSchedule(req, ["a2", "b1"]); // a2 660-720 overlaps 690-720
    expect(rules(violations)).toEqual(["blockedTimeRanges"]);
    expect(violations[0].ids).toEqual(["a2"]);
  });

  it("minTransferMinutes", () => {
    const req = baseRequest();
    req.hardConstraints = { minTransferMinutes: 30 };
    const violations = checkSchedule(req, ["a1", "b1"]); // gap 0 < 30, life->matt
    expect(rules(violations)).toEqual(["minTransferMinutes"]);
    expect(violations[0].ids.sort()).toEqual(["a1", "b1"]);
  });

  it("minTransferMinutes exempts same-building pairs", () => {
    const req = baseRequest();
    req.hardConstraints = { minTransferMinutes: 60 };
    // a1 (540-600 life) + b3 (630-690 life): gap 30 < 60 but same building.
    expect(checkSchedule(req, ["a1", "b3"])).toEqual([]);
  });

  it("excluded-section", () => {
    const req = baseRequest();
    req.excludedSectionIds = ["b1"];
    const violations = checkSchedule(req, ["a1", "b1"]);
    expect(rules(violations)).toEqual(["excluded-section"]);
    expect(violations[0].ids).toEqual(["b1"]);
  });

  it("locked-section", () => {
    const req = baseRequest();
    req.lockedSectionIds = ["b2"];
    const violations = checkSchedule(req, ["a1", "b1"]); // b2 required, not chosen
    expect(rules(violations)).toEqual(["locked-section"]);
    expect(violations[0].ids).toEqual(["b2"]);
  });

  it("locked ids outside the requested pool are ignored", () => {
    const req = baseRequest();
    req.lockedSectionIds = ["no-such-section"];
    expect(checkSchedule(req, ["a1", "b1"])).toEqual([]);
  });

  it("course-coverage: two sections for one course and zero for another", () => {
    const violations = checkSchedule(baseRequest(), ["a1", "a2"]);
    expect(rules(violations)).toEqual(["course-coverage"]);
  });

  it("course-coverage: a requested course with no chosen section", () => {
    const violations = checkSchedule(baseRequest(), ["a1"]);
    expect(rules(violations)).toEqual(["course-coverage"]);
    expect(violations[0].ids).toEqual(["B 2"]);
  });

  it("pool-origin: unknown section id (and the coverage hole it leaves)", () => {
    const violations = checkSchedule(baseRequest(), ["a1", "ghost"]);
    expect(rules(violations)).toEqual(["course-coverage", "pool-origin"]);
    const origin = violations.find((v) => v.rule === "pool-origin");
    expect(origin?.ids).toEqual(["ghost"]);
  });
});

describe("result-level checks", () => {
  it("accepts a well-formed result", () => {
    const req = baseRequest();
    const second: OptimizedSchedule = {
      sectionIds: ["a1", "b3"],
      byCourse: { "A 1": "a1", "B 2": "b3" },
      breakdown: {
        gapMinutes: 30, walkingSeconds: 0, earlyStartMinutes: 0, lateEndMinutes: 0,
        daysOnCampus: 1, ratingSum: 4, gpaSum: 0, unknownWalkingPairs: 0,
        cost: 30 + 10 - 4, // 36
      },
    };
    const result = {
      status: "optimal" as const,
      schedules: [second, validSchedule()],
      diversity: 0.5,
      initMs: 0,
      searchMs: 1,
    };
    expect(checkResult(req, result)).toEqual([]);
  });

  it("flags tampered breakdown", () => {
    const req = baseRequest();
    const tampered = validSchedule();
    tampered.breakdown = { ...tampered.breakdown, cost: tampered.breakdown.cost + 1 };
    const result = { status: "optimal" as const, schedules: [tampered], diversity: 0, initMs: 0, searchMs: 0 };
    expect(rules(checkResult(req, result))).toEqual(["breakdown"]);
  });

  it("flags tampered ordering", () => {
    const req = baseRequest();
    const second: OptimizedSchedule = {
      sectionIds: ["a1", "b3"],
      byCourse: { "A 1": "a1", "B 2": "b3" },
      breakdown: {
        gapMinutes: 30, walkingSeconds: 0, earlyStartMinutes: 0, lateEndMinutes: 0,
        daysOnCampus: 1, ratingSum: 4, gpaSum: 0, unknownWalkingPairs: 0, cost: 36,
      },
    };
    const result = {
      status: "optimal" as const,
      schedules: [validSchedule(), second], // 153 then 36: descending
      diversity: 0.5,
      initMs: 0,
      searchMs: 0,
    };
    expect(rules(checkResult(req, result))).toEqual(["ordering"]);
  });

  it("flags tampered tie-break", () => {
    const req = baseRequest();
    // Symmetric request: two same-time section pairs; only walking weight on.
    req.sections = [
      section("c1a", "C 1", 3, [{ day: "Mon", start: 540, end: 600, buildingId: "life" }]),
      section("c1b", "C 1", 3, [{ day: "Mon", start: 540, end: 600, buildingId: "chem" }]),
      section("c2a", "C 2", 3, [{ day: "Mon", start: 600, end: 660, buildingId: "life" }]),
      section("c2b", "C 2", 3, [{ day: "Mon", start: 600, end: 660, buildingId: "chem" }]),
    ];
    req.requestedCourseCodes = ["C 1", "C 2"];
    req.softWeights = {
      perGapMinute: 0, perWalkingSecond: 1, perEarlyStartMinute: 0, perLateEndMinute: 0,
      perDayOnCampus: 0, perRatingPoint: 0, perGpaPoint: 0, perUnknownWalking: 0,
    };
    const zero: ScoreBreakdown = {
      gapMinutes: 0, walkingSeconds: 0, earlyStartMinutes: 0, lateEndMinutes: 0,
      daysOnCampus: 1, ratingSum: 0, gpaSum: 0, unknownWalkingPairs: 0, cost: 0,
    };
    const sLow: OptimizedSchedule = { sectionIds: ["c1a", "c2a"], byCourse: { "C 1": "c1a", "C 2": "c2a" }, breakdown: { ...zero } };
    const sHigh: OptimizedSchedule = { sectionIds: ["c1b", "c2b"], byCourse: { "C 1": "c1b", "C 2": "c2b" }, breakdown: { ...zero } };
    // Equal costs, keys "c1b|c2b" > "c1a|c2a": the bigger key must come second.
    const result = { status: "optimal" as const, schedules: [sHigh, sLow], diversity: 1, initMs: 0, searchMs: 0 };
    expect(rules(checkResult(req, result))).toEqual(["ordering"]);
  });

  it("flags tampered diversity", () => {
    const req = baseRequest();
    const second: OptimizedSchedule = {
      sectionIds: ["a2", "b1"], byCourse: { "A 1": "a2", "B 2": "b1" },
      breakdown: {
        gapMinutes: 0, walkingSeconds: 300, earlyStartMinutes: 0, lateEndMinutes: 0,
        daysOnCampus: 1, ratingSum: 0, gpaSum: 3, unknownWalkingPairs: 0, cost: 157,
      },
    };
    const result = { status: "optimal" as const, schedules: [validSchedule(), second], diversity: 0.9, initMs: 0, searchMs: 0 };
    // True diversity: the pair differs in 1 of 2 course slots -> 0.5.
    expect(rules(checkResult(req, result))).toEqual(["diversity"]);
  });

  it("flags k-exceeded", () => {
    const req = baseRequest();
    req.k = 1;
    const result = { status: "optimal" as const, schedules: [validSchedule(), validSchedule()], diversity: 0, initMs: 0, searchMs: 0 };
    expect(rules(checkResult(req, result))).toEqual(["k-exceeded"]);
  });

  it("flags infeasible status without a subset and timeout over budget", () => {
    const req = baseRequest();
    const noSubset = { status: "infeasible" as const, schedules: [], diversity: 0, initMs: 0, searchMs: 0 };
    expect(rules(checkResult(req, noSubset))).toEqual(["status-infeasible-subset"]);
    const overBudget = { status: "timeout" as const, schedules: [], diversity: 0, initMs: 0, searchMs: req.timeBudgetMs + 51 };
    expect(rules(checkResult(req, overBudget))).toEqual(["status-timeout-budget"]);
  });
});

describe("verifyIis", () => {
  it("accepts a known-irreducible subset", () => {
    const req = baseRequest();
    req.excludedSectionIds = ["b2"];
    req.lockedSectionIds = ["b2"]; // locked and excluded: the only B section
    // Irreducible: {course B 2, locked b2, excluded b2}. Dropping any member
    // unblocks it (no-course -> empty request feasible; no-lock -> b2 free to
    // be chosen; no-exclusion -> locked b2 is choosable).
    const verdict = verifyIis(req, {
      members: [
        { kind: "course", id: "B 2" },
        { kind: "locked", id: "b2" },
        { kind: "excluded", id: "b2" },
      ],
    });
    expect(verdict.subsetInfeasible).toBe(true);
    expect(verdict.allSingleRemovalsFeasible).toBe(true);
  });

  it("rejects a non-irreducible subset", () => {
    const req = baseRequest();
    req.excludedSectionIds = ["b2"];
    req.lockedSectionIds = ["b2"];
    // The irreducible core is {course B 2, locked b2, excluded b2}; adding the
    // redundant {course A 1} member keeps infeasibility but removing it leaves
    // the core infeasible -> not irreducible.
    const verdict = verifyIis(req, {
      members: [
        { kind: "course", id: "A 1" },
        { kind: "course", id: "B 2" },
        { kind: "locked", id: "b2" },
        { kind: "excluded", id: "b2" },
      ],
    });
    expect(verdict.subsetInfeasible).toBe(true);
    expect(verdict.allSingleRemovalsFeasible).toBe(false);
  });
});

describe("runChecker", () => {
  it("validates IIS on infeasible results and reports iis-invalid on a bad subset", () => {
    const req = baseRequest();
    req.excludedSectionIds = ["b2"];
    req.lockedSectionIds = ["b2"];
    const bad = {
      status: "infeasible" as const,
      schedules: [],
      diversity: 0,
      initMs: 0,
      searchMs: 0,
      infeasibleSubset: { members: [{ kind: "course" as const, id: "B 2" }] },
    };
    const violations = runChecker(req, bad);
    expect(rules(violations)).toEqual(["iis-invalid"]);
  });
});
