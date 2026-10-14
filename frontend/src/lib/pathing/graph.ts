import { courseReferences } from "@/lib/prereq";
import type { CatalogCourse, CourseId, Prerequisite, Reason } from "@/lib/prereq";

/** Sorts course ids the way the prerequisite engine does (code-point order). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The listed courses plus every catalog course their prerequisite expressions
 * name, walked downward only. A course enters by being needed, never by needing
 * something, so scope comes from the degree plan and not catalog connectivity.
 */
export function prerequisiteClosure(listed: Iterable<CourseId>, byId: ReadonlyMap<CourseId, CatalogCourse>): Set<CourseId> {
  const universe = new Set<CourseId>();
  const queue = [...listed].filter((id) => byId.has(id));
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    if (universe.has(id)) continue;
    universe.add(id);
    for (const reference of courseReferences(byId.get(id)!.prerequisite)) {
      if (byId.has(reference) && !universe.has(reference)) queue.push(reference);
    }
  }
  return universe;
}

function hasAdvisorClause(node: Prerequisite): boolean {
  switch (node.kind) {
    case "consent":
    case "unknown":
      return true;
    case "and":
    case "or":
      return node.children.some(hasAdvisorClause);
    case "minGrade":
    case "corequisite":
      return hasAdvisorClause(node.requirement);
    default:
      return false;
  }
}

/**
 * The OR branches a student can plan on. A branch that names no course (consent,
 * "or equivalent", unparsed text) needs an advisor's say-so, so it drops out
 * whenever another branch names a course. This depends on structure alone,
 * which keeps the term costs below monotone.
 */
export function plannableRoutes(children: readonly Prerequisite[]): readonly Prerequisite[] {
  const routes = children.filter((child) => courseReferences(child).length > 0 || !hasAdvisorClause(child));
  return routes.length > 0 ? routes : children;
}

/** Whether every plannable route through the expression still needs an advisor's approval. */
export function needsAdvisor(node: Prerequisite): boolean {
  switch (node.kind) {
    case "consent":
    case "unknown":
      return true;
    case "and":
      return node.children.some(needsAdvisor);
    case "or":
      return plannableRoutes(node.children).every(needsAdvisor);
    case "minGrade":
    case "corequisite":
      return needsAdvisor(node.requirement);
    default:
      return false;
  }
}

/** What path costing needs to know about each course. */
export type Costing = {
  /** Done, in progress, or planned for the term being built. */
  credited: (courseId: CourseId) => boolean;
  /** Credited, or proven by closure: meets a plain prerequisite. */
  satisfied: (courseId: CourseId) => boolean;
  /** Has a passing completion on record, so a grade that falls short means a retake. */
  done: (courseId: CourseId) => boolean;
  /** Current estimate for an open course; a course missing from the catalog counts 1. */
  terms: (courseId: CourseId) => number;
};

/** The engine's verdict on each node of one course's prerequisite, where its reason tree lines up. */
export type Verdicts = ReadonlyMap<Prerequisite, Reason>;

/**
 * Pairs each node of a prerequisite with the engine's reason for it. The
 * engine evaluates AND, OR and corequisite nodes child by child and a grade
 * minimum through its requirement, so the trees line up until the engine
 * substitutes a closure witness or the shapes differ; matching stops there.
 */
export function alignVerdicts(node: Prerequisite, reason: Reason): Map<Prerequisite, Reason> {
  const verdicts = new Map<Prerequisite, Reason>();
  // Status-level wrappers (advisor check, cycle, unrecognized grade) hold the evaluated reason as their only child.
  let root = reason;
  while ((root.kind === "advisor" || root.kind === "cycle") && root.children?.length === 1) root = root.children[0]!;
  const visit = (current: Prerequisite, verdict: Reason) => {
    verdicts.set(current, verdict);
    if (verdict.outcome === "satisfied") return;
    const children = verdict.children ?? [];
    if ((current.kind === "and" || current.kind === "or") && verdict.kind === current.kind && children.length === current.children.length) {
      current.children.forEach((child, index) => visit(child, children[index]!));
    } else if (current.kind === "minGrade") {
      visit(current.requirement, verdict);
    } else if (current.kind === "corequisite" && verdict.kind === "corequisite" && children.length === 1) {
      visit(current.requirement, children[0]!);
    }
  };
  visit(node, root);
  return verdicts;
}

/**
 * Whether a course leaf is still unmet, and the terms it holds its course back.
 * When the engine reports a grade minimum unmet, closure does not count: a
 * finished course must be retaken (one term), an in-progress one is assumed to
 * earn the grade, and any other course is taken for it.
 */
