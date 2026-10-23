import { auditProgram, earnsCredit, type AuditCourse, type ClaimedCourse, type NodeOutcome } from "./audit";
import type { ProgramData, RequirementNode } from "./types";

/**
 * A term-by-term roadmap: which courses a degree still needs, and the term
 * each one can go in.
 *
 * It works in two steps.
 *
 * 1. Choosing courses. The degree audit says what each requirement still
 *    needs. Where a requirement offers a choice (two of these lab sciences,
 *    six credits from this list), the roadmap picks the options that need
 *    the fewest extra courses, preferring ones UNTangle has prerequisite
 *    data for, then catalog order. It adds the picks to the record as
 *    planned courses and audits again, so the audit's own rules decide what
 *    a pick fills and what is still open, until a round adds nothing. Then
 *    it adds each pick's missing prerequisites, through the cheapest route
 *    of any "or".
 *
 * 2. Placing them. Term by term, each course whose prerequisites are done
 *    by the end of the term before (corequisites: by the end of the same
 *    term) and that runs that season goes in, longest remaining chain
 *    first, while the term stays within the credit limit. A course that
 *    needs a corequisite goes in with it or not at all.
 *
 * What it can't place it reports with the reason: no catalog data, a
 * prerequisite loop, a season it never runs in, a prerequisite that can't
 * be placed, standing the plan never reaches. Requirements it can't turn
 * into named courses (an elective pool whose list wasn't captured, a
 * choice only an advisor can settle) come back as open items.
 *
 * It assumes each course is passed, with whatever grade its rule asks, in
 * the term it is placed. Everything is sorted by course code before it is
 * used, so the same input always gives the same roadmap.
 */

export type Season = "spring" | "summer" | "fall";
export type Term = { readonly season: Season; readonly year: number };

/** A course's prerequisite rule in the shapes the roadmap can schedule. */
export type Requires =
  /** The course passed, with at least `minGrade` when the rule names one. */
  | { readonly kind: "course"; readonly code: string; readonly minGrade?: string }
  /** An empty "and" needs nothing; an empty "or" can never be met. */
  | { readonly kind: "and" | "or"; readonly children: readonly Requires[] }
  /** Met when the inner rule is met by the end of the same term: a corequisite. */
  | { readonly kind: "concurrent"; readonly requirement: Requires }
  /** Credits earned before the term starts, such as senior standing. */
  | { readonly kind: "credits"; readonly min: number }
  /**
   * A clause only an advisor can settle: consent, a major restriction, text
   * the parser couldn't read. The roadmap lets it pass and reports `text`.
   */
  | { readonly kind: "check"; readonly text: string };

export type PlanCourse = {
  readonly code: string;
  readonly credits: number;
  readonly requires: Requires;
  /** The seasons it runs in. Absent when the data doesn't say, and then it runs in every season. */
  readonly offered?: readonly Season[];
};

export type RoadmapInput = {
  /** Audited one at a time, in this order: the major, then the University Core. */
  readonly programs: readonly ProgramData[];
  /** Courses completed, in progress (finished before `start`) or marked done. */
  readonly record: readonly (AuditCourse | ClaimedCourse)[];
  /** Every course UNTangle has prerequisite data for. A course missing here can't be placed. */
  readonly catalog: ReadonlyMap<string, PlanCourse>;
  readonly start: Term;
  /** The most credits any term holds. */
  readonly creditLimit: number;
  /** The seasons the student takes courses in; spring and fall unless given. Must include `start`'s. */
  readonly seasons?: readonly Season[];
  /** Courses already chosen for `start`. They stay there even past the limit. */
  readonly pinned?: readonly string[];
  /** The most terms the roadmap lays out; 16 unless given. */
  readonly maxTerms?: number;
  /**
   * Count every term as holding `creditLimit` credits toward standing,
   * though the roadmap names fewer. The roadmap holds only the courses
   * requirements name; a student fills the rest of a term with electives
   * the degree's total still needs, so without this senior standing (90)
   * can sit out of reach of a 120-credit degree's named courses. Off unless
   * given.
   */
  readonly fullTermsForStanding?: boolean;
  /**
   * Whether a grade meets a rule's minimum ("D" against "C": false); undefined
   * when the school's scale can't say. Required when any rule names a
   * minimum. A course on the record meets a minimum only with a grade that
   * does (undefined lets it through); one in progress, marked done or on the
   * roadmap is assumed to.
   */
  readonly meetsMinimum?: (grade: string, minimum: string) => boolean | undefined;
  /**
   * Courses the record covers as prerequisites (passing the course named
   * here proves them) that a requirement still lists. Only an advisor can
   * waive one, so the roadmap never puts one in a term; it reports it, and
   * it still meets what needs it.
   */
  readonly covered?: ReadonlyMap<string, string>;
};

/** Why a course is on the roadmap. */
export type Why =
  /** A requirement of `program` names it. */
  | { readonly kind: "requirement"; readonly program: string; readonly requirement: string }
  /** Only because roadmap courses need it first. */
  | { readonly kind: "prerequisite"; readonly for: readonly string[] }
  /** The student put it in the first term. */
  | { readonly kind: "pinned" };

export type PlannedCourse = {
  readonly code: string;
  readonly credits: number;
  readonly why: Why;
  /** Roadmap courses from earlier terms that its rule names. */
  readonly after: readonly string[];
  /** Roadmap courses in the same term that its rule names, as corequisites. */
  readonly with: readonly string[];
  /** The clauses of its rule only an advisor can settle. */
  readonly checks: readonly string[];
  /** When its rule allowed an earlier term: that term, and what kept it out (a full term, or a season it doesn't run in). */
  readonly waited: { readonly since: Term; readonly for: "credits" | "season" } | null;
  /** False for a pinned course whose rule the record and the term don't meet yet. */
  readonly ruleMet: boolean;
  /** On the record already, with a grade below what a roadmap course's rule asks for, so it is taken again. */
  readonly retake: boolean;
};

