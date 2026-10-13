/**
 * Turns a request into the search's static data: the candidate sections of
 * each course after every check that needs only the section itself, and the
 * pairs of sections that can never be in one schedule together.
 *
 * Nothing here can drop a section that some valid schedule uses, with one
 * deliberate exception: a section whose meetings and buildings are identical
 * to a cheaper one of the same course (a "twin") is dropped, because the
 * cheaper twin always ranks ahead of it (see `dropTwins`).
 */

import {
  MAX_WEIGHT,
  OPT_DAYS,
  OptimizerInputError,
  type OptConstraints,
  type OptCourse,
  type OptimizeRequest,
  type OptMeeting,
  type OptSection,
  type OptWeights,
} from "./types";
import { neutralRatingTenths, selfCost, transferFits, UNKNOWN_WALK_SECONDS, walkSeconds } from "./score";

export type PreparedMeeting = {
  day: number;
  start: number;
  end: number;
  /** Interned building index; -1 when the meeting has no building. */
  building: number;
};

export type Candidate = {
  /** Global bit index. */
  bit: number;
  section: OptSection;
  /** Index into `Prepared.courses` (courses sorted by code). */
  course: number;
  self: number;
  /** Bit i set when the section meets on OPT_DAYS[i]. */
  dayMask: number;
  /** Interned meeting-time pattern (days, starts, ends), comparable within a course. */
  timeSignature: number;
  meetings: PreparedMeeting[];
};

export type PreparedCourse = {
  code: string;
  credits: number;
  /** Candidates ascending by (self cost, section id). */
  candidates: Candidate[];
  /** First word of this course's bits; each course's bits start on a word boundary. */
  wordLo: number;
  wordHi: number;
  /** Candidate bits grouped by day mask: [dayMask, bitset over the whole word range]. */
  byDayMask: Array<{ dayMask: number; bits: Uint32Array }>;
  /** Number of candidates before the time-of-day, day-off and blocked-time checks. */
  sectionsBeforeConstraints: number;
};

export type Prepared = {
  courses: PreparedCourse[];
  candidates: Candidate[];
  words: number;
  /** Per candidate bit: the bits of candidates it can never be combined with. */
  conflicts: Uint32Array[];
  /** Walking seconds between interned buildings; -1 when unknown. */
  walk: Int32Array;
  buildingCount: number;
  /** Seconds a back-to-back transfer needs on top of the walk; null when the walking check is off. */
  bufferSeconds: number | null;
  weights: OptWeights;
  totalCredits: number;
  maxCredits: number | null;
  /** How many courses two alternatives must place at different times (see diversity in optimize.ts). */
  minDifferentCourses: number;
  creditsByCourse: Record<string, number>;
  neutralRatingByCourse: Record<string, number>;
  /** Distinct meeting start and end minutes, ascending. */
  times: number[];
  /** Minute of the day -> index into `times`, -1 when no meeting starts or ends then. */
  timeIndex: Int16Array;
  /**
   * fill[course][day][i * times.length + j]: the longest meeting of any of the
   * course's candidates on that day that fits inside [times[i], times[j]].
   * The search uses it to bound how much of a break other courses can fill.
   */
  fill: Int16Array[][];
  /**
   * Least walking cost between two buildings over any chain of buildings in
   * between (shortest paths, unknown legs at UNKNOWN_WALK_SECONDS), indexed
   * [from * (buildingCount + 1) + to] with index buildingCount standing for
   * "no building". However many classes end up between two classes, the walk
   * from one to the other costs at least this.
   */
  walkFloor: Float64Array;
};

