import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { optimize } from "@/lib/optimizer/optimize";
import { INSTRUCTOR_TIE_BREAK_TOLERANCE, NEUTRAL_INSTRUCTOR_GPA } from "@/lib/optimizer/score";
import type { OptCourse, OptDay, OptMeeting, OptSection, OptimizeRequest, RankedSchedule } from "@/lib/optimizer/types";
import { scheduleReasons } from "@/lib/reasons";
import {
  checkAgainstReference,
  checkBudgets,
  checkExplanations,
  checkLargeInstancesValid,
  smallInstance,
  termInstance,
  withoutDates,
} from "./checks";
import { referenceCost, referenceTopK } from "./reference";

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
const TERM_SEEDS = Array.from({ length: 300 }, (_, i) => 7001 + i);

describe("optimizer against the brute-force reference", () => {
  test("the 400 undated inputs remain byte-identical when dated fixtures gain a term", () => {
    const bytes = JSON.stringify(SEEDS.map(smallInstance));
    // The hash moved once when the generator gained the instructorGpa field
    // on its own stream: every other draw is unchanged, and stripping the
    // field reproduces the previous bytes exactly. After that update it
    // keeps guarding the same stream discipline.
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("03692fee8e5ed4f8f02a6519d1df96da746905845648b5dcef24a236f0721d37");
  });

  test("matches status, ranked schedules, costs and breakdowns on 400 seeded instances", () => {
    expect(checkAgainstReference(optimize, SEEDS)).toEqual([]);
  });

  test("the seeded suite exercises every outcome the comparison relies on", () => {
    let infeasible = 0;
    let fewerThanK = 0;
    let threeAlternatives = 0;
    for (const seed of SEEDS) {
      const { schedules } = referenceTopK(smallInstance(seed));
      if (schedules.length === 0) infeasible += 1;
      else if (schedules.length < 3) fewerThanK += 1;
      else threeAlternatives += 1;
    }
    expect(infeasible).toBeGreaterThan(20);
    expect(fewerThanK).toBeGreaterThan(10);
    expect(threeAlternatives).toBeGreaterThan(50);
  });

  test("infeasibility explanations are minimal: the set conflicts, and dropping any member fixes it", () => {
    const { failures, checked } = checkExplanations(optimize, [...SEEDS, ...Array.from({ length: 150 }, (_, i) => 401 + i)]);
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(20);
  });
});

describe("optimizer against the reference with half-term dates and weekend meetings", () => {
  for (const walking of [true, false]) {
    test(`matches the reference on 300 dated instances, walking check ${walking ? "on" : "off"}`, () => {
      expect(checkAgainstReference(optimize, TERM_SEEDS, (seed) => termInstance(seed, walking))).toEqual([]);
    });
  }

  test("short ranges and empty weekday occurrences agree with enumerated calendar dates", () => {
    const ranges = [
      { start: "2027-01-11", end: "2027-01-17" },
      { start: "2027-01-17", end: "2027-01-24" },
      { start: "2027-01-12", end: "2027-01-12" },
      { start: "2027-05-08", end: "2027-05-14" },
    ];
    const seeds = Array.from({ length: 100 }, (_, i) => 8001 + i);
    for (const walking of [true, false]) {
      expect(checkAgainstReference(optimize, seeds, (seed) => {
        const request = termInstance(seed, walking);
        let index = seed;
        return { ...request, courses: request.courses.map((c) => ({ ...c, sections: c.sections.map((s) => ({
          ...s, meetings: s.meetings.map((m) => ({ ...m, dates: m.dates ? ranges[index++ % ranges.length] : null })),
        })) })) };
      })).toEqual([]);
    }
  });

  test("explanations stay minimal on dated instances", () => {
    const { failures, checked } = checkExplanations(optimize, TERM_SEEDS, (seed) => termInstance(seed, true));
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(10);
  });

  // On these 300 seeds: 92 answers change when the dates are dropped, 24 best
  // schedules use date-disjoint meetings at overlapping times, 72 have idle
  // time or walking that only the dated back-to-back rule gives, and 34 meet
  // on a weekend. The floors are about half, so a generator change that stops
  // exercising dates fails here instead of passing silently.
  test("the dated suite exercises what the dates change", () => {
    let answerChanged = 0;
    let disjointOverlapUsed = 0;
    let pairsChanged = 0;
    let weekendUsed = 0;
    for (const seed of TERM_SEEDS) {
      const request = termInstance(seed, true);
      const undated = withoutDates(request);
      const dated = referenceTopK(request).schedules;
      const plain = referenceTopK(undated).schedules;
      if (JSON.stringify(dated.map((s) => [s.byCourse, s.cost])) !== JSON.stringify(plain.map((s) => [s.byCourse, s.cost]))) answerChanged += 1;
      const best = dated[0];
      if (!best) continue;
      const meetings = best.sections.flatMap((s) => s.meetings);
      if (meetings.some((m) => m.day === "Sat" || m.day === "Sun")) weekendUsed += 1;
      if (meetings.some((a, i) => meetings.some((b, j) => j > i && a.day === b.day && a.start < b.end && b.start < a.end))) disjointOverlapUsed += 1;
      // The same sections scored as if every meeting ran every week.
      const undatedBest = undated.courses.flatMap((c) => c.sections).filter((s) => best.key.includes(s.id));
      const asPlain = referenceCost(undated, undatedBest).breakdown;
      const b = best.breakdown;
      if (b.gapMinutes !== asPlain.gapMinutes || b.walkSeconds !== asPlain.walkSeconds || b.unknownWalks !== asPlain.unknownWalks) pairsChanged += 1;
    }
    expect(answerChanged).toBeGreaterThan(45);
    expect(disjointOverlapUsed).toBeGreaterThan(12);
    expect(pairsChanged).toBeGreaterThan(35);
    expect(weekendUsed).toBeGreaterThan(17);
  });
});