export type PlanTerm = {
  readonly term: Term;
  /** The credits of the courses it names. */
  readonly credits: number;
  readonly courses: readonly PlannedCourse[];
  /** With `fullTermsForStanding`, the credits it counts toward standing beyond its courses: electives the student picks. 0 otherwise. */
  readonly electives: number;
};

export type UnplacedReason =
  /** Not in the catalog the roadmap was given, so its prerequisites and credits are unknown. */
  | { readonly kind: "no-data" }
  /** More credits than the limit, alone or with the corequisites it must go with. */
  | { readonly kind: "over-limit"; readonly credits: number }
  /** Runs only in seasons the roadmap doesn't plan. */
  | { readonly kind: "not-offered"; readonly offered: readonly Season[] }
  /** Its prerequisites lead back to it through `with`. */
  | { readonly kind: "cycle"; readonly with: readonly string[] }
  /** Needs `by` first, and `by` can't be placed either. */
  | { readonly kind: "blocked"; readonly by: string }
  /** Needs `credits` earned credits; the roadmap's courses and the record reach only `reaches`. */
  | { readonly kind: "standing"; readonly credits: number; readonly reaches: number }
  /** Its rule has no alternative that can ever be met, such as an empty "or". */
  | { readonly kind: "unmeetable" }
  /** The record covers it through `by`, but a requirement still lists it: an advisor decides (`covered` in the input). */
  | { readonly kind: "covered"; readonly by: string }
  /** Ready, but the roadmap ran out of terms (`maxTerms`). */
  | { readonly kind: "out-of-terms" };

export type UnplacedCourse = { readonly code: string; readonly credits: number | null; readonly why: Why; readonly reason: UnplacedReason };

/** A requirement the roadmap can't turn into named courses. */
export type OpenRequirement = {
  /** Unique in one roadmap. */
  readonly key: string;
  /**
   * The key the Courses view gives the same requirement: `<program id>.<index path>`, descending
   * into groups but stopping at a choice, which it shows as one row.
   */
  readonly viewKey: string;
  readonly program: string;
  readonly name: string;
  readonly reason: string;
  /** The credits it asks for, when it asks for credits. */
  readonly credits: number | null;
};

export type Roadmap = {
  readonly start: Term;
  readonly creditLimit: number;
  /** From `start`, every term up to the last that holds a course, empty ones included. */
  readonly terms: readonly PlanTerm[];
  readonly unplaced: readonly UnplacedCourse[];
  readonly open: readonly OpenRequirement[];
  /** Every course still to take, placed or not, by code. */
  readonly left: readonly { readonly code: string; readonly credits: number | null; readonly why: Why }[];
};

const DEFAULT_SEASONS: readonly Season[] = ["spring", "fall"];
export const DEFAULT_MAX_TERMS = 16;
/** A guard, not a tuning value: each round adds at least one course, so rounds stay below the catalog's size. */
const MAX_ROUNDS = 200;
const SEASON_ORDER: Record<Season, number> = { spring: 0, summer: 1, fall: 2 };

/** Plain code-point order, so sorting never depends on the runtime's locale. */
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (codes: Iterable<string>) => [...codes].sort(byCode);
/** "CSCE 4901" -> 4901; a code without a four-digit number sorts last. */
const levelOf = (code: string) => Number(/\s(\d{4})$/.exec(code)?.[1] ?? 9999);

export function termLabel(term: Term): string {
  return `${term.season[0]!.toUpperCase()}${term.season.slice(1)} ${term.year}`;
}

/** The next term the student takes courses in. */
export function nextTerm(term: Term, seasons: readonly Season[]): Term {
  const order = [...new Set(seasons)].sort((a, b) => SEASON_ORDER[a] - SEASON_ORDER[b]);
  const later = order.find((season) => SEASON_ORDER[season] > SEASON_ORDER[term.season]);
  return later ? { season: later, year: term.year } : { season: order[0]!, year: term.year + 1 };
}

/* ---------- reading rules ---------- */

/** Every course a rule names, in any clause. */
function courseLeaves(rule: Requires, into = new Set<string>()): Set<string> {
  switch (rule.kind) {
    case "course":
      into.add(rule.code);
      break;
    case "and":
    case "or":
      rule.children.forEach((child) => courseLeaves(child, into));
      break;
    case "concurrent":
      courseLeaves(rule.requirement, into);
      break;
    case "credits":
    case "check":
      break;
  }
  return into;
}

/** Whether a course, with a rule's minimum when it names one, counts as done. */
type Has = (code: string, minGrade?: string) => boolean;

/** Every course leaf with its minimum, for checks that read grades. */
function leafList(rule: Requires, into: { code: string; minGrade?: string }[] = []): { code: string; minGrade?: string }[] {
  if (rule.kind === "course") into.push(rule.minGrade === undefined ? { code: rule.code } : { code: rule.code, minGrade: rule.minGrade });
  if (rule.kind === "and" || rule.kind === "or") rule.children.forEach((child) => leafList(child, into));
  if (rule.kind === "concurrent") leafList(rule.requirement, into);
  return into;
}

function checkTexts(rule: Requires, into: string[] = []): string[] {
  if (rule.kind === "check" && !into.includes(rule.text)) into.push(rule.text);
  if (rule.kind === "and" || rule.kind === "or") rule.children.forEach((child) => checkTexts(child, into));
  if (rule.kind === "concurrent") checkTexts(rule.requirement, into);
  return into;
}