function leaf(node: Prerequisite & { kind: "course" }, costing: Costing, verdicts: Verdicts, graded: boolean, together: boolean) {
  const id = node.courseId;
  const verdict = verdicts.get(node);
  if (graded && verdict?.kind === "grade" && verdict.outcome === "unmet") {
    if (costing.done(id)) return { met: false, terms: 1 };
    if (costing.credited(id)) return { met: true, terms: 0 };
    return { met: false, terms: costing.terms(id) };
  }
  if (costing.satisfied(id)) return { met: true, terms: 0 };
  const terms = costing.terms(id);
  return { met: false, terms: together && !graded ? terms - 1 : terms };
}

/**
 * Terms an expression holds its course back. A prerequisite must finish a term
 * earlier, so it delays by its own terms. A plain corequisite is taken in the
 * same term, so it delays by one less. A grade minimum anywhere above or below a
 * corequisite needs a finished grade, matching the engine, so it delays fully.
 * A node the engine already reports satisfied delays nothing. Standing, consent
 * and unparsed clauses add nothing here; the engine's status gates them.
 * Infinity means no route.
 */
function delay(node: Prerequisite, costing: Costing, verdicts: Verdicts, graded = false, together = false): number {
  if (verdicts.get(node)?.outcome === "satisfied") return 0;
  switch (node.kind) {
    case "course":
      return leaf(node, costing, verdicts, graded, together).terms;
    case "and":
      return Math.max(0, ...node.children.map((child) => delay(child, costing, verdicts, graded, together)));
    case "or":
      return Math.min(...plannableRoutes(node.children).map((child) => delay(child, costing, verdicts, graded, together)));
    case "minGrade":
      return delay(node.requirement, costing, verdicts, true, together);
    case "corequisite":
      return delay(node.requirement, costing, verdicts, graded, true);
    default:
      return 0;
  }
}

/**
 * Terms until each unfinished universe course is complete, counting next term
 * as 1. Credited courses cost 0 and eligible ones 1, because the engine has
 * already cleared them. The rest follow `1 + delay(prerequisite)`.
 *
 * Solved as a least fixpoint: every estimate starts at 1 and only rises, so a
 * value found halfway through a cycle is never frozen in. The least solution's
 * values leave no gaps, so each value up to the largest belongs to a different
 * course; a finite answer therefore stays within the open courses plus one (a
 * course missing from the catalog counts 1). Anything past that bound is an
 * unbroken cycle and becomes Infinity.
 */
export function courseTerms(
  open: readonly CourseId[],
  byId: ReadonlyMap<CourseId, CatalogCourse>,
  eligible: (courseId: CourseId) => boolean,
  costing: Omit<Costing, "terms">,
  verdictsOf: (courseId: CourseId) => Verdicts,
): Map<CourseId, number> {
  const terms = new Map(open.map((id) => [id, 1]));
  const current: Costing = { ...costing, terms: (id) => terms.get(id) ?? 1 };
  const bound = open.length + 1;
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of open) {
      if (eligible(id)) continue;
      const next = 1 + delay(byId.get(id)!.prerequisite, current, verdictsOf(id));
      const value = next > bound ? Infinity : next;
      if (value !== terms.get(id)) {
        terms.set(id, value);
        changed = true;
      }
    }
  }
  return terms;
}

/**
 * The unmet course leaves on an expression's shortest routes, each marked
 * `together` when it only needs co-enrollment. Every OR branch tying the
 * minimum stays, since each is a real way forward. A course reached both ways
 * keeps the stricter "before" mark. A credited course appears only when a
 * grade it earned falls short, which the caller reports as a retake.
 */
export function neededCourses(node: Prerequisite, costing: Costing, verdicts: Verdicts): Map<CourseId, boolean> {
  const needed = new Map<CourseId, boolean>();
  const visit = (current: Prerequisite, graded: boolean, together: boolean) => {
    if (verdicts.get(current)?.outcome === "satisfied") return;
    switch (current.kind) {
      case "course": {
        if (leaf(current, costing, verdicts, graded, together).met) return;
        const coEnrolled = together && !graded;
        needed.set(current.courseId, (needed.get(current.courseId) ?? true) && coEnrolled);
        return;
      }
      case "and":
        for (const child of current.children) visit(child, graded, together);
        return;
      case "or": {
        const routes = plannableRoutes(current.children);
        const delays = routes.map((child) => delay(child, costing, verdicts, graded, together));
        const best = Math.min(...delays);
        if (best === Infinity) return;
        routes.forEach((child, index) => {
          if (delays[index] === best) visit(child, graded, together);
        });
        return;
      }
      case "minGrade":
        visit(current.requirement, true, together);
        return;
      case "corequisite":
        visit(current.requirement, graded, true);
        return;
      default:
        return;
    }
  };
  visit(node, false, false);
  return needed;
}
