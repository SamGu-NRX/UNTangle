/**
 * Seeded instances for the optimizer tests. Same seed, same instance: all
 * randomness comes from mulberry32 (the PRNG tests/schedule-oracle.test.ts
 * already uses). Sections follow the bundled sample data's shape (MWF
 * 50-minute and TR 80-minute classes on the usual starts, plus labs and
 * evening classes), with a few deliberately odd ones: a section whose own
 * meetings overlap, a lecture and lab back to back in different buildings,
 * twins differing only by instructor, and buildings with no walking
 * estimate.
 */

import type {
  OptConstraints,
  OptCourse,
  OptDateRange,
  OptDay,
  OptimizeRequest,
  OptMeeting,
  OptSection,
  OptWalkingTimeFn,
  OptWeights,
} from "@/lib/optimizer/types";

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const chance = (rng: Rng, p: number) => rng() < p;

/** Synthetic buildings on a 1.2 km square; the last two have no walking estimate. */
export const KNOWN_BUILDINGS = ["b-arts", "b-sci", "b-eng", "b-lib", "b-gym", "b-hall"] as const;
export const UNKNOWN_BUILDINGS = ["b-ghost-1", "b-ghost-2"] as const;
const COORDS: Record<string, [number, number]> = {
  "b-arts": [0, 0],
  "b-sci": [300, 150],
  "b-eng": [900, 400],
  "b-lib": [450, 700],
  "b-gym": [1200, 1100],
  "b-hall": [100, 950],
};

/** Straight-line walking at 1.4 m/s over the synthetic coordinates. */
export const syntheticWalkingTime: OptWalkingTimeFn = (from, to) => {
  const a = COORDS[from];
  const b = COORDS[to];
  if (!a || !b) return { seconds: null, source: "unknown" };
  if (from === to) return { seconds: 0, source: "campus-network" };
  return { seconds: Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) / 1.4), source: "straight-line" };
};

/**
 * A walking function that breaks the triangle inequality on purpose (a real
 * path network can, through one-way paths or rounding), so the tests catch
 * any pruning that silently assumes it.
 */
export const nonMetricWalkingTime: OptWalkingTimeFn = (from, to) => {
  if (!(from in COORDS) || !(to in COORDS)) return { seconds: null, source: "unknown" };
  if (from === to) return { seconds: 0, source: "campus-network" };
  const pair = [from, to].sort().join("|");
  let hash = 2166136261;
  for (let i = 0; i < pair.length; i += 1) hash = Math.imul(hash ^ pair.charCodeAt(i), 16777619);
  return { seconds: 60 + ((hash >>> 0) % 2400), source: "campus-network" };
};

type Pattern = Array<{ day: OptDay; start: number; end: number }>;

const MWF_STARTS = [8, 9, 10, 11, 12, 13, 14, 15, 16].map((h) => h * 60);
const TR_STARTS = [480, 570, 660, 750, 840, 930, 1020];

function realisticPattern(rng: Rng): Pattern {
  const roll = rng();
  if (roll < 0.45) {
    const start = pick(rng, MWF_STARTS);
    return (["Mon", "Wed", "Fri"] as const).map((day) => ({ day, start, end: start + 50 }));
  }
  if (roll < 0.8) {
    const start = pick(rng, TR_STARTS);
    return (["Tue", "Thu"] as const).map((day) => ({ day, start, end: start + 80 }));
  }
  if (roll < 0.9) {
    const start = pick(rng, [480, 660, 840]);
    return [{ day: pick(rng, ["Mon", "Tue", "Wed", "Thu", "Fri"] as const), start, end: start + 170 }];
  }
  const start = pick(rng, [1080, 1110]);
  return [{ day: pick(rng, ["Mon", "Tue", "Wed", "Thu"] as const), start, end: start + 170 }];
}

/** Any grid time, 30-minute steps: dense and irregular, for the exhaustive comparisons. */
function irregularPattern(rng: Rng): Pattern {
  const days = (["Mon", "Tue", "Wed", "Thu", "Fri"] as const).filter(() => chance(rng, 0.45));
  const chosen = days.length > 0 ? days : [pick(rng, ["Mon", "Tue", "Wed", "Thu", "Fri"] as const)];
  const start = 450 + 30 * int(rng, 0, 18);
  const length = pick(rng, [50, 60, 80, 90, 110]);
  return chosen.map((day) => ({ day, start, end: start + length }));
}

