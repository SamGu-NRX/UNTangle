import type { Citation, CourseScope, CourseSlot, OptionGroup, PolicyNode, PoolNode, ProgramData, RequirementNode } from "./types";

/**
 * The pure audit engine: given a student's course attempts and a program's
 * requirement tree, reports what is satisfied, in progress, unsatisfied, or
 * left to an advisor. It never guesses: nodes it cannot verify (advisory
 * pools, prose notes, unknown credit values) come back advisory with their
 * citation, and policy checks that need data the record lacks are reported
 * unverifiable.
 *
 * Each course counts toward at most one requirement node in a program. Nodes
 * claim courses in tree order, so a course an earlier node used cannot fill a
 * later one: the core's double-dip rule, and within a major, CE's required
 * CSCE 3610 cannot also be a VLSI specialization course. Advisory pools read
 * what is left after every tracked node has claimed its courses.
 *
 * Statuses mean the same thing for every node kind:
 * - satisfied: met by finished, credit-earning courses;
 * - inProgress: not met yet, but met once every in-progress course earns credit;
 * - advisory: the audit cannot decide, and an advisor must;
 * - unsatisfied: not met even counting in-progress courses.
 * The tree is evaluated twice, once over finished courses and once adding
 * in-progress ones, so "in progress" is always that second evaluation's
 * verdict rather than a per-kind rule.
 */

/** One attempt at a course. A record may hold several attempts at the same code. */
export type AuditCourse = {
  code: string;
  /** The transcript grade; null when the row carries none. */
  grade: string | null;
  /**
   * Credit hours. For a finished passing attempt these are the hours earned;
   * a GPA also needs them as the hours attempted, so an F must carry its
   * attempted hours here or its GPA weight is unknown.
   */
  credits: number | null;
  sourceKind: "unt" | "transfer" | "exam" | "current" | "unknown";
  inProgress: boolean;
  /** Chronological rank of the attempt's term: a larger rank is a later term. */
  term: number;
};

export type AuditOptions = {
  /**
   * True only when the attempts include every graded attempt on the student's
   * transcript, failed and withdrawn ones too. A GPA computed from a subset
   * is not the student's GPA, so GPA checks report unverifiable without it.
   */
  gradeHistoryComplete: boolean;
};

