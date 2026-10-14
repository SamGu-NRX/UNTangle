import type { CourseId, InferenceResult, Reason } from "@/lib/prereq";
import { alignVerdicts, compareIds, courseTerms, neededCourses, needsAdvisor, prerequisiteClosure } from "./graph";
import type { Costing, Verdicts } from "./graph";
import { evaluateRequirement, listCourses } from "./requirements";
import type { CourseFacts, Evaluation, Listing } from "./requirements";
import type { CoursePathing, PathingAnalysis, RequirementSet, TermRecommendation } from "./types";

type Ranked = { analysis: PathingAnalysis; rank: (a: CoursePathing, b: CoursePathing) => number };

function names(ids: readonly CourseId[]): string {
  if (ids.length > 3) return `${ids.slice(0, 3).join(", ")} and ${ids.length - 3} more`;
  return ids.length > 1 ? `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}` : ids.join("");
}

/**
 * Whether the engine's reason holds a clause it already knows is unmet, such
 * as senior standing at 21 hours. Such a course stays out of reach even if an
 * advisor clears its unknown clauses, though its combined status is "unknown".
 */
function knownUnmet(reason: Reason): boolean {
  if (reason.outcome === "unmet") return true;
  const children = reason.children ?? [];
  return reason.kind === "or" ? children.length > 0 && children.every(knownUnmet) : children.some(knownUnmet);
}

function progressText(evaluation: Evaluation): string {
  const unit = evaluation.target === 1 ? evaluation.unit.slice(0, -1) : evaluation.unit;
  return `${evaluation.done} of ${evaluation.target} ${unit} done`;
}

/**
 * The whole analysis for one plan, with `planned` courses treated as already
 * credited. `recommendNextTerm` re-runs it after each pick, so a second OR
 * alternative or an already-filled group stops looking useful.
 */
