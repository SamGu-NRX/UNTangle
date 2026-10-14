import type { CatalogCourse, CourseId } from "@/lib/prereq";
import { compareIds } from "./graph";
import type { CoursePattern, Requirement, RequirementSet } from "./types";

/** Where a course sits in the plan: its top-level requirement, and the choice branch if any. */
export type Listing = { group: string; position: number; branch: string | null };

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function validate(requirement: Requirement): void {
  const name = requirement.name;
  check(name.trim().length > 0, "Every requirement needs a name.");
  switch (requirement.kind) {
    case "all":
      check(requirement.courses.length > 0, `Requirement "${name}" lists no courses.`);
      return;
    case "choose":
      check(Number.isInteger(requirement.count) && requirement.count >= 1 && requirement.count <= requirement.options.length,
        `Requirement "${name}" must choose between 1 and ${requirement.options.length} courses.`);
      for (const [option, companions] of Object.entries(requirement.companions ?? {})) {
        check(requirement.options.includes(option), `Requirement "${name}" gives companions to ${option}, which is not one of its options.`);
        check(companions.length > 0, `Requirement "${name}" gives ${option} an empty companion list.`);
      }
      return;
    case "hours":
      check(requirement.options.length > 0, `Requirement "${name}" lists no options.`);
      check(Number.isFinite(requirement.hours) && requirement.hours > 0, `Requirement "${name}" needs a positive hour count.`);
      return;
    case "pool":
      check(Number.isFinite(requirement.hours) && requirement.hours > 0, `Requirement "${name}" needs a positive hour count.`);
      if (requirement.match) {
        check(requirement.match.subject.trim().length > 0, `Requirement "${name}" matches an empty subject.`);
        check(Number.isInteger(requirement.match.level) && requirement.match.level >= 0, `Requirement "${name}" needs a whole-number level.`);
      }
      return;
    case "choice":
      check(requirement.branches.length > 0, `Requirement "${name}" has no branches.`);
      for (const branch of requirement.branches) {
        check(branch.requirements.length > 0, `Branch "${branch.name}" of "${name}" is empty.`);
        branch.requirements.forEach(validate);
      }
      return;
  }
}

function listed(requirement: Requirement): readonly CourseId[] {
  switch (requirement.kind) {
    case "all":
      return requirement.courses;
    case "choose":
      return [...requirement.options, ...Object.values(requirement.companions ?? {}).flat()];
    case "hours":
      return requirement.options;
    case "pool":
      return [];
    case "choice":
      return requirement.branches.flatMap((branch) => branch.requirements.flatMap(listed));
  }
}

function patterns(requirement: Requirement): CoursePattern[] {
  if (requirement.kind === "pool") return requirement.match ? [requirement.match] : [];
  if (requirement.kind === "choice") return requirement.branches.flatMap((branch) => branch.requirements.flatMap(patterns));
  return [];
}

function branchOf(requirement: Requirement, find: (inner: Requirement) => boolean): string | null {
  if (requirement.kind !== "choice") return null;
  return requirement.branches.find((branch) => branch.requirements.some(find))?.name ?? null;
}

/** Catalog courses a pattern matches, minus courses the plan lists by name. */
function patternMatcher(catalog: readonly CatalogCourse[], named: ReadonlySet<CourseId>) {
  return (pattern: CoursePattern): CourseId[] =>
    catalog
      .filter((course) => {
        const match = /^(\S+) (\d+)$/.exec(course.id);
        if (!match || named.has(course.id)) return false;
        const number = Number(match[2]);
        return match[1] === pattern.subject && number >= pattern.level && number < pattern.level + 1000;
      })
      .map((course) => course.id)
      .sort(compareIds);
}

/** What requirement evaluation needs to know about courses. */
export type CourseFacts = {
  inCatalog: (courseId: CourseId) => boolean;
  credits: (courseId: CourseId) => number;
  /** Done, in progress, or picked earlier for the term being planned. */
  credited: (courseId: CourseId) => boolean;
  /** Terms until complete; Infinity when no prerequisite route exists. */
  terms: (courseId: CourseId) => number;
  /** Whether the course's own prerequisite still needs an advisor's approval on every plannable route. */
  needsAdvisor: (courseId: CourseId) => boolean;
  matches: (pattern: CoursePattern) => CourseId[];
};

