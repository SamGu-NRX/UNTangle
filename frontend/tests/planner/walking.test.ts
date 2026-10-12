import { describe, expect, test } from "bun:test";
import {
  createStraightLineWalkingTime,
  defaultWalkingTime,
  summarizeWeeklyWalking,
  WALKING_SPEED_METERS_PER_SECOND,
} from "@/lib/planner-walking";
import type { WalkingTimeFn } from "@/lib/planner-walking";
import { recommendSections } from "@/lib/planner";
import { oracleConflictingPairs } from "@/lib/schedule-oracle";
import { buildings, courses, sections } from "@/lib/seed-data";

describe("straight-line walking adapter", () => {
  test("same building is 0 seconds on the campus network", () => {
    expect(defaultWalkingTime("life", "life")).toEqual({ seconds: 0, source: "campus-network" });
  });

  test("an unknown building is unknown, never 0", () => {
    expect(defaultWalkingTime("life", "no-such-building")).toEqual({ seconds: null, source: "unknown" });
    expect(defaultWalkingTime("no-such-building", "life")).toEqual({ seconds: null, source: "unknown" });
    // Even the "same" unknown building has no estimate.
    expect(defaultWalkingTime("no-such-building", "no-such-building")).toEqual({ seconds: null, source: "unknown" });
    expect(defaultWalkingTime("", "")).toEqual({ seconds: null, source: "unknown" });
  });

  test("distance is great-circle meters at 1.4 m/s, labeled straight-line", () => {
    // 0.001 degrees of latitude is 111.19 m on a 6371 km sphere.
    const walk = createStraightLineWalkingTime([
      { id: "a", lat: 33.2, lng: -97.15 },
      { id: "b", lat: 33.201, lng: -97.15 },
    ]);
    const leg = walk("a", "b");
    expect(leg.source).toBe("straight-line");
    expect(leg.seconds).toBe(Math.round(111.19 / WALKING_SPEED_METERS_PER_SECOND));
    expect(walk("b", "a")).toEqual(leg);
  });

  test("every bundled meeting building has an estimate", () => {
    const ids = new Set(sections.flatMap((section) => section.meetings.map((meeting) => meeting.buildingId)));
    for (const id of ids) {
      expect(buildings.some((building) => building.id === id)).toBe(true);
      expect(defaultWalkingTime(id ?? "", "life").source).not.toBe("unknown");
    }
  });
});

describe("weekly walking summary", () => {
  test("sums consecutive legs per day and counts unknown legs separately", () => {
    const summary = summarizeWeeklyWalking([
      { day: "Mon", start: "09:00", buildingId: "life" },
      { day: "Mon", start: "10:00", buildingId: "life" },
      { day: "Mon", start: "11:00", buildingId: "gab" },
      { day: "Mon", start: "12:00", buildingId: undefined },
      { day: "Tue", start: "09:00", buildingId: "gab" },
    ]);
    const lifeToGab = defaultWalkingTime("life", "gab");
    expect(summary.knownLegs).toBe(2);
    expect(summary.unknownLegs).toBe(1);
    expect(summary.knownSeconds).toBe(lifeToGab.seconds ?? Number.NaN);
    expect(summary.estimated).toBe(true);
  });
});

describe("recommendSections walking term", () => {
  // Legs touching "life" have no estimate; every other leg between different
  // buildings is a 10-minute walk. A scorer that treated unknown as 0 seconds
  // would favor schedules full of "life" legs.
  const lifeUnknown: WalkingTimeFn = (from, to) => {
    if (from === "life" || to === "life") return { seconds: null, source: "unknown" };
    return from === to ? { seconds: 0, source: "campus-network" } : { seconds: 600, source: "straight-line" };
  };

  type Section = (typeof sections)[number];
  const eventsOf = (picked: Section[]) =>
    picked.flatMap((section) => section.meetings.map((m) => ({ day: m.day, start: m.start, buildingId: m.buildingId })));

  test("ranks fewer unknown legs first, so an unknown leg is never a free walk", () => {
    const byCourse = new Map<string, Section[]>();
    sections.forEach((section) => byCourse.set(section.courseCode, [...(byCourse.get(section.courseCode) ?? []), section]));
    const small = [...byCourse.entries()].filter(([, list]) => list.length >= 2 && list.length <= 12).map(([code]) => code);

    let checked = 0;
    for (let i = 0; i + 1 < small.length && checked < 5; i += 1) {
      const [a, b] = [small[i], small[i + 1]];
      const combos: Array<{ picked: Section[]; unknownLegs: number; knownSeconds: number }> = [];
      for (const sa of byCourse.get(a)!) {
        for (const sb of byCourse.get(b)!) {
          if (oracleConflictingPairs([sa, sb]).length > 0) continue;
          const summary = summarizeWeeklyWalking(eventsOf([sa, sb]), lifeUnknown);
          combos.push({ picked: [sa, sb], unknownLegs: summary.unknownLegs, knownSeconds: summary.knownSeconds });
        }
      }
      const minUnknown = Math.min(...combos.map((c) => c.unknownLegs));
      const fewestSecondsOverall = Math.min(...combos.map((c) => c.knownSeconds));
      const fewestSecondsAtMin = Math.min(...combos.filter((c) => c.unknownLegs === minUnknown).map((c) => c.knownSeconds));
      // Only informative when counting unknown legs as 0 seconds would change the answer.
      if (!(fewestSecondsOverall < fewestSecondsAtMin)) continue;

      const chosen = recommendSections("minimizeDistance", [a, b], {}, lifeUnknown);
      const picked = [a, b].map((code) => sections.find((s) => s.id === chosen[code])!);
      expect(oracleConflictingPairs(picked)).toEqual([]);
      expect(summarizeWeeklyWalking(eventsOf(picked), lifeUnknown).unknownLegs).toBe(minUnknown);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("with every leg unknown, the result is still conflict-free", () => {
    // Every leg unknown vs every leg known-but-long: with no section able to
    // avoid unknown legs, the result is still a valid conflict-free schedule.
    const unknownEverywhere: WalkingTimeFn = () => ({ seconds: null, source: "unknown" });
    const active = courses.filter((c) => sections.some((s) => s.courseCode === c.code)).slice(0, 3).map((c) => c.code);
    const chosen = recommendSections("minimizeDistance", active, {}, unknownEverywhere);
    const picked = Object.values(chosen).map((id) => sections.find((s) => s.id === id)!);
    expect(oracleConflictingPairs(picked)).toEqual([]);
  });

  test("minimizeDistance agrees with the independent oracle: no conflicts across real course sets", () => {
    const withSections = courses.filter((c) => sections.some((s) => s.courseCode === c.code)).map((c) => c.code);
    for (let start = 0; start + 3 <= Math.min(withSections.length, 30); start += 3) {
      const set = withSections.slice(start, start + 3);
      const chosen = recommendSections("minimizeDistance", set);
      const picked = Object.values(chosen).map((id) => sections.find((s) => s.id === id)!);
      expect(oracleConflictingPairs(picked)).toEqual([]);
    }
  });
});
