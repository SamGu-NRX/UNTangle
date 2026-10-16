/**
 * Overlapping finals are a hard conflict (types.ts, `OptSection.exam`).
 *
 * The acceptance check from docs/research/schedule-builders/README.md,
 * section 4: two sections whose finals overlap prove infeasible, with an
 * explanation that names the finals; non-overlapping finals stay feasible.
 * Then the same rule against a brute-force search on generated instances,
 * and a proof that finals that never clash change nothing Auto returns.
 */
import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import { OptimizerInputError, type OptExam, type OptimizeRequest, type OptimizeResult, type OptSection } from "@/lib/optimizer/types";
import { smallInstance } from "./checks";
import { combinationCount, enumerateValid, referenceRestrict } from "./reference";

const zero = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };
const none = { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null };

const MON_8 = { date: "2027-05-03", start: 8 * 60, end: 10 * 60 };
const MON_9 = { date: "2027-05-03", start: 9 * 60, end: 11 * 60 };
const MON_10 = { date: "2027-05-03", start: 10 * 60, end: 12 * 60 };
const TUE_8 = { date: "2027-05-04", start: 8 * 60, end: 10 * 60 };

/** CSCE 2110 meets MWF at 9, MATH 1710 TR at 9:30: their classes never overlap. */
function twoCourses(examA: OptExam | null, examB: OptExam | null, overrides: Partial<OptimizeRequest> = {}): OptimizeRequest {
  return {
    term: { start: "2027-01-11", end: "2027-05-07" },
    courses: [
      {
        code: "CSCE 2110",
        credits: 3,
        sections: [
          {
            id: "csce-001",
            label: "001",
            courseCode: "CSCE 2110",
            rating: null,
            exam: examA,
            meetings: (["Mon", "Wed", "Fri"] as const).map((day) => ({ day, start: 540, end: 590, buildingId: null })),
          },
        ],
      },
      {
        code: "MATH 1710",
        credits: 4,
        sections: [
          {
            id: "math-002",
            label: "002",
            courseCode: "MATH 1710",
            rating: null,
            exam: examB,
            meetings: (["Tue", "Thu"] as const).map((day) => ({ day, start: 570, end: 650, buildingId: null })),
          },
        ],
      },
    ],
    locks: {},
    excluded: [],
    constraints: none,
    weights: zero,
    walkingTime: () => ({ seconds: null, source: "unknown" }),
    ...overrides,
  };
}

describe("acceptance: overlapping finals", () => {
  test("two sections whose finals overlap are infeasible, and the explanation names the finals", () => {
    const result = optimize(twoCourses(MON_8, MON_9));
    expect(result.status).toBe("infeasible");
    if (result.status !== "infeasible") return;
    expect(result.explanation.members).toEqual([
      { kind: "course", courseCode: "CSCE 2110" },
      { kind: "course", courseCode: "MATH 1710" },
      { kind: "exams" },
    ]);
    expect(result.explanation.minimal).toBe(true);
    expect(result.explanation.sentence).toBe(
      "CSCE 2110 (MWF 9 AM) and MATH 1710 (TTh 9:30 AM) have finals at the same time (Mon, May 3, 8 AM to 10 AM and 9 AM to 11 AM).",
    );
    // UNT sets exam times, so the finals rule itself offers no one-click change.
    expect(result.explanation.suggestions).toEqual([]);
  });

  test("the same slot is named once", () => {
    const result = optimize(twoCourses(MON_8, { ...MON_8 }));
    expect(result.status === "infeasible" && result.explanation.sentence).toBe(
      "CSCE 2110 (MWF 9 AM) and MATH 1710 (TTh 9:30 AM) have finals at the same time (both Mon, May 3, 8 AM to 10 AM).",
    );
  });

  test("control: finals that don't overlap stay feasible", () => {
    for (const [a, b] of [
      [MON_8, TUE_8],
      // 8 to 10 and 10 to 12 only touch.
      [MON_8, MON_10],
      [MON_8, null],
      [null, null],
    ] as const) {
      const result = optimize(twoCourses(a, b));
      expect(result.status).toBe("optimal");
      expect(result.schedules[0].byCourse).toEqual({ "CSCE 2110": "csce-001", "MATH 1710": "math-002" });
    }
  });

  test("kept sections with clashing finals offer to unkeep them, as a class clash does", () => {
    const request = twoCourses(MON_8, MON_9);
    const withSpare: OptimizeRequest = {
      ...request,
      courses: [
        request.courses[0],
        {
          ...request.courses[1],
          sections: [...request.courses[1].sections, { ...request.courses[1].sections[0], id: "math-003", label: "003", exam: TUE_8, meetings: request.courses[1].sections[0].meetings.map((m) => ({ ...m, start: 660, end: 740 })) }],
        },
      ],
      locks: { "CSCE 2110": "csce-001", "MATH 1710": "math-002" },
    };
    const result = optimize(withSpare);
    expect(result.status).toBe("infeasible");
    if (result.status !== "infeasible") return;
    // CSCE 2110 has one section, so its lock isn't part of the conflict; MATH 1710's is.
    expect(result.explanation.members).toEqual([
      { kind: "course", courseCode: "CSCE 2110" },
      { kind: "course", courseCode: "MATH 1710" },
      { kind: "exams" },
      { kind: "lock", courseCode: "MATH 1710", sectionId: "math-002" },
    ]);
    expect(result.explanation.sentence).toBe(
      "CSCE 2110 (MWF 9 AM) and your locked MATH 1710 section (TTh 9:30 AM) have finals at the same time (Mon, May 3, 8 AM to 10 AM and 9 AM to 11 AM).",
    );
    expect(result.explanation.suggestions.map((s) => [s.label, s.resolves])).toEqual([["Unlock MATH 1710", true]]);
  });

  test("Auto picks the section whose final doesn't clash", () => {
    const request = twoCourses(MON_8, MON_9);
    const spare: OptSection = { ...request.courses[1].sections[0], id: "math-003", label: "003", exam: TUE_8 };
    // math-003 meets at the same times as math-002, so without finals it would be its twin and lose the id tie.
    const result = optimize({ ...request, courses: [request.courses[0], { ...request.courses[1], sections: [...request.courses[1].sections, spare] }] });
    expect(result.status).toBe("optimal");
    expect(result.schedules.map((s) => s.byCourse["MATH 1710"])).toEqual(["math-003"]);
  });

  test("the finals rule is blamed only when nothing the student set explains the conflict", () => {
    // A busy time on Monday mornings already rules out CSCE 2110; the clashing finals are beside the point.
    const result = optimize(
      twoCourses(MON_8, MON_9, {
        constraints: { ...none, blocked: [{ id: "work", label: "Work", day: "Mon", start: 480, end: 720 }] },
      }),
    );
    expect(result.status).toBe("infeasible");
    if (result.status !== "infeasible") return;
    expect(result.explanation.members).toEqual([{ kind: "course", courseCode: "CSCE 2110" }, { kind: "blocked", blockedId: "work" }]);
  });

  test("a malformed final is a caller bug", () => {
    expect(() => optimize(twoCourses({ date: "2027-02-30", start: 480, end: 600 }, null))).toThrow(OptimizerInputError);
    expect(() => optimize(twoCourses({ date: "2027-05-03", start: 600, end: 600 }, null))).toThrow("exam with invalid times 600-600");
  });
});