function analyze(plan: RequirementSet, statuses: InferenceResult, planned: ReadonlySet<CourseId>): Ranked {
  const byId = new Map(statuses.catalog.map((course) => [course.id, course]));
  const { listings, matches } = listCourses(plan, statuses.catalog);
  const universe = prerequisiteClosure(listings.keys(), byId);
  const statusOf = (id: CourseId) => statuses.statuses.get(id)?.status ?? "unknown";
  const credited = (id: CourseId) => planned.has(id) || statusOf(id) === "done" || statusOf(id) === "taking";
  // Closure-covered courses meet prerequisites but earn no credit toward the plan.
  const satisfied = (id: CourseId) => credited(id) || statuses.coverage.has(id);
  const done = (id: CourseId) => statusOf(id) === "done";
  const open = [...universe].filter((id) => !credited(id)).sort(compareIds);
  const verdictCache = new Map<CourseId, Verdicts>();
  const verdictsOf = (id: CourseId): Verdicts => {
    if (!verdictCache.has(id)) verdictCache.set(id, alignVerdicts(byId.get(id)!.prerequisite, statuses.statuses.get(id)!.reason));
    return verdictCache.get(id)!;
  };
  // An override that locks a course is the final word: no prerequisite can clear it.
  const barred = (id: CourseId) => statusOf(id) === "locked" && statuses.statuses.get(id)!.reason.kind === "override";
  const termMap = courseTerms(open, byId, (id) => statusOf(id) === "eligible", barred, { credited, satisfied, done }, verdictsOf);
  const costing: Costing = { credited, satisfied, done, terms: (id) => termMap.get(id) ?? 1 };
  const terms = (id: CourseId) => (credited(id) ? 0 : costing.terms(id));
  const facts: CourseFacts = {
    inCatalog: (id) => byId.has(id),
    credits: (id) => byId.get(id)!.credits,
    credited,
    terms,
    // An eligible course has nothing left to clear, whatever its catalog text says.
    needsAdvisor: (id) => statusOf(id) !== "eligible" && needsAdvisor(byId.get(id)!.prerequisite),
    matches,
  };
  const evaluations = plan.requirements.map((requirement) => evaluateRequirement(requirement, facts));
  const unmet = evaluations.filter((evaluation) => !evaluation.met);

  // Walk shortest routes down from every unmet requirement. Each edge records
  // which course waits on which, and whether only co-enrollment links them.
  const needed = new Set<CourseId>();
  const waiting = new Map<CourseId, Map<CourseId, boolean>>();
  const missing = new Set<CourseId>();
  const retakes = new Set<string>();
  const queue = unmet.flatMap((evaluation) => evaluation.needed);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    if (needed.has(id)) continue;
    needed.add(id);
    if (statusOf(id) === "eligible" || terms(id) === Infinity) continue;
    for (const [leaf, together] of neededCourses(byId.get(id)!.prerequisite, costing, verdictsOf(id))) {
      if (credited(leaf)) {
        retakes.add(`${id} needs a higher grade in ${leaf}`);
        continue;
      }
      if (!universe.has(leaf)) {
        missing.add(leaf);
        continue;
      }
      const users = waiting.get(leaf) ?? new Map<CourseId, boolean>();
      users.set(id, together);
      waiting.set(leaf, users);
      queue.push(leaf);
    }
  }
  const onPath = new Set([...needed, ...unmet.flatMap((evaluation) => evaluation.options)]);

  const blocked = unmet.some((evaluation) => evaluation.terms === Infinity);
  const remainingCriticalPath = blocked ? null : Math.max(0, ...unmet.map((evaluation) => evaluation.terms));
  // Longest stretch still to run after each course: a prerequisite edge adds a
  // term, a co-enrollment edge adds none. Prerequisite edges always climb in
  // terms, so only zero-weight edges can loop and the relaxation settles.
  const tail = new Map<CourseId, number>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [leaf, users] of waiting) {
      for (const [user, together] of users) {
        const length = (together ? 0 : 1) + (tail.get(user) ?? 0);
        if (length > (tail.get(leaf) ?? 0)) {
          tail.set(leaf, length);
          changed = true;
        }
      }
    }
  }
  const unlocked = (start: CourseId): CourseId[] => {
    const seen = new Set<CourseId>();
    const stack = [start];
    while (stack.length > 0) {
      for (const user of waiting.get(stack.pop()!)?.keys() ?? []) {
        if (seen.has(user) || user === start) continue;
        seen.add(user);
        stack.push(user);
      }
    }
    return [...seen].sort(compareIds);
  };

  const role = (listing: Listing): string => {
    const kind = plan.requirements[listing.position]!.kind;
    if (kind === "all") return `Required (${listing.group})`;
    if (kind === "choice") {
      // Rival branches can share a course; name the one the analysis follows when it lists the course.
      const followed = evaluations[listing.position]!.branch;
      return `Counts toward ${listing.group} (${followed && listing.branches.includes(followed) ? followed : listing.branches[0]})`;
    }
    return `Counts toward ${listing.group}, ${progressText(evaluations[listing.position]!)}`;
  };

  const courses = new Map<CourseId, CoursePathing>();
  for (const id of [...universe].sort(compareIds)) {
    const listing = listings.get(id);
    const unlocksDirect = [...(waiting.get(id)?.keys() ?? [])].sort(compareIds);
    const unlocksTransitive = unlocked(id);
    const onCriticalPath = remainingCriticalPath !== null && remainingCriticalPath > 0 && needed.has(id) &&
      terms(id) + (tail.get(id) ?? 0) === remainingCriticalPath;
    let reason: string | null = null;
    if (onPath.has(id)) {
      const parts = [
        listing ? role(listing) : `Needed for ${names(unlocksDirect)}`,
        listing && unlocksDirect.length > 0 ? `unlocks ${names(unlocksDirect)}` : null,
        unlocksTransitive.length > unlocksDirect.length ? `${unlocksTransitive.length} remaining courses wait on it` : null,
        onCriticalPath && remainingCriticalPath! > 1 ? `on the longest remaining chain (${remainingCriticalPath} terms)` : null,
      ];
      reason = parts.filter((part) => part !== null).join("; ");
    }
    courses.set(id, {
      courseId: id,
      status: statusOf(id),
      credits: byId.get(id)!.credits,
      group: listing?.group ?? null,
      unlocksDirect,
      unlocksTransitive,
      remainingChain: terms(id) === Infinity ? null : terms(id),
      onCriticalPath,
      onRemainingPath: onPath.has(id),
      available: statusOf(id) === "eligible",
      reason,
    });
  }

  // Unlocks first, so one more unlock always beats the critical-path flag; then
  // plan order (the catalog lists the major's own courses first), then the
  // larger course, then id.
  const position = (id: CourseId) => listings.get(id)?.position ?? plan.requirements.length;
  const rank = (a: CoursePathing, b: CoursePathing) =>
    b.unlocksTransitive.length - a.unlocksTransitive.length ||
    Number(b.onCriticalPath) - Number(a.onCriticalPath) ||
    position(a.courseId) - position(b.courseId) ||
    b.credits - a.credits ||
    compareIds(a.courseId, b.courseId);

  const warnings: string[] = [];
  const absent = [...listings.keys()].filter((id) => !byId.has(id)).sort(compareIds);
  if (absent.length > 0) warnings.push(`Not in the catalog, so never counted as done and left out of paths: ${absent.join(", ")}.`);
  if (missing.size > 0) warnings.push(`Prerequisites not in the catalog, assumed to take one term with nothing before them: ${[...missing].sort(compareIds).join(", ")}.`);
  const blockedIds = [...new Set(unmet.flatMap((evaluation) => evaluation.blocked))].sort(compareIds);
  for (const id of blockedIds.filter(barred)) warnings.push(`${id} is locked by an override: ${statuses.statuses.get(id)!.reason.message}`);
  const stuck = blockedIds.filter((id) => !barred(id));
  if (stuck.length > 0) warnings.push(`No prerequisite route to ${stuck.join(", ")}: an unbroken prerequisite cycle or an empty list of alternatives blocks ${stuck.length === 1 ? "it" : "them"}.`);
  plan.requirements.forEach((requirement, index) => {
    const evaluation = evaluations[index]!;
    if (!evaluation.met && evaluation.terms === Infinity && evaluation.blocked.length === 0) {
      warnings.push(`${requirement.name} cannot be met from the courses in the catalog.`);
    }
  });
  if (retakes.size > 0) warnings.push(`Grade below the minimum on record, so a retake or advisor review comes first: ${[...retakes].sort(compareIds).join("; ")}.`);
  for (const pool of untrackedPools(plan)) {
    warnings.push(`${pool}: the plan data has no course list for this pool, so its hours are never counted; an advisor must confirm which courses apply.`);
  }
  for (const rule of plan.notChecked ?? []) warnings.push(`Not checked: ${rule}`);

  const analysis: PathingAnalysis = {
    universe: [...universe].sort(compareIds),
    courses,
    requirements: plan.requirements.map((requirement, index) => {
      const evaluation = evaluations[index]!;
      return {
        name: requirement.name,
        kind: requirement.kind,
        met: evaluation.met,
        done: evaluation.done,
        target: evaluation.target,
        unit: evaluation.unit,
        remainingTerms: evaluation.terms === Infinity ? null : evaluation.met ? 0 : evaluation.terms,
        tracked: evaluation.tracked,
        branch: evaluation.branch,
      };
    }),
    remainingCriticalPath,
    advisorChecks: [...needed]
      .map((id) => courses.get(id)!)
      .filter((course) => course.status === "unknown" && course.remainingChain === 1)
      .filter((course) => !knownUnmet(statuses.statuses.get(course.courseId)!.reason))
      .sort(rank)
      .map((course) => course.courseId),
    warnings,
  };
  return { analysis, rank };
}

