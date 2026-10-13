/**
 * Why nothing fits, in terms a student can act on.
 *
 * The explanation is a smallest conflicting set: a few courses, locks,
 * exclusions and constraints that cannot all hold at once, where dropping any
 * one of them would let the rest fit. It is found with a deletion filter:
 * start from a set known to conflict, try dropping each member in turn, and
 * keep the drop whenever the rest still conflicts. Every check is a bounded
 * feasibility search; if the budget runs out, the member stays and the
 * result is marked not minimal rather than guessed.
 *
 * To keep the checks small, the filter starts from the first single course
 * (with every constraint) that already fails on its own, then the first
 * failing pair, and only then from the whole request.
 */

import { OPT_DAYS, type ExplainMember, type Explanation, type OptDay, type OptimizeRequest, type OptSection, type Relaxation, type RelaxSuggestion } from "./types";
import { prepare, PrepareBudgetExhausted } from "./prepare";
import { isFeasible, type Budget } from "./search";

function memberKey(member: ExplainMember): string {
  switch (member.kind) {
    case "course":
      return `course:${member.courseCode}`;
    case "lock":
      return `lock:${member.courseCode}`;
    case "excluded":
      return `excluded:${member.sectionId}`;
    case "dayOff":
      return `dayOff:${member.day}`;
    case "blocked":
      return `blocked:${member.blockedId}`;
    default:
      return member.kind;
  }
}

/** Every member of a request, in the order the filter tries to drop them. */
export function allMembers(request: OptimizeRequest): ExplainMember[] {
  const members: ExplainMember[] = [];
  const codes = request.courses.map((course) => course.code).sort();
  for (const code of codes) members.push({ kind: "course", courseCode: code });
  for (const sectionId of [...request.excluded].sort()) members.push({ kind: "excluded", sectionId });
  for (const code of codes) {
    const sectionId = request.locks[code];
    if (sectionId !== undefined) members.push({ kind: "lock", courseCode: code, sectionId });
  }
  const c = request.constraints;
  for (const block of c.blocked) members.push({ kind: "blocked", blockedId: block.id });
  for (const day of OPT_DAYS) if (c.daysOff.includes(day)) members.push({ kind: "dayOff", day });
  if (c.earliestStart !== null) members.push({ kind: "earliestStart" });
  if (c.latestEnd !== null) members.push({ kind: "latestEnd" });
  if (c.walking !== null) members.push({ kind: "walking" });
  if (c.maxCredits !== null) members.push({ kind: "maxCredits" });
  return members;
}

/** The request restricted to the given members: everything else is dropped. */
export function restrictTo(request: OptimizeRequest, members: readonly ExplainMember[]): OptimizeRequest {
  const keys = new Set(members.map(memberKey));
  const courses = request.courses.filter((course) => keys.has(`course:${course.code}`));
  const kept = new Set(courses.map((course) => course.code));
  const sectionCourse = new Map<string, string>();
  for (const course of courses) for (const section of course.sections) sectionCourse.set(section.id, course.code);
  const c = request.constraints;
  return {
    ...request,
    courses,
    locks: Object.fromEntries(
      Object.entries(request.locks).filter(([code]) => kept.has(code) && keys.has(`lock:${code}`)),
    ),
    excluded: request.excluded.filter((id) => sectionCourse.has(id) && keys.has(`excluded:${id}`)),
    constraints: {
      earliestStart: keys.has("earliestStart") ? c.earliestStart : null,
      latestEnd: keys.has("latestEnd") ? c.latestEnd : null,
      daysOff: c.daysOff.filter((day) => keys.has(`dayOff:${day}`)),
      blocked: c.blocked.filter((block) => keys.has(`blocked:${block.id}`)),
      maxCredits: keys.has("maxCredits") ? c.maxCredits : null,
      walking: keys.has("walking") ? c.walking : null,
    },
  };
}

type Check = (request: OptimizeRequest) => boolean | null;

