import { describe, expect, test } from "bun:test";
import { instructorTiebreak, type CourseEvidence, type SchedulePicks } from "../../src/instructor-tiebreak";
import { allKnown, everySchedule, ids, imputationTrap, mixedRequest } from "./fixtures";

/** -1 when a ranks first, 1 when b does, 0 on a tie. */
const order = (compare: (a: SchedulePicks, b: SchedulePicks) => number, a: SchedulePicks, b: SchedulePicks) => Math.sign(compare(a, b));

const base: SchedulePicks = {
  "MATH 1680": ids.math.morning,
  "CSCE 1030": ids.csce.high,
  "ENGL 1310": ids.engl.high,
  "HIST 2610": ids.hist.high,
  "PSCI 1040": ids.psci.only,
};

describe("instructorTiebreak", () => {
  test("the schedule whose picks have more evidence over the counted courses ranks first", () => {
    const compare = instructorTiebreak(mixedRequest);
    const weaker = { ...base, "MATH 1680": ids.math.afternoon };
    expect(order(compare, base, weaker)).toBe(-1);
    expect(order(compare, weaker, base)).toBe(1);
  });

  test("a course with any option lacking evidence is left out, even when both picks have evidence", () => {
    const compare = instructorTiebreak(mixedRequest);
    expect(order(compare, base, { ...base, "CSCE 1030": ids.csce.low })).toBe(0);
    expect(order(compare, base, { ...base, "ENGL 1310": ids.engl.unmatched })).toBe(0);
  });

  test("missing evidence is never read as zero, as a neutral 3.00 or as the course's average", () => {
    const compare = instructorTiebreak(imputationTrap.request);
    expect(order(compare, imputationTrap.missing, imputationTrap.strong)).toBe(-1);
    expect(order(compare, imputationTrap.strong, imputationTrap.missing)).toBe(1);
  });

  test("with no counted course, every pair ties", () => {
    const uncounted = mixedRequest.filter((course) => ["CSCE 1030", "ENGL 1310", "HIST 2610"].includes(course.courseCode));
    const compare = instructorTiebreak(uncounted);
    const schedules = everySchedule(uncounted);
    for (const a of schedules) for (const b of schedules) expect(order(compare, a, b)).toBe(0);
  });

  test("evidence that adds up to the same total ties exactly", () => {
    const compare = instructorTiebreak(allKnown([310, 330], [320, 300]));
    const a = { "CSCE 1030": ids.csce.high, "MATH 1680": ids.math.morning };
    const b = { "CSCE 1030": ids.csce.low, "MATH 1680": ids.math.afternoon };
    expect(order(compare, a, b)).toBe(0);
  });

  test("one hundredth of a grade point decides", () => {
    const compare = instructorTiebreak(allKnown([310, 331], [320, 300]));
    const a = { "CSCE 1030": ids.csce.high, "MATH 1680": ids.math.morning };
    const b = { "CSCE 1030": ids.csce.low, "MATH 1680": ids.math.afternoon };
    expect(order(compare, b, a)).toBe(-1);
  });

  test("is a strict weak order over every schedule of a request", () => {
    const compare = instructorTiebreak(mixedRequest);
    const schedules = everySchedule(mixedRequest);
    expect(schedules).toHaveLength(54);
    const signs = schedules.map((a) => schedules.map((b) => order(compare, a, b)));
    const n = schedules.length;
    for (let i = 0; i < n; i += 1) {
      expect(signs[i][i]).toBe(0);
      for (let j = 0; j < n; j += 1) {
        if (signs[i][j] !== -signs[j][i]) throw new Error(`not antisymmetric: ${i} vs ${j}`);
        for (let k = 0; k < n; k += 1) {
          if (signs[i][j] < 0 && signs[j][k] < 0 && signs[i][k] >= 0) throw new Error(`not transitive: ${i} < ${j} < ${k}`);
          if (signs[i][j] === 0 && signs[j][k] === 0 && signs[i][k] !== 0) throw new Error(`ties not transitive: ${i} ~ ${j} ~ ${k}`);
        }
      }
    }
    // The order is not trivial: MATH still separates schedules.
    expect(signs.flat().filter((sign) => sign !== 0).length).toBeGreaterThan(0);
  });

  test("the order courses and options are listed in changes no answer", () => {
    const reversed: CourseEvidence[] = [...mixedRequest]
      .reverse()
      .map((course) => ({ ...course, options: Object.fromEntries(Object.entries(course.options).reverse()) }));
    const compare = instructorTiebreak(mixedRequest);
    const compareReversed = instructorTiebreak(reversed);
    const schedules = everySchedule(mixedRequest);
    for (const a of schedules) for (const b of schedules) expect(order(compareReversed, a, b)).toBe(order(compare, a, b));
  });

  test("a schedule it can't account for throws instead of comparing", () => {
    const compare = instructorTiebreak(mixedRequest);
    expect(compare(base, base)).toBe(0);
    const missingCourse = Object.fromEntries(Object.entries(base).filter(([course]) => course !== "PSCI 1040"));
    expect(() => compare(missingCourse, base)).toThrow();
    expect(() => compare(base, { ...base, "BIOL 1710": "vsb:spring-2027:BIOL 1710:9001" })).toThrow();
    expect(() => compare(base, { ...base, "MATH 1680": "vsb:spring-2027:MATH 1680:9999" })).toThrow();
  });

  test.each([
    ["above 4.00", 401],
    ["below 0", -1],
    ["not whole hundredths", 3.12],
    ["not a number", Number.NaN],
  ])("evidence %s throws when the comparator is built", (_why, value) => {
    expect(typeof instructorTiebreak(allKnown([0, 400], [300, 300]))).toBe("function");
    expect(() => instructorTiebreak(allKnown([value, 300], [300, 300]))).toThrow();
  });

  test("a course listed twice or with no options throws", () => {
    expect(typeof instructorTiebreak(allKnown([300, 300], [300, 300]))).toBe("function");
    expect(() => instructorTiebreak([...allKnown([300, 300], [300, 300]), allKnown([300, 300], [300, 300])[0]])).toThrow();
    expect(() => instructorTiebreak([{ courseCode: "CSCE 1030", options: {} }])).toThrow();
  });
});
