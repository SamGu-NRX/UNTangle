import type { Citation, CourseScope, DegreeData, PolicyNode, PoolNode, ProgramData, RequirementNode } from "./types";

/**
 * The pure audit engine: given a completed-course record and a program's
 * requirement tree, walks the tracked nodes and reports what is satisfied,
 * in progress, or unresolvable. It never guesses: nodes it cannot verify
 * (advisory pools, prose-only notes) come back as untracked findings with
 * their citation, and policy checks that need data the record lacks (UNT
 * residence splits, unknown credits) are reported as unverifiable.
 */

export type AuditCourse = {
  code: string;
  grade: string | null;
  credits: number | null;
  sourceKind: "unt" | "transfer" | "exam" | "current" | "unknown";
  inProgress: boolean;
};

export type NodeOutcome = {
  name: string;
  status: "satisfied" | "inProgress" | "unsatisfied" | "advisory";
  detail: string;
  citation: Citation;
};

export type PolicyOutcome = {
  name: string;
  status: "satisfied" | "unsatisfied" | "unverifiable";
  detail: string;
  citation: Citation;
};

type Branch = { name: string; node: RequirementNode };

/**
 * Shared allocation state for programs whose catalog rule counts each course
 * toward one area only (the core's double-dip rule). Nodes consume completed
 * courses from `used` in tree order, so a course claimed by an earlier node
 * cannot satisfy a later one. Slot nodes (all) keep independent per-slot
 * matching: the core tree has none, and programs that do use slots do not
 * allocate.
 */
type Allocation = { used: Set<string> };

export type AuditResult = {
  programId: string;
  programName: string;
  requirements: NodeOutcome[];
  policies: PolicyOutcome[];
  coreSharedCourses: string[];
  summary: {
    satisfied: number;
    inProgress: number;
    unsatisfied: number;
    advisory: number;
    unverifiablePolicies: number;
  };
};

const GRADE_POINTS: Record<string, number> = {
  "A+": 4, A: 4, "A-": 3.7,
  "B+": 3.3, B: 3, "B-": 2.7,
  "C+": 2.3, C: 2, "C-": 1.7,
  "D+": 1.3, D: 1, "D-": 0.7,
  F: 0,
};

/** Grades at or above a floor like "C" on the catalog's letter scale. */
function gradeMeetsFloor(grade: string | null, floor: string): boolean {
  if (grade === null) return false;
  // Ordered weakest to strongest, matching GRADE_POINTS: each plus-grade sits
  // above its letter, each minus-grade below it.
  const order = ["F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
  const gradeIndex = order.indexOf(grade);
  const floorIndex = order.indexOf(floor);
  if (gradeIndex === -1 || floorIndex === -1) return false;
  return gradeIndex >= floorIndex;
}

function levelOf(code: string): number {
  const match = /\s(\d{4})$/.exec(code);
  return match ? Number(match[1]) : 0;
}

function subjectOf(code: string): string {
  return code.split(/\s+/)[0] ?? "";
}

/** Greedy bipartite matching: cover as many distinct options with distinct courses. */
function maxCovered(options: { must: string[] }[], completed: Set<string>, inProgress: Set<string>, limit = Infinity): { covered: number; satisfiedAll: boolean[]; usedCodes: string[] } {
  const used = new Set<string>();
  const satisfiedAll = options.map((option) => option.must.every((code) => completed.has(code) || inProgress.has(code)));
  const order = options
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => option.must.every((code) => completed.has(code)))
    .sort((a, b) => a.option.must.length - b.option.must.length);
  let covered = 0;
  for (const { option } of order) {
    if (covered >= limit) break;
    if (option.must.every((code) => !used.has(code))) {
      option.must.forEach((code) => used.add(code));
      covered += 1;
    }
  }
  return { covered, satisfiedAll, usedCodes: [...used] };
}

/** Completed courses matching a pool's subject/level rule. */
function matchingCourses(node: PoolNode, completed: Set<string>): string[] {
  return [...completed].filter((code) => {
    if (node.match.subjects === null || !node.match.subjects.includes(subjectOf(code))) return false;
    const level = levelOf(code);
    if (node.match.minLevel !== null && level < node.match.minLevel) return false;
    if (node.match.maxLevel !== null && level > node.match.maxLevel) return false;
    return true;
  });
}

