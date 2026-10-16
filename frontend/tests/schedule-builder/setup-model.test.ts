/**
 * What Set up Auto's Undo puts back: every field the setup writes, and
 * nothing else, so a change made elsewhere while it was open survives.
 */
import { describe, expect, test } from "bun:test";
import { restoreSetup, setupChanged } from "@/components/schedule-builder/setup";
import type { SchedulePreferences } from "@/lib/types";

const before: SchedulePreferences = {
  constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walkingBufferMinutes: 0, excludedSections: [], openSeatsOnly: false, otherSites: false },
  weights: { fewerDays: 0, compact: 1, mornings: 4, evenings: 0, walking: 0, rating: 0 },
};

/** Everything the setup can write: four leanings, short gaps, class hours, days off and busy time. */
const answered: SchedulePreferences = {
  constraints: {
    ...before.constraints,
    earliestStart: 540,
    latestEnd: 1080,
    daysOff: ["Fri"],
    blocked: [{ id: "busy-1", label: "Work", day: "Tue", start: 900, end: 1020 }],
  },
  weights: { fewerDays: 3, compact: 3, mornings: 0, evenings: 2, walking: 4, rating: 2 },
};

describe("restoreSetup", () => {
  test("puts back every field the setup writes", () => {
    expect(restoreSetup(answered, before)).toEqual(before);
  });

  test("keeps a change made elsewhere while the setup was open", () => {
    const elsewhere: SchedulePreferences = { ...answered, constraints: { ...answered.constraints, maxCredits: 15, openSeatsOnly: true, excludedSections: ["s-1"] } };
    expect(restoreSetup(elsewhere, before)).toEqual({ ...before, constraints: { ...before.constraints, maxCredits: 15, openSeatsOnly: true, excludedSections: ["s-1"] } });
  });
});

describe("setupChanged", () => {
  test("true when any field the setup writes differs", () => {
    expect(setupChanged(answered, before)).toBe(true);
    expect(setupChanged({ ...before, weights: { ...before.weights, compact: 2 } }, before)).toBe(true);
    expect(setupChanged({ ...before, constraints: { ...before.constraints, daysOff: ["Mon"] } }, before)).toBe(true);
  });

  test("false when only fields the setup never writes changed", () => {
    expect(setupChanged(before, before)).toBe(false);
    expect(setupChanged({ ...before, constraints: { ...before.constraints, maxCredits: 12, otherSites: true } }, before)).toBe(false);
  });
});