function makeCheck(deadline: number, now: () => number): Check {
  return (request) => {
    const budget: Budget = { deadline, maxNodes: Number.POSITIVE_INFINITY, now, nodes: 0 };
    if (now() > deadline) return null;
    try {
      return isFeasible(prepare(request, deadline, now), budget);
    } catch (error) {
      if (error instanceof PrepareBudgetExhausted) return null;
      throw error;
    }
  };
}

function sharesADay(request: OptimizeRequest, code: string, others: readonly string[]): boolean {
  const days = (c: string) => new Set(request.courses.find((course) => course.code === c)!.sections.flatMap((s) => s.meetings.map((m) => m.day)));
  const own = days(code);
  return others.some((other) => [...days(other)].some((day) => own.has(day)));
}

/**
 * A smallest conflicting set for an infeasible request, in two passes.
 *
 * 1. With every course kept, drop each constraint, lock and exclusion that
 *    the conflict doesn't need. Dropping one only loosens the request, so
 *    each verdict holds for the full request.
 * 2. Drop each course the conflict doesn't need. Without the walking check
 *    this is safe too: fewer classes never create a clash. With it, removing
 *    a class can leave two others back to back and invent a walking conflict
 *    the full request doesn't have, so a course that shares a day with the
 *    rest is kept.
 *
 * `minimal` is true only when every check finished and dropping any single
 * member of the result makes it feasible. Otherwise the set still conflicts
 * but may name more than it needs, and the sentence says so plainly.
 */
export function findConflictSet(request: OptimizeRequest, check: Check): { members: ExplainMember[]; minimal: boolean } {
  const all = allMembers(request);
  const courses = all.filter((member) => member.kind === "course");
  let others = all.filter((member) => member.kind !== "course");
  let decided = true;
  for (const member of [...others]) {
    const without = others.filter((m) => memberKey(m) !== memberKey(member));
    const verdict = check(restrictTo(request, [...courses, ...without]));
    if (verdict === false) others = without;
    else if (verdict === null) decided = false;
  }
  const walking = others.some((member) => member.kind === "walking");
  let kept = [...courses, ...others];
  for (const member of courses) {
    const code = (member as { courseCode: string }).courseCode;
    const remainingCodes = kept
      .filter((m): m is Extract<ExplainMember, { kind: "course" }> => m.kind === "course" && m.courseCode !== code)
      .map((m) => m.courseCode);
    if (walking && sharesADay(request, code, remainingCodes)) continue;
    // A lock means nothing without its course; drop it with the course.
    const pruned = kept.filter((m) => memberKey(m) !== memberKey(member) && !(m.kind === "lock" && m.courseCode === code));
    const verdict = check(restrictTo(request, pruned));
    if (verdict === false) kept = pruned;
    else if (verdict === null) decided = false;
  }
  // Exclusions of dropped courses no longer mean anything.
  const keptCodes = new Set(kept.filter((m) => m.kind === "course").map((m) => (m as { courseCode: string }).courseCode));
  const sectionCourse = new Map(request.courses.flatMap((c) => c.sections.map((s) => [s.id, c.code] as const)));
  kept = kept.filter((m) => m.kind !== "excluded" || keptCodes.has(sectionCourse.get(m.sectionId) ?? ""));
  let minimal = decided && check(restrictTo(request, kept)) === false;
  for (const member of kept) {
    if (!minimal) break;
    if (check(restrictTo(request, kept.filter((m) => memberKey(m) !== memberKey(member)))) !== true) minimal = false;
  }
  return { members: kept, minimal };
}

/* ---------- Words ---------- */

export function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return mins === 0 ? `${hour} ${suffix}` : `${hour}:${String(mins).padStart(2, "0")} ${suffix}`;
}

const DAY_LETTER: Record<OptDay, string> = { Mon: "M", Tue: "T", Wed: "W", Thu: "Th", Fri: "F" };
const DAY_PLURAL: Record<OptDay, string> = { Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays" };
const DAY_NAME: Record<OptDay, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };

/** "MWF 10 AM" style: days sharing a start time are grouped. */
export function describePattern(section: OptSection): string {
  const byStart = new Map<number, OptDay[]>();
  for (const meeting of section.meetings) byStart.set(meeting.start, [...(byStart.get(meeting.start) ?? []), meeting.day]);
  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, days]) => {
      const ordered = OPT_DAYS.filter((day) => days.includes(day));
      return `${ordered.map((day) => DAY_LETTER[day]).join("")} ${formatClock(start)}`;
    })
    .join(", ");
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function sectionLabel(section: OptSection): string {
  return section.label ?? section.id;
}

function conditionPhrases(request: OptimizeRequest, members: ExplainMember[]): string[] {
  const c = request.constraints;
  const has = (kind: ExplainMember["kind"]) => members.some((member) => member.kind === kind);
  const phrases: string[] = [];
  if (has("earliestStart") && has("latestEnd")) {
    phrases.push(`between ${formatClock(c.earliestStart!)} and ${formatClock(c.latestEnd!)}`);
  } else if (has("earliestStart")) {
    phrases.push(`starting at ${formatClock(c.earliestStart!)} or later`);
  } else if (has("latestEnd")) {
    phrases.push(`before ${formatClock(c.latestEnd!)}`);
  }
  const days = OPT_DAYS.filter((day) => members.some((member) => member.kind === "dayOff" && member.day === day));
  if (days.length > 0) phrases.push(`with ${joinList(days.map((day) => DAY_PLURAL[day]))} off`);
  for (const member of members) {
    if (member.kind !== "blocked") continue;
    const block = c.blocked.find((entry) => entry.id === member.blockedId)!;
    phrases.push(`around your ${block.label} time (${DAY_NAME[block.day]} ${formatClock(block.start)}–${formatClock(block.end)})`);
  }
  if (has("walking")) {
    const buffer = c.walking?.bufferMinutes ?? 0;
    phrases.push(buffer > 0 ? `with time to walk between buildings plus ${buffer} minutes` : "with time to walk between buildings");
  }
  const excluded = members.filter((member): member is Extract<ExplainMember, { kind: "excluded" }> => member.kind === "excluded");
  if (excluded.length > 0) {
    const labels = excluded.map((member) => {
      const section = request.courses.flatMap((course) => course.sections).find((entry) => entry.id === member.sectionId)!;
      return `${section.courseCode} ${sectionLabel(section)}`;
    });
    phrases.push(`without ${joinList(labels)}`);
  }
  return phrases;
}

