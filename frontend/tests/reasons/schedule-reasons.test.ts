import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import {
  costTerms,
  COST_PER_DAY,
  COST_PER_GAP_MINUTE,
  COST_PER_LEAN_MINUTE,
  COST_PER_RATING_TENTH,
  COST_PER_WALK_SECOND,
  neutralRatingTenths,
} from "@/lib/optimizer/score";
import type { OptimizeRequest, OptWeights, RankedSchedule } from "@/lib/optimizer/types";
import { FIRST_HALF, SECOND_HALF } from "../optimizer/generator";
import { DEFAULT_MAX_REASONS, MIN_GRADE_SAMPLE, scheduleReasons } from "@/lib/reasons";
import type { GradeCounts, GradeTotals } from "@/lib/grades-history/types";
import type { Reason, ReasonEvidence, ReasonKind, ScheduleReasonsInput } from "@/lib/reasons/types";
import type { Seats } from "@/lib/sections/model";

type Course = OptimizeRequest["courses"][number];
type Meeting = Course["sections"][number]["meetings"][number];
type Day = Meeting["day"];

const zeroWeights: OptWeights = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };
const noConstraints = { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null };

function section(id: string, courseCode: string, meetings: Meeting[], rating: number | null = 4, label?: string): Course["sections"][number] {
  return { id, courseCode, rating, meetings, ...(label ? { label } : {}) };
}

