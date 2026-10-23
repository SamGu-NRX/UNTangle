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
  | { readonly kind: "course"; readonly code: string }
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
};

export type PlanTerm = { readonly term: Term; readonly credits: number; readonly courses: readonly PlannedCourse[] };

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

function checkTexts(rule: Requires, into: string[] = []): string[] {
  if (rule.kind === "check" && !into.includes(rule.text)) into.push(rule.text);
  if (rule.kind === "and" || rule.kind === "or") rule.children.forEach((child) => checkTexts(child, into));
  if (rule.kind === "concurrent") checkTexts(rule.requirement, into);
  return into;
}

/** A route to meeting a rule: courses to add (each with the course that needs it), how many of them have no data, and how many advisor checks it leans on. */
type Route = { add: { code: string; for: string }[]; missing: number; checks: number };

const EMPTY_ROUTE: Route = { add: [], missing: 0, checks: 0 };

/** Fewer courses without data first, then fewer advisor checks, then fewer courses: a real course beats "or consent". */
const routeOrder = (a: Route, b: Route) => a.missing - b.missing || a.checks - b.checks || a.add.length - b.add.length;

/**
 * The cheapest set of courses that would meet `rule` for `parent`, given
 * the courses already `known` (on the record or on the roadmap). A course's
 * own prerequisites join the route, so the cost is the whole chain.
 * `visiting` stops a prerequisite loop; the placing step reports it.
 */
function route(rule: Requires, parent: string, known: ReadonlySet<string>, catalog: RoadmapInput["catalog"], visiting: ReadonlySet<string>): Route {
  switch (rule.kind) {
    case "course": {
      if (known.has(rule.code)) return EMPTY_ROUTE;
      const self = { code: rule.code, for: parent };
      const entry = catalog.get(rule.code);
      if (!entry) return { add: [self], missing: 1, checks: 0 };
      if (visiting.has(rule.code)) return { add: [self], missing: 0, checks: 0 };
      const inner = route(entry.requires, rule.code, new Set([...known, rule.code]), catalog, new Set([...visiting, rule.code]));
      return { add: [self, ...inner.add], missing: inner.missing, checks: inner.checks };
    }
    case "and": {
      // Each part sees what the parts before it added, so a shared prerequisite counts once.
      const grown = new Set(known);
      const total: Route = { add: [], missing: 0, checks: 0 };
      for (const child of rule.children) {
        const part = route(child, parent, grown, catalog, visiting);
        for (const entry of part.add) {
          if (grown.has(entry.code)) continue;
          grown.add(entry.code);
          total.add.push(entry);
        }
        total.missing += part.missing;
        total.checks += part.checks;
      }
      return total;
    }
    case "or": {
      if (rule.children.length === 0) return { add: [], missing: 1, checks: 0 };
      let best: Route | null = null;
      for (const child of rule.children) {
        const option = route(child, parent, known, catalog, visiting);
        if (best === null || routeOrder(option, best) < 0) best = option;
      }
      return best!;
    }
    case "concurrent":
      return route(rule.requirement, parent, known, catalog, visiting);
    case "credits":
      return EMPTY_ROUTE;
    case "check":
      return { add: [], missing: 0, checks: 1 };
  }
}

/** The route that adds `codes` themselves, with their prerequisites. */
function routeFor(codes: readonly string[], known: ReadonlySet<string>, catalog: RoadmapInput["catalog"]): Route {
  return route({ kind: "and", children: codes.map((code) => ({ kind: "course" as const, code })) }, "", known, catalog, new Set());
}

/* ---------- choosing courses ---------- */

