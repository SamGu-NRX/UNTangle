/**
 * What the Courses lens lists, in the order a student acts on it
 * (docs/design/untangle-v3.md, rules 4 and 8): the term tray holds the plan,
 * then To check, You can take, Taking now, Later and Done. Each row carries
 * one fact, the one the student acts on: why it waits, what it needs, or the
 * grade. Pure, so the same answer reaches the view and the tests.
 */
import { suggestNext } from "@/lib/prereq";
import type { Major } from "@/lib/types";
import type { CourseModel, CourseRowModel } from "./course-model";
import type { RuleNode } from "./rules";

export type GroupKey = "check" | "can" | "taking" | "later" | "done";

export const GROUPS: ReadonlyArray<{ key: GroupKey; title: string }> = [
  { key: "check", title: "To check" },
  { key: "can", title: "You can take" },
  { key: "taking", title: "Taking now" },
  { key: "later", title: "Later" },
  { key: "done", title: "Done" },
];

/** To check and You can take start open; the rest start closed (rule 8). */
export const OPEN_AT_START: Readonly<Record<GroupKey, boolean>> = { check: true, can: true, taking: false, later: false, done: false };

const groupOf: Record<CourseRowModel["status"], GroupKey | null> = {
  check: "check",
  available: "can",
  taking: "taking",
  locked: "later",
  done: "done",
  covered: "done",
  // Planned courses live in the term tray.
  planned: null,
};

/** A subhead and its rows. `label` is null when the group has one part. */
export type GroupPart = { label: string | null; ids: string[] };
export type CourseGroup = { key: GroupKey; title: string; parts: GroupPart[]; count: number };

/** Rows a group shows before "Show N more". Starting value: no data on how far students scroll. */
export const ROWS_BEFORE_MORE = 12;

/**
 * For a major the degree audit covers (model/degree.ts): the courses the
 * degree still needs, and the ones the major itself needs.
 */
export type AuditScope = { needed: ReadonlySet<string>; neededByMajor: ReadonlySet<string> };

/** A transcript record counts even when the course is waiting for a check (an unrecognized grade, a row to review). */
const studentHasIt = (row: CourseRowModel) => row.override || row.onTranscript || !["available", "locked", "check"].includes(row.status);

/**
 * The courses the lens lists, and every course the student already has
 * something on (a grade, this term, a plan, a mark). For a major the audit
 * covers, that is what the degree still needs; for another major, its
 * sample core list and its department's catalog. `wide` (the student asked
 * for every department) and having no department (no major, Undeclared)
 * put the whole catalog in scope.
 */
export function degreeScope(model: CourseModel, major: Pick<Major, "department" | "coreCourseCodes"> | null, wide = false, audit: AuditScope | null = null): Set<string> {
  const rows = [...model.rows.values()];
  const department = major && major.department !== "—" ? major.department : null;
  if (wide || (!department && !audit)) return new Set(rows.map((row) => row.id));
  if (audit) return new Set(rows.filter((row) => audit.needed.has(row.id) || studentHasIt(row)).map((row) => row.id));
  const core = new Set(major?.coreCourseCodes ?? []);
  return new Set(rows.filter((row) => core.has(row.id) || row.department === department || studentHasIt(row)).map((row) => row.id));
}

export function buildGroups(model: CourseModel, major: Pick<Major, "department" | "coreCourseCodes"> | null, wide = false, audit: AuditScope | null = null): CourseGroup[] {
  const scope = degreeScope(model, major, wide, audit);
  const byGroup: Record<GroupKey, string[]> = { check: [], can: [], taking: [], later: [], done: [] };
  // Sample lists: core first, in the degree plan's order. Audited: what Auto would pick first, by the
  // prerequisite engine's ranking (most unfinished courses downstream). Then the rest by code.
  const lead = audit
    ? suggestNext({ coreCourseCodes: [...audit.needed] }, model.inference, { maxCredits: Number.MAX_SAFE_INTEGER }).map((suggestion) => suggestion.courseId).filter((id) => scope.has(id))
    : (major?.coreCourseCodes ?? []).filter((id) => scope.has(id));
  const leadSet = new Set(lead);
  for (const id of [...lead, ...[...scope].filter((id) => !leadSet.has(id)).sort()]) {
    const key = groupOf[model.rows.get(id)!.status];
    if (key) byGroup[key].push(id);
  }
  const department = major && major.department !== "—" ? major.department : null;
  return GROUPS.flatMap((group) => {
    const ids = byGroup[group.key];
    if (ids.length === 0) return [];
    // Subheads only where they sort a choice: what you can take, split by what asks for it.
    const parts = group.key === "can" ? canParts(ids, audit, audit ? null : new Set(major?.coreCourseCodes ?? []), department && !wide ? department : null) : [{ label: null, ids }];
    return [{ ...group, parts, count: ids.length }];
  });
}

