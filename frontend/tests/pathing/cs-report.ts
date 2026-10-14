import { readFileSync } from "node:fs";
import { recommendNextTerm, unlockAnalysis } from "../../src/lib/pathing";
import type { CoursePathing, PathingAnalysis, TermRecommendation } from "../../src/lib/pathing";
import { adaptUntCatalog, evidenceFromUntTranscript, inferStatuses, normalizeUntCourseId, parseUntPrerequisite, untAdapter } from "../../src/lib/prereq";
import type { UntCatalogEntry } from "../../src/lib/prereq";
import type { TranscriptCourseRecord } from "../../src/lib/types";
import { majors } from "../../src/lib/seed-data";

type CatalogRow = readonly [string, string, string];

export type CsPathingScenario = {
  report: string;
  unparseableRows: readonly string[];
  prereqCoverage: Readonly<Record<"full" | "partial" | "unknown", number>>;
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

/** Leading integer of an hour cell: "3 hours", "1-3 hours" (smaller of the range), "(3;0;2)" contact strings. */
function leadingInteger(text: string): number | undefined {
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function catalogRows(): readonly CatalogRow[] {
  return JSON.parse(
    readFileSync(new URL("../../src/lib/course-catalog/prerequisites.json", import.meta.url), "utf8"),
  ) as readonly CatalogRow[];
}

function courseLine(course: CoursePathing, status: string): string {
  const reasons = course.reasons.length > 0 ? ` | reasons: ${course.reasons.join("; ")}` : "";
  return `${course.courseId} | ${course.group} | ${status} | ${course.credits} cr | direct ${course.unlocksDirect.length} | transitive ${course.unlocksTransitive.length} | chain ${course.remainingChain}${reasons}`;
}

function render(
  analysis: PathingAnalysis,
  recommendations: readonly TermRecommendation[],
  rowCount: number,
  unparseableRows: readonly string[],
  prereqCoverage: Readonly<Record<"full" | "partial" | "unknown", number>>,
): string {
  const gaps = prereqCoverage.partial + prereqCoverage.unknown;
  const lines = [
    "UNTangle pathing report for Computer Science, BS (major cs)",
    `Catalog rows: ${rowCount}; unparseable rows: ${unparseableRows.length}; prerequisite parse gaps: ${gaps} (full ${prereqCoverage.full}, partial ${prereqCoverage.partial}, unknown ${prereqCoverage.unknown})`,
    `Universe courses: ${analysis.universe.length}; remaining critical path: ${analysis.remainingCriticalPath}`,
    `Warnings: ${analysis.warnings.length > 0 ? analysis.warnings.join("; ") : "none"}`,
    "",
    "Next-term recommendation (credit target 15):",
    ...recommendations.map((rec, index) => {
      const entry: CoursePathing = {
        courseId: rec.courseId,
        group: rec.group,
        status: "eligible",
        credits: rec.credits,
        unlocksDirect: rec.unlocksDirect,
        unlocksTransitive: rec.unlocksTransitive,
        remainingChain: rec.remainingChain,
        available: true,
        reasons: rec.reasons,
      };
      return `  ${index + 1}. ${courseLine(entry, "eligible")}`;
    }),
    "",
    "Universe analysis (sorted by course id):",
    ...analysis.universe.map((id) => `  ${courseLine(analysis.courses.get(id)!, analysis.courses.get(id)!.status)}`),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Real catalog, real engine, real major: the 656-row UNT catalog is adapted with a
 * leading-integer credit-hours map, and the transcript is exactly CSCE 1030, 1040,
 * 2100, MATH 1710, 1720 with grade A. Rows that cannot be parsed are reported, never
 * skipped silently, and prerequisite text that does not fully parse is counted as
 * coverage, so advisor-check and equivalent-clause rows stay visible instead of
 * being presented as fully understood.
 */
export function buildCsScenario(): CsPathingScenario {
  const rows = catalogRows();
  const creditHours = new Map<string, number>();
  const unparseableRows: string[] = [];
  const coverage = { full: 0, partial: 0, unknown: 0 };
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
    // Rows failing code or hours parsing are already reported above; coverage
    // counts only rows that actually enter the catalog.
    coverage[parseUntPrerequisite(prerequisites).coverage]++;
  }
  const entries: readonly UntCatalogEntry[] = rows.map(([courseNumber, hours, prerequisites]) => ({
    course_number: courseNumber,
    number_of_hours: hours,
    prerequisites,
    prerequisites_course_codes: [],
  }));
  const catalog = adaptUntCatalog(entries, creditHours);
  const major = majors.find((candidate) => candidate.id === "cs");
  if (!major) throw new Error("Computer Science, BS major is missing from seed data.");
  const evidence = evidenceFromUntTranscript(["CSCE1030", "CSCE1040", "CSCE2100", "MATH1710", "MATH1720"].map(record));
  const result = inferStatuses(catalog, evidence, untAdapter);
  const analysis = unlockAnalysis(major, result);
  const recommendations = recommendNextTerm(major, result, { creditTarget: 15 });
  return {
    report: render(analysis, recommendations, rows.length, unparseableRows, coverage),
    unparseableRows,
    prereqCoverage: coverage,
    analysis,
    recommendations,
  };
}