function request(courses: Course[], weights: OptWeights, overrides: Partial<OptimizeRequest> = {}): OptimizeRequest {
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

function at(day: Day, start: number, end: number, buildingId: string | null): Meeting {
  return { day, start, end, buildingId };
}

function dated(day: Day, start: number, end: number, buildingId: string | null, dates: { start: string; end: string }): Meeting {
  return { ...at(day, start, end, buildingId), dates };
}

function instructorTotals(parts: { a: number; b: number; c: number; d: number; f: number; w?: number; i?: number }): GradeTotals {
  const counts: GradeCounts = {
    A: parts.a,
    B: parts.b,
    C: parts.c,
    D: parts.d,
    F: parts.f,
    ...(parts.w ? { W: parts.w } : {}),
    ...(parts.i ? { I: parts.i } : {}),
  };
  const totalEnroll = parts.a + parts.b + parts.c + parts.d + parts.f + (parts.w ?? 0) + (parts.i ?? 0);
  return {
    counts,
    total: totalEnroll,
    grades: {
      gradeA: parts.a,
      gradeB: parts.b,
      gradeC: parts.c,
      gradeD: parts.d,
      gradeF: parts.f,
      gradeP: 0,
      gradeNP: 0,
      gradeW: parts.w ?? 0,
      gradeWF: 0,
      gradeI: parts.i ?? 0,
      gradePR: 0,
      gradeNPR: 0,
      gradeZ: 0,
      gradeSuppressed: 0,
      totalEnroll,
    },
  };
}

const KINDS: ReasonKind[] = ["preference-met", "trade-off", "comparison", "fact", "grade-history", "travel-unknown", "seats"];

/** Numbers appearing in a sentence, ignoring course codes like "MATH 1650" (identifiers, not quantities). */
function numericTokens(text: string): number[] {
  return [...text.replace(/[A-Z]{2,4}\s\d+[A-Z]?/g, " ").matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

function assertEvidence(reason: Reason): void {
  // One plain sentence, one fact: a reason that joins two with a semicolon is two reasons.
  expect(reason.sentence.length).toBeGreaterThan(0);
  expect(reason.sentence.endsWith(".")).toBe(true);
  expect(reason.sentence).not.toContain(";");
  expect(/^[A-Z]/.test(reason.sentence)).toBe(true);
  expect(KINDS).toContain(reason.kind);
  // Strict: no reason without evidence.
  expect(reason.evidence.numbers.length).toBeGreaterThan(0);
  const allowed = new Set<number>();
  for (const entry of reason.evidence.numbers as ReasonEvidence["numbers"]) {
    expect(entry.label.length).toBeGreaterThan(0);
    if (typeof entry.value === "number") allowed.add(entry.value);
    else for (const token of numericTokens(entry.value)) allowed.add(token);
  }
  // Every number the sentence quotes must be in its evidence.
  for (const token of numericTokens(reason.sentence)) {
    expect(allowed.has(token), `sentence number ${token} missing from evidence of: ${reason.sentence}`).toBe(true);
  }
}

function allReasons(input: Omit<ScheduleReasonsInput, "index">): { index: number; reasons: Reason[] }[] {
  return input.alternatives.map((_, index) => {
    const reasons = scheduleReasons({ ...input, index });
    for (const reason of reasons) assertEvidence(reason);
    return { index, reasons };
  });
}

/** The optimizer's cost, rebuilt as the weighted sum of the exported cost terms. */
function costFromTerms(requested: OptimizeRequest, schedule: RankedSchedule): number {
  const neutralRatingByCourse: Record<string, number> = {};
  const creditsByCourse: Record<string, number> = {};
  for (const course of requested.courses) {
    neutralRatingByCourse[course.code] = neutralRatingTenths(course.sections);
    creditsByCourse[course.code] = course.credits;
  }
  const sections = requested.courses.map((course) => {
    const found = course.sections.find((candidate) => candidate.id === schedule.byCourse[course.code]);
    if (!found) throw new Error(`missing section for ${course.code}`);
    return found;
  });
  const terms = costTerms({
    sections,
    term: requested.term,
    creditsByCourse,
    neutralRatingByCourse,
    weights: requested.weights,
    walkingTime: requested.walkingTime,
  });
  return (
    requested.weights.fewerDays * COST_PER_DAY * terms.daysOnCampus +
    requested.weights.compact * COST_PER_GAP_MINUTE * terms.gapMinutes +
    requested.weights.walking * COST_PER_WALK_SECOND * terms.travelSeconds +
    COST_PER_LEAN_MINUTE * (requested.weights.mornings * terms.morningLeanMinutes + requested.weights.evenings * terms.eveningLeanMinutes) +
    requested.weights.rating * COST_PER_RATING_TENTH * terms.ratingShortfallTenths
  );
}

function optimal(req: OptimizeRequest): RankedSchedule[] {
  const result = optimize(req);
  expect(result.status).toBe("optimal");
  if (result.status !== "optimal") throw new Error("expected optimal");
  return result.schedules;
}

describe("scheduleReasons", () => {
  // Two courses, two options each. Same-day back-to-back pairs are cheapest:
  // {s1, c1} has no gap and no travel (both LANG), {s0, c0} is back-to-back
  // across buildings (LANG to LAB, 960 s), {s1, c0} leaves a 2-hour gap, and
  // {s0, c1} both a 3-hour gap and no travel. The optimizer ranks them, so
  // every comparison is relative to its actual alternatives.
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

  // The winner pairs MATH with the back-to-back Tuesday CHEM section: one day
  // on campus but a 2-hour gap. The runner-up spreads over two days with no
  // gap. With fewerDays at 3 the winner ranks first and still says what it
  // gives up.
  const rankedFirstRequest = (weights: Partial<OptWeights>) =>
    request(
      [
        { code: "MATH 1650", credits: 3, sections: [section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG")])] },
        {
          code: "CHEM 2370",
          credits: 3,
          sections: [section("c0", "CHEM 2370", [at("Mon", 720, 780, "LANG")]), section("c1", "CHEM 2370", [at("Tue", 540, 600, "LANG")])],
        },
      ],
      { ...zeroWeights, ...weights },
    );

  test("the optimizer's cost is the weighted sum of the exported cost terms", () => {
    const cases = [
      rankedFirstRequest({ fewerDays: 3, compact: 1 }),
      rankedFirstRequest({ fewerDays: 1, compact: 4 }),
      request(
        [
          { code: "MATH 1650", credits: 3, sections: [section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG")])] },
          { code: "CHEM 2370", credits: 3, sections: [section("c0", "CHEM 2370", [at("Mon", 600, 660, "SCI")]), section("c1", "CHEM 2370", [at("Mon", 600, 660, "GHOST")])] },
        ],
        { ...zeroWeights, walking: 2 },
        { walkingTime: (from: string, to: string) => (from === "LANG" && to === "SCI" ? { seconds: 300, source: "campus-network" as const } : { seconds: null, source: "unknown" as const }) },
      ),
      request(
        [
          {
            code: "MATH 1650",
            credits: 3,
            sections: [
              section("s0", "MATH 1650", [dated("Mon", 480, 540, "LANG", FIRST_HALF), dated("Wed", 720, 780, "LANG", SECOND_HALF)]),
              section("s1", "MATH 1650", [dated("Mon", 540, 600, "LANG", FIRST_HALF), dated("Wed", 750, 810, "LANG", SECOND_HALF)]),
            ],
          },
        ],
        { ...zeroWeights, mornings: 4 },
        { term: { start: "2027-01-11", end: "2027-05-07" } },
      ),
      request(
        [
          {
            code: "MATH 1650",
            credits: 3,
            sections: [
              section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG")], null),
              section("s1", "MATH 1650", [at("Mon", 540, 600, "LANG")], 5),
              section("s2", "MATH 1650", [at("Tue", 540, 600, "LANG")], 3),
            ],
          },
        ],
        { ...zeroWeights, rating: 4 },
      ),
    ];
    for (const req of cases) {
      for (const schedule of optimal(req)) {
        expect(schedule.cost).toBe(costFromTerms(req, schedule));
      }
    }
  });

  test("every reason carries evidence, and every number in the sentence is in it", () => {
    const requests = [
      walkingRequest(),
      rankedFirstRequest({ fewerDays: 3, compact: 1 }),
      request(
        [{ code: "MATH 1650", credits: 3, sections: [section("s0", "MATH 1650", [at("Mon", 480, 540, "LANG")])], }],
        { ...zeroWeights, fewerDays: 1, compact: 1, mornings: 1, rating: 1 },
      ),
      request(
        [
          { code: "MATH 1650", credits: 3, sections: [section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG")])] },
          { code: "CHEM 2370", credits: 3, sections: [section("c0", "CHEM 2370", [at("Mon", 600, 660, "LAB")])] },
        ],
        { ...zeroWeights, walking: 2 },
        { walkingTime: () => ({ seconds: null, source: "unknown" as const }) },
      ),
    ];
    for (const req of requests) {
      const schedules = optimal(req);
      for (const { reasons } of allReasons({ alternatives: schedules, request: req })) {
        expect(reasons.length).toBeGreaterThan(0);
      }
    }
  });

  test("a comparison is relative to the next actual option, named as the UI names it", () => {
    const req = walkingRequest();
    const schedules = optimal(req);
    const { reasons } = allReasons({ alternatives: schedules, request: req })[0];
    // 960 seconds between LANG and LAB: exactly 16 minutes, against Option B.
    // The winner itself is walk-free (LANG next to LANG), so the comparison
    // is favorable, not a trade-off.
    expect(reasons.some((reason) => reason.kind === "comparison" && reason.sentence === "It means 16 minutes less travel time between classes than Option B.")).toBe(true);
    const comparison = reasons.find((reason) => reason.kind === "comparison" && reason.preference === "walking");
    expect(comparison).toBeDefined();
    expect(comparison!.evidence.numbers.some((entry) => entry.label.startsWith("Option A:"))).toBe(true);
    expect(comparison!.evidence.numbers.some((entry) => entry.label.startsWith("Option B:"))).toBe(true);
  });

  test("a ranked-first schedule still names what it gives up", () => {
    const req = rankedFirstRequest({ fewerDays: 3, compact: 1 });
    const schedules = optimal(req);
    const { reasons } = allReasons({ alternatives: schedules, request: req })[0];
    expect(reasons.some((reason) => reason.kind === "comparison" && reason.sentence === "It means 1 day fewer on campus than Option B.")).toBe(true);
    expect(reasons.some((reason) => reason.kind === "trade-off" && reason.sentence === "Time between classes runs 120 minutes longer than Option B's.")).toBe(true);
  });

  test("reasons rank by how much the difference is worth: weight times the optimizer's per-unit cost", () => {
    const rankedFirst = rankedFirstRequest({ fewerDays: 3, compact: 1 });
    const first = allReasons({ alternatives: optimal(rankedFirst), request: rankedFirst })[0].reasons;
    expect(first[0].preference).toBe("fewerDays");
    expect(first[1].preference).toBe("compact");

    // Same two schedules with the weights flipped: the gap difference now
    // outweighs the day difference, and the order follows.
    const flipped = rankedFirstRequest({ fewerDays: 1, compact: 4 });
    const flippedReasons = allReasons({ alternatives: optimal(flipped), request: flipped })[0].reasons;
    expect(flippedReasons[0].preference).toBe("compact");
    expect(flippedReasons[1].preference).toBe("fewerDays");
  });

  test("one reason per preference: a comparison replaces the fact", () => {
    const req = walkingRequest();
    const schedules = optimal(req);
    const { reasons } = allReasons({ alternatives: schedules, request: req })[0];
    const walking = reasons.filter((reason) => reason.preference === "walking");
    expect(walking.length).toBe(1);
    expect(walking[0].kind).toBe("comparison");
    const compact = reasons.filter((reason) => reason.preference === "compact");
    expect(compact.length).toBe(1);
    expect(compact[0].kind).toBe("preference-met");
  });

  test("at most three reasons by default, and maxReasons is honored or rejected", () => {
    // One section, four weighted preferences: four facts, capped at three.
    const req = request(
      [{ code: "MATH 1650", credits: 3, sections: [section("s0", "MATH 1650", [at("Mon", 480, 540, "LANG")])] }],
      { ...zeroWeights, fewerDays: 1, compact: 1, mornings: 1, rating: 1 },
    );
    const schedules = optimal(req);
    expect(schedules.length).toBe(1);
    const base = { alternatives: schedules, request: req };
    expect(scheduleReasons({ ...base, index: 0 }).length).toBe(3);
    expect(scheduleReasons({ ...base, index: 0 }).length).toBe(DEFAULT_MAX_REASONS);
    expect(scheduleReasons({ ...base, index: 0, maxReasons: 4 }).length).toBe(4);
    expect(scheduleReasons({ ...base, index: 0, maxReasons: 1 }).length).toBe(1);
    expect(scheduleReasons({ ...base, index: 0, maxReasons: 0 })).toEqual([]);
    expect(() => scheduleReasons({ ...base, index: 0, maxReasons: -1 })).toThrow("reasons: maxReasons must be a non-negative number");
    expect(() => scheduleReasons({ ...base, index: 0, maxReasons: Number.NaN })).toThrow("reasons: maxReasons must be a non-negative number");
  });

  test("with no stated preferences and nothing supplied, there is nothing to say", () => {
    const req = request(
      [{ code: "MATH 1650", credits: 3, sections: [section("s0", "MATH 1650", [at("Mon", 480, 540, "LANG")])] }],
      zeroWeights,
    );
    const schedules = optimal(req);
    expect(scheduleReasons({ alternatives: schedules, index: 0, request: req })).toEqual([]);
  });

  test("this schedule's own unknown travel is never compared, only caveated", () => {
    const req = request(
      [
        {
          code: "MATH 1650",
          credits: 3,
          sections: [section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG"), at("Tue", 540, 600, "LANG")])],
        },
        {
          code: "CHEM 2370",
          credits: 3,
          sections: [section("c0", "CHEM 2370", [at("Mon", 600, 660, "LAB")]), section("c1", "CHEM 2370", [at("Tue", 600, 660, "LAB")])],
        },
      ],
      { ...zeroWeights, walking: 2 },
      { walkingTime: () => ({ seconds: null, source: "unknown" as const }) },
    );
    const schedules = optimal(req);
    const { reasons } = allReasons({ alternatives: schedules, request: req })[0];
    expect(reasons.some((reason) => reason.kind === "comparison" || reason.kind === "trade-off")).toBe(false);
    expect(reasons.some((reason) => reason.kind === "travel-unknown" && reason.sentence === "Travel time is unknown for 1 back-to-back pair across buildings, and the estimate counts 10 minutes for it.")).toBe(true);
    expect(reasons.some((reason) => reason.sentence === "Travel time between back-to-back classes adds up to 10 minutes.")).toBe(true);
  });

  test("when only the other option has unknown travel, a lower estimate is stated as at least", () => {
    const req = request(
      [
        { code: "MATH 1650", credits: 3, sections: [section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG"), at("Tue", 540, 600, "LANG")])] },
        {
          code: "CHEM 2370",
          credits: 3,
          sections: [section("c0", "CHEM 2370", [at("Mon", 600, 660, "SCI")]), section("c1", "CHEM 2370", [at("Tue", 600, 660, "GHOST")])],
        },
      ],
      { ...zeroWeights, walking: 2 },
      { walkingTime: (from: string, to: string) => (from === "LANG" && to === "SCI" ? { seconds: 300, source: "campus-network" as const } : { seconds: null, source: "unknown" as const }) },
    );
    const schedules = optimal(req);
    const { reasons } = allReasons({ alternatives: schedules, request: req })[0];
    // 300 known seconds here; the other option's leg is only assumed 600.
    expect(reasons.some((reason) => reason.kind === "comparison" && reason.sentence === "It means at least 5 minutes less travel time between classes than Option B.")).toBe(true);
  });

  test("dated sessions: no reason claims a week", () => {
    const req = request(
      [
        { code: "MATH 1650", credits: 3, sections: [section("s0", "MATH 1650", [dated("Mon", 540, 600, "LANG", FIRST_HALF)])] },
        { code: "CHEM 2370", credits: 3, sections: [section("c0", "CHEM 2370", [dated("Wed", 540, 600, "LANG", SECOND_HALF)])] },
      ],
      { ...zeroWeights, fewerDays: 1 },
      { term: { start: "2027-01-11", end: "2027-05-07" } },
    );
    const schedules = optimal(req);
    expect(schedules.length).toBe(1);
    const { reasons } = allReasons({ alternatives: schedules, request: req })[0];
    expect(reasons.some((reason) => reason.sentence === "It keeps you on campus 2 days.")).toBe(true);
    for (const reason of reasons) {
      expect(reason.sentence.match(/week/i)).toBeNull();
    }
  });

  test("mornings compare the optimizer's mean-start lean, not the earliest start", () => {
    // s0 starts at 8:00 (first half) and noon (second half); s1 starts at
    // 9:00 and 12:30. Earliest starts differ by 60 minutes, but the lean the
    // optimizer scores differs by 45: the mean start after 7 AM.
    const req = request(
      [
        {
          code: "MATH 1650",
          credits: 3,
          sections: [
            section("s0", "MATH 1650", [dated("Mon", 480, 540, "LANG", FIRST_HALF), dated("Wed", 720, 780, "LANG", SECOND_HALF)]),
            section("s1", "MATH 1650", [dated("Mon", 540, 600, "LANG", FIRST_HALF), dated("Wed", 750, 810, "LANG", SECOND_HALF)]),
          ],
        },
      ],
      { ...zeroWeights, mornings: 4 },
      { term: { start: "2027-01-11", end: "2027-05-07" } },
    );
    const schedules = optimal(req);
    expect(schedules.length).toBe(2);
    const { reasons } = allReasons({ alternatives: schedules, request: req })[0];
    expect(reasons.some((reason) => reason.sentence === "Its classes start a combined 45 minutes earlier (counted after 7 AM) than Option B's.")).toBe(true);
    expect(reasons.some((reason) => reason.sentence.includes("60 minutes"))).toBe(false);
  });

  test("unrated sections fill in from the course mean, and one point is singular", () => {
    const req = request(
      [
        {
          code: "MATH 1650",
          credits: 3,
          sections: [
            // s0 and s1 must not share a meeting pattern: the optimizer keeps
            // only the first of same-shaped sections. With the course mean
            // (5 and 3 -> 4.0) filling in s0's rating, it ranks between them.
            section("s0", "MATH 1650", [at("Tue", 540, 600, "LANG")], null),
            section("s1", "MATH 1650", [at("Mon", 540, 600, "LANG")], 5),
            section("s2", "MATH 1650", [at("Tue", 660, 720, "LANG")], 3),
          ],
        },
      ],
      { ...zeroWeights, rating: 4 },
    );
    const schedules = optimal(req);
    // The course mean (5 and 3 -> 4.0) fills in s0's missing rating, and the
    // shortfall comparisons run on that fill-in.
    const { reasons } = allReasons({ alternatives: schedules, request: req })[0];
    expect(reasons.some((reason) => reason.sentence === "Its instructors average 1 point higher than Option B's.")).toBe(true);

    const unrated = request(
      [{ code: "MATH 1650", credits: 3, sections: [section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG")], null)] }],
      { ...zeroWeights, rating: 1 },
    );
    const { reasons: unratedReasons } = allReasons({ alternatives: optimal(unrated), request: unrated })[0];
    expect(unratedReasons.some((reason) => reason.sentence === "No section of this schedule has a rating.")).toBe(true);
  });

  test("seat reasons come from the shared Seats type and unknowns say nothing", () => {
    const base = () =>
      request([{ code: "MATH 1650", credits: 3, sections: [section("s0", "MATH 1650", [at("Mon", 540, 600, "LANG")], 4, "Lab")] }], zeroWeights);
    const schedules = optimal(base());
    const input = (seats: Readonly<Record<string, Seats>>): ScheduleReasonsInput => ({ alternatives: schedules, index: 0, request: base(), seats });
    const closed = scheduleReasons(input({ s0: { open: 0, total: 30 } }));
    expect(closed.some((reason) => reason.kind === "seats" && reason.sentence === "Section Lab of MATH 1650 has no open seats left.")).toBe(true);
    const tight = scheduleReasons(input({ s0: { open: 3, total: 30 } }));
    expect(tight.some((reason) => reason.kind === "seats" && reason.sentence === "Section Lab of MATH 1650 has 3 of 30 seats open.")).toBe(true);
    const roomy = scheduleReasons(input({ s0: { open: 20, total: 30 } }));
    expect(roomy.some((reason) => reason.kind === "seats")).toBe(false);
    const unknown = scheduleReasons(input({ s0: { open: null, total: null } }));
    expect(unknown).toEqual([]);
  });

  test("grade history describes the chosen instructor's past sections on an A through F denominator", () => {
    const req = request(
      [{ code: "BIOL 2040", credits: 3, sections: [section("b0", "BIOL 2040", [at("Mon", 540, 600, "LANG")])] }],
      zeroWeights,
    );
    const schedules = optimal(req);
    const reasons = scheduleReasons({
      alternatives: schedules,
      index: 0,
      request: req,
      instructorGradeHistory: { b0: instructorTotals({ a: 62, b: 20, c: 10, d: 4, f: 4, w: 50, i: 20 }) },
    });
    expect(MIN_GRADE_SAMPLE).toBe(10);
    expect(reasons.some((reason) => reason.kind === "grade-history" && reason.sentence === "Across past sections taught by this section's instructor, 82% of 100 graded students earned an A or B in BIOL 2040.")).toBe(true);
    const grade = reasons.find((reason) => reason.kind === "grade-history");
    expect(grade).toBeDefined();
    const denominator = grade!.evidence.numbers.find((entry) => entry.label === "graded students (A through F)");
    expect(denominator!.value).toBe(100);

    const thin = scheduleReasons({
      alternatives: schedules,
      index: 0,
      request: req,
      instructorGradeHistory: { b0: instructorTotals({ a: 3, b: 2, c: 2, d: 1, f: 1 }) },
    });
    expect(thin.some((reason) => reason.kind === "grade-history")).toBe(false);
  });

  test("a schedule outside the alternatives, or a bad cap, is a programming error", () => {
    const req = walkingRequest();
    const schedules = optimal(req);
    const base = { alternatives: schedules, request: req };
    expect(() => scheduleReasons({ ...base, index: -1 })).toThrow("reasons: index must point at one of the alternatives");
    expect(() => scheduleReasons({ ...base, index: schedules.length })).toThrow("reasons: index must point at one of the alternatives");
    expect(() => scheduleReasons({ ...base, index: 0, maxReasons: -1 })).toThrow("reasons: maxReasons must be a non-negative number");
    expect(() => scheduleReasons({ ...base, index: 0, maxReasons: Number.NaN })).toThrow("reasons: maxReasons must be a non-negative number");
  });
});