describe("optimizer budgets and large instances", () => {
  test("a cut-off search never claims optimal or infeasible, and returns only valid schedules", () => {
    expect(checkBudgets(optimize)).toEqual([]);
  });

  test("large instances return only schedules with zero hard-constraint violations", () => {
    expect(checkLargeInstancesValid(optimize, [1, 2, 3, 4, 5, 6])).toEqual([]);
  });

  test("the same request gives the same answer", () => {
    for (const seed of [3, 30, 300]) {
      const request = smallInstance(seed);
      expect(JSON.stringify(optimize(request).schedules)).toBe(JSON.stringify(optimize(request).schedules));
    }
  });
});

describe("instructor evidence tie-break", () => {
  const compactWeights = { fewerDays: 0, compact: 1, mornings: 0, evenings: 0, walking: 0, rating: 0 };
  const at = (start: number, day: OptDay = "Mon"): OptMeeting => ({ day, start, end: start + 50, buildingId: "KLCE" });
  const gpaSection = (id: string, courseCode: string, meetings: OptMeeting[], instructorGpa?: number | null): OptSection => ({
    id,
    courseCode,
    rating: null,
    meetings,
    ...(instructorGpa === undefined ? {} : { instructorGpa }),
  });
  const one = (code: string, sections: OptSection[]): OptCourse => ({ code, credits: 3, sections });
  const tieRequest = (courses: OptCourse[]): OptimizeRequest => ({
    courses,
    locks: {},
    excluded: [],
    constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null },
    weights: compactWeights,
    walkingTime: () => ({ seconds: 960, source: "campus-network" }),
  });
  const chosen = (req: OptimizeRequest, schedule: RankedSchedule): OptSection[] =>
    req.courses.map((course) => course.sections.find((section) => section.id === schedule.byCourse[course.code])!);
  const meanEvidence = (req: OptimizeRequest, schedule: RankedSchedule): number => {
    const sections = chosen(req, schedule);
    return sections.reduce((sum, section) => sum + (section.instructorGpa ?? NEUTRAL_INSTRUCTOR_GPA), 0) / sections.length;
  };

  // One 50-minute section per slot, every building KLCE, weight 1 on idle
  // time: each 10 lean minutes between a plan's sections cost 200. Sections
  // at different times are never twins, so every combination stays in the
  // search and the tie-break tier decides it.
  const tiedGrid = () => [
    one("ECON 1110", [gpaSection("econ-a", "ECON 1110", [at(480)], 3.9), gpaSection("econ-b", "ECON 1110", [at(610)], 2.9)]),
    one("MATH 1650", [gpaSection("math-001", "MATH 1650", [at(540)]), gpaSection("math-002", "MATH 1650", [at(670)])]),
  ];

  test("a preference is never traded for instructor score", () => {
    // math-001 sits 10 lean minutes after the only ECON section (cost 200);
    // math-002 sits 80 after (1600). The stronger instructor teaches the
    // expensive section, and the cheaper plan still ranks first: the cost
    // tier is decided before evidence is ever consulted.
    const req = tieRequest([
      one("ECON 1110", [gpaSection("econ-a", "ECON 1110", [at(480)], 3.0)]),
      one("MATH 1650", [gpaSection("math-001", "MATH 1650", [at(540)], 2.9), gpaSection("math-002", "MATH 1650", [at(610)], 3.9)]),
    ]);
    const result = optimize(req);
    expect(result.status).toBe("optimal");
    expect(result.schedules[0]?.byCourse).toEqual({ "ECON 1110": "econ-a", "MATH 1650": "math-001" });
    expect(result.schedules[1]?.byCourse).toEqual({ "ECON 1110": "econ-a", "MATH 1650": "math-002" });
    expect(result.schedules[0]!.cost).toBeLessThan(result.schedules[1]!.cost);
    expect(result.schedules[1]!.cost - result.schedules[0]!.cost).toBeGreaterThan(INSTRUCTOR_TIE_BREAK_TOLERANCE);
    // And the winner really is the weaker-instructor plan.
    expect(meanEvidence(req, result.schedules[0]!)).toBeLessThan(meanEvidence(req, result.schedules[1]!));
  });

  test("a tie is broken by grade history, with the average sentence", () => {
    // Both cheap plans cost 200; the winner's ECON instructor averaged 3.9
    // against 2.9 for the runner-up's. The MATH sections carry no evidence,
    // so the neutral stand-in fills them and the tie still breaks.
    const req = tieRequest(tiedGrid());
    const result = optimize(req);
    expect(result.status).toBe("optimal");
    expect(result.schedules[0]?.byCourse).toEqual({ "ECON 1110": "econ-a", "MATH 1650": "math-001" });
    expect(result.schedules[1]?.byCourse).toEqual({ "ECON 1110": "econ-b", "MATH 1650": "math-002" });
    expect(result.schedules[0]?.cost).toBe(result.schedules[1]?.cost);
    const reasons = scheduleReasons({ alternatives: result.schedules, index: 0, optionName: (index) => `option ${index + 1}`, request: req });
    const tie = reasons.find((reason) => reason.kind === "grade-history" && reason.preference === null);
    expect(tie?.sentence).toBe("Students in this instructor's sections averaged a 3.9.");
    expect(tie?.evidence.numbers).toContainEqual({ label: "average grade points of sections with grade history", value: 3.9 });
    expect(tie?.evidence.numbers).toContainEqual({ label: "sections with grade history", value: 1 });
  });

  test("a missing match is neutral, not a penalty", () => {
    // (a) The plan whose second section has no evidence (the neutral 3.0
    // stands in) must beat the plan whose second section's instructor
    // averaged 2.0: (3.8 + 3.0) / 2 beats (3.8 + 2.0) / 2 at equal cost.
    const econA = gpaSection("econ-a", "ECON 1110", [at(480), at(480, "Tue")], 3.8);
    const req = tieRequest([
      one("ECON 1110", [econA]),
      one("MATH 1650", [gpaSection("math-001", "MATH 1650", [at(540)]), gpaSection("math-002", "MATH 1650", [at(540, "Tue")], 2.0)]),
    ]);
    const result = optimize(req);
    expect(result.schedules[0]?.byCourse).toEqual({ "ECON 1110": "econ-a", "MATH 1650": "math-001" });
    expect(result.schedules[0]?.cost).toBe(result.schedules[1]?.cost);
    expect(meanEvidence(req, result.schedules[0]!)).toBeGreaterThan(meanEvidence(req, result.schedules[1]!));
  });

  test("a plan with no evidence at all beats one whose only evidence is poor", () => {
    // (b) The all-neutral plan's evidence is exactly the neutral stand-in,
    // and it outranks a plan whose only known instructor averaged 2.5.
    const econA = gpaSection("econ-a", "ECON 1110", [at(480), at(480, "Tue")]);
    const req = tieRequest([
      one("ECON 1110", [econA]),
      one("MATH 1650", [gpaSection("math-001", "MATH 1650", [at(540)]), gpaSection("math-002", "MATH 1650", [at(540, "Tue")], 2.5)]),
    ]);
    const result = optimize(req);
    expect(result.schedules[0]?.byCourse).toEqual({ "ECON 1110": "econ-a", "MATH 1650": "math-001" });
    expect(result.schedules[0]?.cost).toBe(result.schedules[1]?.cost);
    expect(meanEvidence(req, result.schedules[0]!)).toBe(NEUTRAL_INSTRUCTOR_GPA);
    expect(meanEvidence(req, result.schedules[1]!)).toBe((NEUTRAL_INSTRUCTOR_GPA + 2.5) / 2);
  });

  test("with no evidence anywhere the order is the section-id key order", () => {
    // (c) All-neutral plans behave exactly as before this tier existed;
    // the 400-seed agreement tests pin the same property across shapes.
    const result = optimize(tieRequest([one("ECON 1110", [gpaSection("econ-a", "ECON 1110", [at(480)]), gpaSection("econ-b", "ECON 1110", [at(540)])])]));
    expect(result.schedules.map((schedule) => schedule.byCourse["ECON 1110"])).toEqual(["econ-a", "econ-b"]);
    expect(result.schedules[0]?.cost).toBe(result.schedules[1]?.cost);
  });

  test("the tolerance keeps the preference tier dominant", () => {
    // Raised past 1, evidence could outweigh a one-unit cost difference;
    // this assertion forces that conversation.
    expect(Number.isFinite(INSTRUCTOR_TIE_BREAK_TOLERANCE)).toBe(true);
    expect(INSTRUCTOR_TIE_BREAK_TOLERANCE).toBeGreaterThanOrEqual(0);
    expect(INSTRUCTOR_TIE_BREAK_TOLERANCE).toBeLessThan(1);
  });
});
