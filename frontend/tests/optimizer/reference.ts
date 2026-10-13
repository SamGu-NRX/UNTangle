/**
 * Brute-force reference for the optimizer, written from the contract in
 * src/lib/optimizer/types.ts and the numbers in score.ts's doc comment, and
 * sharing no code with the engine: every constant below is written out
 * again on purpose, so a changed constant in the engine is a disagreement.
 *
 * It enumerates every combination of one section per course, so it is only
 * usable on small instances.
 *
 * Dates, from the contract: a meeting without dates runs every week. Two
 * meetings share a week when either has no dates or their inclusive ranges
 * intersect, and they conflict only then. Back to back: cut the calendar at
 * every range's first day and the day after its last; in each piece and each
 * day, the meetings running there sorted by start are a sequence whose
 * neighbors are back to back. A pair back to back in several pieces counts
 * once. This file builds those pieces explicitly instead of using bitmasks.
 */

import type { ExplainMember, Relaxation, OptCourse, OptDay, OptimizeRequest, OptMeeting, OptSection, OptWeights } from "@/lib/optimizer/types";

const DAYS: OptDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const UNKNOWN_WALK = 600;

/** ISO dates compare correctly as strings. */
function shareAWeek(a: OptMeeting, b: OptMeeting): boolean {
  if (!a.dates || !b.dates) return true;
  return a.dates.start <= b.dates.end && b.dates.start <= a.dates.end;
}

function nextDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function previousDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * One date inside every piece of the calendar cut at the request's date
 * boundaries: each range's first day, the day after each range's last day,
 * and the day before the earliest first day. A request without dates has
 * one piece.
 */
const piecesCache = new WeakMap<OptimizeRequest, string[]>();
function pieces(request: OptimizeRequest): string[] {
  const cached = piecesCache.get(request);
  if (cached) return cached;
  const ranges = request.courses.flatMap((c) => c.sections.flatMap((s) => s.meetings.flatMap((m) => (m.dates ? [m.dates] : []))));
  let out: string[];
  if (ranges.length === 0) out = ["any"];
  else {
    const starts = ranges.map((r) => r.start).sort();
    out = [...new Set([previousDay(starts[0]), ...starts, ...ranges.map((r) => nextDay(r.end))])].sort();
  }
  piecesCache.set(request, out);
  return out;
}

function runsOn(meeting: OptMeeting, date: string): boolean {
  return date === "any" || !meeting.dates || (meeting.dates.start <= date && date <= meeting.dates.end);
}

type Placed = OptMeeting & { owner: string };

/** Distinct back-to-back pairs of a selection, each once. */
function backToBackPairs(request: OptimizeRequest, chosen: OptSection[]): Array<[Placed, Placed]> {
  const all: Placed[] = chosen.flatMap((section) => section.meetings.map((m) => ({ ...m, owner: section.id })));
  const seen = new Set<string>();
  const pairs: Array<[Placed, Placed]> = [];
  for (const date of pieces(request)) {
    for (const day of DAYS) {
      const list = all
        .map((m, index) => ({ m, index }))
        .filter(({ m }) => m.day === day && runsOn(m, date))
        .sort((a, b) => a.m.start - b.m.start || a.m.end - b.m.end);
      for (let i = 1; i < list.length; i += 1) {
        const key = `${list[i - 1].index}|${list[i].index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push([list[i - 1].m, list[i].m]);
      }
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

function walkBetween(request: OptimizeRequest, a: string | null, b: string | null): number | null {
  if (a !== null && b !== null && a === b) return 0;
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
      if (a.day === b.day && a.start < b.end && b.start < a.end && shareAWeek(a, b)) problems.push(`overlap ${a.owner} ${b.owner}`);
    }
  }
  if (c.maxCredits !== null) {
    const credits = chosen.reduce((sum, s) => sum + request.courses.find((course) => course.code === s.courseCode)!.credits, 0);
    if (credits > c.maxCredits) problems.push("too many credits");
  }
  if (c.walking !== null) {
    for (const [prev, next] of backToBackPairs(request, chosen)) {
      if (prev.buildingId !== null && prev.buildingId === next.buildingId) continue;
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
    if (prev.buildingId !== null && prev.buildingId === next.buildingId) continue;
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
      credits: chosen.reduce((sum, s) => sum + request.courses.find((course) => course.code === s.courseCode)!.credits, 0),
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
  return out.sort((a, b) => a.cost - b.cost || compareKey(a.key, b.key));
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
  const courses = request.courses.filter((course) => named((m) => m.kind === "course" && m.courseCode === course.code));
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
