import { detectCycles } from "@/lib/prereq";
import type { CourseId, InferenceResult, Major } from "@/lib/prereq";
import { buildDependents, compareIds, majorUniverse } from "./graph";
import type { CoursePathing, PathingAnalysis, PathingGroup, TermRecommendation } from "./types";

/** All courses reachable from `start` through prerequisite-reference edges, `start` included. */
function dependentClosure(start: CourseId, dependents: Map<CourseId, Set<CourseId>>): Set<CourseId> {
  const visited = new Set<CourseId>([start]);
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    for (const next of dependents.get(queue[index]) ?? new Set<CourseId>()) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

/**
 * Major-scoped unlock analysis.
 *
 * The universe is every catalog course connected to a core course through
 * prerequisite-reference edges in either direction; everything else is ignored.
 * `unlocksDirect` and `unlocksTransitive` list unfinished dependents (done and
 * taking courses are excluded from the lists but still bridge traversal).
 * `remainingChain` counts 1 + the longest chain of unfinished dependents, with
 * cycle members as chain sinks so recursion always terminates. Advisor-check
 * requirements surface as status "unknown" and are never available.
 */
export function unlockAnalysis(major: Major, statuses: InferenceResult): PathingAnalysis {
  const dependents = buildDependents(statuses);
  const { universe, warnings } = majorUniverse(major, statuses, dependents);
  const byId = new Map(statuses.catalog.map((course) => [course.id, course]));
  const core = new Set(major.coreCourseCodes);
  // Cycle members are chain sinks: detectCycles is the engine's own SCC walk over the
  // catalog, and the reported cycles are honored too, so a hand-built result cannot hide a cycle.
  const cycleIds = new Set<CourseId>([...statuses.cycles.flat(), ...detectCycles(statuses.catalog).flat()]);
  const statusOf = (id: CourseId) => statuses.statuses.get(id)?.status ?? "unknown";
  const finished = (id: CourseId) => {
    const status = statusOf(id);
    return status === "done" || status === "taking";
  };

  const chains = new Map<CourseId, number>();
  const inProgress = new Set<CourseId>();
  const remainingChain = (id: CourseId): number => {
    const memo = chains.get(id);
    if (memo !== undefined) return memo;
    if (finished(id) || cycleIds.has(id)) {
      chains.set(id, 0);
      return 0;
    }
    // Guard, not behavior: the cycle sets above already name every cycle, so this
    // re-entrancy would mean a cycle escaped detection. Fail loudly, never loop forever.
    if (inProgress.has(id)) throw new Error(`Prerequisite cycle at ${id} escaped cycle detection.`);
    inProgress.add(id);
    let longest = 0;
    for (const dependent of dependents.get(id) ?? new Set<CourseId>()) {
      if (!universe.has(dependent) || finished(dependent)) continue;
      longest = Math.max(longest, remainingChain(dependent));
    }
    inProgress.delete(id);
    const value = 1 + longest;
    chains.set(id, value);
    return value;
  };

  const sortedUniverse = [...universe].sort(compareIds);
  for (const id of sortedUniverse) remainingChain(id);
  let remainingCriticalPath = 0;
  for (const id of sortedUniverse) remainingCriticalPath = Math.max(remainingCriticalPath, remainingChain(id));

  const courses = new Map<CourseId, CoursePathing>();
  for (const id of sortedUniverse) {
    const closure = dependentClosure(id, dependents);
    const status = statusOf(id);
    const group: PathingGroup = core.has(id)
      ? "core"
      : [...closure].some((reached) => core.has(reached))
        ? "prerequisite"
        : "advanced";
    // Dependents of a universe course are in the universe by construction, so the
    // unfinished filter alone shapes the direct list.
    const unlocksDirect = [...(dependents.get(id) ?? new Set<CourseId>())].filter((dependent) => !finished(dependent)).sort(compareIds);
    const unlocksTransitive = [...closure].filter((reached) => reached !== id && !finished(reached)).sort(compareIds);
    const chain = chains.get(id)!;
    const available = status === "eligible";
    const reasons: string[] = [];
    if (available) {
      if (unlocksTransitive.length > 0) reasons.push(`Unlocks ${unlocksTransitive.length} ${unlocksTransitive.length === 1 ? "course" : "courses"}`);
      if (chain > 0 && chain === remainingCriticalPath) reasons.push("On the longest chain to graduating");
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
  return { universe: sortedUniverse, courses, warnings, remainingCriticalPath };
}

/**
 * Greedy one-term plan from the available universe courses, ranked by transitive
 * unlocks, then remaining chain, then credits, then id. A candidate that would
 * overflow the credit target is skipped and the walk continues, mirroring
 * `suggestNext`. A zero target plans nothing.
 */
export function recommendNextTerm(
  major: Major,
  statuses: InferenceResult,
  options: { creditTarget: number },
): TermRecommendation[] {
  const { creditTarget } = options;
  if (!Number.isFinite(creditTarget) || creditTarget < 0) throw new Error("creditTarget must be finite and nonnegative.");
  if (creditTarget === 0) return [];
  const analysis = unlockAnalysis(major, statuses);
  const candidates = [...analysis.courses.values()].filter((course) => course.available);
  // Unlock breadth first, then the longest remaining chain, then heavier courses,
  // then id, so no ranking tie is ever left to insertion order.
  candidates.sort((a, b) =>
    b.unlocksTransitive.length - a.unlocksTransitive.length ||
    b.remainingChain - a.remainingChain ||
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
