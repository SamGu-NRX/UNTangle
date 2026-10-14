import { readFileSync } from "node:fs";
import { recommendNextTerm, unlockAnalysis } from "../../src/lib/pathing";
import type { PathingAnalysis, RequirementProgress, TermRecommendation } from "../../src/lib/pathing";
import { csBs2026 } from "../../src/lib/pathing/plans/cs-bs-2026-27";
import { adaptUntCatalog, evidenceFromUntTranscript, inferStatuses, normalizeUntCourseId, parseUntPrerequisite, untAdapter } from "../../src/lib/prereq";
import type { InferenceResult, Reason, UntCatalogEntry } from "../../src/lib/prereq";
import type { TranscriptCourseRecord } from "../../src/lib/types";

type CatalogRow = readonly [string, string, string];

export const csTranscript = ["CSCE 1010", "CSCE 1015", "CSCE 1030", "CSCE 1040", "CSCE 2100", "MATH 1710", "MATH 1720"];

export type CsPathingScenario = {
  report: string;
  unparseableRows: readonly string[];
  prereqCoverage: Readonly<Record<"full" | "partial" | "unknown", number>>;
  result: InferenceResult;
  analysis: PathingAnalysis;
  recommendations: readonly TermRecommendation[];
};

const record = (code: string): TranscriptCourseRecord => ({
  id: code,
  code,
  title: "Course",
  term: "Fall 2025",
  grade: "A",
  credits: 3,
  sourceKind: "unt",
  confidence: 1,
  rationale: "Verified transcript",
  duplicateExcluded: false,
  appliedStatus: "completed",
  prerequisiteSatisfied: true,
  reviewRequired: false,
});

/** Leading integer of an hour cell: "3 hours", "1-3 hours" (the smaller end), "(3;0;2)" contact strings. */
function leadingInteger(text: string): number | undefined {
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

/** The engine's own "Check with advisor" lines under a reason, in tree order. */
function advisorNotes(reason: Reason): string[] {
  const children = reason.children ?? [];
  if (children.length === 0) return reason.kind === "advisor" && reason.outcome === "unknown" ? [reason.message] : [];
  return children.flatMap(advisorNotes);
}

function progressLine(progress: RequirementProgress): string {
  const branch = progress.branch ? ` (following ${progress.branch})` : "";
  const unit = progress.target === 1 ? progress.unit.slice(0, -1) : progress.unit;
  const terms = progress.met ? "met"
    : progress.remainingTerms === null ? "no route"
    : `${progress.tracked ? "" : "at least "}${progress.remainingTerms} ${progress.remainingTerms === 1 ? "term" : "terms"} left`;
  return `  ${progress.name}${branch}: ${progress.done} of ${progress.target} ${unit} done; ${terms}`;
}

function render(scenario: Omit<CsPathingScenario, "report">, rowCount: number): string {
  const { analysis, recommendations, result, unparseableRows, prereqCoverage } = scenario;
  const gaps = prereqCoverage.partial + prereqCoverage.unknown;
  const lines = [
    `UNTangle pathing report: ${csBs2026.name}`,
    `Plan source: ${csBs2026.source}`,
    `Catalog rows: ${rowCount}; unparseable rows: ${unparseableRows.length}; prerequisite parse gaps: ${gaps} (full ${prereqCoverage.full}, partial ${prereqCoverage.partial}, unknown ${prereqCoverage.unknown})`,
    `Transcript, all grade A: ${csTranscript.join(", ")}`,
    `Remaining critical path: ${analysis.remainingCriticalPath ?? "unknown"} terms`,
    "",
    "Warnings:",
    ...analysis.warnings.map((warning) => `  ${warning}`),
    "",
    "Requirements:",
    ...analysis.requirements.map(progressLine),
    "",
    "Recommended next term (credit target 15):",
    ...recommendations.map((rec, index) => `  ${index + 1}. ${rec.courseId} (${rec.credits} cr): ${rec.reason}`),
    "",
    "One term away, but status unknown until an advisor clears the engine's check:",
    ...analysis.advisorChecks.flatMap((id) => [
      `  ${id}: ${analysis.courses.get(id)!.reason}`,
      // Catalog text can end in a space; trim it so the fixture has no trailing whitespace.
      ...advisorNotes(result.statuses.get(id)!.reason).map((note) => `    engine: ${note.trimEnd()}`),
    ]),
    "",
    "Remaining-path courses (id | status | chain | critical | unlocks direct/transitive):",
    ...[...analysis.courses.values()]
      .filter((course) => course.onRemainingPath)
      .map((course) => `  ${course.courseId} | ${course.status} | ${course.remainingChain ?? "none"} | ${course.onCriticalPath ? "yes" : "no"} | ${course.unlocksDirect.length}/${course.unlocksTransitive.length}`),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The real 656-row catalog through the real engine, scored against the real
 * 2026-2027 CS BS plan. Credit hours come from each row's leading integer.
 * Rows that cannot be read are reported, and prerequisite text that does not
 * fully parse is counted, so advisor-check rows stay visible.
 */
export function buildCsScenario(): CsPathingScenario {
  const rows = JSON.parse(
    readFileSync(new URL("../../src/lib/course-catalog/prerequisites.json", import.meta.url), "utf8"),
  ) as readonly CatalogRow[];
  const creditHours = new Map<string, number>();
  const unparseableRows: string[] = [];
  const prereqCoverage = { full: 0, partial: 0, unknown: 0 };
  for (const [courseNumber, hours, prerequisites] of rows) {
    let id: string;
    try {
      id = normalizeUntCourseId(courseNumber);
    } catch {
      unparseableRows.push(`${courseNumber}: unrecognized course code`);
      continue;
    }
    const hoursValue = leadingInteger(hours);
    if (hoursValue === undefined) {
      unparseableRows.push(`${courseNumber}: no leading integer in "${hours}"`);
      continue;
    }
    creditHours.set(id, hoursValue);
    prereqCoverage[parseUntPrerequisite(prerequisites).coverage]++;
  }
  const entries: readonly UntCatalogEntry[] = rows.map(([courseNumber, hours, prerequisites]) => ({
    course_number: courseNumber,
    number_of_hours: hours,
    prerequisites,
    prerequisites_course_codes: [],
  }));
  const catalog = adaptUntCatalog(entries, creditHours);
  const result = inferStatuses(catalog, evidenceFromUntTranscript(csTranscript.map(record)), untAdapter);
  const analysis = unlockAnalysis(csBs2026, result);
  const recommendations = recommendNextTerm(csBs2026, result, { creditTarget: 15 });
  const scenario = { unparseableRows, prereqCoverage, result, analysis, recommendations };
  return { ...scenario, report: render(scenario, rows.length) };
}
