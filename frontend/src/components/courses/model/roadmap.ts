/**
 * The roadmap Courses shows: @untangle/core/degree/roadmap fed from the
 * same record, programs and catalog the degree check reads, and the
 * sentences that explain where each course went.
 *
 * The catalog the planner reads is the prerequisite engine's, translated:
 * a grade minimum stays on each course it covers (a D on the record
 * doesn't meet "C or better", so the roadmap plans the retake), a
 * corequisite becomes "this term or earlier", standing becomes earned
 * credits through the school's own table, and consent or text the parser
 * couldn't read becomes an advisor check that doesn't block placing.
 * UNTangle's catalog says nothing structured about which seasons a course
 * runs in, so no course carries offering seasons.
 */
import { DEFAULT_MAX_TERMS, planRoadmap, termLabel, type PlanCourse, type PlannedCourse, type Requires, type Roadmap, type Season, type Term, type UnplacedCourse, type Why } from "@untangle/core/degree/roadmap";
import type { CatalogCourse, Prerequisite, SchoolAdapter } from "@/lib/prereq";
import type { Major } from "@/lib/types";
import type { SchoolProfile } from "../school";
import type { PlanSnapshot } from "./course-model";
import { auditCourses, degreePrograms } from "./degree";

/**
 * The credit limits the roadmap offers. 15 is the profile's four-year pace
 * (school.ts); 12 is UNT's full-time floor, the same note says; 18 is a
 * heavy term. Starting values, not data on what students take.
 */
export const CREDIT_LIMITS = [12, 15, 18] as const;
export type CreditLimit = (typeof CREDIT_LIMITS)[number];

/** `rule` with `grade` as the minimum on every course it names; where a course already has one, the stricter stays. */
function withMinimum(rule: Requires, grade: string, adapter: SchoolAdapter): Requires {
  switch (rule.kind) {
    case "course": {
      const inner = rule.minGrade;
      // The outer minimum is the stricter when a grade at it would meet the inner one.
      const stricter = inner === undefined || adapter.meetsMinimumGrade(grade, inner) === true ? grade : inner;
      return { ...rule, minGrade: stricter };
    }
    case "and":
    case "or":
      return { kind: rule.kind, children: rule.children.map((child) => withMinimum(child, grade, adapter)) };
    case "concurrent":
      return { kind: "concurrent", requirement: withMinimum(rule.requirement, grade, adapter) };
    case "credits":
    case "check":
      return rule;
  }
}

export function requiresOf(node: Prerequisite, adapter: SchoolAdapter): Requires {
  const check = (): Requires => ({ kind: "check", text: node.source.trim() });
  switch (node.kind) {
    case "course":
      return { kind: "course", code: node.courseId };
    case "and":
    case "or":
      return { kind: node.kind, children: node.children.map((child) => requiresOf(child, adapter)) };
    case "minGrade":
      return withMinimum(requiresOf(node.requirement, adapter), node.grade, adapter);
    case "corequisite":
      return { kind: "concurrent", requirement: requiresOf(node.requirement, adapter) };
    case "standing": {
      const hours = adapter.minimumHours?.(node.minimum);
      return hours === undefined ? check() : { kind: "credits", min: hours };
    }
    case "consent":
    case "unknown":
      return check();
  }
}

const catalogs = new WeakMap<readonly CatalogCourse[], ReadonlyMap<string, PlanCourse>>();

/** The school's catalog in the roadmap's shapes, built once per catalog. */
export function planCatalog(profile: Pick<SchoolProfile, "catalog" | "adapter">): ReadonlyMap<string, PlanCourse> {
  const cached = catalogs.get(profile.catalog);
  if (cached) return cached;
  const built = new Map(profile.catalog.map((course) => [course.id, { code: course.id, credits: course.credits, requires: requiresOf(course.prerequisite, profile.adapter) }]));
  catalogs.set(profile.catalog, built);
  return built;
}

const SEASONS: Record<string, Season> = { Spring: "spring", Summer: "summer", Fall: "fall" };

/** "Spring 2027" as a term; loud on anything else. */
export function parseTerm(label: string): Term {
  const match = /^(Spring|Summer|Fall) (\d{4})$/.exec(label);
  if (!match) throw new Error(`"${label}" isn't a term the roadmap can start from, such as "Spring 2027".`);
  return { season: SEASONS[match[1]!]!, year: Number(match[2]) };
}

/**
 * The roadmap for a plan, starting with the planning term, whose tray
 * courses stay in it. `waivers` are the degree check's: courses the record
 * covers that the degree still lists, which Courses sends to an advisor, so
 * the roadmap holds them out of every term too. Null for a major the degree
 * audit doesn't cover.
 */