function evaluate(node: RequirementNode, completed: Set<string>, inProgress: Set<string>, creditsByCode: Map<string, number>, allocation: Allocation | null = null, applied: Set<string> = new Set()): NodeOutcome {
  const cite = node.citation;
  switch (node.kind) {
    case "all": {
      const slotStates = node.items.map((slot) => {
        const hit = slot.alternatives.find((option) => option.must.every((code) => completed.has(code)));
        if (hit) {
          hit.must.forEach((code) => applied.add(code));
          return { state: "satisfied", option: hit };
        }
        // An option whose courses are all completed or in progress, with at
        // least one still in progress, is under way: a completed lecture
        // with an in-progress lab is progress, not a miss.
        const pending = slot.alternatives.find(
          (option) => option.must.every((code) => completed.has(code) || inProgress.has(code)) && option.must.some((code) => inProgress.has(code)),
        );
        if (pending) {
          pending.must.forEach((code) => applied.add(code));
          return { state: "inProgress", option: pending };
        }
        return { state: "unsatisfied", option: null };
      });
      const satisfied = slotStates.filter((slot) => slot.state === "satisfied").length;
      const progress = slotStates.filter((slot) => slot.state === "inProgress").length;
      const detail = `${satisfied}/${slotStates.length} slots satisfied${progress > 0 ? `, ${progress} in progress` : ""}`;
      return {
        name: node.name,
        status: satisfied === slotStates.length ? "satisfied" : progress > 0 ? "inProgress" : "unsatisfied",
        detail,
        citation: cite,
      };
    }
    case "choose": {
      if (allocation) {
        // Same disjoint coverage as maxCovered, but each taken option claims
        // its courses in the shared allocation so later nodes cannot reuse
        // them, and coverage only counts courses no earlier node took.
        const freeCompleted = new Set([...completed].filter((code) => !allocation.used.has(code)));
        const freePlanned = new Set([...freeCompleted, ...[...inProgress].filter((code) => !allocation.used.has(code))]);
        const order = node.options
          .filter((option) => option.must.every((code) => freeCompleted.has(code)))
          .sort((a, b) => a.must.length - b.must.length);
        let taken = 0;
        for (const option of order) {
          if (taken >= node.count) break;
          option.must.forEach((code) => allocation.used.add(code));
          option.must.forEach((code) => applied.add(code));
          taken += 1;
        }
        const possible = maxCovered(node.options, freePlanned, new Set()).covered;
        const status = taken >= node.count ? "satisfied" : possible >= node.count ? "inProgress" : "unsatisfied";
        return { name: node.name, status, detail: `${Math.min(taken, node.count)}/${node.count} chosen`, citation: cite };
      }
      // Only the options the choice actually uses count toward grade floors:
      // the unused alternatives are not dragged in.
      const { covered, usedCodes } = maxCovered(node.options, completed, inProgress, node.count);
      usedCodes.forEach((code) => applied.add(code));
      const possible = maxCovered(node.options, new Set([...completed, ...inProgress]), new Set(), node.count).covered;
      const status = covered >= node.count ? "satisfied" : possible >= node.count ? "inProgress" : "unsatisfied";
      return { name: node.name, status, detail: `${Math.min(covered, node.count)}/${node.count} chosen`, citation: cite };
    }
    case "hours": {
      if (allocation) {
        // Options in listed order form a prefix: each option whose courses are
        // all completed and unclaimed is taken (and claims them) until the
        // hours are met. A course claimed here cannot satisfy a later node,
        // which is how the catalog's double-dip rule behaves. A planned pass
        // over completed plus in-progress rows reports hours a live term
        // already reaches.
        let plannedCredits = 0;
        for (const option of node.options) {
          if (plannedCredits >= node.hours) break;
          if (!option.must.every((code) => (completed.has(code) || inProgress.has(code)) && !allocation.used.has(code))) continue;
          for (const code of option.must) {
            const value = creditsByCode.get(code);
            if (value !== undefined) plannedCredits += value;
          }
        }
        let courses = 0;
        let credits = 0;
        let unknownCredits = false;
        for (const option of node.options) {
          if (credits >= node.hours) break;
          if (!option.must.every((code) => completed.has(code) && !allocation.used.has(code))) continue;
          option.must.forEach((code) => allocation.used.add(code));
          option.must.forEach((code) => applied.add(code));
          courses += 1;
          for (const code of option.must) {
            const value = creditsByCode.get(code);
            if (value === undefined) unknownCredits = true;
            else credits += value;
          }
        }
        const detail = `${courses} course${courses === 1 ? "" : "s"}, ${credits}/${node.hours} hours${unknownCredits ? " (some credit hours unknown)" : ""}${plannedCredits > credits ? `, ${plannedCredits} planned` : ""}`;
        const status = credits >= node.hours ? "satisfied" : plannedCredits >= node.hours ? "inProgress" : courses > 0 ? "inProgress" : "unsatisfied";
        return { name: node.name, status, detail, citation: cite };
      }
      const { covered, usedCodes } = maxCovered(node.options, completed, inProgress);
      usedCodes.forEach((code) => applied.add(code));
      // Planned coverage walks the options in catalog order over completed
      // plus in-progress rows, so a term still under way can already reach
      // the hours.
      let plannedTotal = 0;
      for (const option of node.options) {
        if (plannedTotal >= node.hours) break;
        if (!option.must.every((code) => completed.has(code) || inProgress.has(code))) continue;
        for (const code of option.must) {
          const value = creditsByCode.get(code);
          if (value !== undefined) plannedTotal += value;
        }
      }
      let total = 0;
      let unknownCredits = false;
      for (const code of usedCodes) {
        const value = creditsByCode.get(code);
        if (value === undefined) unknownCredits = true;
        else total += value;
      }
      const detail = `${covered} course${covered === 1 ? "" : "s"}, ${total}/${node.hours} hours${unknownCredits ? " (some credit hours unknown)" : ""}${plannedTotal > total ? `, ${plannedTotal} planned` : ""}`;
      const status = total >= node.hours ? "satisfied" : plannedTotal >= node.hours ? "inProgress" : covered > 0 ? "inProgress" : "unsatisfied";
      return { name: node.name, status, detail, citation: cite };
    }
    case "pool": {
      const matching = matchingCourses(node, completed);
      matching.forEach((code) => applied.add(code));
      const total = matching.length * 3;
      return {
        name: node.name,
        status: "advisory",
        detail: `${node.note ?? "Advisory pool: the catalog's authoritative list is not captured."} Completed courses matching the subject/level rule: ${matching.length > 0 ? matching.join(", ") : "none"} (~${total} hours of ${node.hours}). Verify against the catalog list.`,
        citation: cite,
      };
    }
    case "choice": {
      if (allocation) {
        // Branches try in order against the live allocation: the first
        // satisfied branch keeps its consumption, later branches roll back so
        // an unsatisfied attempt releases its courses to the next branch, and
        // the first in-progress branch (re-evaluated so its partial claims
        // stand) is the fallback when nothing satisfies.
        let satisfied: { branch: Branch; outcome: NodeOutcome } | null = null;
        let pending: { branch: Branch; outcome: NodeOutcome } | null = null;
        let advisory: { branch: Branch; outcome: NodeOutcome } | null = null;
        for (const branch of node.branches) {
          const usedSnapshot = new Set(allocation.used);
          const appliedSnapshot = new Set(applied);
          const outcome = evaluate(branch.node, completed, inProgress, creditsByCode, allocation, applied);
          if (outcome.status === "satisfied") {
            satisfied = { branch, outcome };
            break;
          }
          if (outcome.status === "inProgress" && pending === null) pending = { branch, outcome };
          if (outcome.status === "advisory" && advisory === null) advisory = { branch, outcome };
          allocation.used = usedSnapshot;
          applied.clear();
          appliedSnapshot.forEach((code) => applied.add(code));
        }
        if (satisfied) return { ...satisfied.outcome, name: `${node.name} — ${satisfied.branch.name}`, citation: cite };
        if (pending) {
          const outcome = evaluate(pending.branch.node, completed, inProgress, creditsByCode, allocation, applied);
          return { ...outcome, name: `${node.name} — ${pending.branch.name}`, citation: cite };
        }
        // An advisory best branch (a proficiency note, say) is reported as
        // advisory, not as an unsatisfied requirement.
        if (advisory) return { ...advisory.outcome, name: `${node.name} — ${advisory.branch.name}`, citation: cite };
        const first = node.branches[0];
        const outcome = evaluate(first.node, completed, inProgress, creditsByCode, allocation, applied);
        return {
          name: `${node.name} — ${first.name}`,
          status: "unsatisfied",
          detail: `No branch satisfied. First branch: ${outcome.detail}`,
          citation: cite,
        };
      }
      const results = node.branches.map((branch) => {
        // Each branch evaluates against a scratch applied set; only the
        // chosen branch's courses count toward grade floors.
        const scratch = new Set(applied);
        const outcome = evaluate(branch.node, completed, inProgress, creditsByCode, allocation, scratch);
        return { branch, outcome, scratch };
      });
      const chosen = results.find((result) => result.outcome.status === "satisfied")
        ?? results.find((result) => result.outcome.status === "inProgress");
      if (chosen) {
        applied.clear();
        chosen.scratch.forEach((code) => applied.add(code));
        return { ...chosen.outcome, name: `${node.name} — ${chosen.branch.name}`, citation: cite };
      }
      const best = results.find((result) => result.outcome.status !== "unsatisfied") ?? results[0];
      if (best.outcome.status === "advisory") {
        return { ...best.outcome, name: `${node.name} — ${best.branch.name}`, citation: cite };
      }
      return {
        name: `${node.name} — ${best.branch.name}`,
        status: "unsatisfied",
        detail: `No branch satisfied. First branch: ${best.outcome.detail}`,
        citation: cite,
      };
    }
    case "group": {
      const results = node.children.map((child) => evaluate(child, completed, inProgress, creditsByCode, allocation, applied));
      const satisfied = results.filter((result) => result.status === "satisfied").length;
      const progress = results.filter((result) => result.status === "inProgress").length;
      // Notes and advisory pools cannot fail a group; only unsatisfied
      // checkable parts do.
      const unsatisfied = results.filter((result) => result.status === "unsatisfied").length;
      return {
        name: node.name,
        status: unsatisfied > 0 ? "unsatisfied" : progress > 0 ? "inProgress" : "satisfied",
        detail: `${satisfied}/${results.length} parts satisfied${progress > 0 ? `, ${progress} in progress` : ""}`,
        citation: cite,
      };
    }
    case "policy":
    case "note":
      return { name: node.name, status: "advisory", detail: node.kind === "policy" ? node.quote : node.text, citation: cite };
  }
}

