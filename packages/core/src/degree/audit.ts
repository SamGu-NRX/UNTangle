import type { Citation, DegreeData, ProgramData, RequirementNode } from "./types";

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
function maxCovered(options: { must: string[] }[], completed: Set<string>, inProgress: Set<string>): { covered: number; satisfiedAll: boolean[] } {
  const used = new Set<string>();
  const satisfiedAll = options.map((option) => option.must.every((code) => completed.has(code) || inProgress.has(code)));
  const order = options
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => option.must.every((code) => completed.has(code)))
    .sort((a, b) => a.option.must.length - b.option.must.length);
  let covered = 0;
  for (const { option } of order) {
    if (option.must.every((code) => !used.has(code))) {
      option.must.forEach((code) => used.add(code));
      covered += 1;
    }
  }
  return { covered, satisfiedAll };
}

function evaluate(node: RequirementNode, completed: Set<string>, inProgress: Set<string>, creditsByCode: Map<string, number>): NodeOutcome {
  const cite = node.citation;
  switch (node.kind) {
    case "all": {
      const slotStates = node.items.map((slot) => {
        const hit = slot.alternatives.find((option) => option.must.every((code) => completed.has(code)));
        if (hit) return { state: "satisfied", option: hit };
        const pending = slot.alternatives.find((option) => option.must.every((code) => inProgress.has(code)));
        if (pending) return { state: "inProgress", option: pending };
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
      const { covered } = maxCovered(node.options, completed, inProgress);
      const possible = maxCovered(node.options, completed, new Set([...completed, ...inProgress])).covered;
      const status = covered >= node.count ? "satisfied" : possible >= node.count ? "inProgress" : "unsatisfied";
      return { name: node.name, status, detail: `${Math.min(covered, node.count)}/${node.count} chosen`, citation: cite };
    }
    case "hours": {
      const { covered } = maxCovered(node.options, completed, inProgress);
      const satisfiedCodes = new Set<string>();
      for (const option of node.options) {
        if (option.must.every((code) => completed.has(code))) option.must.forEach((code) => satisfiedCodes.add(code));
      }
      let total = 0;
      let unknownCredits = false;
      for (const code of satisfiedCodes) {
        const value = creditsByCode.get(code);
        if (value === undefined) unknownCredits = true;
        else total += value;
      }
      const detail = `${covered} course${covered === 1 ? "" : "s"}, ${total}/${node.hours} hours${unknownCredits ? " (some credit hours unknown)" : ""}`;
      const status = total >= node.hours ? "satisfied" : covered > 0 ? "inProgress" : "unsatisfied";
      return { name: node.name, status, detail, citation: cite };
    }
    case "pool": {
      const matching = [...completed].filter((code) => {
        if (node.match.subjects === null || !node.match.subjects.includes(subjectOf(code))) return false;
        const level = levelOf(code);
        if (node.match.minLevel !== null && level < node.match.minLevel) return false;
        if (node.match.maxLevel !== null && level > node.match.maxLevel) return false;
        return true;
      });
      const total = matching.length * 3;
      return {
        name: node.name,
        status: "advisory",
        detail: `${node.note ?? "Advisory pool: the catalog's authoritative list is not captured."} Completed courses matching the subject/level rule: ${matching.length > 0 ? matching.join(", ") : "none"} (~${total} hours of ${node.hours}). Verify against the catalog list.`,
        citation: cite,
      };
    }
    case "choice": {
      const results = node.branches.map((branch) => ({ branch, outcome: evaluate(branch.node, completed, inProgress, creditsByCode) }));
      const chosen = results.find((result) => result.outcome.status === "satisfied")
        ?? results.find((result) => result.outcome.status === "inProgress");
      if (chosen) return { ...chosen.outcome, name: `${node.name} — ${chosen.branch.name}`, citation: cite };
      const best = results.find((result) => result.outcome.status !== "unsatisfied") ?? results[0];
      return {
        name: `${node.name} — ${best.branch.name}`,
        status: "unsatisfied",
        detail: `No branch satisfied. First branch: ${best.outcome.detail}`,
        citation: cite,
      };
    }
    case "group": {
      const results = node.children.map((child) => evaluate(child, completed, inProgress, creditsByCode));
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

function evaluatePolicy(policy: Extract<RequirementNode, { kind: "policy" }>, courses: AuditCourse[], nodeCodes: string[]): PolicyOutcome {
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
      if (course.grade === null) return null;
      const value = GRADE_POINTS[course.grade];
      if (value === undefined) return null;
      points += value * (course.credits ?? 3);
      count += course.credits ?? 3;
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
      if (p.scope === "all courses required in the major") {
        const failing = completed.filter((course) => nodeCodes.includes(course.code) && !gradeMeetsFloor(course.grade, p.grade));
        return failing.length === 0
          ? { ...detail, status: "satisfied", detail: `No completed major course falls below ${p.grade}.` }
          : { ...detail, status: "unsatisfied", detail: `Below ${p.grade}: ${failing.map((course) => `${course.code} (${course.grade ?? "no grade"})`).join(", ")}` };
      }
      const scoped = completed.filter((course) => nodeCodes.includes(course.code));
      const failing = scoped.filter((course) => !gradeMeetsFloor(course.grade, p.grade));
      return failing.length === 0
        ? { ...detail, status: "satisfied", detail: `No completed course in scope (${p.scope}) falls below ${p.grade}.` }
        : { ...detail, status: "unsatisfied", detail: `Below ${p.grade}: ${failing.map((course) => `${course.code} (${course.grade ?? "no grade"})`).join(", ")}` };
    }
    case "gpa": {
      const list = completed.filter((course) => {
        if (p.scope === "overall") return true;
        if (p.scope === "unt") return course.sourceKind === "unt";
        return nodeCodes.includes(course.code);
      });
      const value = gpa(list);
      if (value === null) return { ...detail, detail: `${policy.quote} — grades or credits missing; cannot verify.` };
      return { ...detail, status: value >= p.minimum ? "satisfied" : "unsatisfied", detail: `${value.toFixed(2)} GPA of ${p.minimum.toFixed(1)} required (${list.length} courses)` };
    }
  }
  // The switch above covers every policy type; this fallback keeps the
  // return type honest if a new kind is added without a check.
  return detail;
}

/** Course codes referenced by tracked requirement nodes (minGrade scopes). */
function collectCodes(node: RequirementNode, into: Set<string>): void {
  const grab = (options: { must: string[] }[]): void => options.forEach((option) => option.must.forEach((code) => into.add(code)));
  switch (node.kind) {
    case "all": node.items.forEach((slot) => grab(slot.alternatives)); break;
    case "choose":
    case "hours": grab(node.options); break;
    case "pool": break;
    case "choice": node.branches.forEach((branch) => collectCodes(branch.node, into)); break;
    case "group": node.children.forEach((child) => collectCodes(child, into)); break;
    default: break;
  }
}

export function auditProgram(program: ProgramData, courses: AuditCourse[]): AuditResult {
  const completed = new Set(courses.filter((course) => !course.inProgress).map((course) => course.code));
  const inProgress = new Set(courses.filter((course) => course.inProgress).map((course) => course.code));
  const creditsByCode = new Map<string, number>();
  for (const course of courses) {
    if (course.credits !== null) creditsByCode.set(course.code, course.credits);
  }
  const nodeCodes = new Set<string>();
  for (const node of program.requirements) collectCodes(node, nodeCodes);

  const requirements = program.requirements.map((node) => evaluate(node, completed, inProgress, creditsByCode));
  const policies = program.requirements
    .filter((node): node is Extract<RequirementNode, { kind: "policy" }> => node.kind === "policy")
    .map((node) => evaluatePolicy(node, courses, [...nodeCodes]));

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
