/**
 * Seeded benchmark instance generator.
 *
 * Fully deterministic: every choice comes from the seeded PRNG in ./rng.ts —
 * Math.random is never used, so `generateInstance(seed, size)` reproduces an
 * instance byte-for-byte.
 *
 * Instances are complete `OptimizeRequest`s over a SYNTHETIC building set
 * (`BENCH_BUILDING_IDS`) that deliberately includes ids the benchmark
 * walking function does not know (`BENCH_UNKNOWN_BUILDING_IDS`), so
 * unknown-walking pairs occur in real proportion. Sections are 1..40 per
 * course, courses 2..8, meetings 1..3 per section on Mon..Fri, times on a
 * 30-minute grid, with deliberately dense conflict injection (sections of
 * the same course draw from a small slot pool, so alternatives collide).
 *
 * Constraint profiles make suite coverage deterministic: across the pinned
 * suite in ./instances.ts every hard-constraint kind appears at least once,
 * and several instances are infeasible by construction (each such family
 * exhibits a blocking argument, not a solver guess). Where a family cannot
 * prove feasibility by construction it is marked unknown and the
 * brute-force cross-validation establishes the truth.
 *
 * DATA HONESTY: generated sections are synthetic samples for benchmarking —
 * they are NOT a real term's offerings and must never be presented as one.
 */

import type {
  BlockedTimeRange,
  HardConstraints,
  OptimizerSection,
  OptimizeRequest,
  SoftWeights,
  WalkingTime,
  WalkingTimeFn,
} from "../types";
import { weekDays, type WeekDay } from "@/lib/types";
import { maybe, mulberry32, pick, randInt, round2, shuffled, type Rng } from "./rng";

/** Synthetic campus buildings the benchmark walking function knows. */
export const BENCH_BUILDING_IDS = ["bench-arts", "bench-sci", "bench-eng", "bench-lib", "bench-gym"] as const;

/**
 * Synthetic building ids the benchmark walking function deliberately does
 * NOT know — requests containing them exercise the unknown-walking rule
 * (unknown is never free and never 0).
 */
export const BENCH_UNKNOWN_BUILDING_IDS = ["bench-ghost-1", "bench-ghost-2"] as const;

/** The 15 lowercase building ids of the bundled catalog, for the real-catalog suite. */
const CATALOG_BUILDING_IDS = [
  "art", "arta", "aud", "blb", "chem", "env", "gab", "gate",
  "hick", "lang", "life", "matt", "musi", "ntdp", "wh",
] as const;

const KNOWN_WALKING_IDS = new Set<string>([...BENCH_BUILDING_IDS, ...CATALOG_BUILDING_IDS]);