export function buildRoadmap(
  profile: SchoolProfile,
  plan: Pick<PlanSnapshot, "statuses" | "transcript" | "manualCredit" | "planned">,
  major: Pick<Major, "id">,
  creditLimit: number,
  waivers: ReadonlyMap<string, string> = new Map(),
): Roadmap | null {
  const programs = degreePrograms(major);
  if (!programs) return null;
  return planRoadmap({
    programs,
    record: auditCourses(profile, plan),
    catalog: planCatalog(profile),
    start: parseTerm(profile.planningTerm),
    creditLimit,
    pinned: [...plan.planned].sort(),
    // Spare credits in a term go to the electives the 120-credit total still needs, so standing counts full terms.
    fullTermsForStanding: true,
    meetsMinimum: (grade, minimum) => profile.adapter.meetsMinimumGrade(grade, minimum),
    covered: waivers,
  });
}

/** What the roadmap on screen was built from: the record by identity, the rest as text, so a change to any of them is seen. */
export type RoadmapInputs = {
  statuses: PlanSnapshot["statuses"];
  transcript: PlanSnapshot["transcript"];
  /** The courses marked done, one per line. */
  manualCredit: string;
  /** The tray's courses, one per line. */
  tray: string;
  limit: number;
  /** The degree check's waivers, one "course>covered by" per line. */
  waivers: string;
};

/** True while the roadmap on screen was built from older inputs than the current ones, so the view says it's replanning. */
export function roadmapIsStale(shown: RoadmapInputs, current: RoadmapInputs): boolean {
  return (
    shown.statuses !== current.statuses ||
    shown.transcript !== current.transcript ||
    shown.manualCredit !== current.manualCredit ||
    shown.tray !== current.tray ||
    shown.limit !== current.limit ||
    shown.waivers !== current.waivers
  );
}

/* ---------- copy ---------- */

const list = (codes: readonly string[]) => (codes.length <= 2 ? codes.join(" and ") : `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`);
const seasonList = (seasons: readonly Season[]) => list(seasons.map((season) => season));

/** Where each roadmap course sits, for sentences that name the term of a course they lean on. */
export function termsByCourse(roadmap: Roadmap): ReadonlyMap<string, Term> {
  return new Map(roadmap.terms.flatMap((entry) => entry.courses.map((course) => [course.code, entry.term] as const)));
}

/** The one fact a roadmap row shows, or null: why a course that no requirement names is here. */
export function plannedFact(course: PlannedCourse): string | null {
  if (course.why.kind === "pinned") return course.ruleMet ? "In your tray" : "In your tray early";
  if (course.why.kind === "prerequisite") return `${course.retake ? "Retake for" : "For"} ${course.why.for[0]}${course.why.for.length > 1 ? ` and ${course.why.for.length - 1} more` : ""}`;
  return null;
}

/** The short reason a course isn't in a term, as a row's one fact. */
export function unplacedFact(course: UnplacedCourse): string {
  const reason = course.reason;
  switch (reason.kind) {
    case "no-data":
      return "Not in UNTangle's catalog";
    case "over-limit":
      return `${reason.credits} credits, over the limit`;
    case "not-offered":
      return `Runs only in ${seasonList(reason.offered)}`;
    case "cycle":
      return reason.with.length > 0 ? `Loops with ${reason.with[0]}` : "Lists itself";
    case "blocked":
      return `Needs ${reason.by} first`;
    case "standing":
      return `Needs ${reason.credits} credits first`;
    case "unmeetable":
      return "No way to meet its rule";
    case "covered":
      return "Ask an advisor";
    case "out-of-terms":
      return "Past the last term";
  }
}

const whyClause = (why: Why): string =>
  why.kind === "prerequisite" ? ` It's on the roadmap because ${list(why.for)} ${why.for.length === 1 ? "needs" : "need"} it first.` : "";

/**
 * The roadmap's account of one course, for its detail: the term, what it
 * waits on, and why it's on the roadmap at all. `catalog` says when a
 * course is early only because its catalog entry lists no prerequisites.
 */
