/**
 * The degree facts Courses shows, from the degree audit
 * (@untangle/core/degree/audit): what each requirement still needs, what is
 * in progress or rests on courses the student marked done, what only an
 * advisor can settle, how many credits are left, and the one set of courses
 * Auto may plan from. The prerequisite model (course-model.ts) still decides
 * readiness: whether a course is locked, needs a check, or can be taken now.
 *
 * The audit covers Computer Science, BS and Computer Engineering, BS, each
 * with the University Core, from the 2026-2027 catalog. Other majors get
 * `{ kind: "unaudited" }`, and Courses keeps its sample core lists for them.
 */
import { auditProgram, type AuditCourse, type AuditResult, type ClaimedCourse, type NodeOutcome } from "@untangle/core/degree/audit";
import type { Citation, ProgramData } from "@untangle/core/degree/types";
import { auditInput } from "@/lib/degree/audit-input";
import { DEGREE_DATA } from "@/lib/degree/programs.generated";
import type { Major, MajorId } from "@/lib/types";
import type { SchoolProfile } from "../school";
import { manualDoneIds, type CourseModel, type CourseRowModel, type PlanSnapshot } from "./course-model";

/** The audit's program for each planner major it covers. */
const AUDITED: Partial<Record<MajorId, string>> = { cs: "cs-bs", ce: "ce-bs" };
const CORE_ID = "core";

export const isAudited = (major: Pick<Major, "id"> | null): boolean => Boolean(major && AUDITED[major.id]);

export type Area = "major" | "core";

/**
 * One requirement that is not finished: still needed, met only once this
 * term's courses pass, or met only by courses the student marked done.
 */
export type Requirement = {
  /** Stable within one catalog: the program and the requirement's place in its tree. */
  key: string;
  area: Area;
  name: string;
  status: "needed" | "inProgress" | "claimed";
  /** What the row says it needs, in one short phrase. */
  fact: string;
  citation: Citation;
  /** The audit's outcome, for the detail. */
  outcome: NodeOutcome;
};

/** A requirement only an advisor can settle, with the audit's reason. */
export type AdvisorItem = {
  key: string;
  area: Area;
  name: string;
  /** The catalog's own words for a rule the audit does not check, else the audit's reason. */
  text: string;
  /** True when `text` quotes the catalog. */
  quote: boolean;
  /** Courses on the record that may count here. */
  candidates: string[];
  citation: Citation;
};

export type HoursLeft = {
  /** The degree's total: 120 for CS BS, 121 for CE BS. */
  required: number;
  /**
   * Credits the total still lacks once in-progress courses pass and the
   * student's marks hold, or null when some course's credits are unknown.
   * A floor: the requirements below can still need courses past the total.
   */
  left: number | null;
  /** With credits unknown, the most that can be left: the unknown courses can only lower it. */
  atMost: number;
  /** In-progress courses counted at their catalog credits, because the transcript printed 0. */
  fromCatalog: string[];
  /** Courses counted with no known credits. */
  unknown: string[];
  /** Credits counted on the student's word alone. */
  claimed: number;
};

export type AuditedDegree = {
  kind: "audited";
  programName: string;
  catalogYear: string;
  hours: HoursLeft;
  areas: { area: Area; title: string; requirements: Requirement[] }[];
  advisor: AdvisorItem[];
  /** Every course a requirement still needs, in the major or the core. */
  needed: ReadonlySet<string>;
  /** The ones the major needs. */
  neededByMajor: ReadonlySet<string>;
  /**
   * Courses the prerequisite model counts as covered by a later course
   * (CSCE 1030 once CSCE 1040 is passed) while the degree still lists them,
   * with the course that covers each. Only an advisor can waive one.
   */
  waivers: ReadonlyMap<string, string>;
  /** Marked-done courses the transcript decides instead. */
  ignoredClaims: string[];
};

export type DegreeCheck = { kind: "none" } | { kind: "unaudited" } | AuditedDegree;

/** A record the audit reads: transcript rows, the student's marks, and courses to treat as in progress. */
type AuditRecord = Pick<PlanSnapshot, "statuses" | "transcript" | "manualCredit">;

const programById = (id: string): ProgramData => {
  const found = DEGREE_DATA.programs.find((program) => program.id === id);
  if (!found) throw new Error(`The degree data has no program "${id}".`);
  return found;
};

/** The catalog's credits for a course, or null when UNTangle's catalog does not carry it. */
function catalogCredits(profile: SchoolProfile, code: string): number | null {
  const id = profile.normalizeId(code);
  return id === null ? null : (profile.entries.get(id)?.credits ?? null);
}

/**
 * Both audits for one record. `planned` courses join as in-progress
 * attempts at their catalog credits, so Auto can ask what is still needed
 * once its picks pass. Courses the student marked done join as claims.
 */