/**
 * A route to meeting a rule: courses to add (each with the course that
 * needs it), how many of them have no data, how many advisor checks it
 * leans on, and how many times it leads back to a course it is meeting a
 * prerequisite for, which no term order can satisfy.
 */
type Route = { add: { code: string; for: string }[]; missing: number; checks: number; loops: number };

const EMPTY_ROUTE: Route = { add: [], missing: 0, checks: 0, loops: 0 };

/** A loop never, then fewer courses without data, fewer advisor checks, fewer courses: a real course beats "or consent". */
const routeOrder = (a: Route, b: Route) => a.loops - b.loops || a.missing - b.missing || a.checks - b.checks || a.add.length - b.add.length;

/**
 * The cheapest set of courses that would meet `rule` for `parent`, given
 * what `has` counts as done (the record, with its grades, and the roadmap
 * so far). A course's own prerequisites join the route, so the cost is the
 * whole chain. A course on the record with too low a grade joins it again,
 * as a retake. `visiting` holds the courses whose prerequisites this route
 * is meeting: reaching one again is a loop, checked before anything counts
 * as done, so an alternative that needs the course it serves never looks
 * free.
 */
function route(rule: Requires, parent: string, has: Has, catalog: RoadmapInput["catalog"], visiting: ReadonlySet<string>): Route {
  switch (rule.kind) {
    case "course": {
      if (visiting.has(rule.code)) return { add: [], missing: 0, checks: 0, loops: 1 };
      if (has(rule.code, rule.minGrade)) return EMPTY_ROUTE;
      const self = { code: rule.code, for: parent };
      const entry = catalog.get(rule.code);
      if (!entry) return { add: [self], missing: 1, checks: 0, loops: 0 };
      const inner = route(entry.requires, rule.code, has, catalog, new Set([...visiting, rule.code]));
      return { add: [self, ...inner.add], missing: inner.missing, checks: inner.checks, loops: inner.loops };
    }
    case "and": {
      // Each part sees what the parts before it added, so a shared prerequisite counts once.
      const added = new Set<string>();
      const grown: Has = (code, minGrade) => added.has(code) || has(code, minGrade);
      const total: Route = { add: [], missing: 0, checks: 0, loops: 0 };
      for (const child of rule.children) {
        const part = route(child, parent, grown, catalog, visiting);
        for (const entry of part.add) {
          if (added.has(entry.code)) continue;
          added.add(entry.code);
          total.add.push(entry);
        }
        total.missing += part.missing;
        total.checks += part.checks;
        total.loops += part.loops;
      }
      return total;
    }
    case "or": {
      if (rule.children.length === 0) return { add: [], missing: 1, checks: 0, loops: 0 };
      let best: Route | null = null;
      for (const child of rule.children) {
        const option = route(child, parent, has, catalog, visiting);
        if (best === null || routeOrder(option, best) < 0) best = option;
      }
      return best!;
    }
    case "concurrent":
      return route(rule.requirement, parent, has, catalog, visiting);
    case "credits":
      return EMPTY_ROUTE;
    case "check":
      return { add: [], missing: 0, checks: 1, loops: 0 };
  }
}

/** The route that adds `codes` themselves, with their prerequisites. */
function routeFor(codes: readonly string[], has: Has, catalog: RoadmapInput["catalog"]): Route {
  return route({ kind: "and", children: codes.map((code) => ({ kind: "course" as const, code })) }, "", has, catalog, new Set());
}

/* ---------- choosing courses ---------- */

type Choosing = {
  program: ProgramData;
  catalog: RoadmapInput["catalog"];
  /** On the record, pinned, or already picked. */
  known: Set<string>;
  /** What counts as done when ranking options: picks and pinned courses, and the record with its grades. */
  has: Has;
  /** Picked in this walk: one course fills one requirement of a program. */
  taken: Set<string>;
  picks: Map<string, string>;
  open: OpenRequirement[];
};

function creditsOf(codes: readonly string[], catalog: RoadmapInput["catalog"]): number | null {
  let sum = 0;
  for (const code of codes) {
    const credits = catalog.get(code)?.credits;
    if (credits === undefined) return null;
    sum += credits;
  }
  return sum;
}

/** Options in the order the roadmap prefers them: see `routeOrder`, then fewer credits, then catalog order. */
function rankOptions<T>(options: readonly T[], codesOf: (option: T) => readonly string[], context: Choosing): T[] {
  const scored = options.map((option, index) => {
    const codes = codesOf(option);
    return { option, index, route: routeFor(codes, context.has, context.catalog), credits: creditsOf(codes, context.catalog) ?? Number.MAX_SAFE_INTEGER };
  });
  scored.sort((a, b) => routeOrder(a.route, b.route) || a.credits - b.credits || a.index - b.index);
  return scored.map((entry) => entry.option);
}

function pick(codes: readonly string[], requirement: string, context: Choosing): void {
  for (const code of codes) {
    context.taken.add(code);
    if (context.known.has(code)) continue;
    context.known.add(code);
    context.picks.set(code, requirement);
  }
}

const free = (codes: readonly string[], context: Choosing) => codes.length > 0 && codes.every((code) => !context.taken.has(code));

/** The parts of a node the audit evaluated, in its order: policies are checked apart from the tree. */
const evaluatedChildren = (node: RequirementNode): RequirementNode[] =>
  node.kind === "group" ? node.children.filter((child) => child.kind !== "policy") : node.kind === "choice" ? node.branches.map((branch) => branch.node) : [];