const DAY_INDEX = new Map(OPT_DAYS.map((day, index) => [day, index] as const));

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Loud checks of the request shape. A failure is a bug in the caller, not a student input. */
export function validateRequest(request: OptimizeRequest): void {
  const codes = new Set<string>();
  const sectionIds = new Map<string, string>();
  for (const course of request.courses) {
    if (codes.has(course.code)) throw new OptimizerInputError(`course ${course.code} is listed twice`);
    codes.add(course.code);
    if (!Number.isFinite(course.credits) || course.credits < 0) {
      throw new OptimizerInputError(`course ${course.code} has invalid credits ${course.credits}`);
    }
    for (const section of course.sections) {
      if (sectionIds.has(section.id)) throw new OptimizerInputError(`section ${section.id} is listed twice`);
      sectionIds.set(section.id, course.code);
      if (section.courseCode !== course.code) {
        throw new OptimizerInputError(`section ${section.id} belongs to ${section.courseCode}, listed under ${course.code}`);
      }
      if (section.meetings.length === 0) throw new OptimizerInputError(`section ${section.id} has no meetings`);
      for (const meeting of section.meetings) {
        if (!DAY_INDEX.has(meeting.day)) throw new OptimizerInputError(`section ${section.id} meets on unknown day ${meeting.day}`);
        if (!isInteger(meeting.start, 0, 24 * 60) || !isInteger(meeting.end, 0, 24 * 60) || meeting.end <= meeting.start) {
          throw new OptimizerInputError(`section ${section.id} has a meeting with invalid times ${meeting.start}-${meeting.end}`);
        }
      }
    }
  }
  for (const [courseCode, sectionId] of Object.entries(request.locks)) {
    if (!codes.has(courseCode)) throw new OptimizerInputError(`lock on ${courseCode}, which is not a requested course`);
    if (sectionIds.get(sectionId) !== courseCode) {
      throw new OptimizerInputError(`lock on ${courseCode} names ${sectionId}, which is not one of its sections`);
    }
  }
  for (const sectionId of request.excluded) {
    if (!sectionIds.has(sectionId)) throw new OptimizerInputError(`excluded section ${sectionId} is not in the request`);
  }
  for (const [key, value] of Object.entries(request.weights)) {
    if (!isInteger(value, 0, MAX_WEIGHT)) throw new OptimizerInputError(`weight ${key} must be an integer 0..${MAX_WEIGHT}, got ${value}`);
  }
  const constraints = request.constraints;
  for (const [key, value] of [
    ["earliestStart", constraints.earliestStart],
    ["latestEnd", constraints.latestEnd],
  ] as const) {
    if (value !== null && !isInteger(value, 0, 24 * 60)) throw new OptimizerInputError(`${key} must be a minute of the day, got ${value}`);
  }
  for (const day of constraints.daysOff) {
    if (!DAY_INDEX.has(day)) throw new OptimizerInputError(`unknown day off ${day}`);
  }
  const blockedIds = new Set<string>();
  for (const block of constraints.blocked) {
    if (blockedIds.has(block.id)) throw new OptimizerInputError(`blocked time ${block.id} is listed twice`);
    blockedIds.add(block.id);
    if (!DAY_INDEX.has(block.day) || !isInteger(block.start, 0, 24 * 60) || !isInteger(block.end, 0, 24 * 60) || block.end <= block.start) {
      throw new OptimizerInputError(`blocked time ${block.id} is invalid`);
    }
  }
  if (constraints.maxCredits !== null && !(Number.isFinite(constraints.maxCredits) && constraints.maxCredits >= 0)) {
    throw new OptimizerInputError(`maxCredits must be a non-negative number, got ${constraints.maxCredits}`);
  }
  if (constraints.walking !== null && !isInteger(constraints.walking.bufferMinutes, 0, 120)) {
    throw new OptimizerInputError(`walking buffer must be 0..120 minutes, got ${constraints.walking.bufferMinutes}`);
  }
  const k = request.k ?? 3;
  if (!isInteger(k, 1, 20)) throw new OptimizerInputError(`k must be an integer 1..20, got ${k}`);
}