/** FNV-1a fingerprint of the SORTED building pair — symmetric and deterministic. */
function pairFingerprint(from: string, to: string): number {
  const [first, second] = from < to ? [from, to] : [to, from];
  let hash = 2166136261;
  const joined = `${first}|${second}`;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * The benchmark walking function. Deterministic and dependency-free — a
 * SYNTHETIC network, not the real campus graph of
 * `@/lib/campus/walking-times.ts`:
 * - same building -> `{ seconds: 0, source: "campus-network" }` (known, never unknown);
 * - both buildings known (synthetic bench ids or the 15 real bundled ids) ->
 *   a stable pseudo-distance of 90..1139 seconds;
 * - anything else (including the two bench-ghost ids) -> `{ seconds: null, source: "unknown" }`.
 */
export const benchWalkingTime: WalkingTimeFn = (fromBuildingId: string, toBuildingId: string): WalkingTime => {
  if (fromBuildingId === toBuildingId) return { seconds: 0, source: "campus-network" };
  if (KNOWN_WALKING_IDS.has(fromBuildingId) && KNOWN_WALKING_IDS.has(toBuildingId)) {
    return { seconds: 90 + (pairFingerprint(fromBuildingId, toBuildingId) % 1050), source: "campus-network" };
  }
  return { seconds: null, source: "unknown" };
};

/**
 * Deterministic constraint focus of an instance family. Profiles ending in
 * "infeasible" carry a by-construction blocking argument; "anchors" and
 * "credits" carry a by-construction witness schedule; the rest leave the
 * feasible/infeasible verdict to the brute-force cross-validation.
 */
export type ConstraintProfile =
  | "plain"
  | "anchors"
  | "daysOff"
  | "blocked"
  | "transfer"
  | "credits"
  | "mixed"
  | "infeasibleCredits"
  | "infeasibleBlocked"
  | "infeasibleTransfer"
  | "infeasibleLockedOverlap"
  | "infeasibleLockedExcluded"
  | "infeasibleAllDaysOff"
  | "empty"
  | "zeroCandidates"
  | "singleOption";

/** Instance size knobs. Bounds pinned by tests: courses <= 8, sectionsPerCourse <= 40. */
export interface InstanceSize {
  /** Requested courses (2..8 for the pinned suite; 1 allowed for edge families). */
  courses: number;
  /** Sections per course (1..40). */
  sectionsPerCourse: number;
  /** Locked section ids to inject (the 2nd+ lock uses an unknown id to exercise the ignore rule). */
  locks: number;
  /** Excluded section ids to inject (never all sections of a course unless the profile demands it). */
  exclusions: number;
  /** 0..1 — probability each optional constraint is also set in the "mixed" profile. */
  constraintDensity: number;
  profile: ConstraintProfile;
}

interface Slot {
  start: number;
  duration: number;
}

/** Shared base generation: courses, sections (dense conflicts), weights, locks, exclusions. */
function generateBase(rng: Rng, size: InstanceSize): {
  sections: OptimizerSection[];
  courseCodes: string[];
  slots: Slot[];
} {
  const slotCount = Math.max(6, Math.min(14, size.sectionsPerCourse + 3));
  const slots: Slot[] = [];
  for (let i = 0; i < slotCount; i++) {
    slots.push({ start: 480 + 30 * randInt(rng, 0, 20), duration: 30 * randInt(rng, 1, 3) });
  }

  const courseCodes = Array.from({ length: size.courses }, (_, c) => `BENCH ${100 + c * 10}`);
  const sections: OptimizerSection[] = [];
  for (let c = 0; c < size.courses; c++) {
    const baseCredits = pick(rng, [3, 4] as const);
    for (let s = 0; s < size.sectionsPerCourse; s++) {
      const meetingCount = randInt(rng, 1, 3);
      const days = shuffled(rng, weekDays).slice(0, meetingCount);
      const sectionSlots = shuffled(rng, slots).slice(0, meetingCount);
      const meetings = days.map((day, i) => ({
        day,
        start: sectionSlots[i].start,
        end: sectionSlots[i].start + sectionSlots[i].duration,
        buildingId: maybe(rng, 0.2)
          ? pick(rng, BENCH_UNKNOWN_BUILDING_IDS)
          : pick(rng, BENCH_BUILDING_IDS),
      }));
      sections.push({
        id: `bench-s${c}-${s}`,
        courseCode: courseCodes[c],
        credits: Math.max(1, Math.min(5, baseCredits + pick(rng, [-1, 0, 0, 1] as const))),
        meetings,
        instructorRating: maybe(rng, 0.15) ? undefined : round2(rng() * 5, 1),
        historicalGpa: maybe(rng, 0.3) ? undefined : round2(rng() * 4, 1),
      });
    }
  }
  return { sections, courseCodes, slots };
}

/** Generate soft weights from the rng (all >= 0; some zero weights for coverage). */
function generateWeights(rng: Rng): SoftWeights {
  return {
    perGapMinute: round2(rng() * 2),
    perWalkingSecond: round2(rng() * 0.1, 3),
    perEarlyStartMinute: round2(rng()),
    perLateEndMinute: round2(rng()),
    perDayOnCampus: round2(rng() * 40),
    perRatingPoint: round2(rng() * 10),
    perGpaPoint: round2(rng() * 10),
    perUnknownWalking: pick(rng, [0, 10, 25, 50] as const),
  };
}

/** First section index of a course (sections are laid out course by course). */
function firstSectionIndexOfCourse(sections: OptimizerSection[], courseCode: string): number {
  return sections.findIndex((section) => section.courseCode === courseCode);
}

/**
 * Generate a complete benchmark request. Deterministic in (seed, size).
 * k is pinned to 3 and the time budget to 1000ms; ./instances.ts may
 * override the budget for the largest families.
 */
export function generateInstance(seed: number, size: InstanceSize): OptimizeRequest {
  const rng = mulberry32(seed);
  const { sections, courseCodes, slots } = generateBase(rng, size);
  const hardConstraints: HardConstraints = {};
  const requestedCourseCodes = [...courseCodes];
  const lockedSectionIds: string[] = [];
  const excludedSectionIds: string[] = [];
  let earlyStartAnchorMinutes: number | undefined;
  let lateEndAnchorMinutes: number | undefined;

  const allSectionIds = sections.map((section) => section.id);
  const minCreditsByCourse = courseCodes.map((code) =>
    Math.min(...sections.filter((section) => section.courseCode === code).map((section) => section.credits)),
  );
  const maxCreditsByCourse = courseCodes.map((code) =>
    Math.max(...sections.filter((section) => section.courseCode === code).map((section) => section.credits)),
  );
  const minCreditTotal = minCreditsByCourse.reduce((a, b) => a + b, 0);
  const maxCreditTotal = maxCreditsByCourse.reduce((a, b) => a + b, 0);
  const excludedSet = new Set<string>();

  // Lock / exclusion injection for non-degenerate profiles (degenerate
  // families set their own below).
  const degenerateProfiles: ConstraintProfile[] = [
    "infeasibleLockedOverlap",
    "infeasibleLockedExcluded",
    "infeasibleTransfer",
    "empty",
    "zeroCandidates",
    "singleOption",
  ];
  if (!degenerateProfiles.includes(size.profile)) {
    for (let i = 0; i < size.locks; i++) {
      // First lock is a real pool section; later locks use an id that is not
      // in the pool, exercising the "locked id of a non-requested course is
      // ignored" rule.
      lockedSectionIds.push(i === 0 ? pick(rng, allSectionIds) : "bench-missing-lock");
    }
    let guard = 0;
    while (excludedSet.size < size.exclusions && guard < 100) {
      guard += 1;
      const candidate = pick(rng, allSectionIds);
      if (lockedSectionIds.includes(candidate) || excludedSet.has(candidate)) continue;
      const course = candidate.slice(0, candidate.lastIndexOf("-"));
      const excludedForCourse = [...excludedSet].filter((id) => id.startsWith(`${course}-`)).length;
      if (excludedForCourse >= size.sectionsPerCourse - 1) continue;
      excludedSet.add(candidate);
      excludedSectionIds.push(candidate);
    }
  }

  switch (size.profile) {
    case "anchors": {
      // Witness schedule: per course, the first section not excluded. Anchors
      // tighten around the witness; feasibility is by construction.
      const witness = courseCodes.map(
        (code) => sections.find((section) => section.courseCode === code && !excludedSet.has(section.id)),
      );
      if (witness.every(Boolean)) {
        const witnessSections = witness as OptimizerSection[];
        const earliest = Math.max(...witnessSections.map((s) => Math.min(...s.meetings.map((m) => m.start))));
        const latest = Math.min(...witnessSections.map((s) => Math.max(...s.meetings.map((m) => m.end))));
        if (earliest <= latest) {
          earlyStartAnchorMinutes = earliest;
          lateEndAnchorMinutes = latest;
          hardConstraints.earliestStart = earliest;
          hardConstraints.latestEnd = latest;
          break;
        }
      }
      hardConstraints.earliestStart = 480;
      hardConstraints.latestEnd = 1200;
      break;
    }
    case "daysOff": {
      // The day that the most courses can fully avoid; feasible when every
      // course keeps a section off it (not guaranteed here).
      let bestDay: WeekDay = "Mon";
      let bestCoverage = -1;
      for (const day of weekDays) {
        const coverage = courseCodes.filter((code) =>
          sections.some(
            (section) => section.courseCode === code && !section.meetings.some((meeting) => meeting.day === day),
          ),
        ).length;
        if (coverage > bestCoverage) {
          bestCoverage = coverage;
          bestDay = day;
        }
      }
      hardConstraints.daysOff = [bestDay];
      break;
    }
    case "blocked": {
      // One or two blocked ranges over generated slots; not guaranteed either way.
      hardConstraints.blockedTimeRanges = Array.from({ length: randInt(rng, 1, 2) }, () => {
        const slot = pick(rng, slots);
        return { day: pick(rng, weekDays), start: slot.start, end: slot.start + slot.duration };
      });
      break;
    }
    case "transfer": {
      hardConstraints.minTransferMinutes = pick(rng, [30, 45, 60] as const);
      break;
    }
    case "credits": {
      // Tightest feasible credit cap: forces the min-credit pick in every course.
      hardConstraints.maxCredits = minCreditTotal;
      break;
    }
    case "mixed": {
      if (maybe(rng, size.constraintDensity)) {
        hardConstraints.earliestStart = 480 + 30 * randInt(rng, 0, 2);
        earlyStartAnchorMinutes = hardConstraints.earliestStart;
      }
      if (maybe(rng, size.constraintDensity)) {
        hardConstraints.latestEnd = 1110 + 30 * randInt(rng, 0, 3);
        lateEndAnchorMinutes = hardConstraints.latestEnd;
      }
      if (maybe(rng, size.constraintDensity)) hardConstraints.daysOff = shuffled(rng, weekDays).slice(0, 1);
      if (maybe(rng, size.constraintDensity)) {
        const slot = pick(rng, slots);
        hardConstraints.blockedTimeRanges = [
          { day: pick(rng, weekDays), start: slot.start, end: slot.start + slot.duration },
        ];
      }
      if (maybe(rng, size.constraintDensity)) hardConstraints.minTransferMinutes = pick(rng, [30, 45, 60] as const);
      if (maybe(rng, size.constraintDensity)) hardConstraints.maxCredits = maxCreditTotal;
      break;
    }
    case "infeasibleCredits": {
      hardConstraints.maxCredits = minCreditTotal - 1;
      break;
    }
    case "infeasibleBlocked": {
      // One blocked range per distinct meeting triple of course 0: every
      // course-0 candidate has a blocked overlap -> infeasible.
      const triples = new Set<string>();
      const ranges: BlockedTimeRange[] = [];
      for (const section of sections) {
        if (section.courseCode !== courseCodes[0]) continue;
        for (const meeting of section.meetings) {
          const key = `${meeting.day}|${meeting.start}|${meeting.end}`;
          if (triples.has(key)) continue;
          triples.add(key);
          ranges.push({ day: meeting.day, start: meeting.start, end: meeting.end });
        }
      }
      hardConstraints.blockedTimeRanges = ranges;
      break;
    }
    case "infeasibleTransfer": {
      // Two single-option sections whose unique schedules contain
      // different-building consecutive pairs; no gap can satisfy a transfer
      // minimum of 1,000,000 minutes.
      sections[0] = {
        ...sections[0],
        meetings: [
          { day: "Mon", start: 540, end: 570, buildingId: "bench-arts" },
          { day: "Mon", start: 630, end: 660, buildingId: "bench-sci" },
        ],
      };
      const course1Index = firstSectionIndexOfCourse(sections, courseCodes[1]);
      if (course1Index >= 0) {
        sections[course1Index] = {
          ...sections[course1Index],
          meetings: [
            { day: "Mon", start: 690, end: 720, buildingId: "bench-sci" },
            { day: "Mon", start: 780, end: 810, buildingId: "bench-arts" },
          ],
        };
      }
      hardConstraints.minTransferMinutes = 1_000_000;
      break;
    }
    case "infeasibleLockedOverlap": {
      // Two locked sections of different courses at the same time: the
      // baseline no-overlap invariant makes every schedule infeasible.
      sections[0] = { ...sections[0], meetings: [{ day: "Mon", start: 540, end: 660, buildingId: "bench-arts" }] };
      const course1Index = firstSectionIndexOfCourse(sections, courseCodes[1]);
      if (course1Index >= 0) {
        sections[course1Index] = {
          ...sections[course1Index],
          meetings: [{ day: "Mon", start: 540, end: 660, buildingId: "bench-sci" }],
        };
        lockedSectionIds.push(sections[0].id, sections[course1Index].id);
      }
      break;
    }
    case "infeasibleLockedExcluded": {
      lockedSectionIds.push(sections[0].id);
      excludedSectionIds.push(sections[0].id);
      excludedSet.add(sections[0].id);
      break;
    }
    case "infeasibleAllDaysOff": {
      hardConstraints.daysOff = [...weekDays];
      break;
    }
    case "empty": {
      requestedCourseCodes.length = 0;
      break;
    }
    case "zeroCandidates": {
      // A requested code with no pool sections: infeasible (one section per
      // requested course is impossible).
      requestedCourseCodes.push("BENCH 999");
      break;
    }
    case "singleOption":
    case "plain":
      break;
  }

  return {
    sections,
    requestedCourseCodes,
    lockedSectionIds,
    excludedSectionIds,
    hardConstraints,
    softWeights: generateWeights(rng),
    earlyStartAnchorMinutes,
    lateEndAnchorMinutes,
    k: 3,
    timeBudgetMs: 1000,
    walkingTime: benchWalkingTime,
  };
}