export type Evaluation = {
  met: boolean;
  done: number;
  target: number;
  unit: "courses" | "hours" | "requirements";
  /** Terms until met along the shortest route; Infinity when there is none. */
  terms: number;
  /** The shortest route needs a course whose own prerequisite needs an advisor. */
  advisor: boolean;
  /** Unfinished courses on the shortest route. */
  needed: CourseId[];
  /** Unfinished courses that would count toward it. */
  options: CourseId[];
  /** Courses already credited toward it. */
  progress: number;
  /** False when the plan data or catalog cannot measure part of it; `terms` then counts only the measurable part. */
  tracked: boolean;
  branch: string | null;
  /** Unfinished required courses with no prerequisite route. */
  blocked: CourseId[];
};

type Fill = Pick<Evaluation, "terms" | "advisor" | "needed">;

/**
 * The shortest way to cover `amount` with unfinished options, where each
 * option is worth `size`. Options that need no advisor go first; then the
 * smallest term limit whose options cover the amount; within it, larger
 * options first so fewer courses cover it (greedy, not an exact minimum),
 * breaking ties by id.
 */
function fill(open: readonly CourseId[], amount: number, size: (courseId: CourseId) => number, facts: CourseFacts): Fill {
  if (amount <= 0) return { terms: 0, advisor: false, needed: [] };
  const reachable = open.filter((id) => facts.terms(id) < Infinity);
  for (const tier of [reachable.filter((id) => !facts.needsAdvisor(id)), reachable]) {
    for (const limit of [...new Set(tier.map(facts.terms))].sort((a, b) => a - b)) {
      const picked: CourseId[] = [];
      let total = 0;
      for (const id of tier.filter((option) => facts.terms(option) <= limit).sort((a, b) => size(b) - size(a) || compareIds(a, b))) {
        if (total >= amount) break;
        picked.push(id);
        total += size(id);
      }
      if (total >= amount) return { terms: limit, advisor: picked.some(facts.needsAdvisor), needed: picked.sort(compareIds) };
    }
  }
  return { terms: Infinity, advisor: false, needed: [] };
}

function fromOptions(
  options: readonly CourseId[],
  target: number,
  unit: "courses" | "hours",
  facts: CourseFacts,
  bundle: (option: CourseId) => readonly CourseId[] = (option) => [option],
): Evaluation {
  const size = unit === "hours" ? facts.credits : () => 1;
  const known = options.filter(facts.inCatalog);
  // An option counts only once every course in its bundle (a lecture and its lab) is credited.
  const counted = known.filter((option) => bundle(option).every(facts.credited));
  const done = counted.reduce((total, id) => total + size(id), 0);
  const open = known.filter((option) => !counted.includes(option));
  const members = (option: CourseId) => bundle(option).filter((id) => facts.inCatalog(id) && !facts.credited(id));
  const unitFacts: CourseFacts = {
    ...facts,
    // A bundle member missing from the catalog has no known prerequisites: one term.
    terms: (option) => Math.max(0, ...bundle(option).map((id) => (facts.inCatalog(id) ? facts.terms(id) : 1))),
    needsAdvisor: (option) => members(option).some(facts.needsAdvisor),
  };
  const route = fill(open, target - done, size, unitFacts);
  const met = done >= target;
  return {
    met, done, target, unit, ...route,
    needed: [...new Set(route.needed.flatMap(members))],
    options: met ? [] : [...new Set(open.flatMap(members))],
    progress: counted.length,
    tracked: true,
    branch: null,
    blocked: [],
  };
}

function evaluateBranch(requirements: readonly Requirement[], name: string, facts: CourseFacts): Evaluation {
  const parts = requirements.map((requirement) => evaluateRequirement(requirement, facts));
  const unmet = parts.filter((part) => !part.met);
  return {
    met: unmet.length === 0,
    done: parts.length - unmet.length,
    target: parts.length,
    unit: "requirements",
    terms: Math.max(0, ...unmet.map((part) => part.terms)),
    advisor: unmet.some((part) => part.advisor),
    needed: unmet.flatMap((part) => part.needed),
    options: unmet.flatMap((part) => part.options),
    progress: parts.reduce((total, part) => total + part.progress, 0),
    tracked: unmet.every((part) => part.tracked),
    branch: name,
    blocked: unmet.flatMap((part) => part.blocked),
  };
}