function runAudits(profile: SchoolProfile, record: AuditRecord, programId: string, planned: readonly string[] = []) {
  // The planner's record names no catalog year, so it is audited against the one year the data has; the
  // page says which. auditInput's warnings are not shown: the catalog year is that note, and rows waiting
  // for review already wait in To check, counting for nothing, as they do here.
  const input = auditInput({ catalogId: null, transcriptRecords: record.transcript }, DEGREE_DATA, {
    claimed: [...manualDoneIds(profile, record)],
    catalogHours: (code) => catalogCredits(profile, code),
  });
  // Unreachable while the record names no catalog year; loud if a caller ever passes one the data lacks.
  if (!input.ok) throw new Error(input.error);
  const attempts: (AuditCourse | ClaimedCourse)[] = [
    ...input.attempts,
    ...input.claims,
    ...planned.map((code) => ({ code, grade: null, credits: catalogCredits(profile, code), sourceKind: "current" as const, inProgress: true, term: Number.MAX_SAFE_INTEGER })),
  ];
  // The planner keeps only the rows the student confirmed, so it cannot show every graded attempt (as in the audit route).
  const options = { gradeHistoryComplete: false };
  return {
    major: auditProgram(programById(programId), attempts, options),
    core: auditProgram(programById(CORE_ID), attempts, options),
    fromCatalog: input.catalogHours,
  };
}

