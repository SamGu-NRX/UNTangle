import { canSupplyClosure, courseReferences, hasUnscopedEscape, requirementKey, requiresAdvisor } from "./ast";
import type { CatalogCourse, CourseAssessment, Evidence, InferenceResult, Prerequisite, Reason, SchoolAdapter } from "./types";

function compareIds(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export function detectCycles(catalog: readonly CatalogCourse[]): string[][] {
  const ids = new Set<string>();
  for (const course of catalog) {
    if (ids.has(course.id)) throw new Error(`Duplicate catalog course ID: ${course.id}`);
    ids.add(course.id);
  }
  const graph = new Map(catalog.map(course => [course.id, courseReferences(course.prerequisite).sort(compareIds)]));
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const cycles: string[][] = [];
  function visit(id: string) {
    const index = indices.size;
    indices.set(id, index);
    low.set(id, index);
    stack.push(id);
    active.add(id);
    for (const next of graph.get(id) ?? []) {
      if (!graph.has(next)) continue;
      if (!indices.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (active.has(next)) low.set(id, Math.min(low.get(id)!, indices.get(next)!));
    }
    if (low.get(id) !== index) return;
    const component: string[] = [];
    let next: string;
    do {
      next = stack.pop()!;
      active.delete(next);
      component.push(next);
    } while (next !== id);
    if (component.length > 1 || graph.get(id)?.includes(id)) cycles.push(component.sort(compareIds));
  }
  for (const id of [...graph.keys()].sort(compareIds)) if (!indices.has(id)) visit(id);
  return cycles.sort((a, b) => compareIds(a[0], b[0]));
}

function combine(kind: "and" | "or", children: readonly Reason[], source: string): Reason {
  const outcomes = children.map(child => child.outcome);
  // A known mandatory failure decides an AND. Unscoped prose still forces
  // course-wide review through requiresAdvisor after evaluation.
  const outcome = kind === "and"
    ? outcomes.includes("unmet") ? "unmet" : outcomes.includes("unknown") ? "unknown" : "satisfied"
    : outcomes.includes("satisfied") ? "satisfied" : outcomes.includes("unknown") ? "unknown" : "unmet";
  return { kind, outcome, source, message: kind === "and" ? "All requirements must be satisfied." : "One alternative must be satisfied.", children };
}

export function inferStatuses(catalog: readonly CatalogCourse[], evidence: Evidence, adapter: SchoolAdapter): InferenceResult {
  const byId = new Map<string, CatalogCourse>();
  for (const course of catalog) {
    if (byId.has(course.id)) throw new Error(`Duplicate course id: ${course.id}`);
    if (!Number.isFinite(course.credits) || course.credits < 0) throw new Error(`Invalid credits for ${course.id}`);
    byId.set(course.id, course);
  }
  const ordered = [...byId.values()].sort((a, b) => compareIds(a.id, b.id));
  const completed = new Map<string, { grades: string[]; reason: Reason }>();
  const recordedGrades = new Map<string, string[]>();
  const uncertain = new Set(evidence.needsReview);
  const taking = new Set(evidence.inProgress);
  const planned = new Set(evidence.planned);
  for (const row of evidence.transcript ?? []) {
    const grades = recordedGrades.get(row.courseId) ?? [];
    grades.push(row.grade);
    recordedGrades.set(row.courseId, grades);
    const passed = adapter.isPassingGrade(row.grade);
    if (passed === undefined) uncertain.add(row.courseId);
    if (!passed) continue;
    const existing = completed.get(row.courseId);
    if (existing) existing.grades.push(row.grade);
    else completed.set(row.courseId, {
      grades: [row.grade],
      reason: { kind: "transcript", outcome: "satisfied", courseId: row.courseId, source: row.source, message: `Transcript records passing grade ${row.grade}.` },
    });
  }
  for (const [id, override] of evidence.overrides ?? []) {
    if (!override.reason.trim()) throw new Error(`Override for ${id} requires a reason.`);
    completed.delete(id);
    recordedGrades.delete(id);
    uncertain.delete(id);
    taking.delete(id);
    if (override.status !== "taking") planned.delete(id);
    if (override.status === "done") completed.set(id, {
      grades: override.grade ? [override.grade] : [],
      reason: { kind: "override", outcome: "satisfied", courseId: id, message: override.reason },
    });
    if (override.status === "taking") taking.add(id);
  }

  if (evidence.earnedHours !== undefined && (!Number.isFinite(evidence.earnedHours) || evidence.earnedHours < 0)) throw new Error("earnedHours must be finite and nonnegative.");
  let earnedHours = evidence.earnedHours;
  if (earnedHours === undefined && evidence.transcript !== undefined && uncertain.size === 0) {
    const creditsByCourse = new Map<string, number>();
    let completeHours = true;
    for (const row of evidence.transcript) {
      if (adapter.isPassingGrade(row.grade) !== true) continue;
      const override = evidence.overrides?.get(row.courseId);
      if (override && override.status !== "done") continue;
      if (row.credits === undefined || row.credits === null || !Number.isFinite(row.credits) || row.credits < 0) { completeHours = false; continue; }
      // Retakes do not earn the same credit twice. Repeatable-course totals need an authoritative summary.
      creditsByCourse.set(row.courseId, Math.max(row.credits, creditsByCourse.get(row.courseId) ?? 0));
    }
    if (completeHours) earnedHours = [...creditsByCourse.values()].reduce((sum, credits) => sum + credits, 0);
  }
  function minimumHours(minimum: string): number | undefined {
    const hours = adapter.minimumHours?.(minimum);
    if (hours !== undefined && (!Number.isFinite(hours) || hours < 0)) throw new Error(`Invalid adapter hour threshold for ${minimum}`);
    return hours;
  }
  function hasHourRequirement(node: Prerequisite): boolean {
    if (node.kind === "standing") return minimumHours(node.minimum) !== undefined;
    if (node.kind === "and" || node.kind === "or") return node.children.some(hasHourRequirement);
    return (node.kind === "minGrade" || node.kind === "corequisite") && hasHourRequirement(node.requirement);
  }

  const closure = new Map<string, Reason>();
  const coverage = new Map<string, string>();
  const visitedRequirements = new Set<string>();
  const expanded = new Set<string>();
  const queue = [...completed.keys()].sort(compareIds);
  function containsCorequisite(node: Prerequisite): boolean {
    if (node.kind === "corequisite") return true;
    if (node.kind === "and" || node.kind === "or") return node.children.some(containsCorequisite);
    return node.kind === "minGrade" && containsCorequisite(node.requirement);
  }
  /** `root` is the passed course whose prerequisite walk reached this node. */
  function add(node: Prerequisite, witness: Reason, root: string) {
    if (node.escape) return;
    if (node.kind === "and" && node.children.length === 0) return;
    const key = requirementKey(node);
    if (visitedRequirements.has(key)) return;
    visitedRequirements.add(key);
    if (canSupplyClosure(node) && !containsCorequisite(node) && !hasHourRequirement(node)) {
      closure.set(key, witness);
    }
    // An OR witnesses its entire expression; it does not identify a passed branch.
    if (node.kind === "and") for (const child of node.children) add(child, witness, root);
    if (node.kind === "course") {
      const override = evidence.overrides?.get(node.courseId);
      const hasUnresolvedEvidence = (recordedGrades.has(node.courseId) || uncertain.has(node.courseId)) && !completed.has(node.courseId);
      if ((!override || override.status === "done") && !hasUnresolvedEvidence) {
        queue.push(node.courseId);
        // Covered: closure proves it and nothing contradicts it, but there is no credit of its own.
        if (closure.has(key) && !completed.has(node.courseId) && !coverage.has(node.courseId)) coverage.set(node.courseId, root);
      }
    }
    if (node.kind === "minGrade") {
      const requirement = node.requirement;
      if (requirement.kind === "and") {
        for (const child of requirement.children) add({ kind: "minGrade", grade: node.grade, requirement: child, source: node.source }, witness, root);
      }
      if (requirement.kind === "minGrade") {
        add({ kind: "minGrade", grade: node.grade, requirement: requirement.requirement, source: node.source }, witness, root);
      }
      if (requirement.kind === "course" || requirement.kind === "or" || requirement.kind === "minGrade") add(requirement, witness, root);
    }
    // A co-requisite could have been concurrent, so it cannot imply completion.
  }
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (expanded.has(id)) continue;
    expanded.add(id);
    const prerequisite = byId.get(id)?.prerequisite;
    if (!prerequisite || hasUnscopedEscape(prerequisite)) continue;
    const parent = completed.get(id)?.reason ?? closure.get(requirementKey({ kind: "course", courseId: id, source: "" }));
    if (!parent) continue;
    add(prerequisite, {
      kind: "closure", outcome: "satisfied", courseId: id, source: prerequisite.source,
      message: `${id} implies its prerequisite requirement was satisfied; no credit is inferred.`, children: [parent],
    }, completed.has(id) ? id : coverage.get(id) ?? id);
  }

  function courseEvidence(id: string, minimum?: string, concurrent = false): Reason {
    const override = evidence.overrides?.get(id);
    if (override && override.status !== "done" && !(concurrent && override.status === "taking")) {
      return { kind: "override", outcome: override.status === "unknown" ? "unknown" : "unmet", courseId: id, message: override.reason };
    }
    const credit = completed.get(id);
    if (credit) {
      if (minimum === undefined) return { kind: "course", outcome: "satisfied", courseId: id, message: `${id} has completed credit.`, children: [credit.reason] };
      const checks = credit.grades.map(grade => adapter.meetsMinimumGrade(grade, minimum));
      const outcome = checks.includes(true) ? "satisfied" : checks.length === 0 || checks.includes(undefined) || (concurrent && (taking.has(id) || planned.has(id))) ? "unknown" : "unmet";
      return { kind: "grade", outcome, courseId: id, message: `${id} requires ${minimum} or better; recorded grades: ${credit.grades.join(", ") || "none"}.`, children: [credit.reason] };
    }
    const grades = recordedGrades.get(id);
    if (minimum !== undefined && grades) {
      const checks = grades.map(grade => adapter.meetsMinimumGrade(grade, minimum));
      return { kind: "grade", outcome: uncertain.has(id) || checks.includes(undefined) || (concurrent && (taking.has(id) || planned.has(id))) ? "unknown" : "unmet", courseId: id,
        message: `${id} requires ${minimum} or better; recorded grades: ${grades.join(", ")}.` };
    }
    if (concurrent && (taking.has(id) || planned.has(id)) && minimum === undefined) {
      return { kind: "corequisite", outcome: "satisfied", courseId: id, message: `${id} is ${taking.has(id) ? "in progress" : "planned"}.` };
    }
    return { kind: minimum !== undefined ? "grade" : "course", outcome: uncertain.has(id) || (concurrent && (taking.has(id) || planned.has(id))) ? "unknown" : "unmet", courseId: id,
      message: minimum !== undefined ? `No completed grade of ${minimum} or better is known for ${id}.` : `No passing completion is known for ${id}.` };
  }

  function evaluate(node: Prerequisite, minimum?: string, concurrent = false): Reason {
    let result: Reason;
    switch (node.kind) {
      case "course": result = courseEvidence(node.courseId, minimum, concurrent); break;
      case "and": case "or": result = combine(node.kind, node.children.map(child => evaluate(child, minimum, concurrent)), node.source); break;
      case "minGrade": return minimum === undefined ? evaluate(node.requirement, node.grade, concurrent)
        : combine("and", [evaluate(node.requirement, node.grade, concurrent), evaluate(node.requirement, minimum, concurrent)], node.source);
      case "corequisite": result = { ...combine("and", [evaluate(node.requirement, minimum, true)], node.source), kind: "corequisite" }; break;
      case "standing": {
        const check = evidence.standing === undefined ? undefined : adapter.meetsStanding(evidence.standing, node.minimum);
        const hours = minimumHours(node.minimum);
        const outcome = check === false ? "unmet" : hours !== undefined
          ? earnedHours === undefined ? "unknown" : earnedHours >= hours ? "satisfied" : "unmet"
          : check === undefined ? "unknown" : check ? "satisfied" : "unmet";
        result = { kind: "standing", outcome, source: node.source, message: hours !== undefined
          ? `${earnedHours === undefined ? "Check with advisor: " : ""}requires ${hours} earned hours for ${node.minimum}; known hours: ${earnedHours ?? "unknown"}; recorded standing: ${evidence.standing ?? "unknown"}.`
          : `Requires ${node.minimum} standing; recorded standing: ${evidence.standing ?? "unknown"}.` };
        break;
      }
      case "consent": case "unknown": return { kind: "advisor", outcome: "unknown", source: node.source, message: `Check with advisor: ${node.source}` };
    }
    const effectiveNode: Prerequisite = minimum !== undefined ? { kind: "minGrade", grade: minimum, requirement: node, source: node.source } : node;
    const witness = closure.get(requirementKey(effectiveNode));
    const blockedByOverride = courseReferences(node).some(id => {
      const override = evidence.overrides?.get(id);
      return override && override.status !== "done";
    });
    // Direct grades and explicit overrides outweigh an inference from enrollment history.
    function hasRecordedGrade(requirement: Prerequisite, threshold = minimum): boolean {
      switch (requirement.kind) {
        case "course": return threshold !== undefined && completed.has(requirement.courseId);
        case "minGrade": return hasRecordedGrade(requirement.requirement, requirement.grade);
        case "corequisite": return hasRecordedGrade(requirement.requirement, threshold);
        case "and": case "or": return requirement.children.some(child => hasRecordedGrade(child, threshold));
        default: return false;
      }
    }
    const hasDirectGrade = hasRecordedGrade(node);
    const hasUnresolvedEvidence = courseReferences(node).some(id => (recordedGrades.has(id) || uncertain.has(id)) && !completed.has(id));
    function hasStanding(requirement: Prerequisite): boolean {
      if (requirement.kind === "standing") return true;
      if (requirement.kind === "and" || requirement.kind === "or") return requirement.children.some(hasStanding);
      return (requirement.kind === "minGrade" || requirement.kind === "corequisite") && hasStanding(requirement.requirement);
    }
    const hasExplicitStanding = evidence.standing !== undefined && hasStanding(node);
    if (witness && !blockedByOverride && !hasDirectGrade && !hasUnresolvedEvidence && !hasExplicitStanding && !requiresAdvisor(node) && !hasHourRequirement(node)) return witness;
    return result;
  }

  const cycles = detectCycles(catalog);
  const cycleIds = new Set(cycles.flat());
  const statuses = new Map<string, CourseAssessment>();
  for (const course of ordered) {
    const override = evidence.overrides?.get(course.id);
    if (override) {
      statuses.set(course.id, { courseId: course.id, status: override.status,
        reason: { kind: "override", outcome: override.status === "unknown" ? "unknown" : override.status === "locked" ? "unmet" : "satisfied", message: override.reason, courseId: course.id } });
      continue;
    }
    const credit = completed.get(course.id);
    if (credit) { statuses.set(course.id, { courseId: course.id, status: "done", reason: credit.reason }); continue; }
    if (taking.has(course.id)) {
      statuses.set(course.id, { courseId: course.id, status: "taking", reason: { kind: "inProgress", outcome: "satisfied", courseId: course.id, message: "Course is in progress." } });
      continue;
    }
    let reason = evaluate(course.prerequisite);
    if (reason.outcome !== "satisfied" && requiresAdvisor(course.prerequisite)) reason = { kind: "advisor", outcome: "unknown", source: course.prerequisite.source, message: "Check with advisor: catalog includes consent or unparsed requirements.", children: [reason] };
    if (reason.outcome !== "satisfied" && cycleIds.has(course.id)) {
      reason = { kind: "cycle", outcome: "unknown", message: "Prerequisite cycle needs review.", courseId: course.id, children: [reason] };
    }
    if (uncertain.has(course.id)) reason = { kind: "advisor", outcome: "unknown", message: "Check with advisor: transcript grade is unrecognized.", children: [reason] };
    const status = reason.outcome === "satisfied" ? "eligible" : reason.outcome === "unmet" ? "locked" : "unknown";
    statuses.set(course.id, { courseId: course.id, status, reason });
  }
  return { catalog: ordered, statuses, cycles, coverage };
}