/**
 * Progress and the shortest remaining route for one requirement.
 *
 * A choice is the student's decision, not a route to shorten: it follows the
 * met branch, else the one with the most credited courses (the student has
 * started it), else the first reachable branch that needs no advisor, else the
 * first reachable one in plan order. Picking the shortest branch instead would
 * follow the senior thesis for every sophomore, because its senior-standing
 * rule costs no terms. Until a branch is started, every branch's courses count
 * as options.
 */
export function evaluateRequirement(requirement: Requirement, facts: CourseFacts): Evaluation {
  switch (requirement.kind) {
    case "all": {
      const credited = requirement.courses.filter(facts.credited);
      const open = requirement.courses.filter((id) => facts.inCatalog(id) && !facts.credited(id));
      const met = credited.length === requirement.courses.length;
      return {
        met,
        done: credited.length,
        target: requirement.courses.length,
        unit: "courses",
        terms: Math.max(0, ...open.map(facts.terms)),
        advisor: open.some(facts.needsAdvisor),
        needed: open,
        options: open,
        progress: credited.length,
        // A listed course the catalog lacks can never be confirmed.
        tracked: requirement.courses.every(facts.inCatalog),
        branch: null,
        blocked: open.filter((id) => facts.terms(id) === Infinity),
      };
    }
    case "choose":
      return fromOptions(requirement.options, requirement.count, "courses", facts, (option) => [option, ...(requirement.companions?.[option] ?? [])]);
    case "hours":
      return fromOptions(requirement.options, requirement.hours, "hours", facts);
    case "pool":
      if (requirement.match) return fromOptions(facts.matches(requirement.match), requirement.hours, "hours", facts);
      // Untracked: never met, and with no known courses it adds nothing to any path.
      return { ...fromOptions([], requirement.hours, "hours", facts), terms: 0, tracked: false };
    case "choice": {
      const branches = requirement.branches.map((branch) => evaluateBranch(branch.requirements, branch.name, facts));
      const order = branches.map((_, index) => index).sort((a, b) => {
        const [x, y] = [branches[a]!, branches[b]!];
        return Number(y.met) - Number(x.met) || y.progress - x.progress ||
          Number(x.terms === Infinity) - Number(y.terms === Infinity) || Number(x.advisor) - Number(y.advisor) || a - b;
      });
      const best = branches[order[0]!]!;
      if (best.met || best.progress > 0) return best;
      return { ...best, options: [...new Set(branches.flatMap((branch) => branch.options))] };
    }
  }
}

/**
 * Validates the plan and maps every course it lists, by name or by pattern, to
 * its place in the plan. A course counts toward one requirement only, so a
 * course named twice is an error rather than a silent double count.
 */
export function listCourses(
  plan: RequirementSet,
  catalog: readonly CatalogCourse[],
): { listings: Map<CourseId, Listing>; matches: (pattern: CoursePattern) => CourseId[] } {
  check(plan.requirements.length > 0, `Plan "${plan.name}" has no requirements.`);
  plan.requirements.forEach(validate);
  const listings = new Map<CourseId, Listing>();
  plan.requirements.forEach((requirement, position) => {
    for (const id of listed(requirement)) {
      const owner = listings.get(id);
      // Two labs can share a lecture's companion within one requirement, never across two.
      check(owner === undefined || owner.position === position,
        `Course ${id} is listed by both "${owner?.group}" and "${requirement.name}"; a course counts toward one requirement.`);
      listings.set(id, { group: requirement.name, position, branch: branchOf(requirement, (inner) => listed(inner).includes(id)) });
    }
  });
  const ruled = plan.requirements.flatMap((requirement, position) => patterns(requirement).map((pattern) => ({ pattern, position })));
  for (const a of ruled) {
    for (const b of ruled) {
      const overlap = a.pattern.subject === b.pattern.subject && Math.abs(a.pattern.level - b.pattern.level) < 1000;
      check(a.position === b.position || !overlap,
        `Pools in "${plan.requirements[a.position]!.name}" and "${plan.requirements[b.position]!.name}" match the same ${a.pattern.subject} courses; a course counts toward one requirement.`);
    }
  }
  const matches = patternMatcher(catalog, new Set(listings.keys()));
  plan.requirements.forEach((requirement, position) => {
    for (const pattern of patterns(requirement)) {
      for (const id of matches(pattern)) {
        if (listings.has(id)) continue;
        listings.set(id, { group: requirement.name, position, branch: branchOf(requirement, (inner) => patterns(inner).includes(pattern)) });
      }
    }
  });
  return { listings, matches };
}