export type InstanceShape = {
  courses: number;
  sectionsPerCourse: number | [number, number];
  style: "realistic" | "irregular";
  /** Probability that each constraint kind is switched on. */
  constraintDensity: number;
  walking?: "metric" | "non-metric";
  /**
   * Spring 2027 date ranges and weekend meetings, as in real UNT sections:
   * sections run the full term (with or without dates), the first eight
   * weeks or the second, and some meet on Saturday (rarely Sunday). Off
   * by default; the extra random draws happen only when it is on, so every
   * other instance is unchanged.
   */
  terms?: boolean;
  /**
   * Instructor evidence on the sections, drawn per course: about half the
   * courses fully evidenced (whole hundredths 0 to 400, with repeats so
   * evidence ties occur), a quarter partially evidenced (which the omit rule
   * leaves out for every option), a quarter with none. Off by default; the
   * extra random draws happen only when it is on, so every other instance is
   * unchanged.
   */
  evidence?: boolean;
  /**
   * Chance that a section twins the previous one (same meetings and rooms,
   * another instructor). Twins cost the same, so with evidence on they are
   * where the evidence tier decides. Default 0.08.
   */
  twinChance?: number;
};

export const FULL_TERM = { start: "2027-01-11", end: "2027-05-07" } as const;
export const FIRST_HALF = { start: "2027-01-11", end: "2027-03-05" } as const;
export const SECOND_HALF = { start: "2027-03-15", end: "2027-05-07" } as const;

function termDates(rng: Rng): OptDateRange | null {
  const roll = rng();
  if (roll < 0.25) return null;
  if (roll < 0.4) return FULL_TERM;
  return roll < 0.7 ? FIRST_HALF : SECOND_HALF;
}