export function roadmapNote(code: string, roadmap: Roadmap, catalog: ReadonlyMap<string, PlanCourse>): string | null {
  const terms = termsByCourse(roadmap);
  const at = terms.get(code);
  if (at) {
    const course = roadmap.terms.flatMap((entry) => entry.courses).find((entry) => entry.code === code)!;
    const here = termLabel(at);
    if (course.why.kind === "pinned") {
      return course.ruleMet ? `It's in your ${here} tray, so the roadmap keeps it there.` : `It's in your ${here} tray, though its prerequisites won't be done by then. The roadmap keeps it there.`;
    }
    const parts: string[] = [];
    // The courses it waits on, grouped by the term each is in: "after CSCE 2100 and CSCE 2110 in Spring 2028".
    const byTerm = new Map<string, string[]>();
    for (const earlier of course.after) {
      const label = termLabel(terms.get(earlier)!);
      byTerm.set(label, [...(byTerm.get(label) ?? []), earlier]);
    }
    const after = [...byTerm].map(([label, codes]) => `${list(codes)} in ${label}`);
    parts.push(after.length > 0 ? `The roadmap puts it in ${here}, after ${list(after)}.` : `The roadmap puts it in ${here}.`);
    const rule = catalog.get(code)?.requires;
    if (rule?.kind === "and" && rule.children.length === 0) parts.push("Its catalog entry lists no prerequisites.");
    if (course.with.length > 0) parts.push(`It goes with ${list(course.with)}, which its rule lets you take at the same time.`);
    if (course.waited) {
      const since = termLabel(course.waited.since);
      parts.push(course.waited.for === "season" ? `It could start in ${since}, but it doesn't run that season.` : `It could go in ${since}, but that term is full at ${roadmap.creditLimit} credits.`);
    }
    if (course.checks.length > 0) parts.push("Part of its rule needs an advisor's say, which the roadmap assumes you get.");
    if (course.retake && course.why.kind === "prerequisite") {
      const needs = course.why.for;
      return `${parts.join(" ")} You have it on record, but ${list(needs)} ${needs.length === 1 ? "needs" : "need"} a better grade in it, so the roadmap has you take it again first.`;
    }
    return parts.join(" ") + whyClause(course.why);
  }
  const unplaced = roadmap.unplaced.find((entry) => entry.code === code);
  if (!unplaced) return null;
  const reason = unplaced.reason;
  const sentence = {
    "no-data": "UNTangle's catalog doesn't have it, so the roadmap can't tell what it needs first or how many credits it is. Ask an advisor when to take it.",
    "over-limit": `It can't go in any term at ${roadmap.creditLimit} credits: it needs ${reason.kind === "over-limit" ? reason.credits : 0} credits${reason.kind === "over-limit" && unplaced.credits !== null && reason.credits > unplaced.credits ? " with its corequisites" : ""}. A higher limit fits it.`,
    "not-offered": `It runs only in ${reason.kind === "not-offered" ? seasonList(reason.offered) : ""}, which the roadmap doesn't plan.`,
    cycle: reason.kind === "cycle" && reason.with.length > 0 ? `Its prerequisites loop back to it through ${list(reason.with)}, so neither can go first. Ask an advisor which comes first.` : "Its rule lists itself as a prerequisite. Ask an advisor how to read it.",
    blocked: `It needs ${reason.kind === "blocked" ? reason.by : ""} first, and the roadmap can't place that course either.`,
    standing: reason.kind === "standing" ? `It needs ${reason.credits} earned credits, and the roadmap's courses with your record reach ${reason.reaches}. Electives count toward that total too.` : "",
    unmeetable: "Its catalog rule has no alternative the roadmap can meet. Ask an advisor how to read it.",
    // The degree note above already says the record covers it and only an advisor can waive it.
    covered: "The roadmap leaves it out of every term until an advisor decides whether you need it.",
    "out-of-terms": `The roadmap stops after ${DEFAULT_MAX_TERMS} terms, and this course hadn't gone in by then.`,
  }[reason.kind];
  return `It isn't in a term yet. ${sentence}${whyClause(unplaced.why)}`;
}

const counted = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The group's first line: how many terms, and the last one. With anything
 * not in a term yet it names no last term, since the degree doesn't end
 * there, and says how much is still out.
 */
export function roadmapSummary(roadmap: Roadmap): string {
  const count = roadmap.terms.length;
  const out = [
    roadmap.unplaced.length > 0 ? counted(roadmap.unplaced.length, "course") : null,
    roadmap.open.length > 0 ? counted(roadmap.open.length, "requirement") : null,
  ].filter((part) => part !== null);
  const outText = out.length > 0 ? `${out.join(" and ")} not in a term yet` : null;
  if (count === 0) return outText ?? "Nothing left";
  if (outText) return `${counted(count, "term")} so far, and ${outText}`;
  const last = termLabel(roadmap.terms[count - 1]!.term);
  return count === 1 ? `1 term, ${last}` : `${count} terms, through ${last}`;
}
