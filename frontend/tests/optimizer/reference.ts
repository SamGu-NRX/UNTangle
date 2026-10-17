/**
 * Brute-force reference for the optimizer, written from the contract in
 * src/lib/optimizer/types.ts and the numbers in score.ts's doc comment, and
 * sharing no code with the engine: every constant below is written out
 * again on purpose, so a changed constant in the engine is a disagreement.
 *
 * It enumerates every combination of one section per course, so it is only
 * usable on small instances.
 *
 * Dates, from the contract: undated meetings run inside the explicit term;
 * dated meetings run inside their own range, without clipping. This reference
 * enumerates calendar dates and their weekdays, not the engine's event sweep
 * or bitmasks. Dates with identical active meetings need only one pair check.
 */

import { instructorTiebreak } from "@untangle/core/instructor-tiebreak";
import type { ExplainMember, Relaxation, OptCourse, OptDay, OptimizeRequest, OptMeeting, OptSection, OptWeights } from "@/lib/optimizer/types";

const DAYS: OptDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const UNKNOWN_WALK = 600;

function runsOn(request: OptimizeRequest, meeting: OptMeeting, date: string): boolean {
  const range = meeting.dates ?? request.term;
  return !range || (range.start <= date && date <= range.end);
}

type Occurrence = { day: OptDay; date: string };
const occurrencesCache = new WeakMap<OptimizeRequest, Occurrence[]>();
function occurrences(request: OptimizeRequest): Occurrence[] {
  const cached = occurrencesCache.get(request);
  if (cached) return cached;
  const meetings = request.courses.flatMap((c) => c.sections.flatMap((s) => s.meetings));
  if (meetings.some((m) => m.dates) && !request.term) throw new Error("reference: dated meetings require term");
  if (!request.term) return DAYS.map((day) => ({ day, date: "any" }));
  const ranges = [request.term, ...meetings.flatMap((m) => m.dates ? [m.dates] : [])];
  const start = ranges.map((r) => r.start).sort()[0];
  const end = ranges.map((r) => r.end).sort().at(-1)!;
  const out: Occurrence[] = [];
  const seen = new Set<string>();
  const cursor = new Date(`${start}T00:00:00Z`);
  for (;;) {
    const date = cursor.toISOString().slice(0, 10);
    if (date > end) break;
    const day = DAYS[(cursor.getUTCDay() + 6) % 7];
    const active = meetings.flatMap((m, i) => m.day === day && runsOn(request, m, date) ? [i] : []);
    const key = `${day}:${active.join(",")}`;
    if (active.length > 0 && !seen.has(key)) {
      seen.add(key);
      out.push({ day, date });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  occurrencesCache.set(request, out);
  return out;
}

function shareAWeek(request: OptimizeRequest, a: OptMeeting, b: OptMeeting): boolean {
  return occurrences(request).some(({ day, date }) => day === a.day && runsOn(request, a, date) && runsOn(request, b, date));
}

type Placed = OptMeeting & { owner: string };

/** Distinct back-to-back pairs of a selection, each once. */
function backToBackPairs(request: OptimizeRequest, chosen: OptSection[]): Array<[Placed, Placed]> {
  const all: Placed[] = chosen.flatMap((section) => section.meetings.map((m) => ({ ...m, owner: section.id })));
  const seen = new Set<string>();
  const pairs: Array<[Placed, Placed]> = [];
  for (const { day, date } of occurrences(request)) {
    const list = all
      .map((m, index) => ({ m, index }))
      .filter(({ m }) => m.day === day && runsOn(request, m, date))
      .sort((a, b) => a.m.start - b.m.start || a.m.end - b.m.end);
    for (let i = 1; i < list.length; i += 1) {
      const key = `${list[i - 1].index}|${list[i].index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([list[i - 1].m, list[i].m]);
    }
  }
  return pairs;
}

export type RefSchedule = {
  sections: OptSection[];
  byCourse: Record<string, string>;
  cost: number;
  key: string[];
  breakdown: {
    daysOnCampus: number;
    gapMinutes: number;
    walkSeconds: number;
    unknownWalks: number;
    earliestStart: number | null;
    latestEnd: number | null;
    credits: number;
  };
};

function placeOf(meeting: Pick<OptMeeting, "buildingId" | "place">): string | null {
  return meeting.place === undefined ? meeting.buildingId : meeting.place;
}

function noWalkBetween(a: Pick<OptMeeting, "buildingId" | "place">, b: Pick<OptMeeting, "buildingId" | "place">): boolean {
  const from = placeOf(a);
  const to = placeOf(b);
  return from === "online" || to === "online" || (from !== null && from === to);
}

function walkBetween(request: OptimizeRequest, a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null;
  const leg = request.walkingTime(a, b);
  // Contract: fractional seconds are rounded to whole seconds.
  return leg.source === "unknown" || leg.seconds === null ? null : Math.round(leg.seconds);
}

/** Every hard-constraint violation of a complete selection, as readable strings. */
export function violations(request: OptimizeRequest, chosen: OptSection[]): string[] {
  const problems: string[] = [];
  const c = request.constraints;
  const codes = request.courses.map((course) => course.code);
  const chosenCodes = chosen.map((section) => section.courseCode);
  if ([...chosenCodes].sort().join() !== [...codes].sort().join()) problems.push("not exactly one section per course");
  for (const section of chosen) {
    const course = request.courses.find((entry) => entry.code === section.courseCode);
    if (!course || !course.sections.some((entry) => entry.id === section.id)) problems.push(`${section.id} not offered`);
    if (request.excluded.includes(section.id)) problems.push(`${section.id} excluded`);
    const lock = request.locks[section.courseCode];
    if (lock !== undefined && lock !== section.id) problems.push(`${section.courseCode} lock broken`);
    for (const m of section.meetings) {
      if (c.earliestStart !== null && m.start < c.earliestStart) problems.push(`${section.id} starts too early`);
      if (c.latestEnd !== null && m.end > c.latestEnd) problems.push(`${section.id} ends too late`);
      if (c.daysOff.includes(m.day)) problems.push(`${section.id} on a day off`);
      for (const b of c.blocked) {
        if (b.day === m.day && m.start < b.end && b.start < m.end) problems.push(`${section.id} hits ${b.id}`);
      }
    }
  }
  const all = chosen.flatMap((section) => section.meetings.map((m) => ({ ...m, owner: section.id })));
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i];
      const b = all[j];
      if (a.day === b.day && a.start < b.end && b.start < a.end && shareAWeek(request, a, b)) problems.push(`overlap ${a.owner} ${b.owner}`);
    }
  }
  // Contract (OptSection.exam): two known finals on one date that share a minute can't be in one schedule.
  for (let i = 0; i < chosen.length; i += 1) {
    for (let j = i + 1; j < chosen.length; j += 1) {
      const a = chosen[i].exam;
      const b = chosen[j].exam;
      if (a && b && a.date === b.date && a.start < b.end && b.start < a.end) problems.push(`finals ${chosen[i].id} ${chosen[j].id}`);
    }
  }
  if (c.maxCredits !== null) {
    // Courses outside the request still count toward the limit (fixedCredits).
    const credits = chosen.reduce((sum, s) => sum + request.courses.find((course) => course.code === s.courseCode)!.credits, request.fixedCredits ?? 0);
    if (credits > c.maxCredits) problems.push("too many credits");
  }
  if (c.walking !== null) {
    for (const [prev, next] of backToBackPairs(request, chosen)) {
      if (noWalkBetween(prev, next)) continue;
      const walk = walkBetween(request, prev.buildingId, next.buildingId) ?? UNKNOWN_WALK;
      if ((next.start - prev.end) * 60 < walk + c.walking.bufferMinutes * 60) problems.push(`walk ${prev.owner} -> ${next.owner}`);
    }
  }
  return problems;
}

function neutralTenths(course: OptCourse): number {
  const present = course.sections.filter((s) => s.rating !== null).map((s) => Math.max(0, Math.min(50, Math.round(s.rating! * 10))));
  return present.length === 0 ? 30 : Math.round(present.reduce((a, b) => a + b, 0) / present.length);
}

export function referenceCost(request: OptimizeRequest, chosen: OptSection[]): Pick<RefSchedule, "cost" | "breakdown"> {
  const w: OptWeights = request.weights;
  const all = chosen.flatMap((section) => section.meetings);
  let gap = 0;
  let walk = 0;
  let unknown = 0;
  const days = new Set(all.map((m) => m.day));
  for (const [prev, next] of backToBackPairs(request, chosen)) {
    gap += Math.max(0, next.start - prev.end);
    if (noWalkBetween(prev, next)) continue;
    const seconds = walkBetween(request, prev.buildingId, next.buildingId);
    if (seconds === null) unknown += 1;
    else walk += seconds;
  }
  let cost = w.fewerDays * 3600 * days.size + w.compact * 60 * gap + w.walking * (walk + 600 * unknown);
  for (const section of chosen) {
    const n = section.meetings.length;
    const meanStart = Math.round(section.meetings.reduce((a, m) => a + m.start, 0) / n);
    const meanEnd = Math.round(section.meetings.reduce((a, m) => a + m.end, 0) / n);
    cost += 20 * (w.mornings * Math.max(0, meanStart - 420) + w.evenings * Math.max(0, 1320 - meanEnd));
    const course = request.courses.find((entry) => entry.code === section.courseCode)!;
    const tenths = section.rating === null ? neutralTenths(course) : Math.max(0, Math.min(50, Math.round(section.rating * 10)));
    cost += w.rating * (50 - tenths) * 180;
  }
  return {
    cost,
    breakdown: {
      daysOnCampus: days.size,
      gapMinutes: gap,
      walkSeconds: walk,
      unknownWalks: unknown,
      earliestStart: all.length ? Math.min(...all.map((m) => m.start)) : null,
      latestEnd: all.length ? Math.max(...all.map((m) => m.end)) : null,
      credits: chosen.reduce((sum, s) => sum + request.courses.find((course) => course.code === s.courseCode)!.credits, request.fixedCredits ?? 0),
    },
  };
}

/** Meeting times including dates: a first-half and a second-half section at one slot differ. */
function timePattern(section: OptSection): string {
  return section.meetings.map((m) => `${m.day} ${m.start} ${m.end} ${m.dates ? `${m.dates.start}..${m.dates.end}` : "every week"}`).sort().join(";");
}

/** The contract's diversity threshold, recomputed from its definition. */
export function referenceMinDifferent(request: OptimizeRequest): number {
  const c = request.constraints;
  let variable = 0;
  for (const course of request.courses) {
    const lock = request.locks[course.code];
    const patterns = new Set(
      course.sections
        .filter((s) => !request.excluded.includes(s.id) && (lock === undefined || s.id === lock))
        .filter((s) =>
          s.meetings.every(
            (m) =>
              (c.earliestStart === null || m.start >= c.earliestStart) &&
              (c.latestEnd === null || m.end <= c.latestEnd) &&
              !c.daysOff.includes(m.day) &&
              c.blocked.every((b) => !(b.day === m.day && m.start < b.end && b.start < m.end)),
          ),
        )
        .map(timePattern),
    );
    if (patterns.size >= 2) variable += 1;
  }
  return Math.max(1, Math.min(2, variable));
}

function compareKey(a: string[], b: string[]): number {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** Every valid schedule, best first. */
export function enumerateValid(request: OptimizeRequest): RefSchedule[] {
  const courses = [...request.courses].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const out: RefSchedule[] = [];
  const current: OptSection[] = [];
  // The evidence tier is core's rule, read off the request exactly as the
  // engine prepares it: per option, the accepted hundredths; the comparator
  // applies the omit rule (a course with any option without evidence
  // contributes 0 for every schedule).
  const compareEvidence = instructorTiebreak(
    request.courses.map((course) => ({
      courseCode: course.code,
      options: Object.fromEntries(
        course.sections.map((section) => [
          section.id,
          typeof section.instructorGpaHundredths === "number"
            ? { kind: "known" as const, meanGradePointsHundredths: section.instructorGpaHundredths }
            : { kind: "unknown" as const },
        ]),
      ),
    })),
  );
  const walk = (index: number) => {
    if (index === courses.length) {
      if (violations(request, current).length > 0) return;
      const { cost, breakdown } = referenceCost(request, current);
      out.push({
        sections: [...current],
        byCourse: Object.fromEntries(current.map((s) => [s.courseCode, s.id])),
        cost,
        key: current.map((s) => s.id),
        breakdown,
      });
      return;
    }
    for (const section of courses[index].sections) {
      current.push(section);
      walk(index + 1);
      current.pop();
    }
  };
  walk(0);
  // Same order the engine must return: ascending cost, then core's
  // instructor-evidence order, then the section ids in course-code order.
  return out.sort((a, b) => a.cost - b.cost || compareEvidence(a.byCourse, b.byCourse) || compareKey(a.key, b.key));
}

/** Top k under the contract: best first, each next the best that differs enough from all picked. */
export function referenceTopK(request: OptimizeRequest): { schedules: RefSchedule[]; minDifferent: number } {
  const valid = enumerateValid(request);
  const minDifferent = referenceMinDifferent(request);
  const picked: RefSchedule[] = [];
  const differing = (a: RefSchedule, b: RefSchedule) =>
    a.sections.filter((s, i) => timePattern(s) !== timePattern(b.sections[i])).length;
  for (const schedule of valid) {
    if (picked.length === (request.k ?? 3)) break;
    if (picked.every((other) => differing(schedule, other) >= minDifferent)) picked.push(schedule);
  }
  return { schedules: picked, minDifferent };
}

export function referenceFeasible(request: OptimizeRequest): boolean {
  const courses = [...request.courses];
  const current: OptSection[] = [];
  const walk = (index: number): boolean => {
    if (index === courses.length) return violations(request, current).length === 0;
    for (const section of courses[index].sections) {
      current.push(section);
      if (walk(index + 1)) return true;
      current.pop();
    }
    return false;
  };
  return walk(0);
}

/** Number of combinations the reference would enumerate. */
export function combinationCount(request: OptimizeRequest): number {
  return request.courses.reduce((product, course) => product * course.sections.length, 1);
}

/**
 * The request with only the named members, per the contract: courses not
 * named are dropped (with their locks and exclusions), constraints not named
 * are off.
 */
export function referenceRestrict(request: OptimizeRequest, members: ExplainMember[]): OptimizeRequest {
  const named = (predicate: (m: ExplainMember) => boolean) => members.some(predicate);
  // Without the finals rule named, no section has a final to clash on.
  const courses = request.courses
    .filter((course) => named((m) => m.kind === "course" && m.courseCode === course.code))
    .map((course) => (named((m) => m.kind === "exams") ? course : { ...course, sections: course.sections.map((s) => (s.exam ? { ...s, exam: null } : s)) }));
  const ids = new Set(courses.flatMap((course) => course.sections.map((s) => s.id)));
  const c = request.constraints;
  return {
    ...request,
    courses,
    locks: Object.fromEntries(
      Object.entries(request.locks).filter(
        ([code]) => courses.some((course) => course.code === code) && named((m) => m.kind === "lock" && m.courseCode === code),
      ),
    ),
    excluded: request.excluded.filter((id) => ids.has(id) && named((m) => m.kind === "excluded" && m.sectionId === id)),
    constraints: {
      earliestStart: named((m) => m.kind === "earliestStart") ? c.earliestStart : null,
      latestEnd: named((m) => m.kind === "latestEnd") ? c.latestEnd : null,
      daysOff: c.daysOff.filter((day) => named((m) => m.kind === "dayOff" && m.day === day)),
      blocked: c.blocked.filter((b) => named((m) => m.kind === "blocked" && m.blockedId === b.id)),
      maxCredits: named((m) => m.kind === "maxCredits") ? c.maxCredits : null,
      walking: named((m) => m.kind === "walking") ? c.walking : null,
    },
  };
}

/** A suggested relaxation applied to the full request, written from the contract. */
export function referenceRelax(request: OptimizeRequest, relaxation: Relaxation): OptimizeRequest {
  const c = { ...request.constraints };
  let locks = { ...request.locks };
  let excluded = [...request.excluded];
  switch (relaxation.kind) {
    case "earliestStart": c.earliestStart = relaxation.to; break;
    case "latestEnd": c.latestEnd = relaxation.to; break;
    case "dayOff": c.daysOff = c.daysOff.filter((d) => d !== relaxation.day); break;
    case "blocked": c.blocked = c.blocked.filter((b) => b.id !== relaxation.blockedId); break;
    case "maxCredits": c.maxCredits = relaxation.to; break;
    case "walking": c.walking = relaxation.to; break;
    case "unlock": locks = Object.fromEntries(Object.entries(locks).filter(([code]) => code !== relaxation.courseCode)); break;
    case "include": excluded = excluded.filter((id) => id !== relaxation.sectionId); break;
  }
  return { ...request, constraints: c, locks, excluded };
}
