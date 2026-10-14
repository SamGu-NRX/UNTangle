import type { CourseId, InferenceResult } from "@/lib/prereq";
import { compareIds, evaluateNode, requirementUniverse } from "./graph";
import type { Satisfaction } from "./graph";
import type { CoursePathing, PathingAnalysis, PathingGroup, RequirementSet, TermRecommendation } from "./types";

/**
 * Requirement-scoped unlock analysis.
 *
 * The universe is the requirement set's courses plus the prerequisites they
 * need, walked downward only — never catalog connectivity. Paths are counted in
 * terms (one pass per course per term, no credit or offering limits), following
 * the prerequisite EXPRESSION: OR alternatives pick the cheapest viable branch,
 * plain corequisites add no term, and grade-wrapped ones do. `unlocksDirect`
 * lists unfinished universe courses whose cheapest viable branch needs the
 * course; a satisfied OR alternative therefore stops unlocking anything.
 * An unresolved prerequisite cycle surfaces as null chains and a warning, and
 * `remainingCriticalPath` is the longest chain over unfinished required
 * courses (null when one of them is cycle-blocked; 0 when none remain).
 * Advisor-check requirements surface as status "unknown" and are never available.
 */
export function unlockAnalysis(requirements: RequirementSet, statuses: InferenceResult): PathingAnalysis {
  const { universe, warnings } = requirementUniverse(requirements, statuses);
  const byId = new Map(statuses.catalog.map((course) => [course.id, course]));
  const required = new Set(requirements.requiredCourseIds);
  const statusOf = (id: CourseId) => statuses.statuses.get(id)?.status ?? "unknown";
  const finished = (id: CourseId) => {
    const status = statusOf(id);
    return status === "done" || status === "taking";
  };
  const gradeFinished = (id: CourseId) => statusOf(id) === "done";
  const satisfaction: Satisfaction = { finished, gradeFinished };

  // Pass one: memoized term cost per course. Re-entering a course while its own
  // cost is still being computed is an unresolved cycle; its cheapest branch runs
  // through itself, so no branch cost exists. Evidence that completes a cycle
  // member short-circuits before recursion, so evidence-resolved cycles cost 0.
  const costs = new Map<CourseId, number | null>();
  const inProgress = new Set<CourseId>();
  const courseCost = (id: CourseId): number | null => {
    const memo = costs.get(id);
    if (memo !== undefined) return memo;
    if (inProgress.has(id)) return null;
    const course = byId.get(id);
    if (!course) return 0;
    inProgress.add(id);
    const sub = evaluateNode(course.prerequisite, false, satisfaction, courseCost);
    inProgress.delete(id);
    const value = sub.cost === null ? null : 1 + sub.cost;
    costs.set(id, value);
    return value;
  };
  for (const id of universe) courseCost(id);

  // Pass two: the needed leaves on each course's cheapest viable branch, now
  // that every cost is memoized. This walk never re-enters courseCost, so
  // cycles cannot recur here.
  const neededBy = new Map<CourseId, Set<CourseId>>();
  for (const id of universe) {
    const course = byId.get(id)!;
    if (finished(id)) continue;
    const sub = evaluateNode(course.prerequisite, false, satisfaction, courseCost);
    for (const leaf of sub.needed) {
      if (!universe.has(leaf)) continue;
      const users = neededBy.get(leaf) ?? new Set<CourseId>();
      users.add(id);
      neededBy.set(leaf, users);
    }
  }

  const transitiveFrom = (start: CourseId): Set<CourseId> => {
    const closure = new Set<CourseId>();
    const queue = [start];
    for (let index = 0; index < queue.length; index++) {
      for (const user of neededBy.get(queue[index]!) ?? new Set<CourseId>()) {
        if (closure.has(user)) continue;
        closure.add(user);
        queue.push(user);
      }
    }
    return closure;
  };

  const sortedUniverse = [...universe].sort(compareIds);
  const unfinishedRequired = sortedUniverse.filter((id) => required.has(id) && !finished(id));
  let cycleBlocked = false;
  for (const id of unfinishedRequired) {
    if (costs.get(id) === null) cycleBlocked = true;
  }
  const analysisWarnings = [...warnings];
  if (cycleBlocked) {
    const blocked = unfinishedRequired.filter((id) => costs.get(id) === null).sort(compareIds);
    analysisWarnings.push(`Unresolved prerequisite cycle blocks: ${blocked.join(", ")}; remainingCriticalPath is null.`);
  }
  const criticalCandidates = unfinishedRequired
    .map((id) => costs.get(id)!)
    .filter((cost): cost is number => cost !== null);
  const remainingCriticalPath = cycleBlocked ? null : Math.max(0, ...criticalCandidates);

  const courses = new Map<CourseId, CoursePathing>();
  for (const id of sortedUniverse) {
    const status = statusOf(id);
    const group: PathingGroup = required.has(id) ? "required" : "prerequisite";
    const unlocksDirect = [...(neededBy.get(id) ?? new Set<CourseId>())].sort(compareIds);
    const unlocksTransitive = [...transitiveFrom(id)].filter((user) => user !== id).sort(compareIds);
    const chain = finished(id) ? 0 : costs.get(id)!;
    const available = status === "eligible";
    const reasons: string[] = [];
    if (available) {
      if (unlocksTransitive.length > 0) reasons.push(`Unlocks ${unlocksTransitive.length} ${unlocksTransitive.length === 1 ? "course" : "courses"}`);
      if (remainingCriticalPath !== null && remainingCriticalPath > 0 && chain === remainingCriticalPath) reasons.push("On the longest chain to graduating");
    }
    courses.set(id, {
      courseId: id,
      group,
      status,
      credits: byId.get(id)!.credits,
      unlocksDirect,
      unlocksTransitive,
      remainingChain: chain,
      available,
      reasons,
    });
  }

  return {
    universe: sortedUniverse,
    courses,
    warnings: analysisWarnings,
    chooseNGroups: (requirements.chooseNGroups ?? []).map((group) => ({
      name: group.name,
      options: [...group.options].sort(compareIds),
      choose: group.choose,
    })),
    remainingCriticalPath,
  };
}