function openItem(outcome: NodeOutcome, node: RequirementNode, key: string, viewKey: string, reason: string, context: Choosing): void {
  // Prose notes and degree rules are not course work; the advisor list in Courses shows them.
  if (node.kind === "note" || node.kind === "policy") return;
  const credits = node.kind === "pool" || node.kind === "hours" ? node.hours : null;
  context.open.push({ key, viewKey, program: context.program.id, name: outcome.name, reason, credits });
}

/** Turns what one requirement still needs into picks, or an open item when it can't be named. */
function chooseFor(outcome: NodeOutcome, node: RequirementNode, key: string, viewKey: string, context: Choosing): void {
  if (outcome.kind !== node.kind) throw new Error(`The audit's outcome "${outcome.name}" (${outcome.kind}) doesn't line up with the program's node "${node.name}" (${node.kind}).`);
  const remaining = outcome.remaining;
  switch (remaining.kind) {
    case "none":
      return;
    case "courses": {
      pick(remaining.courses, outcome.name, context);
      for (const sets of remaining.oneOf) {
        const best = rankOptions(sets.filter((set) => free(set, context)), (set) => set, context)[0];
        if (best) pick(best, outcome.name, context);
      }
      return;
    }
    case "choose": {
      let needed = remaining.picks;
      const slots = remaining.eligible
        .map((slot) => rankOptions(slot.options.filter((option) => free(option.courses, context)), (option) => option.courses, context)[0])
        .filter((option) => option !== undefined);
      for (const option of rankOptions(slots, (entry) => entry.courses, context)) {
        if (needed <= 0) break;
        if (!free(option.courses, context)) continue;
        pick(option.courses, outcome.name, context);
        needed -= option.picks;
      }
      if (needed > 0) openItem(outcome, node, key, viewKey, `It needs ${needed} more pick${needed === 1 ? "" : "s"} than its listed options can give.`, context);
      return;
    }
    case "hours": {
      // A set whose credits are unknown can't be counted toward the hours, so it is never picked.
      let needed = remaining.hours;
      let uncounted = false;
      for (const set of rankOptions(remaining.eligible, (entry) => entry, context)) {
        if (needed <= 0) break;
        const credits = creditsOf(set, context.catalog);
        if (credits === null) uncounted = true;
        if (!free(set, context) || credits === null) continue;
        pick(set, outcome.name, context);
        needed -= credits;
      }
      if (needed > 0) {
        const reason = uncounted
          ? `Its listed courses that could fill the last ${needed} credits aren't in the catalog the roadmap reads, so it can't count their credits.`
          : `Its listed courses can't fill the last ${needed} credits.`;
        openItem(outcome, node, key, viewKey, reason, context);
      }
      return;
    }
    case "parts": {
      const children = evaluatedChildren(node);
      (outcome.children ?? []).forEach((child, index) => chooseFor(child, children[index]!, `${key}.${index}`, `${viewKey}.${index}`, context));
      return;
    }
    case "branch": {
      if (outcome.kind !== "choice" || node.kind !== "choice") throw new Error(`"${outcome.name}" needs a branch but is not a choice.`);
      const index = outcome.shownBranch;
      // Courses shows a choice as one row, so everything inside it links to that row.
      chooseFor(outcome.children[index]!, node.branches[index]!.node, `${key}.${index}`, viewKey, context);
      return;
    }
    case "advisor":
      // A group or choice the audit can't decide still has parts it can name.
      if (outcome.children && (node.kind === "group" || node.kind === "choice")) {
        const children = evaluatedChildren(node);
        if (outcome.kind === "choice") chooseFor(outcome.children[outcome.shownBranch]!, children[outcome.shownBranch]!, `${key}.${outcome.shownBranch}`, viewKey, context);
        else outcome.children.forEach((child, index) => chooseFor(child, children[index]!, `${key}.${index}`, `${viewKey}.${index}`, context));
        return;
      }
      openItem(outcome, node, key, viewKey, remaining.reason, context);
      return;
  }
}

function walkProgram(outcomes: readonly NodeOutcome[], program: ProgramData, context: Choosing): void {
  const nodes = program.requirements.filter((node) => node.kind !== "policy");
  if (nodes.length !== outcomes.length) throw new Error(`${program.id}: the audit returned ${outcomes.length} requirements for ${nodes.length} nodes.`);
  outcomes.forEach((outcome, index) => chooseFor(outcome, nodes[index]!, `${program.id}.${index}`, `${program.id}.${index}`, context));
}

function plannedAttempt(code: string, catalog: RoadmapInput["catalog"]): AuditCourse {
  return { code, grade: null, credits: catalog.get(code)?.credits ?? null, sourceKind: "current", inProgress: true, term: Number.MAX_SAFE_INTEGER };
}

/**
 * A requirement the audit still reads unmet with every roadmap course
 * counted: the choosing rounds had nothing more to give it (its courses
 * already count toward an earlier requirement, say), so it is reported
 * rather than dropped. Groups and choices open into the parts that are unmet.
 */
function reportUnmet(outcome: NodeOutcome, node: RequirementNode, key: string, viewKey: string, context: Choosing): void {
  if (outcome.status !== "unsatisfied") return;
  const children = evaluatedChildren(node);
  if (outcome.kind === "choice" && node.kind === "choice") {
    reportUnmet(outcome.children[outcome.shownBranch]!, children[outcome.shownBranch]!, `${key}.${outcome.shownBranch}`, viewKey, context);
    return;
  }
  if (outcome.kind === "group" && outcome.children) {
    outcome.children.forEach((child, index) => reportUnmet(child, children[index]!, `${key}.${index}`, `${viewKey}.${index}`, context));
    return;
  }
  const reported = context.open.some((item) => item.key === key || item.key.startsWith(`${key}.`) || key.startsWith(`${item.key}.`));
  if (!reported) openItem(outcome, node, key, viewKey, `With every course on the roadmap counted, the audit still reads it unmet: ${outcome.detail}.`, context);
}