function canParts(ids: string[], audit: AuditScope | null, core: ReadonlySet<string> | null, department: string | null): GroupPart[] {
  const split = audit
    ? [
        { label: "For your major", ids: ids.filter((id) => audit.neededByMajor.has(id)) },
        { label: "For the University Core", ids: ids.filter((id) => audit.needed.has(id) && !audit.neededByMajor.has(id)) },
        { label: "More courses", ids: ids.filter((id) => !audit.needed.has(id)) },
      ]
    : [
        { label: "In your degree plan", ids: ids.filter((id) => core!.has(id)) },
        { label: department ? `More ${department} courses` : "More courses", ids: ids.filter((id) => !core!.has(id)) },
      ];
  const filled = split.filter((part) => part.ids.length > 0);
  return filled.length > 1 ? filled : [{ label: null, ids }];
}

/** The parts with at most `limit` rows in all, and how many were held back. */
export function visibleParts(parts: readonly GroupPart[], limit: number): { parts: GroupPart[]; hidden: number } {
  let left = limit;
  const shown = parts.flatMap((part) => {
    if (left <= 0) return [];
    const ids = part.ids.slice(0, left);
    left -= ids.length;
    return [{ ...part, ids }];
  });
  const total = parts.reduce((sum, part) => sum + part.ids.length, 0);
  return { parts: shown, hidden: total - Math.min(total, limit) };
}

export type RowFact = { text: string; tone: "attention" | "default" };

/**
 * "A and B", "A, B and 2 more"; "A or B", "A, B or another". `unnamed` counts
 * requirements that have no short name (a nested group), so the list never
 * reads as complete when it is not.
 */
function listTerms(names: readonly string[], word: "and" | "or", unnamed = 0): string {
  const total = names.length + unnamed;
  if (unnamed === 0 && total <= 2) return names.join(` ${word} `);
  const shown = names.slice(0, 2);
  const rest = total - shown.length;
  const tail = word === "and" ? `${rest} more` : rest === 1 ? "another" : `${rest} others`;
  return `${shown.join(", ")} ${word} ${tail}`;
}

/** "Consent of department" -> "department consent"; "consent of Honors College dean" -> "consent of the Honors College dean". */
function consentPhrase(text: string): string | null {
  const clean = text.trim().replace(/^by\s+/i, "").replace(/\s+required$/i, "");
  const short = clean.match(/^(instructor|department(?:al)?) consent$/i);
  if (short) return `${short[1].toLowerCase().replace("departmental", "department")} consent`;
  const of = clean.match(/^consent (?:of )?(?:the )?(.+)$/i);
  if (!of) return null;
  return /^\w+$/.test(of[1]) ? `${of[1].toLowerCase()} consent` : `consent of the ${of[1]}`;
}

/** A requirement short enough to name in a row: a course, a consent, a standing. Groups and unreadable text have none. */
function term(node: RuleNode): string | null {
  switch (node.kind) {
    case "course":
      return node.id;
    case "standing":
      // Reads as part of a sentence: "Needs junior standing".
      return node.text.toLowerCase();
    case "consent":
    case "unparsed":
      return /consent/i.test(node.text) ? consentPhrase(node.text) : null;
    default:
      return null;
  }
}

const isGroup = (node: RuleNode) => node.kind === "all" || node.kind === "any";

/**
 * What is missing, in a row's words: "CSCE 2110", "MATH 1650 or instructor
 * consent", "junior standing". Null when nothing in the rule can be named.
 */
export function missingText(node: RuleNode | null): string | null {
  if (!node) return null;
  if (node.kind === "course") return node.id;
  if (node.kind !== "all" && node.kind !== "any") return term(node);
  const named = node.items.flatMap((item) => term(item) ?? []);
  if (named.length === 0) return null;
  if (node.kind === "all") {
    // A required consent is the step the student takes first.
    const consent = node.items.find((item) => (item.kind === "consent" || item.kind === "unparsed") && term(item));
    if (consent) return term(consent);
    // Unreadable text in an AND is left to the detail; a nested group is still one more requirement.
    return listTerms(named, "and", node.items.filter(isGroup).length);
  }
  // An alternative is never dropped: one without a name counts as another.
  return listTerms(named, "or", node.items.length - named.length);
}

/** "Needs CSCE 2110", "Needs MATH 1650 or instructor consent", "Take with BIOL 1710". */
function needsPhrase(node: RuleNode | null): string | null {
  if (node?.kind === "course" && node.together) return `Take with ${node.id}`;
  const missing = missingText(node);
  return missing ? `Needs ${missing}` : null;
}

/**
 * The one fact a row shows, or null when the row needs none (a course you can
 * take shows its + instead; Taking now says it in its header).
 */
export function rowFact(row: CourseRowModel): RowFact | null {
  switch (row.status) {
    case "check": {
      if (row.waiver) return { text: "Ask an advisor if it's waived", tone: "attention" };
      if (row.assessment?.reason.message.includes("transcript grade is unrecognized")) {
        return { text: "Transcript grade needs a check", tone: "attention" };
      }
      return { text: needsPhrase(row.unmet) ?? "Catalog rule needs an advisor", tone: "attention" };
    }
    case "locked":
      return { text: needsPhrase(row.unmet) ?? "Prerequisites not met", tone: "default" };
    case "done":
      return { text: row.meta.kind === "grade" ? `Grade ${row.meta.grade}` : "Marked done by you", tone: "default" };
    case "covered":
      return row.coveredBy ? { text: `Covered by ${row.coveredBy}`, tone: "default" } : null;
    default:
      return null;
  }
}