type ScopeContext = { applied: Set<string>; poolMatches: Set<string> };

/**
 * The completed courses a grade or GPA policy applies to, from the typed
 * scope ingest parsed out of the catalog's wording. Returns null when no
 * filter resolves: the audit reports unverifiable rather than guessing a
 * scope. Hand-written trees may still carry the three universal scopes as
 * plain strings.
 */
function scopedCourses(p: { scope: string; courseScope?: CourseScope }, courses: AuditCourse[], context: ScopeContext): AuditCourse[] | null {
  const completed = courses.filter((course) => !course.inProgress);
  if (p.courseScope) {
    const scope = p.courseScope;
    switch (scope.kind) {
      case "overall":
        return completed;
      case "unt":
        return completed.filter((course) => course.sourceKind === "unt");
      case "major":
        return completed.filter((course) => context.applied.has(course.code) || context.poolMatches.has(course.code));
      case "codes":
        return completed.filter((course) => scope.codes.includes(course.code));
      case "subjectLevel":
        return completed.filter((course) => scope.subjects.includes(subjectOf(course.code)) && (scope.minLevel === null || levelOf(course.code) >= scope.minLevel));
    }
  }
  if (p.scope === "overall") return completed;
  if (p.scope === "unt") return completed.filter((course) => course.sourceKind === "unt");
  if (p.scope === "all courses required in the major") {
    return completed.filter((course) => context.applied.has(course.code) || context.poolMatches.has(course.code));
  }
  return null;
}

