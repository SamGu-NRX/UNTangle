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
 * - claimed: met only once the courses the student marked done by hand count
 *   too, so nothing on the transcript verifies it;
 * - advisory: the audit cannot decide, and an advisor must;
 * - unsatisfied: not met even counting in-progress and claimed courses.
 * The tree is evaluated in layers: finished courses, then adding in-progress
 * ones, then adding claims. The fullest layer decides whether a node is met;
 * for a met node, "satisfied", "in progress" and "claimed" name the first
 * layer that meets it, rather than a per-kind rule.
 *
 * Each layer allocates courses afresh, so a node can read claimed (or in
 * progress) although every course it took is finished: the claim let an
 * earlier node take a different course and freed a finished one for this
 * node. The node still depends on the claim, so the label is right; a
 * display should say so rather than treat it as a contradiction.
 */

/** One transcript attempt at a course. A record may hold several attempts at the same code. */
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

/**
 * A course the student marked done by hand, with no transcript row behind
 * it. It has no grade and no term. A requirement it helps meet reads
 * "claimed", never satisfied, and no policy reads it, because nothing
 * verifies it. Any transcript attempt at the same code, even a failed one,
 * decides that code instead, and the claim is reported in `ignoredClaims`.
 */
export type ClaimedCourse = {
  code: string;
  /** The course's catalog hours; null when unknown. */
  credits: number | null;
  sourceKind: "claimed";
};

export type AuditOptions = {
  /**
   * True only when the attempts include every graded attempt on the student's
   * transcript, failed and withdrawn ones too. A GPA computed from a subset
   * is not the student's GPA, so GPA checks report unverifiable without it.
   */
  gradeHistoryComplete: boolean;
};

/**
 * One slot a choose node can still take a pick from. Its options are the
 * catalog's equivalents, so taking any one adds that option's `picks`.
 */
export type RemainingSlot = {
  options: {
    /** The option's courses not yet on the record. */
    courses: string[];
    /** How many of the picks still needed taking these courses adds, never more than are needed. */
    picks: number;
  }[];
};

/**
 * What a requirement still needs, so a caller never parses `detail`. It is
 * read with in-progress and claimed courses counted, so they never appear
 * as needed, and a course another requirement already counted is never
 * offered again.
 */
export type Remaining =
  /**
   * Nothing to add: the requirement is satisfied, in progress or claimed,
   * or its parent needs nothing, as for a choice's branch the student did
   * not take.
   */
  | { kind: "none" }
  /**
   * A course list. Every code in `courses` is still needed. Each entry of
   * `oneOf` is one required slot the catalog lets a student fill in more
   * than one way (MATH 1710, or MATH 1810 with MATH 1820); any one of its
   * course sets fills it, and the audit does not pick. A course on the
   * record drops out of a set unless another requirement already counts it.
   */
  | { kind: "courses"; courses: string[]; oneOf: string[][][] }
  /** `picks` more picks, from `eligible`. */
  | { kind: "choose"; picks: number; eligible: RemainingSlot[] }
  /** `hours` more credit hours; each entry of `eligible` is one course set the catalog lists, minus courses already on the record. */
  | { kind: "hours"; hours: number; eligible: string[][] }
  /** Every unmet part in `children` must be met. */
  | { kind: "parts" }
  /** Any one branch in `children` must be met; the audit does not pick. */
  | { kind: "branch" }
  /**
   * The audit cannot count what is left, so the student should check with
   * an advisor. `candidates` are record courses that may count here.
   */
  | { kind: "advisor"; reason: string; candidates: string[] };

export type NodeOutcome = {
  name: string;
  kind: RequirementNode["kind"];
  /**
   * Defined in the comment at the top of this file. "claimed" or
   * "inProgress" can sit on a node whose own courses are all finished, when
   * the claim or in-progress course freed one of them from an earlier node.
   */
  status: "satisfied" | "inProgress" | "claimed" | "unsatisfied" | "advisory";
  detail: string;
  citation: Citation;
  remaining: Remaining;
  /** A group's parts, or every branch of a choice. */
  children?: NodeOutcome[];
};

/**
 * Credit hours toward the program's total-hours rule, each course once.
 * In-progress hours count once the course is graded; claimed hours count
 * only on the student's word.
 */
export type HourTotals = {
  /** The binding rule's total: 120 for CS BS, 121 for CE BS, 42 for the core. */
  required: number;
  finished: number;
  inProgress: number;
  claimed: number;
  /**
   * The hours the total still lacks once in-progress courses earn credit
   * and claims hold. This is a floor, not the remaining workload: a student
   * can reach the total and still miss a required course, a grade floor or
   * an advisory rule, which the requirements report. Null when any counted
   * course has unknown credit hours (listed in `unknownHours`), since the
   * true figure could then be lower.
   */
  stillNeeded: number | null;
  unknownHours: string[];
};