type Choosing = {
  program: ProgramData;
  catalog: RoadmapInput["catalog"];
  /** On the record, pinned, or already picked. */
  known: Set<string>;
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
    return { option, index, route: routeFor(codes, context.known, context.catalog), credits: creditsOf(codes, context.catalog) ?? Number.MAX_SAFE_INTEGER };
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
 * The courses the roadmap will take: what the requirements name, chosen as
 * the module comment says, plus the prerequisites they lack.
 */
function chooseCourses(input: RoadmapInput, onRecord: ReadonlySet<string>, pinned: readonly string[]): { picks: Map<string, Why>; open: OpenRequirement[] } {
  const requirementPicks = new Map<string, { program: string; requirement: string }>();
  let open: OpenRequirement[] = [];
  for (let round = 0; ; round += 1) {
    if (round === MAX_ROUNDS) throw new Error(`The roadmap's course choice didn't settle in ${MAX_ROUNDS} rounds.`);
    let added = false;
    open = [];
    for (const program of input.programs) {
      const planned = [...pinned, ...requirementPicks.keys()].filter((code) => !onRecord.has(code));
      const result = auditProgram(program, [...input.record, ...planned.map((code) => plannedAttempt(code, input.catalog))], { gradeHistoryComplete: false });
      const context: Choosing = { program, catalog: input.catalog, known: new Set([...onRecord, ...pinned, ...requirementPicks.keys()]), taken: new Set(), picks: new Map(), open };
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
  const known = new Set([...onRecord, ...picks.keys()]);
  const prerequisiteFor = new Map<string, Set<string>>();
  for (const code of sorted(picks.keys())) {
    const entry = input.catalog.get(code);
    if (!entry) continue;
    const needs = route(entry.requires, code, known, input.catalog, new Set([code]));
    for (const need of needs.add) {
      known.add(need.code);
      if (picks.has(need.code)) continue;
      prerequisiteFor.set(need.code, (prerequisiteFor.get(need.code) ?? new Set()).add(need.for));
    }
  }
  for (const code of sorted(prerequisiteFor.keys())) picks.set(code, { kind: "prerequisite", for: sorted(prerequisiteFor.get(code)!) });
  return { picks, open };
}

/* ---------- placing courses ---------- */

type Placing = {
  before: ReadonlySet<string>;
  /** Placed this term, plus the bundle being tried. */
  now: ReadonlySet<string>;
  earned: number;
  canJoin: (code: string) => boolean;
  /** On the record or on the roadmap. */
  planned: ReadonlySet<string>;
};

/**
 * The alternatives of an "or" the roadmap follows: the ones whose courses
 * it planned, when there are any, else all of them. Choosing courses
 * planned "MATH 1100" over "or consent", so placing waits for MATH 1100
 * rather than letting the consent clause pass first.
 */
function followed(children: readonly Requires[], planned: ReadonlySet<string>): readonly Requires[] {
  const routed = children.filter((child) => {
    const leaves = courseLeaves(child);
    return leaves.size > 0 && [...leaves].every((code) => planned.has(code));
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
      if (at.before.has(rule.code)) return [];
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

function blockers(rule: Requires, done: ReadonlySet<string>, earned: number, planned: ReadonlySet<string>, concurrent = false): Blockers | null {
  switch (rule.kind) {
    case "course":
      if (done.has(rule.code)) return null;
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

/** Courses that are on the record for prerequisites, and the credits they have earned or will have by `start`. */
function readRecord(record: RoadmapInput["record"]): { onRecord: Set<string>; earned: number } {
  const credits = new Map<string, number>();
  for (const course of record) {
    const counts = course.sourceKind === "claimed" ? true : course.inProgress || earnsCredit(course);
    if (!counts) continue;
    // A course counts once; credits it never printed count as none, so standing is never overstated.
    credits.set(course.code, Math.max(credits.get(course.code) ?? 0, course.credits ?? 0));
  }
  return { onRecord: new Set(credits.keys()), earned: [...credits.values()].reduce((sum, value) => sum + value, 0) };
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
  }
}

export function planRoadmap(input: RoadmapInput): Roadmap {
  const seasons = input.seasons ?? DEFAULT_SEASONS;
  const maxTerms = input.maxTerms ?? DEFAULT_MAX_TERMS;
  validate(input, seasons, maxTerms);
  const { onRecord, earned: earnedOnRecord } = readRecord(input.record);
  const pinned = sorted(new Set((input.pinned ?? []).filter((code) => !onRecord.has(code))));
  const { picks, open } = chooseCourses(input, onRecord, pinned);

  const unplaced = new Map<string, UnplacedReason>();
  const pending = new Set<string>();
  for (const code of picks.keys()) {
    const entry = input.catalog.get(code);
    if (!entry) unplaced.set(code, { kind: "no-data" });
    else if (pinned.includes(code)) continue;
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

  const planned: ReadonlySet<string> = new Set([...onRecord, ...picks.keys()]);
  const placedBefore = new Set<string>(onRecord);
  const placedOnRoadmap = new Set<string>();
  const firstReady = new Map<string, number>();
  const skippedSeason = new Map<string, boolean>();
  const terms: { term: Term; credits: number; courses: PlannedCourse[] }[] = [];
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
      });
      now.add(code);
      credits += entry.credits;
    };

    if (index === 0) for (const code of placedPinned) place(code, true);

    const offeredNow = (other: string) => input.catalog.get(other)!.offered?.includes(term.season) ?? true;
    for (const code of order) {
      if (!pending.has(code) || now.has(code)) continue;
      const base: Placing = { before: placedBefore, now, earned, planned, canJoin: (other) => pending.has(other) && !now.has(other) };
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
      ruleMet: course.why.kind !== "pinned" || joinsNeeded(rule(course.code), { before: placedBefore, now, earned, planned, canJoin: () => false }) !== null,
    }));
    terms.push({ term, credits, courses: withs.sort((a, b) => byCode(a.code, b.code)) });
    laidOut += 1;
    for (const code of now) {
      placedBefore.add(code);
      placedOnRoadmap.add(code);
    }
    earned += input.fullTermsForStanding ? Math.max(credits, input.creditLimit) : credits;
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
    const bundle = bundleFor(code, { before: placedBefore, now: new Set(), earned, planned, canJoin: (other) => stuckSet.has(other) }, rule);
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