/** One plain sentence for a conflicting set. */
export function explainSentence(request: OptimizeRequest, members: ExplainMember[]): string {
  const codes = members.filter((member) => member.kind === "course").map((member) => (member as { courseCode: string }).courseCode);
  const locked = new Map(
    members
      .filter((member): member is Extract<ExplainMember, { kind: "lock" }> => member.kind === "lock")
      .map((member) => [member.courseCode, member.sectionId] as const),
  );
  const sectionById = new Map(request.courses.flatMap((course) => course.sections).map((section) => [section.id, section] as const));
  const sub = restrictTo(request, members);

  if (members.some((member) => member.kind === "maxCredits")) {
    const credits = request.courses.filter((course) => codes.includes(course.code)).reduce((sum, course) => sum + course.credits, 0);
    return `${joinList(codes)} add up to ${credits} credits, over your ${request.constraints.maxCredits}-credit limit.`;
  }

  const conditions = conditionPhrases(request, members);
  const where = conditions.length > 0 ? ` ${conditions.join(" ")}` : "";

  // The one section a course is reduced to, when it has only one left.
  const onlySection = (code: string): OptSection | null => {
    const lockedId = locked.get(code);
    if (lockedId) return sectionById.get(lockedId) ?? null;
    const prepared = prepare(sub);
    const course = prepared.courses.find((entry) => entry.code === code);
    return course && course.candidates.length === 1 ? course.candidates[0].section : null;
  };
  const describe = (code: string): string => {
    const lockedId = locked.get(code);
    if (lockedId) return `your locked ${code} section (${describePattern(sectionById.get(lockedId)!)})`;
    return code;
  };

  if (codes.length === 1) {
    const code = codes[0];
    if (locked.has(code)) return `Your locked ${code} section (${describePattern(sectionById.get(locked.get(code)!)!)}) doesn't fit${where}.`;
    if (conditions.length === 0) return `No section of ${code} works: each one's own meetings clash.`;
    return `No section of ${code} fits${where}.`;
  }

  if (codes.length === 2) {
    const [a, b] = codes;
    const onlyA = onlySection(a);
    const onlyB = onlySection(b);
    if (conditions.length === 0) {
      if (onlyA && onlyB) return `${describe(a)} and ${describe(b)} overlap (${describePattern(onlyA)} and ${describePattern(onlyB)}).`.replace(/^./, (s) => s.toUpperCase());
      if (onlyB) return `Every section of ${a} overlaps ${locked.has(b) ? describe(b) : `${b}'s only section (${describePattern(onlyB)})`}.`;
      if (onlyA) return `Every section of ${b} overlaps ${locked.has(a) ? describe(a) : `${a}'s only section (${describePattern(onlyA)})`}.`;
      return `Every section of ${a} overlaps every section of ${b}.`;
    }
    if (onlyB && !onlyA) return `No section of ${a} fits alongside ${locked.has(b) ? describe(b) : `${b} (${describePattern(onlyB)})`}${where}.`;
    if (onlyA && !onlyB) return `No section of ${b} fits alongside ${locked.has(a) ? describe(a) : `${a} (${describePattern(onlyA)})`}${where}.`;
    return `No pair of ${a} and ${b} sections fits together${where}.`;
  }

  const names = codes.map(describe);
  return `${joinList(names)} can't all fit together${where}: every combination has a clash.`.replace(/^./, (s) => s.toUpperCase());
}

/** Used when the set could not be shown minimal: it conflicts, but may name more than needed. */
export function fallbackSentence(request: OptimizeRequest, members: ExplainMember[]): string {
  const codes = members.filter((m) => m.kind === "course").map((m) => (m as { courseCode: string }).courseCode);
  const locks = members.filter((m): m is Extract<ExplainMember, { kind: "lock" }> => m.kind === "lock").map((m) => `your ${m.courseCode} lock`);
  const parts = [...codes, ...locks, ...conditionPhrases(request, members)];
  if (members.some((m) => m.kind === "maxCredits")) parts.push(`a ${request.constraints.maxCredits}-credit limit`);
  return `These can't all hold together: ${joinList(parts)}.`;
}

/* ---------- One-click relaxations ---------- */

function applyRelaxation(request: OptimizeRequest, relaxation: Relaxation): OptimizeRequest {
  const c = request.constraints;
  switch (relaxation.kind) {
    case "earliestStart":
      return { ...request, constraints: { ...c, earliestStart: relaxation.to } };
    case "latestEnd":
      return { ...request, constraints: { ...c, latestEnd: relaxation.to } };
    case "dayOff":
      return { ...request, constraints: { ...c, daysOff: c.daysOff.filter((day) => day !== relaxation.day) } };
    case "blocked":
      return { ...request, constraints: { ...c, blocked: c.blocked.filter((block) => block.id !== relaxation.blockedId) } };
    case "maxCredits":
      return { ...request, constraints: { ...c, maxCredits: relaxation.to } };
    case "walking":
      return { ...request, constraints: { ...c, walking: relaxation.to } };
    case "unlock": {
      const locks = { ...request.locks };
      delete locks[relaxation.courseCode];
      return { ...request, locks };
    }
    case "include":
      return { ...request, excluded: request.excluded.filter((id) => id !== relaxation.sectionId) };
  }
}