export type PolicyOutcome = {
  name: string;
  status: "satisfied" | "inProgress" | "unsatisfied" | "unverifiable";
  detail: string;
  citation: Citation;
};

export type AuditResult = {
  programId: string;
  programName: string;
  requirements: NodeOutcome[];
  policies: PolicyOutcome[];
  coreSharedCourses: string[];
  /**
   * Hours toward the program's total-hours rule; null when the program has
   * none. A total scoped to the courses the requirements counted (the
   * core's 42 hours) reads the allocation with in-progress and claimed
   * courses included, plus a partly met choice's courses, each course once.
   */
  totals: HourTotals | null;
  /** Codes the student claimed that the transcript also holds; the transcript decides them. */
  ignoredClaims: string[];
  summary: {
    satisfied: number;
    inProgress: number;
    claimed: number;
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
 * now and the retake is not counted again. A code counts once however many
 * of its attempts earned credit, so a course the catalog lets a student take
 * again for credit (CSCE 4890 Directed Study, say) counts its latest credited
 * attempt only; hours from the other attempts are an advisor's call.
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

/**
 * Splits the input into transcript evidence and claims. A claim on a code
 * the transcript holds in any form is set aside: the transcript wins.
 */
function splitClaims(courses: readonly (AuditCourse | ClaimedCourse)[]): { evidence: Map<string, CourseEvidence>; claims: Map<string, number | null>; ignoredClaims: string[] } {
  const attempts: AuditCourse[] = [];
  const claimed = new Map<string, number | null>();
  for (const course of courses) {
    if (course.sourceKind !== "claimed") {
      attempts.push(course);
      continue;
    }
    if (claimed.has(course.code)) throw new Error(`${course.code} is claimed twice; pass each claimed course once.`);
    claimed.set(course.code, course.credits);
  }
  const evidence = collectEvidence(attempts);
  const claims = new Map([...claimed].filter(([code]) => !evidence.has(code)));
  const ignoredClaims = [...claimed.keys()].filter((code) => evidence.has(code)).sort();
  return { evidence, claims, ignoredClaims };
}

/** The course set one evaluation reads, its credit values, and the shared claims. */
type Scenario = {
  available: Set<string>;
  credits: Map<string, number | null>;
  used: Set<string>;
  /** Codes the tracked nodes claimed in an earlier pass; pools report only what they left. */
  claimedByTracked: Set<string> | null;
  /**
   * Credited codes whose grade falls below the major's grade floor. Nodes take
   * them only when no passing course fits, so a D in one listed course does
   * not fail the floor for a student who passed enough of the others.
   */
  belowFloor: Set<string>;
  sharing: ProgramData["courseSharing"];
  /** Each pool's unclaimed candidates, recorded by the pass that knows the tracked claims. */
  pools: { node: PoolNode; codes: string[] }[];
  /**
   * Codes an unmet choice's branches took before the choice released them.
   * Hour totals count them, each once, so a partly met choice still counts
   * toward an applied total; no requirement sees them as claimed.
   */
  partial: Set<string>;
};

type State = "met" | "unmet" | "undecided";
type Evaluation = {
  name: string;
  kind: RequirementNode["kind"];
  state: State;
  detail: string;
  citation: Citation;
  /** How close the node came, from 0 to 1, so an unmet choice can name its closest branch. */
  progress: number;
  /** What this evaluation still lacks: none when met, an advisor's call when undecided. */
  need: Remaining;
  children?: Evaluation[];
};

const NOTHING: Remaining = { kind: "none" };

function advisor(reason: string, candidates: string[] = []): Remaining {
  return { kind: "advisor", reason, candidates };
}

function isFree(scenario: Scenario, code: string): boolean {
  return scenario.available.has(code) && !scenario.used.has(code);
}

function claim(scenario: Scenario, codes: string[]): void {
  codes.forEach((code) => scenario.used.add(code));
}

function optionCount(option: OptionGroup): number {
  return option.counts ?? 1;
}

/** 1 when any course of the option falls below the major's floor, else 0. */
function optionPenalty(option: OptionGroup, scenario: Scenario): number {
  return option.must.some((code) => scenario.belowFloor.has(code)) ? 1 : 0;
}

/** Stable sort: the options with the lowest key first, catalog order within a key. */
function sortedBy<T>(items: T[], key: (item: T) => number): T[] {
  return items.map((item, index) => ({ item, index, key: key(item) })).sort((a, b) => a.key - b.key || a.index - b.index).map((entry) => entry.item);
}

/**
 * The slot picks that fill the most of `count` from free courses: each slot
 * gives at most one alternative, and slots may not share a course. Among
 * picks that fill as much, the one using fewest below-floor options wins.
 * Overlapping alternatives make a first-fit undercount, so the search
 * backtracks; slots and alternatives are tried in catalog order and the first
 * best assignment found is kept, so the result is deterministic.
 */
function bestSlotPicks(slots: CourseSlot[], count: number, scenario: Scenario): { covered: number; codes: string[] } {
  const candidates = slots
    .map((slot) => sortedBy(slot.alternatives.filter((option) => option.must.every((code) => isFree(scenario, code))), (option) => optionPenalty(option, scenario)))
    .filter((alternatives) => alternatives.length > 0);
  const maxGain = candidates.map((alternatives) => Math.max(...alternatives.map(optionCount)));
  const remainingGain = new Array<number>(candidates.length + 1).fill(0);
  for (let index = candidates.length - 1; index >= 0; index -= 1) remainingGain[index] = remainingGain[index + 1]! + maxGain[index]!;
  let best = { covered: 0, penalty: 0, codes: [] as string[] };
  let settled = false;
  const taken = new Set<string>();
  const picked: string[] = [];
  const walk = (index: number, covered: number, penalty: number): void => {
    const capped = Math.min(covered, count);
    if (capped > best.covered || (capped === best.covered && penalty < best.penalty)) best = { covered: capped, penalty, codes: [...picked] };
    if (capped >= count) {
      if (penalty === 0) settled = true;
      return;
    }
    const reachable = Math.min(covered + remainingGain[index]!, count);
    if (settled || index >= candidates.length || reachable < best.covered || (reachable === best.covered && penalty >= best.penalty)) return;
    for (const option of candidates[index]!) {
      if (option.must.some((code) => taken.has(code))) continue;
      option.must.forEach((code) => taken.add(code));
      picked.push(...option.must);
      walk(index + 1, covered + optionCount(option), penalty + optionPenalty(option, scenario));
      picked.splice(picked.length - option.must.length, option.must.length);
      option.must.forEach((code) => taken.delete(code));
      if (settled) return;
    }
    walk(index + 1, covered, penalty);
  };
  walk(0, 0, 0);
  return { covered: best.covered, codes: best.codes };
}

/**
 * The options a short choose node can still gain picks from, by slot. An
 * option is offered when adding its courses not on the record raises the
 * node's picks under the same search, and `picks` is that gain. So a course
 * that lets the current picks move between slots is offered, and the second
 * chemistry pair, an equivalent of a slot already filled, is not. Options
 * that need a course an earlier requirement counted (in `before`) are left
 * out. Within a slot, options asking for the same courses are listed once.
 */
function eligibleSlots(slots: CourseSlot[], count: number, covered: number, scenario: Scenario, before: Set<string>): RemainingSlot[] {
  return slots.flatMap((slot) => {
    const options = new Map<string, { courses: string[]; picks: number }>();
    for (const option of slot.alternatives) {
      if (option.must.some((code) => before.has(code))) continue;
      const courses = option.must.filter((code) => !scenario.available.has(code));
      if (courses.length === 0) continue;
      const widened: Scenario = { ...scenario, used: before, available: new Set([...scenario.available, ...courses]) };
      const picks = bestSlotPicks(slots, count, widened).covered - covered;
      const key = courses.join("+");
      if (picks > 0 && picks > (options.get(key)?.picks ?? 0)) options.set(key, { courses, picks });
    }
    return options.size > 0 ? [{ options: [...options.values()] }] : [];
  });
}

/**
 * What a course list's unfilled slots need, after the node's claims. A slot
 * with one option lists its missing courses; a slot with several lists each
 * option's missing courses, unpicked.
 */
function missingCourses(slots: CourseSlot[], scenario: Scenario): Remaining {
  const courses: string[] = [];
  const oneOf: string[][][] = [];
  for (const slot of slots) {
    const sets = slot.alternatives.map((option) => option.must.filter((code) => !isFree(scenario, code)));
    if (sets.length === 1) courses.push(...sets[0]!);
    else oneOf.push(sets);
  }
  return { kind: "courses", courses, oneOf };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * A node's evaluation, with the sharing rule applied: under an advisor's
 * sharing rule, a course list met only by reusing a course an earlier node
 * claimed is left to an advisor instead of reading unmet. CE's VLSI
 * specialization with the required CSCE 3610 is the case the catalog prints.
 */
function evaluate(node: RequirementNode, scenario: Scenario): Evaluation {
  const before = new Set(scenario.used);
  const result = evaluateNode(node, scenario);
  if (result.state !== "unmet" || scenario.sharing !== "advisor" || (node.kind !== "all" && node.kind !== "choose" && node.kind !== "hours")) return result;
  const alone: Scenario = { ...scenario, used: new Set(), pools: [], partial: new Set() };
  if (evaluateNode(node, alone).state !== "met") return result;
  const shared = [...alone.used].filter((code) => before.has(code)).sort();
  const sharing = `met if ${shared.join(", ")} also ${shared.length === 1 ? "counts" : "count"} here, though ${shared.length === 1 ? "it already counts" : "they already count"} toward an earlier requirement. One course may meet several requirements with an advisor's approval.`;
  return {
    ...result,
    state: "undecided",
    detail: `${result.detail}; ${sharing}`,
    need: advisor(`This requirement is ${sharing}`, shared),
  };
}

function evaluateNode(node: RequirementNode, scenario: Scenario): Evaluation {
  const base = { name: node.name, kind: node.kind, citation: node.citation };
  switch (node.kind) {
    case "all": {
      // A required slot claims the complete alternative with the best grades
      // (catalog order among equals); the course is required here, so no
      // later node has a better claim to it.
      let met = 0;
      const unfilled: CourseSlot[] = [];
      for (const slot of node.items) {
        const complete = slot.alternatives.filter((option) => option.must.every((code) => isFree(scenario, code)));
        const hit = sortedBy(complete, (option) => optionPenalty(option, scenario))[0];
        if (!hit) {
          unfilled.push(slot);
          continue;
        }
        claim(scenario, hit.must);
        met += 1;
      }
      const state: State = met === node.items.length ? "met" : "unmet";
      return { ...base, state, progress: met / node.items.length, detail: `${met}/${node.items.length} required courses or sequences complete`, need: state === "met" ? NOTHING : missingCourses(unfilled, scenario) };
    }
    case "choose": {
      const before = new Set(scenario.used);
      const { covered, codes } = bestSlotPicks(node.items, node.count, scenario);
      claim(scenario, codes);
      const state: State = covered >= node.count ? "met" : "unmet";
      return {
        ...base,
        state,
        progress: covered / node.count,
        detail: `${covered}/${node.count} chosen${codes.length > 0 ? ` (${codes.join(", ")})` : ""}`,
        need: state === "met" ? NOTHING : { kind: "choose", picks: node.count - covered, eligible: eligibleSlots(node.items, node.count, covered, scenario, before) },
      };
    }
    case "hours": {
      // Passing grades go before ones below the major's floor, known credit
      // before unknown within each, catalog order after that. A course with
      // unknown credit could be the one that fills the hours, so claiming
      // stops there: the node cannot hoard more courses on a guess, and it
      // reads advisory rather than satisfied or unsatisfied.
      const known = (option: OptionGroup): boolean => option.must.every((code) => scenario.credits.get(code) != null);
      const ordered = sortedBy(node.options, (option) => optionPenalty(option, scenario) * 2 + (known(option) ? 0 : 1));
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
      const need: Remaining =
        state === "met" ? NOTHING
        : state === "undecided" ? advisor(`The credit hours of ${unknown.join(", ")} are unknown, so the audit cannot tell how many of the ${node.hours} hours are left.`, unknown)
        : { kind: "hours", hours: node.hours - hours, eligible: node.options.filter((option) => option.must.every((code) => !scenario.used.has(code))).map((option) => option.must.filter((code) => !isFree(scenario, code))) };
      return { ...base, state, progress: Math.min(hours / node.hours, 1), detail: `${plural(taken.length, "course")}, ${hours}/${node.hours} hours${listed}${unknownNote}`, need };
    }
    case "pool": {
      const codes = poolMatches(node, scenario);
      if (scenario.claimedByTracked) scenario.pools.push({ node, codes });
      return { ...base, state: "undecided", progress: 0, detail: poolDetail(node, codes, scenario), need: advisor(node.note ?? UNCAPTURED_POOL, codes) };
    }
    case "choice": {
      // Every branch is tried against the claims made before the choice, so
      // each branch's progress is reported on equal terms. The first met
      // branch keeps its claims; when none is met, nothing is claimed and the
      // branches' courses stay free for later nodes. A met choice keeps only
      // its branch's unsettled courses, so a nested unmet choice in a branch
      // the student did not take adds nothing.
      const start = scenario.used;
      const startPartial = scenario.partial;
      const tried = node.branches.map((branch) => {
        scenario.used = new Set(start);
        scenario.partial = new Set(startPartial);
        const evaluation = evaluate(branch.node, scenario);
        return { branch: branch.name, evaluation, after: scenario.used, partial: scenario.partial };
      });
      const met = tried.find((entry) => entry.evaluation.state === "met");
      scenario.used = met ? met.after : start;
      scenario.partial = met ? met.partial : new Set(tried.flatMap((entry) => [...entry.partial]));
      if (!met) for (const entry of tried) for (const code of entry.after) if (!start.has(code)) scenario.partial.add(code);
      const undecided = tried.some((entry) => entry.evaluation.state === "undecided");
      // Unmet, the choice names its closest branch; an undecided branch wins a tie.
      const closer = (entry: (typeof tried)[number], best: (typeof tried)[number]): boolean =>
        entry.evaluation.progress > best.evaluation.progress || (entry.evaluation.progress === best.evaluation.progress && entry.evaluation.state === "undecided" && best.evaluation.state !== "undecided");
      const shown = met ?? tried.reduce((best, entry) => (closer(entry, best) ? entry : best));
      return {
        ...base,
        name: `${node.name} — ${shown.branch}`,
        progress: shown.evaluation.progress,
        state: met ? "met" : undecided ? "undecided" : "unmet",
        detail: met ? shown.evaluation.detail : `No branch met. ${shown.branch}: ${shown.evaluation.detail}`,
        need: met ? NOTHING : { kind: "branch" },
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
      return { ...base, state, progress: children.length === 0 ? 1 : met / children.length, detail: `${met}/${children.length} parts satisfied${review}`, need: state === "met" ? NOTHING : { kind: "parts" }, children };
    }
    case "policy":
      return { ...base, state: "undecided", progress: 0, detail: node.quote, need: advisor(`The audit does not check this catalog rule: ${node.quote}`) };
    case "note":
      return { ...base, state: "undecided", progress: 0, detail: node.text, need: advisor(`The audit does not check this catalog passage: ${node.text}`) };
  }
}

const UNCAPTURED_POOL = "Advisory: the catalog's course list for this requirement is not captured.";

/**
 * The record's courses that match a pool's subject and level rule, after
 * every tracked node took its courses. A required CSCE course is never an
 * elective candidate.
 */
function poolMatches(node: PoolNode, scenario: Scenario): string[] {
  const excluded = scenario.claimedByTracked ?? scenario.used;
  return [...scenario.available].filter((code) => {
    if (excluded.has(code)) return false;
    if (node.match.subjects === null || !node.match.subjects.includes(subjectOf(code))) return false;
    const level = levelOf(code);
    if (node.match.minLevel !== null && level < node.match.minLevel) return false;
    if (node.match.maxLevel !== null && level > node.match.maxLevel) return false;
    return true;
  }).sort();
}

function poolDetail(node: PoolNode, matching: string[], scenario: Scenario): string {
  const known = matching.map((code) => scenario.credits.get(code));
  const hours = known.every((value) => value != null) ? `${known.reduce<number>((sum, value) => sum + (value ?? 0), 0)} hours` : "hours partly unknown";
  const list = matching.length > 0 ? `${matching.join(", ")} (${hours} of ${node.hours})` : "none";
  return `${node.note ?? UNCAPTURED_POOL} Unclaimed courses matching the subject and level rule: ${list}. Verify against the catalog list.`;
}

/** One full pass over the tree, then a second so pools see what the tracked nodes claimed. */
function evaluateProgram(program: ProgramData, available: Set<string>, credits: Map<string, number | null>, belowFloor: Set<string>): { evaluations: Evaluation[]; used: Set<string>; pools: Scenario["pools"]; partial: Set<string> } {
  // Policies are checked separately and reported among the policies, not as requirement nodes.
  const nodes = program.requirements.filter((node) => node.kind !== "policy");
  const fresh = (claimedByTracked: Set<string> | null): Scenario => ({ available, credits, used: new Set(), claimedByTracked, belowFloor, sharing: program.courseSharing, pools: [], partial: new Set() });
  const first = fresh(null);
  nodes.forEach((node) => evaluate(node, first));
  // Pools never claim, so the second pass makes the same claims as the first.
  const second = fresh(first.used);
  const evaluations = nodes.map((node) => evaluate(node, second));
  return { evaluations, used: second.used, pools: second.pools, partial: second.partial };
}

/**
 * One outcome from the three layers: finished courses, then in-progress
 * ones added, then claims added. Every layer walks the same tree, so their
 * parts line up by position; a choice lists every branch in each.
 *
 * Each layer allocates courses afresh, so an earlier layer can meet a node
 * with a course the fullest layer gives to another node. The fullest layer
 * therefore decides whether a node is met, unmet or undecided, and what it
 * still needs; the earlier layers only label a met node satisfied or in
 * progress. Otherwise a group could read unmet while every part read done.
 */
function combine(now: Evaluation, projected: Evaluation, fullest: Evaluation, needed = true): NodeOutcome {
  const status: NodeOutcome["status"] =
    fullest.state === "unmet" ? "unsatisfied"
    : fullest.state === "undecided" ? "advisory"
    : now.state === "met" ? "satisfied"
    : projected.state === "met" ? "inProgress"
    : "claimed";
  // A choice is named for the branch the layer that decided its status
  // settled on: the in-progress or claimed courses' branch, or the branch
  // that made it undecided.
  const layers = [now, projected, fullest];
  const shown =
    status === "inProgress" ? projected
    : status === "claimed" ? fullest
    : status === "advisory" ? layers.find((layer) => layer.state === "undecided")!
    : now.state === "met" && status === "unsatisfied" ? fullest
    : now;
  // Short of satisfied, the detail shows what each later layer adds.
  const additions = status === "satisfied" ? [] : [
    ...(projected.detail !== now.detail ? [`Counting in-progress courses: ${projected.detail}`] : []),
    ...(fullest.detail !== projected.detail ? [`Counting courses marked done: ${fullest.detail}`] : []),
  ];
  const detail = [now.detail, ...additions].join(". ");
  // What is left comes from the fullest layer, so nothing in progress or
  // claimed is listed as needed. Under a parent that needs nothing, nothing
  // is needed: the branch a student did not take is not work left.
  const remaining = needed && (status === "unsatisfied" || status === "advisory") ? fullest.need : NOTHING;
  const children = now.children?.map((child, index) => combine(child, projected.children![index]!, fullest.children![index]!, remaining.kind !== "none"));
  return { name: shown.name, kind: now.kind, status, detail, citation: now.citation, remaining, ...(children ? { children } : {}) };
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

function belowGrade(grade: string | null | undefined, floor: string): boolean {
  return grade != null && grade in GRADE_POINTS && LETTER_ORDER.indexOf(grade) < LETTER_ORDER.indexOf(floor);
}

function evaluatePolicy(policy: PolicyNode, evidence: CourseEvidence[], applied: Set<string>, pools: Scenario["pools"], options: AuditOptions): PolicyOutcome {
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
      const advanced = (p.courseScope ? evidenceInScope(p.courseScope, credited, applied) : credited).filter((entry) => levelOf(entry.code) >= 3000);
      const atUnt = advanced.filter((entry) => entry.credit?.sourceKind === "unt");
      const elsewhere = advanced.length - atUnt.length;
      const { hours, unknown } = creditedHours(atUnt);
      if (hours === null) return { ...base, detail: `${policy.quote} — credit hours unknown for ${unknown.join(", ")}; cannot verify.` };
      // Scoped to the major, the claimed courses leave out advisory pool
      // candidates; an unclaimed advanced UNT course may be the elective that
      // closes the gap, so a short total cannot read unsatisfied then.
      const poolAtUnt = p.courseScope?.kind === "applied" && hours < p.hours
        ? [...new Set(pools.flatMap(({ codes }) => codes))].filter((code) => credited.some((entry) => entry.code === code && entry.credit?.sourceKind === "unt" && levelOf(code) >= 3000))
        : [];
      if (poolAtUnt.length > 0) return { ...base, detail: `${hours} advanced UNT hours of ${p.hours} from courses the audit placed; ${poolAtUnt.join(", ")} may count as major electives too. Cannot verify.` };
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
      const gradeOf = (entry: CourseEvidence): string => entry.credit?.grade ?? "no grade";
      // An advisory pool's candidates are not claimed, but one of them may be
      // the elective a student counts. When the passing candidates cannot fill
      // the pool's hours, a below-floor candidate might have to count, so the
      // floor cannot read satisfied.
      const byCode = new Map(credited.map((entry) => [entry.code, entry]));
      const poolRisk = p.courseScope.kind !== "applied" ? [] : pools.flatMap(({ node, codes }) => {
        const entries = codes.flatMap((code) => byCode.get(code) ?? []);
        const passingHours = entries.filter((entry) => !belowGrade(entry.credit?.grade, p.grade)).reduce((sum, entry) => sum + (entry.credit?.credits ?? 0), 0);
        return passingHours >= node.hours ? [] : entries.filter((entry) => belowGrade(entry.credit?.grade, p.grade)).map((entry) => ({ entry, pool: node.name }));
      });
      const risk = poolRisk.length > 0 ? ` ${poolRisk.map(({ entry, pool }) => `${entry.code} (${gradeOf(entry)}) may count toward ${pool}`).join("; ")}; if it does, it falls below ${p.grade}.` : "";
      if (inScope.length === 0) return { ...base, detail: `${policy.quote} — no completed courses in scope (${p.scope}); nothing to check.${risk}` };
      const lettered = inScope.filter((entry) => gradeOf(entry) in GRADE_POINTS);
      // Exam and transfer credit (CR, or no UNT grade) carries no letter to
      // compare; it is listed, not failed. A P on a major course is a
      // question for an advisor, so it makes the floor unverifiable.
      const creditOnly = inScope.filter((entry) => !(gradeOf(entry) in GRADE_POINTS) && (gradeOf(entry) === "CR" || entry.credit?.sourceKind === "transfer" || entry.credit?.sourceKind === "exam"));
      const unreadable = inScope.filter((entry) => !lettered.includes(entry) && !creditOnly.includes(entry));
      const failing = lettered.filter((entry) => belowGrade(gradeOf(entry), p.grade));
      const describe = (list: CourseEvidence[]): string => list.map((entry) => `${entry.code} (${gradeOf(entry)})`).join(", ");
      const skipped = creditOnly.length > 0 ? ` Not checked, no letter grade: ${describe(creditOnly)}.` : "";
      if (failing.length > 0) return { ...base, status: "unsatisfied", detail: `Below ${p.grade}: ${describe(failing)}.${risk}${skipped}` };
      if (unreadable.length > 0) return { ...base, detail: `${policy.quote} — ${describe(unreadable)}: no grade on UNT's letter scale; cannot verify.${risk}${skipped}` };
      if (poolRisk.length > 0) return { ...base, detail: `${policy.quote} —${risk} Cannot verify.${skipped}` };
      if (lettered.length === 0) return { ...base, detail: `${policy.quote} — every course in scope is credit without a letter grade; nothing to check.${skipped}` };
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
 * A policy read twice: over the courses the nodes placed, and again with the
 * finished courses an unmet choice's branches took and released (`unsettled`).
 * Those courses count only if their branch is the one the student finishes.
 * CE's CSCE 3420 and 3530 are 6 advanced major hours toward Communication and
 * Networks, and a D in either fails the major's C floor there, but neither
 * counts if the student finishes another specialization. Reading only the
 * placed courses would pass that C floor over the D, and reading every course
 * would pass a residence check on hours that may never apply. So when the two
 * readings disagree, the policy is unverifiable until a branch is met.
 */
function evaluatePolicyBeforeChoices(policy: PolicyNode, evidence: CourseEvidence[], applied: Set<string>, unsettled: Set<string>, pools: Scenario["pools"], options: AuditOptions): PolicyOutcome {
  const placed = evaluatePolicy(policy, evidence, applied, pools, options);
  const extra = [...unsettled].filter((code) => !applied.has(code)).sort();
  if (extra.length === 0) return placed;
  const widened = evaluatePolicy(policy, evidence, new Set([...applied, ...extra]), pools, options);
  if (widened.detail === placed.detail) return placed;
  const sentence = (text: string): string => (text.endsWith(".") ? text : `${text}.`);
  const counting = `${sentence(placed.detail)} Counting ${extra.join(", ")}, from a choice no branch has met yet: ${sentence(widened.detail)}`;
  // Hours and grade floors only move one way as courses are added, so two
  // readings that agree hold for every way the choice can settle. A GPA can
  // move either way, so for a GPA only an unchanged reading is conclusive.
  if (widened.status === placed.status && policy.policy.type !== "gpa") return { ...placed, detail: counting };
  return { ...placed, status: "unverifiable", detail: `${counting} Cannot verify until a branch is met.` };
}

/** Treat current courses as credit for the audit's projected, in-progress layer. */
function projectedEvidence(evidence: CourseEvidence[]): CourseEvidence[] {
  return evidence.map((entry) => entry.credit || !entry.current ? entry : { ...entry, credit: entry.current });
}

/** Advanced hours use the same finished/projected distinction as requirement nodes. */
function evaluatePolicyLayers(policy: PolicyNode, evidence: CourseEvidence[], now: ReturnType<typeof evaluateProgram>, projected: ReturnType<typeof evaluateProgram>, options: AuditOptions): PolicyOutcome {
  const current = evaluatePolicyBeforeChoices(policy, evidence, now.used, now.partial, now.pools, options);
  if (policy.policy.type !== "advancedHours" || current.status !== "unsatisfied") return current;
  const later = evaluatePolicyBeforeChoices(policy, projectedEvidence(evidence), projected.used, projected.partial, projected.pools, options);
  return later.status === "satisfied"
    ? { ...current, status: "inProgress", detail: `${current.detail}. Counting in-progress courses: ${later.detail}` }
    : current;
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
  // A repeated course leaves the figure to UNT's repeat rule, so none is shown.
  const value = noCredits.length === 0 && repeated.length === 0 && hours > 0 ? points / hours : null;
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

/**
 * Hours toward the program's binding total-hours rule, each code once. A
 * finished course counts its credit, an in-progress one without credit its
 * current attempt, and a claim its catalog hours. A total scoped to applied
 * courses reads `applied`: the fullest layer's allocation plus the courses an
 * unmet choice's branches took. Counting a course that might not apply only
 * lowers `stillNeeded`, so the floor holds; leaving out one that does apply
 * (3 of the core's Component Area Option hours, say) would break it.
 *
 * Every total-hours rule must be met, so among rules over the same courses
 * the largest binds: CE BS prints 121 hours beside the university's 120.
 * Rules over different courses have no single total, so they throw.
 */
function hourTotals(program: ProgramData, policyNodes: PolicyNode[], evidence: Map<string, CourseEvidence>, claims: Map<string, number | null>, applied: Set<string>): HourTotals | null {
  const rules = policyNodes.flatMap((node) => (node.policy.type === "totalHours" ? [{ name: node.name, hours: node.policy.hours, scope: node.policy.courseScope ?? ({ kind: "overall" } satisfies CourseScope) }] : []));
  if (rules.length === 0) return null;
  if (new Set(rules.map((rule) => JSON.stringify(rule.scope))).size > 1) {
    throw new Error(`${program.id}'s total-hours rules count different courses (${rules.map((rule) => `${rule.name}: ${rule.scope.kind}`).join("; ")}), so they have no single total.`);
  }
  const { name, hours: required, scope } = rules.reduce((largest, rule) => (rule.hours > largest.hours ? rule : largest));
  if (scope.kind === "unt") throw new Error(`${program.id}'s "${name}" counts UNT hours only, and the hour totals cannot tell whether in-progress or claimed courses are UNT courses.`);
  const inScope = (code: string): boolean => scope.kind === "overall" || (scope.kind === "applied" ? applied.has(code) : scope.codes.includes(code));
  const totals = { finished: 0, inProgress: 0, claimed: 0 };
  const unknownHours: string[] = [];
  const add = (code: string, credits: number | null, bucket: keyof typeof totals): void => {
    if (!inScope(code)) return;
    if (credits === null) unknownHours.push(code);
    else totals[bucket] += credits;
  };
  for (const entry of evidence.values()) {
    if (entry.credit) add(entry.code, entry.credit.credits, "finished");
    else if (entry.current) add(entry.code, entry.current.credits, "inProgress");
  }
  for (const [code, credits] of claims) add(code, credits, "claimed");
  const counted = totals.finished + totals.inProgress + totals.claimed;
  return {
    required,
    ...totals,
    stillNeeded: unknownHours.length > 0 ? null : Math.max(0, required - counted),
    unknownHours: unknownHours.sort(),
  };
}

export function auditProgram(program: ProgramData, courses: readonly (AuditCourse | ClaimedCourse)[], options: AuditOptions): AuditResult {
  const { evidence, claims, ignoredClaims } = splitClaims(courses);
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
  const policyNodes: PolicyNode[] = [];
  for (const node of program.requirements) collectPolicyNodes(node, policyNodes);
  // The major's own floor, the one scoped to the courses the nodes claim.
  const majorFloor = policyNodes.map((node) => node.policy).find((policy) => policy.type === "minGrade" && policy.courseScope?.kind === "applied");
  const belowFloor = new Set(
    majorFloor?.type === "minGrade" ? [...evidence.values()].filter((entry) => belowGrade(entry.credit?.grade, majorFloor.grade)).map((entry) => entry.code) : [],
  );
  const now = evaluateProgram(program, finished, finishedCredits, belowFloor);
  const later = evaluateProgram(program, projected, projectedCredits, belowFloor);
  // Claims have no grade, so none falls below the floor.
  const withClaims = claims.size === 0 ? later : evaluateProgram(program, new Set([...projected, ...claims.keys()]), new Map([...projectedCredits, ...claims]), belowFloor);
  const requirements = now.evaluations.map((evaluation, index) => combine(evaluation, later.evaluations[index]!, withClaims.evaluations[index]!));

  // Grade floors and scoped totals read the courses the requirement nodes
  // claimed from finished work, and the ones an unmet choice released.
  // Advisory pool matches are never claimed, and claims never reach a
  // policy: nothing verifies them.
  const policies = policyNodes.map((node) => evaluatePolicyLayers(node, [...evidence.values()], now, later, options));

  const count = (status: NodeOutcome["status"]): number => requirements.filter((result) => result.status === status).length;
  return {
    programId: program.id,
    programName: program.name,
    requirements,
    policies,
    coreSharedCourses: program.coreSharedCourses,
    totals: hourTotals(program, policyNodes, evidence, claims, new Set([...withClaims.used, ...withClaims.partial])),
    ignoredClaims,
    summary: {
      satisfied: count("satisfied"),
      inProgress: count("inProgress"),
      claimed: count("claimed"),
      unsatisfied: count("unsatisfied"),
      advisory: count("advisory"),
      unverifiablePolicies: policies.filter((result) => result.status === "unverifiable").length,
    },
  };
}
