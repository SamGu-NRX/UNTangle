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

/**
 * Maximum disjoint-option coverage: the largest number of options that can
 * each take all their courses from `available`. Overlapping options make a
 * first-fit undercount (options {A,B},{A,C},{B,D} admit two disjoint picks
 * while greedy commits to one), so the search backtracks. Options are tried
 * in catalog order, include-first, keeping the reported set deterministic.
 */
function maxCovered(options: { must: string[] }[], available: Set<string>, limit = Infinity): { covered: number; usedCodes: string[] } {
  const candidates = options.filter((option) => option.must.every((code) => available.has(code)));
  let bestCodes: string[][] = [];
  const used = new Set<string>();
  const picked: string[][] = [];
  const walk = (start: number): void => {
    if (picked.length > bestCodes.length) bestCodes = picked.map((codes) => [...codes]);
    if (picked.length >= limit) return;
    for (let index = start; index < candidates.length; index += 1) {
      // No later candidate can grow a better answer from here.
      if (picked.length + (candidates.length - index) <= bestCodes.length) break;
      const option = candidates[index]!.must;
      if (option.some((code) => used.has(code))) continue;
      option.forEach((code) => used.add(code));
      picked.push(option);
      walk(index + 1);
      picked.pop();
      option.forEach((code) => used.delete(code));
    }
  };
  walk(0);
  return { covered: bestCodes.length, usedCodes: bestCodes.flat() };
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
        // Maximum disjoint coverage, but each taken option claims its courses
        // in the shared allocation so later nodes cannot reuse them, and
        // coverage only counts courses no earlier node took.
        const freeCompleted = new Set([...completed].filter((code) => !allocation.used.has(code)));
        const freePlanned = new Set([...freeCompleted, ...[...inProgress].filter((code) => !allocation.used.has(code))]);
        const { covered, usedCodes } = maxCovered(node.options, freeCompleted, node.count);
        usedCodes.forEach((code) => {
          allocation.used.add(code);
          applied.add(code);
        });
        const possible = maxCovered(node.options, freePlanned, node.count).covered;
        const status = covered >= node.count ? "satisfied" : possible > covered ? "inProgress" : "unsatisfied";
        return { name: node.name, status, detail: `${covered}/${node.count} chosen`, citation: cite };
      }
      // Only the options the choice actually uses count toward grade floors:
      // the unused alternatives are not dragged in.
      const { covered, usedCodes } = maxCovered(node.options, completed, node.count);
      usedCodes.forEach((code) => applied.add(code));
      const possible = maxCovered(node.options, new Set([...completed, ...inProgress]), node.count).covered;
      const status = covered >= node.count ? "satisfied" : possible > covered ? "inProgress" : "unsatisfied";
      return { name: node.name, status, detail: `${covered}/${node.count} chosen`, citation: cite };
    }
    case "hours": {
      if (allocation) {
        // Options in listed order form a prefix: each option whose courses are
        // all completed and unclaimed is taken (and claims them) until the
        // hours are met. A course claimed here cannot satisfy a later node,
        // which is how the catalog's double-dip rule behaves. When the node is
        // Each counted option claims its in-progress codes into the same
        // allocation, so a live course contributes planned hours to exactly one
        // area, and a node already satisfied by completed work claims nothing
        // further. The planned amount is reported whenever any live credit was
        // counted: completed and planned hours mix without hiding the live term.
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
        let plannedCredits = 0;
        let plannedUnknown = false;
        if (credits < node.hours) {
          for (const option of node.options) {
            if (plannedCredits >= node.hours - credits) break;
            if (!option.must.every((code) => (completed.has(code) || inProgress.has(code)) && !allocation.used.has(code))) continue;
            for (const code of option.must) {
              if (!inProgress.has(code)) continue;
              const value = creditsByCode.get(code);
              if (value === undefined) plannedUnknown = true;
              else plannedCredits += value;
              allocation.used.add(code);
            }
          }
        }
        const detail = `${courses} course${courses === 1 ? "" : "s"}, ${credits}/${node.hours} hours${unknownCredits ? " (some credit hours unknown)" : ""}${plannedCredits > 0 ? `, ${plannedCredits} planned` : ""}${plannedUnknown ? " (planned credit hours unknown)" : ""}`;
        const status = credits >= node.hours ? "satisfied" : plannedCredits > credits || plannedUnknown || courses > 0 ? "inProgress" : "unsatisfied";
        return { name: node.name, status, detail, citation: cite };
      }
      const { covered, usedCodes } = maxCovered(node.options, completed);
      usedCodes.forEach((code) => applied.add(code));
      // In-progress rows are reported as planned coverage: a term still under
      // way that already reaches the hours — or adds any hours at all — keeps
      // the node in progress instead of unsatisfied. Each counted option claims
      // its in-progress codes in a node-local set, so one live course cannot
      // contribute planned hours to two overlapping options.
      let total = 0;
      let unknownCredits = false;
      for (const code of usedCodes) {
        const value = creditsByCode.get(code);
        if (value === undefined) unknownCredits = true;
        else total += value;
      }
      // Planned coverage only fills a node the completed hours have not met —
      // a satisfied node reports no planned hours — and the detail exposes the
      // planned amount whenever any in-progress credit was counted, so a mix
      // of completed and planned hours does not hide the live term.
      let plannedTotal = 0;
      let plannedUnknown = false;
      const plannedUsed = new Set<string>();
      if (total < node.hours) {
        for (const option of node.options) {
          if (plannedTotal >= node.hours - total) break;
          if (!option.must.every((code) => (completed.has(code) || inProgress.has(code)) && !plannedUsed.has(code))) continue;
          for (const code of option.must) {
            if (!inProgress.has(code)) continue;
            const value = creditsByCode.get(code);
            if (value === undefined) plannedUnknown = true;
            else plannedTotal += value;
            plannedUsed.add(code);
          }
        }
      }
      const detail = `${covered} course${covered === 1 ? "" : "s"}, ${total}/${node.hours} hours${unknownCredits ? " (some credit hours unknown)" : ""}${plannedTotal > 0 ? `, ${plannedTotal} planned` : ""}${plannedUnknown ? " (planned credit hours unknown)" : ""}`;
      const status = total >= node.hours ? "satisfied" : plannedTotal > total || plannedUnknown || covered > 0 ? "inProgress" : "unsatisfied";
      return { name: node.name, status, detail, citation: cite };
    }
    case "pool": {
      // Matches stay on this advisory node: the pool's subject/level rule is
      // the audit's approximation of a list the capture did not record, so
      // its courses never confirm major coursework in any policy scope.
      const matching = matchingCourses(node, completed);
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

type ScopeContext = { applied: Set<string> };

/** The courses from `list` a typed scope admits. */
function coursesInScope(scope: CourseScope, list: AuditCourse[], context: ScopeContext): AuditCourse[] {
  switch (scope.kind) {
    case "overall":
      return list;
    case "unt":
      return list.filter((course) => course.sourceKind === "unt");
    case "major":
      return list.filter((course) => context.applied.has(course.code));
    case "codes":
      return list.filter((course) => scope.codes.includes(course.code));
    case "subjectLevel":
      return list.filter((course) => scope.subjects.includes(subjectOf(course.code)) && (scope.minLevel === null || levelOf(course.code) >= scope.minLevel));
  }
}

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
    return coursesInScope(p.courseScope, completed, context);
  }
  if (p.scope === "overall") return completed;
  if (p.scope === "unt") return completed.filter((course) => course.sourceKind === "unt");
  if (p.scope === "all courses required in the major") {
    return completed.filter((course) => context.applied.has(course.code));
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
      // An optional course scope narrows both sums to the policy's own course
      // set: the core's 42-hour total counts core coursework, not the whole
      // record. Unscoped totals still read every completed transcript course.
      const inScope = p.courseScope ? coursesInScope(p.courseScope, courses, context) : courses;
      const total = sum(inScope.filter((course) => !course.inProgress));
      if (total === null) return { ...detail, detail: `${policy.quote} — completed hours include unknown credit values; cannot verify.` };
      const planned = sum(inScope.filter((course) => course.inProgress)) ?? 0;
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
      // A policy may narrow the count to coursework its scope admits: the
      // mathematics degree's hours total counts the mathematics courses the
      // audit confirmed toward the major, not every MATH/STAT course on the
      // record.
      const bySubject = completed.filter((course) => p.subjects.includes(subjectOf(course.code)));
      const inScope = p.courseScope ? coursesInScope(p.courseScope, bySubject, context) : bySubject;
      const total = sum(inScope);
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
  const applied = new Set<string>();
  const allocation: Allocation | null = program.oneCourseOneArea ? { used: new Set<string>() } : null;
  const requirements = program.requirements.map((node) => evaluate(node, completed, inProgress, creditsByCode, allocation, applied));
  // Grade floors and scoped hour totals apply to the coursework the audit
  // confirmed: courses that satisfied captured requirements. Advisory pool
  // matches are approximations whose authoritative lists were not captured;
  // they inform their own advisory nodes and never confirm major coursework.
  // Policies nested anywhere get outcomes, and each appears once.
  const policyNodes: PolicyNode[] = [];
  for (const node of program.requirements) collectPolicyNodes(node, policyNodes);
  const context: ScopeContext = { applied };
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