function untrackedPools(plan: RequirementSet): string[] {
  const found = new Set<string>();
  const visit = (requirements: RequirementSet["requirements"]) => {
    for (const requirement of requirements) {
      if (requirement.kind === "pool" && !requirement.match) found.add(requirement.name);
      if (requirement.kind === "choice") for (const branch of requirement.branches) visit(branch.requirements);
    }
  };
  visit(plan.requirements);
  return [...found];
}

/**
 * Requirement-scoped unlock analysis. The universe is every course the plan
 * lists that the catalog carries, plus the prerequisites they name, walked
 * downward only. Paths count terms, assume a pass every term and ignore credit
 * and offering limits. They follow the prerequisite expression: an OR takes its
 * shortest branch, a satisfied alternative stops unlocking anything, and a
 * plain corequisite shares its course's term. Only courses on a shortest route
 * to an unmet requirement unlock anything, so finished requirements stop
 * pulling their old prerequisites back in.
 */
export function unlockAnalysis(requirements: RequirementSet, statuses: InferenceResult): PathingAnalysis {
  return analyze(requirements, statuses, new Set()).analysis;
}

/**
 * A greedy next-term plan under a credit target. Each pick is the best-ranked
 * eligible course on the remaining path that still fits; the analysis then
 * re-runs with that course counted as taken, so the evidence on each pick is
 * its gain on top of the earlier ones. A course that would overflow the target
 * is skipped and packing continues. Unknown and locked courses are never picked.
 */
export function recommendNextTerm(
  requirements: RequirementSet,
  statuses: InferenceResult,
  options: { creditTarget: number },
): TermRecommendation[] {
  const { creditTarget } = options;
  if (!Number.isFinite(creditTarget) || creditTarget < 0) throw new Error("creditTarget must be finite and nonnegative.");
  const plan: TermRecommendation[] = [];
  const planned = new Set<CourseId>();
  let credits = 0;
  for (;;) {
    const { analysis, rank } = analyze(requirements, statuses, planned);
    const next = [...analysis.courses.values()]
      .filter((course) => course.available && course.onRemainingPath && credits + course.credits <= creditTarget)
      .sort(rank)[0];
    if (!next) return plan;
    planned.add(next.courseId);
    credits += next.credits;
    plan.push({
      courseId: next.courseId,
      credits: next.credits,
      group: next.group,
      unlocksDirect: next.unlocksDirect,
      unlocksTransitive: next.unlocksTransitive,
      remainingChain: next.remainingChain,
      onCriticalPath: next.onCriticalPath,
      reason: next.reason!,
    });
  }
}