/** Small instances, each section given one of four sittings on two dates, so clashes are common. */
function withExams(request: OptimizeRequest, seed: number): OptimizeRequest {
  const slots: OptExam[] = [MON_8, MON_9, MON_10, TUE_8];
  let i = seed;
  return {
    ...request,
    courses: request.courses.map((course) => ({
      ...course,
      sections: course.sections.map((section) => {
        i = (i * 1103515245 + 12345) % 2147483648;
        // About one section in five has no known final.
        return { ...section, exam: i % 5 === 0 ? null : slots[i % slots.length] };
      }),
    })),
  };
}

/** Every valid schedule, best first: reference.ts enumerates them and knows the finals rule. */
const bruteForce = enumerateValid;
const settled = (request: OptimizeRequest) => optimize({ ...request, k: 1, timeBudgetMs: Number.POSITIVE_INFINITY, explainBudgetMs: 10_000 });
const SEEDS = Array.from({ length: 250 }, (_, i) => 9001 + i);

describe("finals against a brute-force search", () => {
  test("the best schedule, or the proof that none exists, matches", () => {
    let infeasible = 0;
    for (const seed of SEEDS) {
      const request = withExams(smallInstance(seed), seed);
      if (combinationCount(request) > 5_000) continue;
      const expected = bruteForce(request);
      const result = settled(request);
      if (expected.length === 0) {
        infeasible += 1;
        expect({ seed, status: result.status }).toEqual({ seed, status: "infeasible" });
        if (result.status !== "infeasible") continue;
        // The named set conflicts on its own.
        expect({ seed, schedules: bruteForce(referenceRestrict(request, result.explanation.members)).length }).toEqual({ seed, schedules: 0 });
      } else {
        expect({ seed, status: result.status, best: result.schedules[0]?.byCourse, cost: result.schedules[0]?.cost }).toEqual({
          seed,
          status: "optimal",
          best: expected[0].byCourse,
          cost: expected[0].cost,
        });
      }
    }
    // The generator has to produce both outcomes for this to mean anything.
    expect(infeasible).toBeGreaterThan(5);
  });
});

describe("finals that never clash change nothing", () => {
  // Sections at the same times stop being twins when their finals differ, so the search sees more
  // candidates and visits other nodes; neither is part of the answer.
  const strip = (result: OptimizeResult) => JSON.parse(JSON.stringify({ ...result, stats: { ...result.stats, elapsedMs: 0, nodes: 0, candidates: {} } }));
  test("same status, schedules, costs and explanations as without finals", () => {
    for (const seed of SEEDS.slice(0, 120)) {
      const request = smallInstance(seed);
      let day = 0;
      // Each section's final on its own day: no two can clash.
      const apart: OptimizeRequest = {
        ...request,
        courses: request.courses.map((course) => ({
          ...course,
          sections: course.sections.map((section) => {
            day += 1;
            const date = new Date(Date.UTC(2027, 4, 1) + day * 86_400_000).toISOString().slice(0, 10);
            return { ...section, exam: { date, start: 480, end: 600 } };
          }),
        })),
      };
      const budget = { timeBudgetMs: Number.POSITIVE_INFINITY, maxNodes: 200_000, explainBudgetMs: 10_000 };
      const before = strip(optimize({ ...request, ...budget }));
      const after = strip(optimize({ ...apart, ...budget }));
      expect({ seed, ...after }).toEqual({ seed, ...before });
    }
  });
});