export { applyRelaxation };

const STEP = 30;

function relaxationsFor(
  request: OptimizeRequest,
  members: ExplainMember[],
  check: Check,
): Array<{ relaxation: Relaxation; label: string }> {
  const c = request.constraints;
  const sub = restrictTo(request, members);
  const fixesConflict = (relaxation: Relaxation) => check(applyRelaxation(sub, relaxation)) === true;
  const out: Array<{ relaxation: Relaxation; label: string }> = [];
  const sectionById = new Map(request.courses.flatMap((course) => course.sections).map((section) => [section.id, section] as const));
  for (const member of members) {
    switch (member.kind) {
      case "earliestStart": {
        let to: number | null = null;
        for (let t = c.earliestStart! - STEP; t >= 6 * 60; t -= STEP) {
          if (fixesConflict({ kind: "earliestStart", to: t })) {
            to = t;
            break;
          }
        }
        out.push({ relaxation: { kind: "earliestStart", to }, label: to === null ? "Allow any start time" : `Start as early as ${formatClock(to)}` });
        break;
      }
      case "latestEnd": {
        let to: number | null = null;
        for (let t = c.latestEnd! + STEP; t <= 22 * 60; t += STEP) {
          if (fixesConflict({ kind: "latestEnd", to: t })) {
            to = t;
            break;
          }
        }
        out.push({ relaxation: { kind: "latestEnd", to }, label: to === null ? "Allow any end time" : `Finish as late as ${formatClock(to)}` });
        break;
      }
      case "dayOff":
        out.push({ relaxation: { kind: "dayOff", day: member.day }, label: `Allow classes on ${DAY_PLURAL[member.day]}` });
        break;
      case "blocked": {
        const block = c.blocked.find((entry) => entry.id === member.blockedId)!;
        out.push({ relaxation: { kind: "blocked", blockedId: member.blockedId }, label: `Allow classes during ${block.label}` });
        break;
      }
      case "maxCredits": {
        const total = request.courses.reduce((sum, course) => sum + course.credits, 0);
        out.push({ relaxation: { kind: "maxCredits", to: total }, label: `Raise the credit limit to ${total}` });
        break;
      }
      case "walking": {
        const buffer = c.walking?.bufferMinutes ?? 0;
        if (buffer > 0 && fixesConflict({ kind: "walking", to: { bufferMinutes: 0 } })) {
          out.push({ relaxation: { kind: "walking", to: { bufferMinutes: 0 } }, label: "Drop the extra walking buffer" });
        } else {
          out.push({ relaxation: { kind: "walking", to: null }, label: "Allow tight walks between buildings" });
        }
        break;
      }
      case "lock":
        out.push({ relaxation: { kind: "unlock", courseCode: member.courseCode }, label: `Unlock ${member.courseCode}` });
        break;
      case "excluded": {
        const section = sectionById.get(member.sectionId)!;
        out.push({ relaxation: { kind: "include", sectionId: member.sectionId }, label: `Allow ${section.courseCode} ${sectionLabel(section)} again` });
        break;
      }
      case "course":
        break;
    }
  }
  return out;
}

export function explainInfeasible(request: OptimizeRequest, budgetMs: number, now: () => number): Explanation {
  const check = makeCheck(now() + budgetMs, now);
  const { members, minimal } = findConflictSet(request, check);
  const sentence = minimal ? explainSentence(request, members) : fallbackSentence(request, members);
  const suggestions: RelaxSuggestion[] = relaxationsFor(request, members, check).map((entry) => ({
    ...entry,
    resolves: check(applyRelaxation(request, entry.relaxation)),
  }));
  // Changes that make everything fit come first; otherwise keep member order.
  suggestions.sort((a, b) => Number(b.resolves === true) - Number(a.resolves === true));
  return { members, minimal, sentence, suggestions };
}