function overlaps(a: { day: number; start: number; end: number }, b: { day: number; start: number; end: number }) {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

/**
 * The checks a section passes or fails on its own: start and end of day,
 * days off, blocked times. Shared with the diversity rule, which counts
 * time options after exactly these checks.
 */
export function passesTimeConstraints(section: OptSection, constraints: OptConstraints): boolean {
  const off = new Set(constraints.daysOff);
  for (const meeting of section.meetings) {
    if (constraints.earliestStart !== null && meeting.start < constraints.earliestStart) return false;
    if (constraints.latestEnd !== null && meeting.end > constraints.latestEnd) return false;
    if (off.has(meeting.day)) return false;
    for (const block of constraints.blocked) {
      if (block.day === meeting.day && meeting.start < block.end && block.start < meeting.end) return false;
    }
  }
  return true;
}

/** Days, starts and ends of a section's meetings, ignoring buildings. */
export function timeSignatureOf(meetings: readonly OptMeeting[]): string {
  return meetings
    .map((m) => `${DAY_INDEX.get(m.day)}:${m.start}-${m.end}`)
    .sort()
    .join(",");
}

function fullSignatureOf(meetings: readonly OptMeeting[]): string {
  return meetings
    .map((m) => `${DAY_INDEX.get(m.day)}:${m.start}-${m.end}@${m.buildingId ?? ""}`)
    .sort()
    .join(",");
}

/** The sections a course may use after locks and exclusions. */
export function allowedSections(course: OptCourse, request: Pick<OptimizeRequest, "locks" | "excluded">): OptSection[] {
  const excluded = new Set(request.excluded);
  const locked = request.locks[course.code];
  return course.sections.filter((section) => !excluded.has(section.id) && (locked === undefined || section.id === locked));
}

/**
 * Two alternatives are meaningfully different when they place at least this
 * many courses at different meeting times (days, starts or ends; a different
 * room or instructor at the same times does not count). It is 2, or fewer
 * when fewer courses have a choice of times after locks, exclusions and the
 * time constraints. Never below 1.
 */
export function minDifferentCourses(request: Pick<OptimizeRequest, "courses" | "locks" | "excluded" | "constraints">): number {
  let variable = 0;
  for (const course of request.courses) {
    const signatures = new Set(
      allowedSections(course, request)
        .filter((section) => passesTimeConstraints(section, request.constraints))
        .map((section) => timeSignatureOf(section.meetings)),
    );
    if (signatures.size >= 2) variable += 1;
  }
  return Math.max(1, Math.min(2, variable));
}

function compareIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function prepare(request: OptimizeRequest): Prepared {
  validateRequest(request);
  const { constraints, weights } = request;
  const sortedCourses = [...request.courses].sort((a, b) => compareIds(a.code, b.code));

  const buildingIndex = new Map<string, number>();
  const intern = (id: string | null) => {
    if (id === null) return -1;
    let index = buildingIndex.get(id);
    if (index === undefined) {
      index = buildingIndex.size;
      buildingIndex.set(id, index);
    }
    return index;
  };

  // Shortest meeting any chosen section could have: a break shorter than
  // this can never hold another class.
  let globalMinDuration = Number.POSITIVE_INFINITY;
  const allowedByCourse = sortedCourses.map((course) => allowedSections(course, request));
  for (const list of allowedByCourse) {
    for (const section of list) {
      for (const meeting of section.meetings) {
        globalMinDuration = Math.min(globalMinDuration, meeting.end - meeting.start);
        intern(meeting.buildingId);
      }
    }
  }

  const buildingCount = buildingIndex.size;
  const walk = new Int32Array(buildingCount * buildingCount);
  const buildingIds = [...buildingIndex.keys()];
  for (let a = 0; a < buildingCount; a += 1) {
    for (let b = 0; b < buildingCount; b += 1) {
      const seconds = walkSeconds(request.walkingTime, buildingIds[a], buildingIds[b]);
      walk[a * buildingCount + b] = seconds === null ? -1 : seconds;
    }
  }
  const bufferMinutes = constraints.walking?.bufferMinutes ?? null;
  const walkOf = (from: number, to: number): number | null => {
    if (from >= 0 && from === to) return 0;
    if (from < 0 || to < 0) return null;
    const seconds = walk[from * buildingCount + to];
    return seconds < 0 ? null : seconds;
  };
  /** A back-to-back pair that breaks the walking check and that no other class can sit between. */
  const tightPair = (prev: PreparedMeeting, next: PreparedMeeting) =>
    bufferMinutes !== null &&
    !(prev.building >= 0 && prev.building === next.building) &&
    next.start - prev.end < globalMinDuration &&
    !transferFits(prev, next, walkOf(prev.building, next.building), bufferMinutes);

  const neutralRatingByCourse: Record<string, number> = {};
  const creditsByCourse: Record<string, number> = {};
  const courses: PreparedCourse[] = [];
  const candidates: Candidate[] = [];
  let word = 0;
  const signatureIds = new Map<string, number>();

  sortedCourses.forEach((course, courseIndex) => {
    const neutral = neutralRatingTenths(course.sections);
    neutralRatingByCourse[course.code] = neutral;
    creditsByCourse[course.code] = course.credits;
    const allowed = allowedByCourse[courseIndex];
    const kept: Candidate[] = [];
    for (const section of allowed) {
      if (!passesTimeConstraints(section, constraints)) continue;
      const meetings = section.meetings
        .map((m) => ({ day: DAY_INDEX.get(m.day)!, start: m.start, end: m.end, building: intern(m.buildingId) }))
        .sort((a, b) => a.day - b.day || a.start - b.start);
      let selfBroken = false;
      for (let i = 0; i < meetings.length && !selfBroken; i += 1) {
        for (let j = i + 1; j < meetings.length; j += 1) {
          // Two meetings of one section are checked like any other pair:
          // they may not overlap, and the walk between them must fit.
          if (overlaps(meetings[i], meetings[j])) {
            selfBroken = true;
            break;
          }
        }
        const next = meetings[i + 1];
        if (next && next.day === meetings[i].day && tightPair(meetings[i], next)) selfBroken = true;
      }
      if (selfBroken) continue;
      const signature = timeSignatureOf(section.meetings);
      let signatureId = signatureIds.get(signature);
      if (signatureId === undefined) {
        signatureId = signatureIds.size;
        signatureIds.set(signature, signatureId);
      }
      kept.push({
        bit: -1,
        section,
        course: courseIndex,
        self: selfCost(section, weights, neutral),
        dayMask: meetings.reduce((mask, m) => mask | (1 << m.day), 0),
        timeSignature: signatureId,
        meetings,
      });
    }
    const walkingMatters = weights.walking > 0 || constraints.walking !== null;
    const ordered = dropTwins(kept, walkingMatters).sort((a, b) => a.self - b.self || compareIds(a.section.id, b.section.id));
    const wordLo = word;
    ordered.forEach((candidate, index) => {
      candidate.bit = wordLo * 32 + index;
      candidates.push(candidate);
    });
    word += Math.max(1, Math.ceil(ordered.length / 32));
    courses.push({
      code: course.code,
      credits: course.credits,
      candidates: ordered,
      wordLo,
      wordHi: word,
      byDayMask: [],
      sectionsBeforeConstraints: allowed.length,
    });
  });

  const words = word;
  for (const course of courses) {
    const groups = new Map<number, Uint32Array>();
    for (const candidate of course.candidates) {
      let bits = groups.get(candidate.dayMask);
      if (!bits) {
        bits = new Uint32Array(words);
        groups.set(candidate.dayMask, bits);
      }
      bits[candidate.bit >>> 5] |= 1 << (candidate.bit & 31);
    }
    course.byDayMask = [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dayMask, bits]) => ({ dayMask, bits }));
  }

  // Indexed by candidate bit; bits in a course's padding have no entry.
  const conflicts: Uint32Array[] = [];
  for (const candidate of candidates) conflicts[candidate.bit] = new Uint32Array(words);
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.course === b.course) continue;
      if (incompatible(a, b, tightPair)) {
        conflicts[a.bit][b.bit >>> 5] |= 1 << (b.bit & 31);
        conflicts[b.bit][a.bit >>> 5] |= 1 << (a.bit & 31);
      }
    }
  }

  const timeSet = new Set<number>();
  for (const candidate of candidates) {
    for (const meeting of candidate.meetings) {
      timeSet.add(meeting.start);
      timeSet.add(meeting.end);
    }
  }
  const times = [...timeSet].sort((a, b) => a - b);
  const timeIndex = new Int16Array(24 * 60 + 1).fill(-1);
  times.forEach((minute, index) => (timeIndex[minute] = index));
  const t = times.length;
  const fill = courses.map((course) =>
    OPT_DAYS.map((_, day) => {
      const table = new Int16Array(t * t);
      for (const candidate of course.candidates) {
        for (const meeting of candidate.meetings) {
          if (meeting.day !== day) continue;
          const k = timeIndex[meeting.start] * t + timeIndex[meeting.end];
          table[k] = Math.max(table[k], meeting.end - meeting.start);
        }
      }
      // Widen: a window [i, j] holds everything a narrower window inside it holds.
      for (let i = t - 1; i >= 0; i -= 1) {
        for (let j = 0; j < t; j += 1) {
          let value = table[i * t + j];
          if (i + 1 < t && table[(i + 1) * t + j] > value) value = table[(i + 1) * t + j];
          if (j > 0 && table[i * t + j - 1] > value) value = table[i * t + j - 1];
          table[i * t + j] = value;
        }
      }
      return table;
    }),
  );

  const nodes = buildingCount + 1;
  const walkFloor = new Float64Array(nodes * nodes);
  for (let a = 0; a < nodes; a += 1) {
    for (let b = 0; b < nodes; b += 1) {
      const known = a < buildingCount && b < buildingCount ? walkOf(a, b) : null;
      walkFloor[a * nodes + b] = a === b && a < buildingCount ? 0 : (known ?? UNKNOWN_WALK_SECONDS);
    }
  }
  for (let via = 0; via < nodes; via += 1) {
    for (let a = 0; a < nodes; a += 1) {
      for (let b = 0; b < nodes; b += 1) {
        const through = walkFloor[a * nodes + via] + walkFloor[via * nodes + b];
        if (through < walkFloor[a * nodes + b]) walkFloor[a * nodes + b] = through;
      }
    }
  }

  return {
    walkFloor,
    times,
    timeIndex,
    fill,
    courses,
    candidates,
    words,
    conflicts,
    walk,
    buildingCount,
    bufferSeconds: bufferMinutes === null ? null : bufferMinutes * 60,
    weights,
    totalCredits: sortedCourses.reduce((sum, course) => sum + course.credits, 0),
    maxCredits: constraints.maxCredits,
    minDifferentCourses: minDifferentCourses(request),
    creditsByCourse,
    neutralRatingByCourse,
  };
}