function evaluatePolicy(policy: PolicyNode, courses: AuditCourse[], context: ScopeContext): PolicyOutcome {
  const detail: PolicyOutcome = { name: policy.name, status: "unverifiable", detail: policy.quote, citation: policy.citation };
  const completed = courses.filter((course) => !course.inProgress);
  const sum = (list: AuditCourse[]): number | null => {
    let total = 0;
    for (const course of list) {
      if (course.credits === null) return null;
      total += course.credits;
    }
    return total;
  };
  const gpa = (list: AuditCourse[]): number | null => {
    let points = 0;
    let count = 0;
    for (const course of list) {
      if (course.grade === null || course.credits === null) return null;
      const value = GRADE_POINTS[course.grade];
      if (value === undefined) return null;
      points += value * course.credits;
      count += course.credits;
    }
    return count === 0 ? null : points / count;
  };
  const p = policy.policy;
  switch (p.type) {
    case "totalHours": {
      const total = sum(completed);
      if (total === null) return { ...detail, detail: `${policy.quote} — completed hours include unknown credit values; cannot verify.` };
      const planned = sum(courses.filter((course) => course.inProgress)) ?? 0;
      return { ...detail, status: total >= p.hours ? "satisfied" : "unsatisfied", detail: `${total} completed hours of ${p.hours}${planned > 0 ? ` (${planned} in progress)` : ""}` };
    }
    case "advancedHours": {
      const advanced = completed.filter((course) => levelOf(course.code) >= 3000);
      const total = sum(advanced);
      if (total === null) return { ...detail, detail: `${policy.quote} — unknown credit values; cannot verify.` };
      return { ...detail, status: total >= p.hours ? "satisfied" : "unsatisfied", detail: `${total} advanced hours of ${p.hours}` };
    }
    case "advancedHoursAtUnt": {
      const unt = completed.filter((course) => course.sourceKind === "unt" && levelOf(course.code) >= 3000);
      const other = completed.filter((course) => course.sourceKind !== "unt" && levelOf(course.code) >= 3000);
      const total = sum(unt);
      if (total === null) return { ...detail, detail: `${policy.quote} — unknown credit values; cannot verify.` };
      return {
        ...detail,
        status: total >= p.hours ? "satisfied" : "unsatisfied",
        detail: `${total} advanced UNT hours of ${p.hours}${other.length > 0 ? `; ${other.length} advanced transfer/exam courses need advisor confirmation of residence credit` : ""}`,
      };
    }
    case "residencyPercent":
      return { ...detail, status: "unverifiable", detail: `${policy.quote} — the record does not split hours by institution; verify with an advisor.` };
    case "subjectHours": {
      const inSubject = completed.filter((course) => p.subjects.includes(subjectOf(course.code)));
      const total = sum(inSubject);
      if (total === null) return { ...detail, detail: `${policy.quote} — unknown credit values; cannot verify.` };
      return { ...detail, status: total >= p.hours ? "satisfied" : "unsatisfied", detail: `${total} hours in ${p.subjects.join("/")} of ${p.hours}` };
    }
    case "minGrade": {
      const scoped = scopedCourses(p, courses, context);
      if (scoped === null) {
        return { ...detail, detail: `${policy.quote} — the course scope (${p.scope}) cannot be resolved from the record; cannot verify.` };
      }
      if (scoped.length === 0) {
        return { ...detail, detail: `${policy.quote} — no completed courses in scope (${p.scope}); nothing to check.` };
      }
      // A grade the point table does not carry (credit, pass, in progress)
      // cannot be compared: the floor is unverifiable, not passed.
      const ungraded = scoped.filter((course) => course.grade === null || GRADE_POINTS[course.grade] === undefined);
      if (ungraded.length > 0) {
        return {
          ...detail,
          status: "unverifiable",
          detail: `${policy.quote} — ${ungraded.map((course) => `${course.code} (${course.grade ?? "no grade"})`).join(", ")} ${ungraded.length === 1 ? "has" : "have"} no letter grade; cannot verify.`,
        };
      }
      const failing = scoped.filter((course) => !gradeMeetsFloor(course.grade, p.grade));
      return failing.length === 0
        ? { ...detail, status: "satisfied", detail: `No completed course in scope (${p.scope}) falls below ${p.grade}.` }
        : { ...detail, status: "unsatisfied", detail: `Below ${p.grade}: ${failing.map((course) => `${course.code} (${course.grade ?? "no grade"})`).join(", ")}` };
    }
    case "gpa": {
      const list = scopedCourses(p, courses, context);
      if (list === null) {
        return { ...detail, detail: `${policy.quote} — the course scope (${p.scope}) cannot be resolved from the record; cannot verify.` };
      }
      const value = gpa(list);
      if (value === null) return { ...detail, detail: `${policy.quote} — grades or credits missing; cannot verify.` };
      return { ...detail, status: value >= p.minimum ? "satisfied" : "unsatisfied", detail: `${value.toFixed(2)} GPA of ${p.minimum.toFixed(1)} required (${list.length} courses)` };
    }
  }
  // The switch above covers every policy type; this fallback keeps the
  // return type honest if a new kind is added without a check.
  return detail;
}