export type NodeOutcome = {
  name: string;
  kind: RequirementNode["kind"];
  status: "satisfied" | "inProgress" | "unsatisfied" | "advisory";
  detail: string;
  citation: Citation;
  /** A group's parts, or the parts of the branch a choice settled on. */
  children?: NodeOutcome[];
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

/**
 * UNT's grade points. The importer reads UNT transcript rows with only these
 * letters (frontend/src/lib/transcript-import.ts, transcriptRowPattern): UNT
 * grades carry no plus or minus, so a "B+" on a row is not on this scale.
 */
const GRADE_POINTS: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
const LETTER_ORDER = ["F", "D", "C", "B", "A"];
/** Grades that earn no credit: failed, withdrawn, incomplete, no pass, and the importer's zero-credit duplicate marker. */
const NO_CREDIT_GRADES = new Set(["F", "W", "I", "NP", "Z"]);
/** Grades that earn credit without grade points. */
const CREDIT_ONLY_GRADES = new Set(["P", "CR"]);

function levelOf(code: string): number {
  const match = /\s(\d{4})$/.exec(code);
  return match ? Number(match[1]) : 0;
}

function subjectOf(code: string): string {
  return code.split(/\s+/)[0] ?? "";
}

/**
 * Whether a finished attempt earned credit: every grade but F, W, I, NP and
 * Z does. The caller passes only rows the importer or the student judged
 * finished, so a grade off UNT's scale or a missing one still counts as
 * credit here; the grade floors and the GPA flag what they cannot read.
 */
function earnsCredit(attempt: AuditCourse): boolean {
  return !attempt.inProgress && !(attempt.grade !== null && NO_CREDIT_GRADES.has(attempt.grade));
}

/** What the record shows for one course code. */
type CourseEvidence = {
  code: string;
  /** The latest finished attempt that earned credit. */
  credit: AuditCourse | null;
  /** The latest in-progress attempt. */
  current: AuditCourse | null;
  /** Every attempt, oldest first. */
  attempts: AuditCourse[];
};

/**
 * Groups attempts by code. A completed attempt stays completed when a later
 * retake is in progress: the retake can only add, so the course is credited
 * now and the retake is not counted again.
 */
function collectEvidence(courses: AuditCourse[]): Map<string, CourseEvidence> {
  const byCode = new Map<string, CourseEvidence>();
  const ordered = courses.map((course, index) => ({ course, index })).sort((a, b) => a.course.term - b.course.term || a.index - b.index);
  for (const { course } of ordered) {
    const entry = byCode.get(course.code) ?? { code: course.code, credit: null, current: null, attempts: [] };
    entry.attempts.push(course);
    if (earnsCredit(course)) entry.credit = course;
    if (course.inProgress) entry.current = course;
    byCode.set(course.code, entry);
  }
  return byCode;
}

/** The course set one evaluation reads, its credit values, and the shared claims. */
type Scenario = {
  available: Set<string>;
  credits: Map<string, number | null>;
  used: Set<string>;
  /** Codes the tracked nodes claimed in an earlier pass; pools report only what they left. */
  claimedByTracked: Set<string> | null;
};

type State = "met" | "unmet" | "undecided";
type Evaluation = { name: string; kind: RequirementNode["kind"]; state: State; detail: string; citation: Citation; children?: Evaluation[] };

function isFree(scenario: Scenario, code: string): boolean {
  return scenario.available.has(code) && !scenario.used.has(code);
}

function claim(scenario: Scenario, codes: string[]): void {
  codes.forEach((code) => scenario.used.add(code));
}

function optionCount(option: OptionGroup): number {
  return option.counts ?? 1;
}

/**
 * The slot picks that fill the most of `count` from free courses: each slot
 * gives at most one alternative, and slots may not share a course. Overlapping
 * alternatives make a first-fit undercount, so the search backtracks; slots
 * and alternatives are tried in catalog order and the first assignment that
 * reaches `count` wins, keeping the result deterministic.
 */
function bestSlotPicks(slots: CourseSlot[], count: number, scenario: Scenario): { covered: number; codes: string[] } {
  const candidates = slots
    .map((slot) => slot.alternatives.filter((option) => option.must.every((code) => isFree(scenario, code))))
    .filter((alternatives) => alternatives.length > 0);
  const maxGain = candidates.map((alternatives) => Math.max(...alternatives.map(optionCount)));
  const remainingGain = new Array<number>(candidates.length + 1).fill(0);
  for (let index = candidates.length - 1; index >= 0; index -= 1) remainingGain[index] = remainingGain[index + 1]! + maxGain[index]!;
  let best = { covered: 0, codes: [] as string[] };
  const taken = new Set<string>();
  const picked: string[] = [];
  const walk = (index: number, covered: number): boolean => {
    const capped = Math.min(covered, count);
    if (capped > best.covered) best = { covered: capped, codes: [...picked] };
    if (capped >= count) return true;
    if (index >= candidates.length || Math.min(covered + remainingGain[index]!, count) <= best.covered) return false;
    for (const option of candidates[index]!) {
      if (option.must.some((code) => taken.has(code))) continue;
      option.must.forEach((code) => taken.add(code));
      picked.push(...option.must);
      const done = walk(index + 1, covered + optionCount(option));
      picked.splice(picked.length - option.must.length, option.must.length);
      option.must.forEach((code) => taken.delete(code));
      if (done) return true;
    }
    return walk(index + 1, covered);
  };
  walk(0, 0);
  return best;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function evaluate(node: RequirementNode, scenario: Scenario): Evaluation {
  const base = { name: node.name, kind: node.kind, citation: node.citation };
  switch (node.kind) {
    case "all": {
      // A required slot claims the first alternative it finds complete; the
      // course is required here, so no later node has a better claim to it.
      let met = 0;
      for (const slot of node.items) {
        const hit = slot.alternatives.find((option) => option.must.every((code) => isFree(scenario, code)));
        if (!hit) continue;
        claim(scenario, hit.must);
        met += 1;
      }
      return { ...base, state: met === node.items.length ? "met" : "unmet", detail: `${met}/${node.items.length} required courses or sequences complete` };
    }
    case "choose": {
      const { covered, codes } = bestSlotPicks(node.items, node.count, scenario);
      claim(scenario, codes);
      return { ...base, state: covered >= node.count ? "met" : "unmet", detail: `${covered}/${node.count} chosen${codes.length > 0 ? ` (${codes.join(", ")})` : ""}` };
    }
    case "hours": {
      // Options with known credit go first, in catalog order. A course with
      // unknown credit could be the one that fills the hours, so claiming
      // stops there: the node cannot hoard more courses on a guess, and it
      // reads advisory rather than satisfied or unsatisfied.
      const known = (option: OptionGroup): boolean => option.must.every((code) => scenario.credits.get(code) != null);
      const ordered = [...node.options.filter(known), ...node.options.filter((option) => !known(option))];
      let hours = 0;
      const taken: string[] = [];
      const unknown: string[] = [];
      for (const option of ordered) {
        if (hours >= node.hours) break;
        if (!option.must.every((code) => isFree(scenario, code))) continue;
        claim(scenario, option.must);
        taken.push(...option.must);
        for (const code of option.must) {
          const value = scenario.credits.get(code);
          if (value == null) unknown.push(code);
          else hours += value;
        }
        if (unknown.length > 0) break;
      }
      const state: State = hours >= node.hours ? "met" : unknown.length > 0 ? "undecided" : "unmet";
      const listed = taken.length > 0 ? ` (${taken.join(", ")})` : "";
      const unknownNote = unknown.length > 0 ? `; credit hours unknown for ${unknown.join(", ")}` : "";
      return { ...base, state, detail: `${plural(taken.length, "course")}, ${hours}/${node.hours} hours${listed}${unknownNote}` };
    }
    case "pool":
      return { ...base, state: "undecided", detail: poolDetail(node, scenario) };
    case "choice": {
      // Every branch is tried against the claims made before the choice, so
      // each branch's progress is reported on equal terms. The first met
      // branch keeps its claims; when none is met, nothing is claimed and the
      // branches' courses stay free for later nodes.
      const start = scenario.used;
      const tried = node.branches.map((branch) => {
        scenario.used = new Set(start);
        const evaluation = evaluate(branch.node, scenario);
        return { branch: branch.name, evaluation, after: scenario.used };
      });
      const met = tried.find((entry) => entry.evaluation.state === "met");
      scenario.used = met ? met.after : start;
      const undecided = tried.find((entry) => entry.evaluation.state === "undecided");
      const shown = met ?? undecided ?? tried[0]!;
      return {
        ...base,
        name: `${node.name} — ${shown.branch}`,
        state: met ? "met" : undecided ? "undecided" : "unmet",
        detail: met ? shown.evaluation.detail : `No branch met. ${shown.branch}: ${shown.evaluation.detail}`,
        children: tried.map((entry) => entry.evaluation),
      };
    }
    case "group": {
      // Policies nested in a group are checked with the program's policies
      // and reported there; they are not parts the group can be missing.
      const children = node.children.filter((child) => child.kind !== "policy").map((child) => evaluate(child, scenario));
      const met = children.filter((child) => child.state === "met").length;
      const undecided = children.filter((child) => child.state === "undecided");
      // Any unmet part fails the group. Otherwise a part the audit cannot
      // decide (an uncaptured elective list, a prose rule) leaves the whole
      // group to an advisor: it cannot read satisfied with parts unchecked.
      const state: State = children.some((child) => child.state === "unmet") ? "unmet" : undecided.length > 0 ? "undecided" : "met";
      const review = undecided.length > 0 ? `; needs advisor review: ${undecided.map((child) => child.name).join(", ")}` : "";
      return { ...base, state, detail: `${met}/${children.length} parts satisfied${review}`, children };
    }
    case "policy":
      return { ...base, state: "undecided", detail: node.quote };
    case "note":
      return { ...base, state: "undecided", detail: node.text };
  }
}

/**
 * An advisory pool's detail: the record's courses that match its subject and
 * level rule, after every tracked node took its courses. A required CSCE
 * course is never listed as an elective candidate.
 */
function poolDetail(node: PoolNode, scenario: Scenario): string {
  const excluded = scenario.claimedByTracked ?? scenario.used;
  const matching = [...scenario.available].filter((code) => {
    if (excluded.has(code)) return false;
    if (node.match.subjects === null || !node.match.subjects.includes(subjectOf(code))) return false;
    const level = levelOf(code);
    if (node.match.minLevel !== null && level < node.match.minLevel) return false;
    if (node.match.maxLevel !== null && level > node.match.maxLevel) return false;
    return true;
  }).sort();
  const known = matching.map((code) => scenario.credits.get(code));
  const hours = known.every((value) => value != null) ? `${known.reduce<number>((sum, value) => sum + (value ?? 0), 0)} hours` : "hours partly unknown";
  const list = matching.length > 0 ? `${matching.join(", ")} (${hours} of ${node.hours})` : "none";
  return `${node.note ?? "Advisory: the catalog's course list for this requirement is not captured."} Unclaimed courses matching the subject and level rule: ${list}. Verify against the catalog list.`;
}

/** One full pass over the tree, then a second so pools see what the tracked nodes claimed. */
function evaluateProgram(program: ProgramData, available: Set<string>, credits: Map<string, number | null>): { evaluations: Evaluation[]; used: Set<string> } {
  // Policies are checked separately and reported among the policies, not as requirement nodes.
  const nodes = program.requirements.filter((node) => node.kind !== "policy");
  const first: Scenario = { available, credits, used: new Set(), claimedByTracked: null };
  nodes.forEach((node) => evaluate(node, first));
  // Pools never claim, so the second pass makes the same claims as the first.
  const second: Scenario = { available, credits, used: new Set(), claimedByTracked: first.used };
  const evaluations = nodes.map((node) => evaluate(node, second));
  return { evaluations, used: second.used };
}

/**
 * One outcome from the two evaluations. Both walk the same tree, so their
 * parts line up by position; a choice lists every branch in both.
 */
function combine(now: Evaluation, projected: Evaluation): NodeOutcome {
  const status: NodeOutcome["status"] =
    now.state === "met" ? "satisfied" : projected.state === "met" ? "inProgress" : now.state === "undecided" || projected.state === "undecided" ? "advisory" : "unsatisfied";
  // A choice in progress is named for the branch the in-progress courses complete.
  const shown = status === "inProgress" ? projected : now;
  // Short of satisfied, the detail shows what the in-progress courses add.
  const detail = status !== "satisfied" && projected.detail !== now.detail ? `${now.detail}. Counting in-progress courses: ${projected.detail}` : now.detail;
  const children = now.children?.map((child, index) => combine(child, projected.children![index]!));
  return { name: shown.name, kind: now.kind, status, detail, citation: now.citation, ...(children ? { children } : {}) };
}

/** The finished courses a typed scope admits, each code once. */
function evidenceInScope(scope: CourseScope, evidence: CourseEvidence[], applied: Set<string>): CourseEvidence[] {
  switch (scope.kind) {
    case "overall":
      return evidence;
    case "unt":
      return evidence.filter((entry) => entry.credit?.sourceKind === "unt");
    case "applied":
      return evidence.filter((entry) => applied.has(entry.code));
    case "codes":
      return evidence.filter((entry) => scope.codes.includes(entry.code));
  }
}

/** Credit hours of the credited courses, each code once; null when any value is unknown. */
function creditedHours(evidence: CourseEvidence[]): { hours: number | null; unknown: string[] } {
  const unknown = evidence.filter((entry) => entry.credit !== null && entry.credit.credits === null).map((entry) => entry.code);
  if (unknown.length > 0) return { hours: null, unknown };
  return { hours: evidence.reduce((sum, entry) => sum + (entry.credit?.credits ?? 0), 0), unknown };
}

function evaluatePolicy(policy: PolicyNode, evidence: CourseEvidence[], applied: Set<string>, options: AuditOptions): PolicyOutcome {
  const base: PolicyOutcome = { name: policy.name, status: "unverifiable", detail: policy.quote, citation: policy.citation };
  const credited = evidence.filter((entry) => entry.credit !== null);
  const p = policy.policy;
  switch (p.type) {
    case "totalHours": {
      const inScope = p.courseScope ? evidenceInScope(p.courseScope, credited, applied) : credited;
      const { hours, unknown } = creditedHours(inScope);
      if (hours === null) return { ...base, detail: `${policy.quote} — credit hours unknown for ${unknown.join(", ")}; cannot verify.` };
      const pending = (p.courseScope ? evidenceInScope(p.courseScope, evidence, applied) : evidence).filter((entry) => entry.credit === null && entry.current !== null);
      const pendingKnown = pending.reduce((sum, entry) => sum + (entry.current?.credits ?? 0), 0);
      const pendingUnknown = pending.some((entry) => entry.current?.credits === null);
      const note = pending.length > 0 ? ` (${pendingKnown} more in progress${pendingUnknown ? ", some with unknown credit hours" : ""})` : "";
      return { ...base, status: hours >= p.hours ? "satisfied" : "unsatisfied", detail: `${hours} completed hours of ${p.hours}${note}` };
    }
    case "advancedHours": {
      const { hours, unknown } = creditedHours(credited.filter((entry) => levelOf(entry.code) >= 3000));
      if (hours === null) return { ...base, detail: `${policy.quote} — credit hours unknown for ${unknown.join(", ")}; cannot verify.` };
      return { ...base, status: hours >= p.hours ? "satisfied" : "unsatisfied", detail: `${hours} advanced hours of ${p.hours}` };
    }
    case "advancedHoursAtUnt": {
      const advanced = credited.filter((entry) => levelOf(entry.code) >= 3000);
      const atUnt = advanced.filter((entry) => entry.credit?.sourceKind === "unt");
      const elsewhere = advanced.length - atUnt.length;
      const { hours, unknown } = creditedHours(atUnt);
      if (hours === null) return { ...base, detail: `${policy.quote} — credit hours unknown for ${unknown.join(", ")}; cannot verify.` };
      return {
        ...base,
        status: hours >= p.hours ? "satisfied" : "unsatisfied",
        detail: `${hours} advanced UNT hours of ${p.hours}${elsewhere > 0 ? `; ${plural(elsewhere, "advanced transfer or exam course")} need advisor confirmation of residence credit` : ""}`,
      };
    }
    case "residencyPercent":
      return { ...base, detail: `${policy.quote} — the audit does not check the residence share yet; verify with an advisor.` };
    case "minGrade": {
      if (!p.courseScope) return { ...base, detail: `${policy.quote} — the course scope (${p.scope}) cannot be resolved from the record; cannot verify.` };
      // The floor reads each credited course's latest credit-earning grade, so
      // a D raised to a C on a retake passes, as the catalog's repeat wording
      // ("repeat the course and raise the grade") asks.
      const inScope = evidenceInScope(p.courseScope, credited, applied);
      if (inScope.length === 0) return { ...base, detail: `${policy.quote} — no completed courses in scope (${p.scope}); nothing to check.` };
      const gradeOf = (entry: CourseEvidence): string => entry.credit?.grade ?? "no grade";
      const lettered = inScope.filter((entry) => gradeOf(entry) in GRADE_POINTS);
      // Exam and transfer credit (CR, or no UNT grade) carries no letter to
      // compare; it is listed, not failed. A P on a major course is a
      // question for an advisor, so it makes the floor unverifiable.
      const creditOnly = inScope.filter((entry) => !(gradeOf(entry) in GRADE_POINTS) && (gradeOf(entry) === "CR" || entry.credit?.sourceKind === "transfer" || entry.credit?.sourceKind === "exam"));
      const unreadable = inScope.filter((entry) => !lettered.includes(entry) && !creditOnly.includes(entry));
      const failing = lettered.filter((entry) => LETTER_ORDER.indexOf(gradeOf(entry)) < LETTER_ORDER.indexOf(p.grade));
      const describe = (list: CourseEvidence[]): string => list.map((entry) => `${entry.code} (${gradeOf(entry)})`).join(", ");
      const skipped = creditOnly.length > 0 ? ` Not checked, no letter grade: ${describe(creditOnly)}.` : "";
      if (failing.length > 0) return { ...base, status: "unsatisfied", detail: `Below ${p.grade}: ${describe(failing)}.${skipped}` };
      if (unreadable.length > 0) return { ...base, detail: `${policy.quote} — ${describe(unreadable)}: no grade on UNT's letter scale; cannot verify.${skipped}` };
      return { ...base, status: "satisfied", detail: `No completed course in scope (${p.scope}) falls below ${p.grade}.${skipped}` };
    }
    case "gpa": {
      if (!p.courseScope) return { ...base, detail: `${policy.quote} — the course scope (${p.scope}) cannot be resolved from the record; cannot verify.` };
      return evaluateGpa(policy, p.minimum, p.courseScope, evidence, applied, options, base);
    }
    case "note":
      return base;
  }
}

/**
 * GPA over every graded attempt in scope: A through F carry grade points,
 * and an F's hours count with zero points ("all work attempted"). P, CR, W,
 * I, NP and in-progress rows carry no points and are skipped. A course
 * attempted more than once makes the figure unverifiable: which attempts
 * count is UNT's repeat rule, and no captured page states it.
 */
function evaluateGpa(policy: PolicyNode, minimum: number, scope: CourseScope, evidence: CourseEvidence[], applied: Set<string>, options: AuditOptions, base: PolicyOutcome): PolicyOutcome {
  const inScope = scope.kind === "unt"
    ? evidence.map((entry) => ({ ...entry, attempts: entry.attempts.filter((attempt) => attempt.sourceKind === "unt") }))
    : evidenceInScope(scope, evidence, applied);
  const graded = inScope.flatMap((entry) => entry.attempts.filter((attempt) => !attempt.inProgress && attempt.grade !== null && attempt.grade in GRADE_POINTS));
  const offScale = inScope.flatMap((entry) => entry.attempts.filter((attempt) => !attempt.inProgress && attempt.grade !== null && attempt.grade !== "" && !(attempt.grade in GRADE_POINTS) && !NO_CREDIT_GRADES.has(attempt.grade) && !CREDIT_ONLY_GRADES.has(attempt.grade)));
  // An F earns no hours, and the importer keeps earned hours (the transcript
  // row's "earned" column, 0.000 for an F), so a 0 on an F is not the hours
  // attempted. Without those hours the F's weight in the GPA is unknown.
  const noCredits = graded.filter((attempt) => attempt.credits === null || (attempt.grade === "F" && attempt.credits === 0));
  const repeated = [...new Set(graded.map((attempt) => attempt.code).filter((code, index, codes) => codes.indexOf(code) !== index))];
  const reasons: string[] = [];
  if (offScale.length > 0) reasons.push(`${offScale.map((attempt) => `${attempt.code} (${attempt.grade})`).join(", ")} ${offScale.length === 1 ? "has a grade" : "have grades"} off UNT's letter scale`);
  if (noCredits.length > 0) reasons.push(`attempted hours unknown for ${noCredits.map((attempt) => `${attempt.code} (${attempt.grade})`).join(", ")}`);
  if (repeated.length > 0) reasons.push(`${repeated.join(", ")} ${repeated.length === 1 ? "was" : "were"} attempted more than once, and UNT's repeat rule is not captured`);
  if (graded.length === 0) reasons.push("no letter-graded attempts in scope");
  const hours = graded.reduce((sum, attempt) => sum + (attempt.credits ?? 0), 0);
  const points = graded.reduce((sum, attempt) => sum + GRADE_POINTS[attempt.grade!]! * (attempt.credits ?? 0), 0);
  const value = noCredits.length === 0 && hours > 0 ? points / hours : null;
  const figure = value === null ? "" : `${value.toFixed(2)} over ${plural(graded.length, "graded attempt")}`;
  if (!options.gradeHistoryComplete) {
    reasons.push("the record holds only the transcript rows saved to the planner, which leaves out failed and withdrawn attempts the import did not save");
  }
  if (reasons.length > 0 || value === null) {
    return { ...base, detail: `${figure ? `${figure} of ${minimum.toFixed(1)} required, but ` : ""}${reasons.join("; ")}. Cannot verify.` };
  }
  return { ...base, status: value >= minimum ? "satisfied" : "unsatisfied", detail: `${figure} of ${minimum.toFixed(1)} required` };
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

export function auditProgram(program: ProgramData, courses: AuditCourse[], options: AuditOptions): AuditResult {
  const evidence = collectEvidence(courses);
  const finished = new Set<string>();
  const finishedCredits = new Map<string, number | null>();
  const projected = new Set<string>();
  const projectedCredits = new Map<string, number | null>();
  for (const entry of evidence.values()) {
    if (entry.credit) {
      finished.add(entry.code);
      finishedCredits.set(entry.code, entry.credit.credits);
      projected.add(entry.code);
      projectedCredits.set(entry.code, entry.credit.credits);
    } else if (entry.current) {
      projected.add(entry.code);
      projectedCredits.set(entry.code, entry.current.credits);
    }
  }
  const now = evaluateProgram(program, finished, finishedCredits);
  const later = evaluateProgram(program, projected, projectedCredits);
  const requirements = now.evaluations.map((evaluation, index) => combine(evaluation, later.evaluations[index]!));

  // Grade floors and scoped totals read the courses the requirement nodes
  // claimed from finished work. Advisory pool matches are never claimed.
  const policyNodes: PolicyNode[] = [];
  for (const node of program.requirements) collectPolicyNodes(node, policyNodes);
  const policies = policyNodes.map((node) => evaluatePolicy(node, [...evidence.values()], now.used, options));

  const count = (status: NodeOutcome["status"]): number => requirements.filter((result) => result.status === status).length;
  return {
    programId: program.id,
    programName: program.name,
    requirements,
    policies,
    coreSharedCourses: program.coreSharedCourses,
    summary: {
      satisfied: count("satisfied"),
      inProgress: count("inProgress"),
      unsatisfied: count("unsatisfied"),
      advisory: count("advisory"),
      unverifiablePolicies: policies.filter((result) => result.status === "unverifiable").length,
    },
  };
}