/**
 * Greedy one-term plan from the available universe courses, ranked by
 * transitive unlocks, then remaining chain (null last), then credits, then id.
 * A candidate that would overflow the credit target is skipped and the walk
 * continues, mirroring `suggestNext`. A zero target plans nothing.
 */
export function recommendNextTerm(
  requirements: RequirementSet,
  statuses: InferenceResult,
  options: { creditTarget: number },
): TermRecommendation[] {
  const { creditTarget } = options;
  if (!Number.isFinite(creditTarget) || creditTarget < 0) throw new Error("creditTarget must be finite and nonnegative.");
  if (creditTarget === 0) return [];
  const analysis = unlockAnalysis(requirements, statuses);
  const candidates = [...analysis.courses.values()].filter((course) => course.available);
  const chainKey = (chain: number | null) => (chain === null ? -1 : chain);
  // Unlock breadth first, then the longest remaining chain (cycle-blocked last),
  // then heavier courses, then id, so no ranking tie is ever left to insertion order.
  candidates.sort((a, b) =>
    b.unlocksTransitive.length - a.unlocksTransitive.length ||
    chainKey(b.remainingChain) - chainKey(a.remainingChain) ||
    b.credits - a.credits ||
    compareIds(a.courseId, b.courseId));
  const plan: TermRecommendation[] = [];
  let credits = 0;
  for (const candidate of candidates) {
    if (credits + candidate.credits > creditTarget) continue;
    credits += candidate.credits;
    plan.push({
      courseId: candidate.courseId,
      credits: candidate.credits,
      group: candidate.group,
      unlocksDirect: candidate.unlocksDirect,
      unlocksTransitive: candidate.unlocksTransitive,
      remainingChain: candidate.remainingChain,
      reasons: candidate.reasons,
    });
  }
  return plan;
}