/** Completed courses matching any advisory pool in the tree (major floor scopes). */
function collectPoolMatches(node: RequirementNode, completed: Set<string>, into: Set<string>): void {
  switch (node.kind) {
    case "pool": matchingCourses(node, completed).forEach((code) => into.add(code)); break;
    case "choice": node.branches.forEach((branch) => collectPoolMatches(branch.node, completed, into)); break;
    case "group": node.children.forEach((child) => collectPoolMatches(child, completed, into)); break;
    default: break;
  }
}

/** Every policy node in the tree, including ones nested in groups and choices. */
function collectPolicyNodes(node: RequirementNode, into: PolicyNode[]): void {
  if (node.kind === "policy") {
    into.push(node);
    return;
  }
  if (node.kind === "group") node.children.forEach((child) => collectPolicyNodes(child, into));
  if (node.kind === "choice") node.branches.forEach((branch) => collectPolicyNodes(branch.node, into));
}

export function auditProgram(program: ProgramData, courses: AuditCourse[]): AuditResult {
  const completed = new Set(courses.filter((course) => !course.inProgress).map((course) => course.code));
  const inProgress = new Set(courses.filter((course) => course.inProgress).map((course) => course.code));
  const creditsByCode = new Map<string, number>();
  for (const course of courses) {
    if (course.credits !== null) creditsByCode.set(course.code, course.credits);
  }
  const poolMatches = new Set<string>();
  for (const node of program.requirements) collectPoolMatches(node, completed, poolMatches);

  // One allocation shared across the tree: earlier nodes' claims are visible
  // to later ones (areas before the Component Area Option choice).
  const allocation: Allocation | null = program.oneCourseOneArea ? { used: new Set<string>() } : null;
  const applied = new Set<string>();
  const requirements = program.requirements.map((node) => evaluate(node, completed, inProgress, creditsByCode, allocation, applied));
  // Grade floors apply to courses the audit actually used: what satisfied a
  // slot, plus completed pool matches. Policies nested anywhere get outcomes,
  // and each appears once.
  const policyNodes: PolicyNode[] = [];
  for (const node of program.requirements) collectPolicyNodes(node, policyNodes);
  const context: ScopeContext = { applied, poolMatches };
  const policies = policyNodes.map((node) => evaluatePolicy(node, courses, context));

  const summary = {
    satisfied: requirements.filter((result) => result.status === "satisfied").length,
    inProgress: requirements.filter((result) => result.status === "inProgress").length,
    unsatisfied: requirements.filter((result) => result.status === "unsatisfied").length,
    advisory: requirements.filter((result) => result.status === "advisory").length,
    unverifiablePolicies: policies.filter((result) => result.status === "unverifiable").length,
  };
  return {
    programId: program.id,
    programName: program.name,
    requirements,
    policies,
    coreSharedCourses: program.coreSharedCourses,
    summary,
  };
}

export function loadDegreeData(json: unknown): DegreeData {
  return json as DegreeData;
}
