/**
 * The prerequisite stops the detail's Path draws, read from the catalog rule
 * against the student's record. Each top-level requirement is one stop; an
 * "or" group is one choice stop that any of its courses meets, so
 * alternatives are never drawn as a sequence. A course counts as met only
 * when it is done or covered: a course still in progress is shown as such.
 */
import type { CourseModel, CourseRowModel, RowStatus } from "./course-model";
import { missingText } from "./groups";
import { ruleCourseIds, unmetFromReason, type RuleNode } from "./rules";

export type StopState = "done" | "covered" | "taking" | "planned" | "todo";

export type PathStopModel =
  | { kind: "course"; id: string; state: StopState }
  /**
   * One of `options` alternatives over the courses `ids`. `chosen` is the course that meets it, or is
   * underway, when that alternative is a single course.
   */
  | { kind: "choice"; ids: string[]; options: number; chosen: string | null; state: StopState };

const stateOf = (status: RowStatus | undefined): StopState =>
  status === "done" || status === "covered" || status === "taking" || status === "planned" ? status : "todo";

/** Done and covered meet a requirement; taking and planned don't yet. */
export const isMet = (state: StopState) => state === "done" || state === "covered";

/** The order a choice prefers its member in: met first, then underway, then planned. */
const RANK: Record<StopState, number> = { done: 0, covered: 1, taking: 2, planned: 3, todo: 4 };

function requirements(node: RuleNode): RuleNode[] {
  return node.kind === "all" ? node.items.flatMap(requirements) : [node];
}

type Rows = ReadonlyMap<string, Pick<CourseRowModel, "status">>;

/** How far along one alternative is: a course by its status, "and" by its weakest part, "or" by its strongest. */
function optionState(node: RuleNode, rows: Rows): StopState {
  switch (node.kind) {
    case "course":
      return stateOf(rows.get(node.id)?.status);
    case "all":
      return node.items.map((item) => optionState(item, rows)).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "done" as StopState);
    case "any":
      return node.items.map((item) => optionState(item, rows)).reduce((a, b) => (RANK[b] < RANK[a] ? b : a), "todo" as StopState);
    default:
      return "todo";
  }
}

export function pathStops(rule: RuleNode | null, rows: Rows): PathStopModel[] {
  if (!rule) return [];
  return requirements(rule).flatMap((node): PathStopModel[] => {
    if (node.kind === "course") return [{ kind: "course", id: node.id, state: stateOf(rows.get(node.id)?.status) }];
    if (node.kind !== "any") return []; // standing, consent and unread text are in the catalog rule line
    const ids = ruleCourseIds(node);
    if (ids.length === 0) return [];
    const best = node.items.reduce((a, b) => (RANK[optionState(b, rows)] < RANK[optionState(a, rows)] ? b : a));
    const state = optionState(best, rows);
    const chosen = state !== "todo" && best.kind === "course" ? best.id : null;
    return [{ kind: "choice", ids, options: node.items.length, chosen, state }];
  });
}

/**
 * What the catalog-rule line says, from the assessed prerequisite outcome,
 * never from the course's own status. A course the student is taking is
 * assessed as if it weren't on the record, so the line agrees with the path
 * drawn above it. Credit makes no claim about the rule: passing a course can
 * itself prove some of its prerequisites (covered), so "without" would
 * contradict the path there.
 */
export type RuleVerdict =
  | { kind: "no-rule" }
  | { kind: "covered"; by: string }
  | { kind: "meets" }
  /** Taking it while the rule isn't met: `missing` names what isn't. */
  | { kind: "without"; missing: string | null }
  | { kind: "credit" }
  /** The engine can't decide (consent, unread text): the line asks for an advisor. */
  | { kind: "check" }
  | { kind: "not-yet" };

export function ruleVerdict(row: CourseRowModel, model: Pick<CourseModel, "assessWithoutRecord">): RuleVerdict {
  if (!row.rule) return { kind: "no-rule" };
  if (row.coveredBy) return { kind: "covered", by: row.coveredBy };
  if (row.status === "done") return { kind: "credit" };
  const taking = row.status === "taking";
  const assessment = taking ? model.assessWithoutRecord(row.id) : row.assessment;
  const outcome = assessment?.reason.outcome;
  if (outcome === "satisfied") return { kind: "meets" };
  if (taking) return { kind: "without", missing: assessment ? missingText(unmetFromReason(assessment.reason)) : null };
  return outcome === "unknown" ? { kind: "check" } : { kind: "not-yet" };
}

/** "You're taking it without CSCE 1030 on record." */
export function withoutSentence({ missing }: Extract<RuleVerdict, { kind: "without" }>): string {
  return missing ? `You're taking it without ${missing} on record.` : "You're taking it, but the rule isn't met on record.";
}
