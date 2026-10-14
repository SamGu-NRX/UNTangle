import { courseReferences } from "@/lib/prereq";
import type { CourseId, InferenceResult, Prerequisite } from "@/lib/prereq";
import type { RequirementSet } from "./types";

/** Sorts course ids the way the prerequisite engine does (code-point order). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The requirement universe: the required course ids plus, walked downward only,
 * every catalog course referenced by a member's prerequisite expression. Courses
 * enter by being needed, never by needing something — a disconnected downstream
 * course (a side requirement of an unrelated elective) stays out, so scope comes
 * from the explicit requirement set and never from catalog connectivity.
 * Required ids missing from the catalog become warnings, not nodes.
 */
export function requirementUniverse(
  requirements: RequirementSet,
  result: InferenceResult,
): { universe: Set<CourseId>; warnings: string[] } {
  const inCatalog = new Map(result.catalog.map((course) => [course.id, course]));
  const universe = new Set<CourseId>();
  const warnings: string[] = [];
  const queue: CourseId[] = [];
  for (const id of [...new Set(requirements.requiredCourseIds)].sort(compareIds)) {
    if (!inCatalog.has(id)) {
      warnings.push(`Required course ${id} is not in the catalog and is skipped.`);
      continue;
    }
    if (!universe.has(id)) {
      universe.add(id);
      queue.push(id);
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const course = inCatalog.get(queue[index]!)!;
    for (const reference of courseReferences(course.prerequisite)) {
      if (universe.has(reference) || !inCatalog.has(reference)) continue;
      universe.add(reference);
      queue.push(reference);
    }
  }
  return { universe, warnings };
}

/** The cost of one course's own prerequisite expression, memoized by the caller. */
export type CourseCost = (courseId: CourseId) => number | null;

/**
 * Satisfaction predicates for path costing. `finished` accepts done or taking
 * (paths assume a pass each term, so an in-flight course lands next term);
 * `gradeFinished` accepts done only, for grade-wrapped requirements that demand
 * a completed grade.
 */
export type Satisfaction = {
  finished: (courseId: CourseId) => boolean;
  gradeFinished: (courseId: CourseId) => boolean;
};

export type PathEvaluation = { cost: number | null; needed: Set<CourseId> };

const RESOLVED_NOTHING: PathEvaluation = { cost: 0, needed: new Set() };
const UNRESOLVED: PathEvaluation = { cost: null, needed: new Set() };

/**
 * Term-cost evaluation of one prerequisite expression, plus the unfinished
 * course leaves on its cheapest viable path.
 *
 * Paths are counted in terms: one pass per course per term, with no limits on
 * credits or course offerings, so AND siblings run in parallel (max) while OR
 * alternatives pick the cheapest branch (min). A corequisite that is not
 * grade-wrapped adds no term (it can be co-enrolled); a grade-wrapped one must
 * already be completed, so it costs normally. Standing, consent, and unknown
 * clauses gate availability through the engine's statuses, not path length.
 * Escapes (equivalent or replacement routes) do not shorten a requirement:
 * the listed courses stay on a continuing student's path. A leaf reference to
 * a course the catalog does not carry adds no term; the engine's statuses
 * surface those gaps instead.
 *
 * Cost is null exactly when every branch of an OR is unresolved or an AND
 * member is — in practice, when the cheapest viable branch runs through an
 * unresolved prerequisite cycle.
 */
export function evaluateNode(
  node: Prerequisite,
  gradeWrapped: boolean,
  satisfaction: Satisfaction,
  courseCost: CourseCost,
): PathEvaluation {
  const { finished, gradeFinished } = satisfaction;
  switch (node.kind) {
    case "course": {
      // A grade-wrapped leaf demands a completed grade; a plain leaf accepts an
      // in-flight course (it lands next term under the pass-each-term assumption).
      if (gradeWrapped ? gradeFinished(node.courseId) : finished(node.courseId)) return RESOLVED_NOTHING;
      const cost = courseCost(node.courseId);
      return { cost, needed: new Set([node.courseId]) };
    }
    case "and": {
      let cost = 0;
      const needed = new Set<CourseId>();
      for (const child of node.children) {
        const sub = evaluateNode(child, gradeWrapped, satisfaction, courseCost);
        if (sub.cost === null) return UNRESOLVED;
        cost = Math.max(cost, sub.cost);
        for (const id of sub.needed) needed.add(id);
      }
      return { cost, needed };
    }
    case "or": {
      let best: PathEvaluation | null = null;
      let bestCost: number | null = null;
      for (const child of node.children) {
        const sub = evaluateNode(child, gradeWrapped, satisfaction, courseCost);
        if (sub.cost === null) continue;
        if (bestCost === null || sub.cost < bestCost) {
          best = sub;
          bestCost = sub.cost;
        }
      }
      if (best === null || bestCost === null) return UNRESOLVED;
      // Every branch tying the minimum stays on some cheapest path.
      const needed = new Set<CourseId>(best.needed);
      for (const child of node.children) {
        const sub = evaluateNode(child, gradeWrapped, satisfaction, courseCost);
        if (sub.cost !== bestCost) continue;
        for (const id of sub.needed) needed.add(id);
      }
      return { cost: bestCost, needed };
    }
    case "minGrade":
      // Grade-wrapped requirements must be completed with the grade, corequisite or not.
      return evaluateNode(node.requirement, true, satisfaction, courseCost);
    case "corequisite":
      // A plain corequisite can be co-enrolled: it adds no term, but taking the
      // course still means arranging the corequisite in the same term. A
      // grade-wrapped corequisite loses that pass and is evaluated normally.
      if (gradeWrapped) return evaluateNode(node.requirement, true, satisfaction, courseCost);
      return evaluateCorequisite(node.requirement, satisfaction, courseCost);
    case "standing":
    case "consent":
    case "unknown":
      return RESOLVED_NOTHING;
  }
}

/** Corequisites ride along in the same term: cost 0, leaves still needed. */
function evaluateCorequisite(
  node: Prerequisite,
  satisfaction: Satisfaction,
  courseCost: CourseCost,
): PathEvaluation {
  return corequisiteEvaluation(node, satisfaction, courseCost, new Set());
}

function corequisiteEvaluation(
  node: Prerequisite,
  satisfaction: Satisfaction,
  courseCost: CourseCost,
  seen: Set<CourseId>,
): PathEvaluation {
  switch (node.kind) {
    case "course": {
      if (satisfaction.finished(node.courseId) || seen.has(node.courseId)) return RESOLVED_NOTHING;
      seen.add(node.courseId);
      return { cost: 0, needed: new Set([node.courseId]) };
    }
    case "and":
    case "or": {
      let cost = 0;
      const needed = new Set<CourseId>();
      for (const child of node.children) {
        const sub = corequisiteEvaluation(child, satisfaction, courseCost, seen);
        cost = Math.max(cost, sub.cost ?? 0);
        for (const id of sub.needed) needed.add(id);
      }
      return { cost, needed };
    }
    case "minGrade":
    case "corequisite":
      return corequisiteEvaluation(node.requirement, satisfaction, courseCost, seen);
    default:
      return RESOLVED_NOTHING;
  }
}