/** Every course a requirement's remaining work names, in any of its options. */
function neededCodes(outcomes: readonly NodeOutcome[], into = new Set<string>()): Set<string> {
  for (const outcome of outcomes) {
    const remaining = outcome.remaining;
    switch (remaining.kind) {
      case "courses":
        remaining.courses.forEach((code) => into.add(code));
        remaining.oneOf.flat(2).forEach((code) => into.add(code));
        break;
      case "choose":
        remaining.eligible.forEach((slot) => slot.options.forEach((option) => option.courses.forEach((code) => into.add(code))));
        break;
      case "hours":
        remaining.eligible.flat().forEach((code) => into.add(code));
        break;
      case "parts":
      case "branch":
        neededCodes(outcome.children ?? [], into);
        break;
      case "none":
      case "advisor":
        break;
    }
  }
  return into;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The credits a requirement still lacks when that is all it asks for: an
 * hours node's hours, a group's parts added up, the least of a choice's
 * branches. Null when it asks for courses instead.
 */
function creditsLeft(outcome: NodeOutcome): number | null {
  const remaining = outcome.remaining;
  if (remaining.kind === "hours") return remaining.hours;
  if (remaining.kind === "none") return 0;
  const parts = (outcome.children ?? []).map(creditsLeft);
  if (parts.some((part) => part === null) || parts.length === 0) return null;
  if (remaining.kind === "parts") return (parts as number[]).reduce((sum, part) => sum + part, 0);
  if (remaining.kind === "branch") return Math.min(...(parts as number[]));
  return null;
}

/** "EENG 2710 and TECM 2700", "16 courses", "6 credits", "2 courses". */
function neededFact(outcome: NodeOutcome): string {
  const remaining = outcome.remaining;
  switch (remaining.kind) {
    case "courses": {
      const total = remaining.courses.length + remaining.oneOf.length;
      if (remaining.oneOf.length === 0 && total <= 2) return remaining.courses.join(" and ");
      return plural(total, "course");
    }
    case "choose":
      return plural(remaining.picks, "course");
    default: {
      const credits = creditsLeft(outcome);
      if (credits !== null) return plural(credits, "credit");
      return outcome.kind === "choice" ? `One of ${outcome.children?.length ?? 2} ways` : "See what it needs";
    }
  }
}

/** The catalog's own total in a name: "American History, 6 hours", "Laboratory science, 6-8 hours (choose 2)". */
const TOTAL_IN_NAME = /,\s*\d+(?:-\d+)?\s+hours(?:\s*\(choose \d+\))?$/;

/**
 * A row's name. A choice's audit name carries the branch it settled on, so
 * the catalog heading names it instead. The row's fact says how much is
 * left, so the catalog's total is dropped from the name.
 */
const displayName = (outcome: NodeOutcome) => (outcome.kind === "choice" ? outcome.citation.heading : outcome.name).replace(TOTAL_IN_NAME, "");

/**
 * Walks one program's outcomes into rows. Groups open into their parts, so
 * a row is always one requirement the student can act on; a choice stays one
 * row, because its branches are alternatives, not parts.
 */
function collect(outcomes: readonly NodeOutcome[], area: Area, prefix: string, rows: Requirement[], advisor: AdvisorItem[]): void {
  outcomes.forEach((outcome, index) => {
    const key = `${prefix}.${index}`;
    const remaining = outcome.remaining;
    if (remaining.kind === "advisor") {
      const quote = outcome.kind === "note" || outcome.kind === "policy";
      // The catalog counts hours; the app says credits (docs/design/copy.md). The quote below keeps the catalog's words.
      advisor.push({ key, area, name: outcome.name.replace(/\b(\d+(?:-\d+)?) hours\b/, "$1 credits"), text: quote ? outcome.detail : remaining.reason, quote, candidates: remaining.candidates, citation: outcome.citation });
      return;
    }
    if (outcome.kind === "group" && outcome.status !== "satisfied") {
      collect(outcome.children ?? [], area, key, rows, advisor);
      return;
    }
    if (outcome.status === "advisory" && outcome.children) {
      // A choice the audit cannot decide: its undecided branch says why.
      collect(outcome.children, area, key, rows, advisor);
      return;
    }
    const base = { key, area, name: displayName(outcome), citation: outcome.citation, outcome };
    if (outcome.status === "unsatisfied" && remaining.kind !== "none") rows.push({ ...base, status: "needed", fact: neededFact(outcome) });
    else if (outcome.status === "inProgress") rows.push({ ...base, status: "inProgress", fact: "Taking now" });
    else if (outcome.status === "claimed") rows.push({ ...base, status: "claimed", fact: "You marked this done" });
  });
}

const ORDER: Record<Requirement["status"], number> = { needed: 0, inProgress: 1, claimed: 2 };

function rowsOf(result: AuditResult, area: Area, advisor: AdvisorItem[]): Requirement[] {
  const rows: Requirement[] = [];
  collect(result.requirements, area, result.programId, rows, advisor);
  // Needed first, then what this term finishes, then what rests on the student's word; catalog order within each.
  return rows.map((row, index) => ({ row, index })).sort((a, b) => ORDER[a.row.status] - ORDER[b.row.status] || a.index - b.index).map(({ row }) => row);
}

function hoursLeft(result: AuditResult, fromCatalog: string[]): HoursLeft {
  const totals = result.totals;
  if (!totals) throw new Error(`${result.programId} has no total-hours rule, so Courses cannot say how many credits are left.`);
  const counted = totals.finished + totals.inProgress + totals.claimed;
  return {
    required: totals.required,
    left: totals.stillNeeded,
    atMost: Math.max(0, totals.required - counted),
    fromCatalog,
    unknown: totals.unknownHours,
    claimed: totals.claimed,
  };
}

/** The degree check for the plan's record against the chosen major. */
export function checkDegree(profile: SchoolProfile, plan: AuditRecord, model: Pick<CourseModel, "rows">, major: Pick<Major, "id"> | null): DegreeCheck {
  if (!major) return { kind: "none" };
  const programId = AUDITED[major.id];
  if (!programId) return { kind: "unaudited" };
  const audits = runAudits(profile, plan, programId);
  const advisor: AdvisorItem[] = [];
  const majorRows = rowsOf(audits.major, "major", advisor);
  const coreRows = rowsOf(audits.core, "core", advisor);
  const neededByMajor = neededCodes(audits.major.requirements);
  const needed = neededCodes(audits.core.requirements, new Set(neededByMajor));
  const waivers = new Map<string, string>();
  for (const id of needed) {
    const coveredBy = model.rows.get(id)?.coveredBy;
    if (coveredBy) waivers.set(id, coveredBy);
  }
  return {
    kind: "audited",
    programName: audits.major.programName,
    catalogYear: DEGREE_DATA.catalogYear,
    hours: hoursLeft(audits.major, audits.fromCatalog),
    areas: [
      { area: "major", title: audits.major.programName, requirements: majorRows },
      { area: "core", title: audits.core.programName, requirements: coreRows },
    ],
    advisor,
    needed,
    neededByMajor,
    waivers,
    ignoredClaims: [...new Set([...audits.major.ignoredClaims, ...audits.core.ignoredClaims])].sort(),
  };
}

/**
 * What the degree still needs once `planned` courses pass, for Auto. The
 * same audit as `checkDegree`, with the planned courses added as in
 * progress, so a requirement Auto just filled stops offering more courses.
 */
export function stillNeeded(profile: SchoolProfile, plan: AuditRecord, major: Pick<Major, "id">, planned: readonly string[]): Set<string> {
  const programId = AUDITED[major.id];
  if (!programId) throw new Error(`The degree audit does not cover the ${major.id} major.`);
  const audits = runAudits(profile, plan, programId, planned);
  return neededCodes(audits.core.requirements, neededCodes(audits.major.requirements));
}

/**
 * The course model with the degree's verdict on covered courses: one the
 * degree still lists moves from Done to To check, as a question for an
 * advisor. Readiness is untouched, so it still unlocks what it unlocked.
 */
export function withDegree(model: CourseModel, degree: DegreeCheck): CourseModel {
  if (degree.kind !== "audited" || degree.waivers.size === 0) return model;
  const rows = new Map<string, CourseRowModel>(model.rows);
  for (const [id, coveredBy] of degree.waivers) {
    const row = rows.get(id);
    if (!row) continue;
    // A planned one stays in the tray; the detail still says to ask.
    rows.set(id, row.status === "covered" ? { ...row, status: "check", meta: { kind: "text", text: "Ask an advisor" }, waiver: coveredBy } : { ...row, waiver: coveredBy });
  }
  return { ...model, rows };
}
