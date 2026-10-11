/**
 * Catalog adapter: builds `OptimizeRequest`s from the bundled
 * `@/lib/seed-data` catalog — the real-catalog benchmark suite.
 *
 * Conversion rules (pinned):
 * - Meeting `start`/`end` are `'HH:MM'` strings in the catalog; converted to
 *   minutes after midnight for the optimizer.
 * - Credits come from the COURSE's `creditHours` (all sections of a course
 *   share it).
 * - `instructorRating` comes from the section's `rating` (0..5).
 * - No `historicalGpa` exists in the bundled data — the field stays
 *   `undefined` and contributes 0 to GPA sums.
 * - Building ids are the catalog's lowercase ids (e.g. `"life"`); the
 *   bundled data has a buildingId on every meeting as of round 1 — a
 *   meeting without one would be dropped defensively.
 *
 * DATA HONESTY: the bundled catalog's 2,704 sections (656 courses, 15
 * buildings) are synthetic samples, NOT a real term's offerings.
 */

import { courses, sections } from "@/lib/seed-data";
import type { WeekDay } from "@/lib/types";
import type {
  HardConstraints,
  OptimizerMeeting,
  OptimizerSection,
  OptimizeRequest,
  SoftWeights,
} from "../types";
import { benchWalkingTime } from "./generator";
import { mulberry32, pick } from "./rng";

/** `'HH:MM'` -> minutes after midnight. */
export function parseTimeOfDay(value: string): number {
  const [hh, mm] = value.split(":");
  return Number(hh) * 60 + Number(mm);
}

/** Default cost weights for catalog instances (documented in bench/README.md). */
export const CATALOG_SOFT_WEIGHTS: SoftWeights = {
  perGapMinute: 1,
  perWalkingSecond: 0.05,
  perEarlyStartMinute: 0.5,
  perLateEndMinute: 0.5,
  perDayOnCampus: 60,
  perRatingPoint: 5,
  perGpaPoint: 10,
  perUnknownWalking: 25,
};

/** Convert one catalog section into an `OptimizerSection`. */
export function toOptimizerSection(
  catalogSection: (typeof sections)[number],
  credits: number,
): OptimizerSection {
  const meetings: OptimizerMeeting[] = catalogSection.meetings.flatMap((meeting) => {
    if (!meeting.buildingId) return []; // defensive: no such meetings in the bundled data
    return [
      {
        day: meeting.day as WeekDay,
        start: parseTimeOfDay(meeting.start),
        end: parseTimeOfDay(meeting.end),
        buildingId: meeting.buildingId,
      },
    ];
  });
  return {
    id: catalogSection.id,
    courseCode: catalogSection.courseCode,
    credits,
    meetings,
    instructorRating: catalogSection.rating,
  };
}

export interface CatalogRequestOptions {
  /** Catalog course codes to request (must exist; no candidates otherwise). */
  courseCodes: string[];
  /** Seed for deterministic lock/exclusion placement (default 0). */
  seed?: number;
  /** Locked section ids to inject (first lock real, later locks unknown ids). */
  locks?: number;
  /** Excluded section ids to inject (never all sections of a course). */
  exclusions?: number;
  /** Explicit hard constraints; default none. */
  hardConstraints?: HardConstraints;
  /** Returned-schedule count; default 3. */
  k?: number;
  /** Time budget; default 1000. */
  timeBudgetMs?: number;
}

/** Build an `OptimizeRequest` over the bundled catalog for the given course codes. */
export function buildCatalogRequest(options: CatalogRequestOptions): OptimizeRequest {
  const seed = options.seed ?? 0;
  const rng = mulberry32(seed);
  const creditHoursByCode = new Map(courses.map((course) => [course.code, course.creditHours] as const));

  const pool: OptimizerSection[] = sections
    .filter((section) => options.courseCodes.includes(section.courseCode))
    .map((section) => toOptimizerSection(section, creditHoursByCode.get(section.courseCode) ?? 0));

  const lockedSectionIds: string[] = [];
  for (let i = 0; i < (options.locks ?? 0); i++) {
    lockedSectionIds.push(i === 0 && pool.length > 0 ? pick(rng, pool).id : "catalog-missing-lock");
  }
  const excludedSectionIds: string[] = [];
  const excludedSet = new Set<string>();
  let guard = 0;
  const sectionsPerCourse = Math.max(
    1,
    ...options.courseCodes.map((code) => pool.filter((section) => section.courseCode === code).length),
  );
  while (excludedSet.size < (options.exclusions ?? 0) && guard < 100) {
    guard += 1;
    const candidate = pick(rng, pool);
    if (lockedSectionIds.includes(candidate.id) || excludedSet.has(candidate.id)) continue;
    const excludedForCourse = [...excludedSet].filter((id) =>
      pool.find((section) => section.id === id && section.courseCode === candidate.courseCode),
    ).length;
    if (excludedForCourse >= sectionsPerCourse - 1) continue;
    excludedSet.add(candidate.id);
    excludedSectionIds.push(candidate.id);
  }

  return {
    sections: pool,
    requestedCourseCodes: [...options.courseCodes],
    lockedSectionIds,
    excludedSectionIds,
    hardConstraints: options.hardConstraints ?? {},
    softWeights: { ...CATALOG_SOFT_WEIGHTS },
    k: options.k ?? 3,
    timeBudgetMs: options.timeBudgetMs ?? 1000,
    walkingTime: benchWalkingTime,
  };
}

/**
 * Deterministically pick `count` catalog course codes whose section counts
 * lie in [minSections, maxSections] — keeps catalog instances enumerable.
 * Sorted codes, evenly spaced sample; no seed needed (data-deterministic).
 */
export function pickCatalogCourseCodes(count: number, minSections = 2, maxSections = 8): string[] {
  const countByCode = new Map<string, number>();
  for (const section of sections) {
    countByCode.set(section.courseCode, (countByCode.get(section.courseCode) ?? 0) + 1);
  }
  const eligible = courses
    .map((course) => course.code)
    .filter((code) => {
      const n = countByCode.get(code) ?? 0;
      return n >= minSections && n <= maxSections;
    })
    .sort();
  if (eligible.length < count) throw new Error(`catalog adapter: only ${eligible.length} eligible course codes`);
  const picked: string[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor((i * eligible.length) / count);
    picked.push(eligible[index]);
  }
  return [...new Set(picked)];
}

/** Section-count helper for tests and the runner's enumerable bookkeeping. */
export function catalogSectionsPerCourse(code: string): number {
  return sections.filter((section) => section.courseCode === code).length;
}