/**
 * The courses the roadmap will take: what the requirements name, chosen as
 * the module comment says, plus the prerequisites they lack. `recordMeets`
 * says whether the record holds a course, with a grade meeting a minimum.
 */
function chooseCourses(
  input: RoadmapInput,
  onRecord: ReadonlySet<string>,
  recordMeets: Has,
  covered: ReadonlyMap<string, string>,
  pinned: readonly string[],
): { picks: Map<string, Why>; open: OpenRequirement[] } {
  const requirementPicks = new Map<string, { program: string; requirement: string }>();
  let open: OpenRequirement[] = [];
  for (let round = 0; ; round += 1) {
    if (round === MAX_ROUNDS) throw new Error(`The roadmap's course choice didn't settle in ${MAX_ROUNDS} rounds.`);
    let added = false;
    open = [];
    for (const program of input.programs) {
      const planned = [...pinned, ...requirementPicks.keys()].filter((code) => !onRecord.has(code));
      const result = auditProgram(program, [...input.record, ...planned.map((code) => plannedAttempt(code, input.catalog))], { gradeHistoryComplete: false });
      const known = new Set([...onRecord, ...pinned, ...requirementPicks.keys()]);
      const has: Has = (code, minGrade) => covered.has(code) || (known.has(code) && !onRecord.has(code)) || recordMeets(code, minGrade);
      const context: Choosing = { program, catalog: input.catalog, known, has, taken: new Set(), picks: new Map(), open };
      walkProgram(result.requirements, program, context);
      for (const [code, requirement] of context.picks) {
        if (requirementPicks.has(code)) continue;
        requirementPicks.set(code, { program: program.id, requirement });
        added = true;
      }
    }
    if (!added) break;
  }

  const picks = new Map<string, Why>();
  for (const code of sorted(requirementPicks.keys())) {
    const { program, requirement } = requirementPicks.get(code)!;
    picks.set(code, { kind: "requirement", program, requirement });
  }
  for (const code of pinned) if (!picks.has(code)) picks.set(code, { kind: "pinned" });

  // Prerequisites, once every requirement is picked, so an "or" uses a course already on the roadmap when it can.
  // A course the record holds with too low a grade comes back here, as a retake.
  const chosen = new Set(picks.keys());
  const has: Has = (code, minGrade) => covered.has(code) || chosen.has(code) || recordMeets(code, minGrade);
  const prerequisiteFor = new Map<string, Set<string>>();
  for (const code of sorted(picks.keys())) {
    const entry = input.catalog.get(code);
    // A covered course goes in no term, so nothing has to come before it.
    if (!entry || covered.has(code)) continue;
    const needs = route(entry.requires, code, has, input.catalog, new Set([code]));
    for (const need of needs.add) {
      chosen.add(need.code);
      if (picks.has(need.code)) continue;
      prerequisiteFor.set(need.code, (prerequisiteFor.get(need.code) ?? new Set()).add(need.for));
    }
  }
  // Which roadmap courses each prerequisite serves. The pass above stops at the first course that adds
  // one, so a later course needing it too reads it as done; routing each course again with no
  // prerequisite chosen yet names every course that leans on it.
  const requirementsOnly: Has = (code, minGrade) => covered.has(code) || (picks.has(code) && !prerequisiteFor.has(code)) || recordMeets(code, minGrade);
  for (const code of sorted(picks.keys())) {
    const entry = input.catalog.get(code);
    if (!entry || covered.has(code)) continue;
    for (const need of route(entry.requires, code, requirementsOnly, input.catalog, new Set([code])).add) prerequisiteFor.get(need.code)?.add(need.for);
  }
  for (const code of sorted(prerequisiteFor.keys())) picks.set(code, { kind: "prerequisite", for: sorted(prerequisiteFor.get(code)!) });

  // The degree with the whole roadmap counted: whatever the audit still reads unmet is reported, never dropped.
  for (const program of input.programs) {
    const result = auditProgram(program, [...input.record, ...[...picks.keys()].map((code) => plannedAttempt(code, input.catalog))], { gradeHistoryComplete: false });
    const nodes = program.requirements.filter((node) => node.kind !== "policy");
    const context: Choosing = { program, catalog: input.catalog, known: new Set(), has, taken: new Set(), picks: new Map(), open };
    result.requirements.forEach((outcome, index) => reportUnmet(outcome, nodes[index]!, `${program.id}.${index}`, `${program.id}.${index}`, context));
  }
  return { picks, open };
}

/* ---------- placing courses ---------- */

type Placing = {
  /** Done before this term: the record (with its grades), covered courses, and earlier terms. */
  done: Has;
  /** Placed this term, plus the bundle being tried. */
  now: ReadonlySet<string>;
  earned: number;
  canJoin: (code: string) => boolean;
  /** On the record (with its grades), covered, or on the roadmap. */
  planned: Has;
};

/**
 * The alternatives of an "or" the roadmap follows: the ones whose courses
 * it planned, when there are any, else all of them. Choosing courses
 * planned "MATH 1100" over "or consent", so placing waits for MATH 1100
 * rather than letting the consent clause pass first.
 */
function followed(children: readonly Requires[], planned: Has): readonly Requires[] {
  const routed = children.filter((child) => {
    const leaves = leafList(child);
    return leaves.length > 0 && leaves.every((leaf) => planned(leaf.code, leaf.minGrade));
  });
  return routed.length > 0 ? routed : children;
}

/**
 * The courses that must join this term for `rule` to be met, or null when
 * it can't be met this term. Only corequisites can join; an "or" takes the
 * followed alternative needing the fewest.
 */