export function generateInstance(seed: number, shape: InstanceShape): OptimizeRequest {
  const rng = mulberry32(seed);
  const building = () => (chance(rng, 0.1) ? pick(rng, UNKNOWN_BUILDINGS) : pick(rng, KNOWN_BUILDINGS));
  // Instructor evidence, in whole hundredths 0 to 400; null marks a section
  // with no accepted evidence, and the omit rule then leaves the whole
  // course out of the tie-break tier. Drawn per course as the shape doc
  // says: about half the courses fully evidenced, a quarter partial, a
  // quarter with none. Off shapes draw nothing, so their instances stay
  // byte-identical to the no-evidence generator.
  const evidenceRoll = shape.evidence ? rng() : -1;
  const gpa = (): number | null | undefined =>
    evidenceRoll < 0
      ? undefined
      : evidenceRoll < 0.5
        ? 100 + int(rng, 0, 300)
        : evidenceRoll < 0.75
          ? chance(rng, 0.5)
            ? null
            : 100 + int(rng, 0, 300)
          : null;
  const courses: OptCourse[] = [];
  for (let c = 0; c < shape.courses; c += 1) {
    const code = `GEN ${1000 + c * 10 + int(rng, 0, 9)}`;
    const count = Array.isArray(shape.sectionsPerCourse)
      ? int(rng, shape.sectionsPerCourse[0], shape.sectionsPerCourse[1])
      : shape.sectionsPerCourse;
    const sections: OptSection[] = [];
    for (let s = 0; s < count; s += 1) {
      const id = `${code.replace(" ", "-").toLowerCase()}-${String(s + 1).padStart(3, "0")}`;
      const rating = chance(rng, 0.15) ? null : Math.round((1 + rng() * 4) * 10) / 10;
      const previous = sections[sections.length - 1];
      if (previous && chance(rng, shape.twinChance ?? 0.08)) {
        // A twin: same meetings and rooms, another instructor.
        const meetings = previous.meetings.map((m) => ({ ...m }));
        if (shape.terms && chance(rng, 0.6)) {
          // Same slot and room in other weeks, such as SPAN 2040 then 2050.
          const dates = termDates(rng);
          for (const meeting of meetings) meeting.dates = dates;
        }
        const twinValue = gpa();
        sections.push({ id, courseCode: code, rating, label: id.slice(-3), meetings, ...(typeof twinValue === "number" ? { instructorGpaHundredths: twinValue } : {}) });
        continue;
      }
      const pattern = shape.style === "realistic" ? realisticPattern(rng) : irregularPattern(rng);
      const room = building();
      const meetings: OptMeeting[] = pattern.map((slot) => ({ ...slot, buildingId: room as string | null }));
      if (chance(rng, 0.05)) {
        // A short recitation on another day: breaks shorter than a normal
        // class can then still hold one, which the search must not assume away.
        const day = pick(rng, ["Mon", "Tue", "Wed", "Thu", "Fri"] as const);
        const start = 480 + 30 * int(rng, 0, 16);
        meetings.push({ day, start, end: start + 25, buildingId: building() });
      } else if (chance(rng, 0.06)) {
        // A lab right after the lecture, elsewhere: within-section walking.
        const first = meetings[0];
        meetings.push({ day: first.day, start: first.end + pick(rng, [0, 10, 20]), end: first.end + 110, buildingId: building() });
      } else if (chance(rng, 0.03)) {
        // A broken section whose own meetings overlap.
        const first = meetings[0];
        meetings.push({ day: first.day, start: first.start + 20, end: first.end + 20, buildingId: room });
      }
      if (chance(rng, 0.03)) meetings[0].buildingId = null;
      if (shape.terms) {
        const weekend = rng();
        if (weekend < 0.12) {
          const start = 480 + 30 * int(rng, 0, 12);
          meetings.push({ day: weekend < 0.03 ? "Sun" : "Sat", start, end: start + pick(rng, [50, 80, 110, 170]), buildingId: building() });
        }
        const dates = termDates(rng);
        meetings.forEach((meeting, index) => {
          // Now and then a meeting runs in other weeks than the rest of its section.
          meeting.dates = index > 0 && chance(rng, 0.1) ? termDates(rng) : dates;
        });
      }
      const value = gpa();
      sections.push({ id, courseCode: code, rating, label: id.slice(-3), meetings, ...(typeof value === "number" ? { instructorGpaHundredths: value } : {}) });
    }
    courses.push({ code, credits: pick(rng, [3, 3, 3, 4, 4, 1]), sections });
  }

  const on = (p = shape.constraintDensity) => chance(rng, p);
  const totalCredits = courses.reduce((sum, course) => sum + course.credits, 0);
  const constraints: OptConstraints = {
    earliestStart: on() ? pick(rng, [480, 510, 540, 570, 600]) : null,
    latestEnd: on() ? pick(rng, [900, 950, 1000, 1020, 1080]) : null,
    daysOff: on() ? [pick(rng, shape.terms ? (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const) : (["Mon", "Tue", "Wed", "Thu", "Fri"] as const))] : [],
    blocked: on()
      ? Array.from({ length: int(rng, 1, 2) }, (_, i) => {
          // Aligned to class boundaries, so touching-but-not-overlapping cases occur.
          const start = pick(rng, [530, 590, 650, 710, 770, 830, 890]);
          return { id: `block-${i}`, label: pick(rng, ["Work", "Practice", "Lab job"]), day: pick(rng, ["Mon", "Tue", "Wed", "Thu", "Fri"] as const), start, end: start + pick(rng, [70, 130]) };
        }).filter((block, i, all) => all.findIndex((other) => other.id === block.id) === i)
      : [],
    maxCredits: on() ? totalCredits + pick(rng, [-1, 0, 0, 1]) : null,
    walking: on(Math.min(1, shape.constraintDensity * 1.5)) ? { bufferMinutes: pick(rng, [0, 0, 5]) } : null,
  };

  const locks: Record<string, string> = {};
  const excluded: string[] = [];
  for (const course of courses) {
    if (on(shape.constraintDensity * 0.5)) locks[course.code] = pick(rng, course.sections).id;
    if (on(shape.constraintDensity * 0.5)) {
      for (const section of course.sections) if (chance(rng, 0.3)) excluded.push(section.id);
    }
  }

  const weightRoll = rng();
  const weights: OptWeights =
    weightRoll < 0.1
      ? { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 }
      : {
          fewerDays: int(rng, 0, 4),
          compact: int(rng, 0, 4),
          mornings: chance(rng, 0.5) ? int(rng, 0, 4) : 0,
          evenings: chance(rng, 0.3) ? int(rng, 0, 4) : 0,
          walking: int(rng, 0, 4),
          rating: int(rng, 0, 4),
        };

  return {
    ...(shape.terms ? { term: FULL_TERM } : {}),
    courses,
    locks,
    excluded,
    constraints,
    weights,
    walkingTime: shape.walking === "non-metric" ? nonMetricWalkingTime : syntheticWalkingTime,
    k: 3,
    timeBudgetMs: 60_000,
    explainBudgetMs: 60_000,
  };
}