/**
 * Two sections can never be chosen together when any of their meetings
 * overlap, or when, merged into one day, a back-to-back pair across them
 * breaks the walking check with a break too short for any other class to
 * sit in between (so the pair stays back-to-back in every schedule).
 */
function incompatible(a: Candidate, b: Candidate, tightPair: (prev: PreparedMeeting, next: PreparedMeeting) => boolean): boolean {
  for (const ma of a.meetings) {
    for (const mb of b.meetings) {
      if (overlaps(ma, mb)) return true;
    }
  }
  if ((a.dayMask & b.dayMask) === 0) return false;
  const merged = [
    ...a.meetings.map((meeting) => ({ meeting, from: 0 })),
    ...b.meetings.map((meeting) => ({ meeting, from: 1 })),
  ].sort((x, y) => x.meeting.day - y.meeting.day || x.meeting.start - y.meeting.start);
  for (let i = 1; i < merged.length; i += 1) {
    const prev = merged[i - 1];
    const next = merged[i];
    if (prev.meeting.day !== next.meeting.day || prev.from === next.from) continue;
    if (tightPair(prev.meeting, next.meeting)) return true;
  }
  return false;
}

/**
 * Of sections with identical meetings in identical buildings, keep the one
 * with the lowest (self cost, id). Every other cost term and every hard
 * constraint depend only on meetings and buildings, and the diversity rule
 * only on meeting times, so the kept twin is at least as good in every
 * schedule and wins the id tie-break: the dropped twin can never be
 * returned at any rank. When neither the walking weight nor the walking
 * check is on, buildings affect nothing, so sections with the same times
 * are twins regardless of room.
 */
function dropTwins(candidates: Candidate[], walkingMatters: boolean): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = walkingMatters ? fullSignatureOf(candidate.section.meetings) : timeSignatureOf(candidate.section.meetings);
    const current = best.get(key);
    if (
      !current ||
      candidate.self < current.self ||
      (candidate.self === current.self && compareIds(candidate.section.id, current.section.id) < 0)
    ) {
      best.set(key, candidate);
    }
  }
  return [...best.values()];
}