function joinsNeeded(rule: Requires, at: Placing, concurrent = false): string[] | null {
  switch (rule.kind) {
    case "course":
      if (at.done(rule.code, rule.minGrade)) return [];
      if (!concurrent) return null;
      if (at.now.has(rule.code)) return [];
      return at.canJoin(rule.code) ? [rule.code] : null;
    case "and": {
      const all = new Set<string>();
      for (const child of rule.children) {
        const part = joinsNeeded(child, at, concurrent);
        if (part === null) return null;
        part.forEach((code) => all.add(code));
      }
      return sorted(all);
    }
    case "or": {
      let best: string[] | null = null;
      for (const child of followed(rule.children, at.planned)) {
        const option = joinsNeeded(child, at, concurrent);
        if (option !== null && (best === null || option.length < best.length)) best = option;
        if (best?.length === 0) break;
      }
      return best;
    }
    case "concurrent":
      return joinsNeeded(rule.requirement, at, true);
    case "credits":
      return at.earned >= rule.min ? [] : null;
    case "check":
      return [];
  }
}

/**
 * What still blocks `rule` once every placed course counts: courses that
 * had to come first, corequisites, and a credit floor not reached. Null
 * when nothing does. A corequisite is never part of a loop: the two can go
 * in one term.
 */
type Blockers = { first: Set<string>; alongside: Set<string>; credits: number | null };

function blockers(rule: Requires, done: Has, earned: number, planned: Has, concurrent = false): Blockers | null {
  switch (rule.kind) {
    case "course":
      if (done(rule.code, rule.minGrade)) return null;
      return concurrent ? { first: new Set(), alongside: new Set([rule.code]), credits: null } : { first: new Set([rule.code]), alongside: new Set(), credits: null };
    case "and":
    case "or": {
      const children = rule.kind === "or" ? followed(rule.children, planned) : rule.children;
      const parts = children.map((child) => blockers(child, done, earned, planned, concurrent));
      if (rule.kind === "or" && children.length > 0 && parts.some((part) => part === null)) return null;
      const blocking = parts.filter((part) => part !== null);
      // An "or" with no alternatives can never be met: blocked by nothing it names.
      if (blocking.length === 0) return rule.kind === "or" ? { first: new Set(), alongside: new Set(), credits: null } : null;
      return {
        first: new Set(blocking.flatMap((part) => [...part.first])),
        alongside: new Set(blocking.flatMap((part) => [...part.alongside])),
        credits: blocking.reduce<number | null>((most, part) => (part.credits === null ? most : Math.max(most ?? 0, part.credits)), null),
      };
    }
    case "concurrent":
      return blockers(rule.requirement, done, earned, planned, true);
    case "credits":
      return earned >= rule.min ? null : { first: new Set(), alongside: new Set(), credits: rule.min };
    case "check":
      return null;
  }
}

/** A course and every corequisite it pulls in, each checked with the others counted as this term's; null when one can't join. */
function bundleFor(code: string, base: Placing, rule: (code: string) => Requires): string[] | null {
  const bundle = [code];
  for (let at = 0; at < bundle.length; at += 1) {
    const needs = joinsNeeded(rule(bundle[at]!), { ...base, now: new Set([...base.now, ...bundle]) });
    if (needs === null) return null;
    for (const other of needs) if (!bundle.includes(other)) bundle.push(other);
  }
  return bundle;
}

/** Strongly connected groups among `codes` (Tarjan), each sorted, in code order. */
function loops(codes: readonly string[], edges: (code: string) => readonly string[]): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: string[][] = [];
  let counter = 0;
  const visit = (code: string) => {
    index.set(code, counter);
    low.set(code, counter);
    counter += 1;
    stack.push(code);
    onStack.add(code);
    for (const next of edges(code)) {
      if (!index.has(next)) {
        visit(next);
        low.set(code, Math.min(low.get(code)!, low.get(next)!));
      } else if (onStack.has(next)) low.set(code, Math.min(low.get(code)!, index.get(next)!));
    }
    if (low.get(code) !== index.get(code)) return;
    const group: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      group.push(member);
    } while (member !== code);
    groups.push(sorted(group));
  };
  for (const code of codes) if (!index.has(code)) visit(code);
  return groups.sort((a, b) => byCode(a[0]!, b[0]!));
}

/**
 * Courses that are on the record for prerequisites, every grade each was
 * counted with (null in progress or marked done), and the credits they have
 * earned or will have by `start`. As in the audit (splitClaims), any
 * transcript attempt at a code decides it, so a mark on a failed course
 * counts for nothing.
 */
function readRecord(record: RoadmapInput["record"]): { onRecord: Set<string>; grades: Map<string, (string | null)[]>; earned: number } {
  const attempted = new Set(record.filter((course) => course.sourceKind !== "claimed").map((course) => course.code));
  const credits = new Map<string, number>();
  const grades = new Map<string, (string | null)[]>();
  for (const course of record) {
    if (course.sourceKind === "claimed" && attempted.has(course.code)) continue;
    const counts = course.sourceKind === "claimed" ? true : course.inProgress || earnsCredit(course);
    if (!counts) continue;
    // A course counts once; credits it never printed count as none, so standing is never overstated.
    credits.set(course.code, Math.max(credits.get(course.code) ?? 0, course.credits ?? 0));
    const grade = course.sourceKind === "claimed" || course.inProgress ? null : course.grade;
    grades.set(course.code, [...(grades.get(course.code) ?? []), grade]);
  }
  return { onRecord: new Set(credits.keys()), grades, earned: [...credits.values()].reduce((sum, value) => sum + value, 0) };
}

