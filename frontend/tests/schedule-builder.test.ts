/**
 * Regression tests for what the old builder got wrong when reproduced as a
 * guest on 2026-10-13 (fd432ac) with ANTH 1010, BIOL 1710, ENGL 1310,
 * MATH 1710 and PSYC 1630 marked Taking. See output/playwright/scheduler-v2/before/.
 */
import { describe, expect, test } from "bun:test";
import { buildOptimizeRequest, defaultSchedulePreferences, getInitialPlannerState, recommendSections } from "@/lib/planner";
import { optimize } from "@/lib/optimizer/optimize";
import { oracleConflictingPairs } from "@/lib/schedule-oracle";
import { sections } from "@/lib/seed-data";
import type { PlannerState } from "@/lib/types";

const FIVE = ["ANTH 1010", "BIOL 1710", "ENGL 1310", "MATH 1710", "PSYC 1630"];
const byId = (id: string) => sections.find((section) => section.id === id)!;
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

function planWith(courseCodes: string[]): PlannerState {
  const initial = getInitialPlannerState();
  return {
    ...initial,
    courseStatuses: { ...initial.courseStatuses, ...Object.fromEntries(courseCodes.map((code) => [code, "inProgress" as const])) },
    selectedSections: {},
  };
}

function daysAndGaps(selection: Record<string, string>) {
  const meetings = Object.values(selection).flatMap((id) => byId(id).meetings);
  const days = new Set(meetings.map((m) => m.day));
  let gap = 0;
  for (const day of days) {
    const list = meetings.filter((m) => m.day === day).sort((a, b) => minutes(a.start) - minutes(b.start));
    for (let i = 1; i < list.length; i += 1) gap += minutes(list[i].start) - minutes(list[i - 1].end);
  }
  return { days: days.size, gap };
}

describe("finding 1: a goal change no longer freezes the page", () => {
  test("re-planning five courses for a goal takes well under a second (was 3.0 s per call)", () => {
    for (const goal of ["clusterMorning", "clusterNight", "compact", "minimizeDistance", "maximizeProfessor"] as const) {
      const started = performance.now();
      const result = recommendSections(goal, FIVE);
      expect(performance.now() - started).toBeLessThan(300);
      expect(Object.keys(result).sort()).toEqual([...FIVE].sort());
      expect(oracleConflictingPairs(Object.values(result).map(byId))).toEqual([]);
    }
  });

  test("three alternatives for the five courses are proven best within the 300 ms page budget", () => {
    const request = buildOptimizeRequest(planWith(FIVE), defaultSchedulePreferences("compact"));
    const result = optimize(request);
    expect(result.status).toBe("optimal");
    expect(result.stats.elapsedMs).toBeLessThan(300);
  });
});

describe("finding 2: compact days minimizes days and idle time", () => {
  // The old compact result used five days. The old nights result shows a
  // three-day week exists: MWF 12:00-4:50 with only the 10-minute breaks
  // between classes, 120 idle minutes in all.
  test("the compact goal finds a three-day week with no more idle time than the 10-minute breaks", () => {
    const result = recommendSections("compact", FIVE);
    expect(oracleConflictingPairs(Object.values(result).map(byId))).toEqual([]);
    const { days, gap } = daysAndGaps(result);
    expect(days).toBe(3);
    expect(gap).toBeLessThanOrEqual(120);
  });
});

describe("finding 3: mornings and nights measure time of day, not meeting count", () => {
  const meanStart = (id: string) => byId(id).meetings.reduce((sum, m) => sum + minutes(m.start), 0) / byId(id).meetings.length;
  const meanEnd = (id: string) => byId(id).meetings.reduce((sum, m) => sum + minutes(m.end), 0) / byId(id).meetings.length;

  test("for one course, mornings picks the earliest class and nights the latest, however often they meet", () => {
    let informative = 0;
    for (const code of FIVE) {
      const own = sections.filter((section) => section.courseCode === code);
      const mixed = new Set(own.map((section) => section.meetings.length)).size > 1;
      if (mixed) informative += 1;
      const morning = recommendSections("clusterMorning", [code])[code];
      const night = recommendSections("clusterNight", [code])[code];
      expect(Math.round(meanStart(morning))).toBe(Math.round(Math.min(...own.map((s) => meanStart(s.id)))));
      expect(Math.round(meanEnd(night))).toBe(Math.round(Math.max(...own.map((s) => meanEnd(s.id)))));
    }
    // Courses offering both twice- and three-times-a-week sections are the ones the old sum got wrong.
    expect(informative).toBeGreaterThan(0);
  });
});

describe("finding 4: optimize offers real alternatives and says why when nothing fits", () => {
  test("three alternatives, each placing at least two courses at different times", () => {
    const request = buildOptimizeRequest(planWith(FIVE), defaultSchedulePreferences("clusterMorning"));
    const result = optimize(request);
    expect(result.schedules).toHaveLength(3);
    const pattern = (id: string) => byId(id).meetings.map((m) => `${m.day}${m.start}${m.end}`).sort().join();
    for (let i = 0; i < 3; i += 1) {
      for (let j = i + 1; j < 3; j += 1) {
        const differing = FIVE.filter(
          (code) => pattern(result.schedules[i].byCourse[code]) !== pattern(result.schedules[j].byCourse[code]),
        );
        expect(differing.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test("an impossible request names what conflicts in plain words and offers a fix that works", () => {
    const preferences = defaultSchedulePreferences("compact");
    const request = buildOptimizeRequest(planWith(["MATH 1710"]), {
      ...preferences,
      constraints: { ...preferences.constraints, latestEnd: 9 * 60 },
    });
    const result = optimize(request);
    expect(result.status).toBe("infeasible");
    if (result.status !== "infeasible") return;
    expect(result.explanation.sentence).toBe("No section of MATH 1710 fits before 9 AM.");
    expect(result.explanation.minimal).toBe(true);
    expect(result.explanation.suggestions[0]).toMatchObject({ resolves: true });
  });
});
