/**
 * The evidence shape's documented draw contract, which the evidence agreement
 * and mutation tests lean on: the tier roll happens per course (about half
 * the courses fully evidenced, a quarter partial, a quarter with none), and
 * evidenced values span the whole 0 to 400 hundredths range. Fixed seeds keep
 * both assertions deterministic.
 */

import { describe, expect, test } from "bun:test";
import { generateInstance } from "./generator";

const SHAPE = {
  courses: 6,
  sectionsPerCourse: [2, 4],
  style: "irregular",
  constraintDensity: 0.5,
  evidence: true,
  twinChance: 0.35,
} as const;

const INSTANCES = Array.from({ length: 120 }, (_, i) => generateInstance(9001 + i, SHAPE));

describe("the evidence shape's documented draw", () => {
  test("evidenced values span the documented 0 to 400 hundredths", () => {
    const values = INSTANCES
      .flatMap((instance) => instance.courses.flatMap((course) => course.sections.map((section) => section.instructorGpaHundredths)))
      .filter((value): value is number => typeof value === "number");
    expect(values.length).toBeGreaterThan(0);
    expect(Math.min(...values)).toBeLessThan(100);
    expect(Math.max(...values)).toBe(400);
  });

  test("the tier roll is per course: uniform instances are rare, not the norm", () => {
    const uniform = INSTANCES.filter((instance) => {
      const tiers = instance.courses.map((course) => course.sections.map((section) => section.instructorGpaHundredths));
      const full = tiers.every((values) => values.every((value) => typeof value === "number"));
      const none = tiers.every((values) => values.every((value) => value === undefined));
      return full || none;
    });
    // A per-instance roll makes about three quarters of instances uniform
    // (roughly half fully evidenced, a quarter with none). Per-course rolls
    // make a uniform 6-course instance rare — about (3/4)^6 of them, here
    // a couple across 120 seeds.
    expect(uniform.length).toBeLessThan(12);
  });
});