function validate(input: RoadmapInput, seasons: readonly Season[], maxTerms: number): void {
  if (!Number.isFinite(input.creditLimit) || input.creditLimit <= 0) throw new Error(`The credit limit must be a positive number, not ${input.creditLimit}.`);
  if (!Number.isInteger(maxTerms) || maxTerms < 1) throw new Error(`maxTerms must be a positive whole number, not ${maxTerms}.`);
  if (seasons.length === 0) throw new Error("The roadmap needs at least one season to plan.");
  if (!seasons.includes(input.start.season)) throw new Error(`The roadmap starts in ${input.start.season}, which isn't one of the seasons it plans (${seasons.join(", ")}).`);
  if (input.programs.length === 0) throw new Error("The roadmap needs at least one program.");
  for (const [code, course] of input.catalog) {
    if (course.code !== code) throw new Error(`The catalog lists ${course.code} under ${code}.`);
    if (!Number.isFinite(course.credits) || course.credits < 0) throw new Error(`${code} has invalid credits: ${course.credits}.`);
    if (!input.meetsMinimum && leafList(course.requires).some((leaf) => leaf.minGrade !== undefined)) {
      throw new Error(`${code}'s rule has a grade minimum, so the roadmap needs meetsMinimum to compare grades.`);
    }
  }
}

export function planRoadmap(input: RoadmapInput): Roadmap {
  const seasons = input.seasons ?? DEFAULT_SEASONS;
  const maxTerms = input.maxTerms ?? DEFAULT_MAX_TERMS;
  validate(input, seasons, maxTerms);
  const { onRecord, grades, earned: earnedOnRecord } = readRecord(input.record);
  const covered = input.covered ?? new Map<string, string>();
  const recordMeets: Has = (code, minGrade) => {
    const counted = grades.get(code);
    if (!counted) return false;
    if (minGrade === undefined) return true;
    return counted.some((grade) => grade === null || input.meetsMinimum!(grade, minGrade) !== false);
  };
  const pinned = sorted(new Set((input.pinned ?? []).filter((code) => !onRecord.has(code))));
  const { picks, open } = chooseCourses(input, onRecord, recordMeets, covered, pinned);

  const unplaced = new Map<string, UnplacedReason>();
  const pending = new Set<string>();
  for (const code of picks.keys()) {
    const entry = input.catalog.get(code);
    if (pinned.includes(code)) {
      if (!entry) unplaced.set(code, { kind: "no-data" });
      continue;
    }
    if (covered.has(code)) unplaced.set(code, { kind: "covered", by: covered.get(code)! });
    else if (!entry) unplaced.set(code, { kind: "no-data" });
    else if (entry.credits > input.creditLimit) unplaced.set(code, { kind: "over-limit", credits: entry.credits });
    else if (entry.offered && !entry.offered.some((season) => seasons.includes(season))) unplaced.set(code, { kind: "not-offered", offered: [...entry.offered] });
    else pending.add(code);
  }
  const rule = (code: string) => input.catalog.get(code)!.requires;

  // Longest chain of roadmap courses that wait on each course: the longest goes first.
  const dependents = new Map<string, string[]>();
  for (const code of sorted(pending)) {
    for (const leaf of courseLeaves(rule(code))) if (leaf !== code) dependents.set(leaf, [...(dependents.get(leaf) ?? []), code]);
  }
  const chain = new Map<string, number>();
  const chainOf = (code: string, path: Set<string>): number => {
    const known = chain.get(code);
    if (known !== undefined) return known;
    if (path.has(code)) return 0;
    path.add(code);
    const length = 1 + Math.max(0, ...(dependents.get(code) ?? []).filter((next) => pending.has(next)).map((next) => chainOf(next, path)));
    path.delete(code);
    chain.set(code, length);
    return length;
  };
  // Ties on the chain go to the lower course level, then the major's courses before the core's, so a
  // first-year course whose rule names nothing still comes before a senior one whose rule names nothing.
  const programRank = (code: string) => {
    const why = picks.get(code)!;
    return why.kind === "requirement" ? input.programs.findIndex((program) => program.id === why.program) : 0;
  };
  const order = sorted(pending).sort(
    (a, b) =>
      chainOf(b, new Set()) - chainOf(a, new Set()) ||
      levelOf(a) - levelOf(b) ||
      programRank(a) - programRank(b) ||
      (dependents.get(b)?.length ?? 0) - (dependents.get(a)?.length ?? 0) ||
      byCode(a, b),
  );

  const planned: Has = (code, minGrade) => covered.has(code) || picks.has(code) || recordMeets(code, minGrade);
  const placedOnRoadmap = new Set<string>();
  // Done before the term being placed: the record with its grades, covered courses, and every earlier term.
  const placedBefore: Has = (code, minGrade) => covered.has(code) || placedOnRoadmap.has(code) || recordMeets(code, minGrade);
  const firstReady = new Map<string, number>();
  const skippedSeason = new Map<string, boolean>();
  const terms: PlanTerm[] = [];
  let earned = earnedOnRecord;
  let term = input.start;
  let idle = 0;
  let laidOut = 0;

  const placedPinned = pinned.filter((code) => input.catalog.has(code));
  for (let index = 0; index < maxTerms && (pending.size > 0 || (index === 0 && placedPinned.length > 0)); index += 1) {
    const now = new Set<string>();
    const courses: PlannedCourse[] = [];
    let credits = 0;
    const place = (code: string, ruleMet: boolean) => {
      const entry = input.catalog.get(code)!;
      const leaves = courseLeaves(entry.requires);
      const since = firstReady.get(code);
      const waited = since !== undefined && since < index ? { since: terms[since]!.term, for: skippedSeason.get(code) ? ("season" as const) : ("credits" as const) } : null;
      courses.push({
        code,
        credits: entry.credits,
        why: picks.get(code)!,
        after: sorted([...leaves].filter((leaf) => placedOnRoadmap.has(leaf) && !now.has(leaf))),
        with: [],
        checks: checkTexts(entry.requires),
        waited,
        ruleMet,
        retake: onRecord.has(code),
      });
      now.add(code);
      credits += entry.credits;
    };

    if (index === 0) for (const code of placedPinned) place(code, true);

    const offeredNow = (other: string) => input.catalog.get(other)!.offered?.includes(term.season) ?? true;
    for (const code of order) {
      if (!pending.has(code) || now.has(code)) continue;
      const base: Placing = { done: placedBefore, now, earned, planned, canJoin: (other) => pending.has(other) && !now.has(other) };
      if (joinsNeeded(rule(code), base) === null) continue;
      if (!firstReady.has(code)) firstReady.set(code, index);
      if (!offeredNow(code)) {
        skippedSeason.set(code, true);
        continue;
      }
      const bundle = bundleFor(code, { ...base, canJoin: (other) => base.canJoin(other) && offeredNow(other) }, rule);
      if (!bundle) continue;
      const bundleCredits = bundle.reduce((sum, member) => sum + input.catalog.get(member)!.credits, 0);
      if (credits + bundleCredits > input.creditLimit) continue;
      for (const member of bundle) {
        place(member, true);
        pending.delete(member);
      }
    }

    // Same-term corequisites, and whether a pinned course's rule holds, now that the whole term is known.
    const withs = courses.map((course) => ({
      ...course,
      with: sorted([...courseLeaves(rule(course.code))].filter((leaf) => leaf !== course.code && now.has(leaf))),
      ruleMet: course.why.kind !== "pinned" || joinsNeeded(rule(course.code), { done: placedBefore, now, earned, planned, canJoin: () => false }) !== null,
    }));
    const electives = input.fullTermsForStanding ? Math.max(0, input.creditLimit - credits) : 0;
    terms.push({ term, credits, courses: withs.sort((a, b) => byCode(a.code, b.code)), electives });
    laidOut += 1;
    for (const code of now) placedOnRoadmap.add(code);
    earned += credits + electives;
    idle = now.size === 0 ? idle + 1 : 0;
    // A full turn of seasons with nothing placed: nothing will change, so stop. Unless full terms count
    // toward standing and a course waits on standing alone, or standing has just let it in: each term
    // brings it closer (maxTerms still bounds it).
    const waitsOnStanding = () =>
      [...pending].some((code) => {
        const found = blockers(rule(code), placedBefore, earned, planned);
        return found === null || (found.credits !== null && found.first.size === 0 && found.alongside.size === 0);
      });
    if (idle >= new Set(seasons).size && !(input.fullTermsForStanding && waitsOnStanding())) break;
    term = nextTerm(term, seasons);
  }
  while (terms.length > 0 && terms[terms.length - 1]!.courses.length === 0) terms.pop();

  // Why each course still waiting never went in.
  const stuck = sorted(pending);
  const stuckSet = new Set(stuck);
  const block = new Map(stuck.map((code) => [code, blockers(rule(code), placedBefore, earned, planned)]));
  // A loop runs through courses that must come first; corequisites can share a term, so they never form one.
  for (const group of loops(stuck, (code) => sorted(block.get(code)?.first ?? []).filter((other) => stuckSet.has(other)))) {
    const selfLoop = group.length === 1 && block.get(group[0]!)?.first.has(group[0]!);
    if (group.length < 2 && !selfLoop) continue;
    for (const code of group) unplaced.set(code, { kind: "cycle", with: group.length === 1 ? [] : group.filter((other) => other !== code) });
  }
  for (const code of stuck) {
    if (unplaced.has(code)) continue;
    // Its rule holds with everything placed: then only room kept it out, with the corequisites it must go with.
    const bundle = bundleFor(code, { done: placedBefore, now: new Set(), earned, planned, canJoin: (other) => stuckSet.has(other) }, rule);
    if (bundle) {
      const credits = bundle.reduce((sum, member) => sum + input.catalog.get(member)!.credits, 0);
      if (credits > input.creditLimit) unplaced.set(code, { kind: "over-limit", credits });
      else if (laidOut >= maxTerms) unplaced.set(code, { kind: "out-of-terms" });
      // Room enough, terms to spare, and still out: it and its corequisites never run in one season.
      else unplaced.set(code, { kind: "not-offered", offered: [...(input.catalog.get(code)!.offered ?? seasons)] });
      continue;
    }
    const found = block.get(code);
    const courses = sorted([...(found?.first ?? []), ...(found?.alongside ?? [])]);
    // The roadmap's own courses first: one it can't place, then one still waiting, then one it never chose.
    const by = courses.find((other) => unplaced.has(other)) ?? courses.find((other) => stuckSet.has(other)) ?? courses[0];
    if (by) unplaced.set(code, { kind: "blocked", by });
    else if (found?.credits != null) unplaced.set(code, { kind: "standing", credits: found.credits, reaches: earned });
    else unplaced.set(code, { kind: "unmeetable" });
  }

  return {
    start: input.start,
    creditLimit: input.creditLimit,
    terms,
    unplaced: sorted(unplaced.keys()).map((code) => ({ code, credits: input.catalog.get(code)?.credits ?? null, why: picks.get(code)!, reason: unplaced.get(code)! })),
    open,
    left: sorted(picks.keys()).map((code) => ({ code, credits: input.catalog.get(code)?.credits ?? null, why: picks.get(code)! })),
  };
}
