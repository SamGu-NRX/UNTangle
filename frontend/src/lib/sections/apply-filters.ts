/**
 * Applying section filters to one course's sections, as the sections route
 * serves them.
 *
 * Parsing is loud: a filter the schema rejects, or a grade threshold that is
 * not a number from 0 to 4, is a 400, never a guess. Applying is core's
 * three-valued judge: a section is kept only when the filter list passes it,
 * and a requested instructor-grade threshold keeps a section only when its
 * instructor has accepted evidence at or above the value — unknown evidence
 * never satisfies a filter (docs/architecture/README.md), so sections whose
 * instructor did not match, or whose history could not be read, are dropped
 * and counted in the summary, never silently blended in.
 *
 * Pure: sources arrive as values, so the route wires the network and the
 * tests do not.
 */

import type { SectionFilter } from "../../../../packages/contracts/src/filters";
import { SectionFiltersSchema } from "../../../../packages/contracts/src/filters";
import type { CourseHistory, HistoryResult } from "@/lib/grades-history/types";
import { evaluateSectionFilters } from "./filterable";
import { instructorEvidence } from "./instructor-evidence";
import type { CourseSections } from "./model";

/** Parsed query parameters: validated filters, plus the optional grade threshold in hundredths. */
export type ParsedFilterParams = { filters: SectionFilter[]; minInstructorGpaHundredths: number | null };

/**
 * Reads the filter list the way `SectionFiltersSchema` accepts it: an array
 * where each kind appears at most once. The contract is the one source of the
 * accepted wire form, so a contract change cannot leave a second validator
 * behind.
 */
function parseFilters(raw: unknown): { ok: true; filters: SectionFilter[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "filters must be a JSON array of section filters" };
  const parsed = SectionFiltersSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    return { ok: false, error: `filters rejected: ${detail}` };
  }
  return { ok: true, filters: parsed.data };
}

/**
 * Reads the filter query parameters. `filters` is a URL-encoded JSON array
 * per SectionFiltersSchema (each kind at most once); `minInstructorGpa` is a
 * number from 0 to 4, at most two decimals (whole hundredths, exact).
 */
export function parseSectionFilterParams(params: URLSearchParams): ParsedFilterParams | { error: string } {
  // The route contract makes duplicate parameters errors, not first-value-wins:
  // get() below would silently read only the first value of a repeated key.
  if (params.getAll("filters").length > 1) return { error: "filters must appear at most once" };
  if (params.getAll("minInstructorGpa").length > 1) return { error: "minInstructorGpa must appear at most once" };
  let filters: SectionFilter[] = [];
  const raw = params.get("filters");
  if (raw !== null && raw.trim() !== "") {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return { error: "filters must be a JSON array of section filters" };
    }
    const parsed = parseFilters(parsedJson);
    if (!parsed.ok) return { error: parsed.error };
    filters = parsed.filters;
  }
  let minInstructorGpaHundredths: number | null = null;
  const rawGpa = params.get("minInstructorGpa");
  if (rawGpa !== null) {
    if (!/^\d+(\.\d{1,2})?$/.test(rawGpa) || Number(rawGpa) > 4) {
      return { error: "minInstructorGpa must be a number from 0 to 4 with at most two decimals" };
    }
    minInstructorGpaHundredths = Math.round(Number(rawGpa) * 100);
  }
  return { filters, minInstructorGpaHundredths };
}

/** Why grade evidence is what it is, so an empty result can be explained: "not-requested" when no threshold asked for it, else the service's answer. */
export type GradeHistoryStatus = { status: "not-requested" | "ok" | "no-history" | "unavailable"; reason?: string };

export type FilterSummary = {
  applied: SectionFilter[];
  minInstructorGpaHundredths: number | null;
  gradeHistory: GradeHistoryStatus;
  hidden: { total: number; unknown: number };
};

export type FilteredCourse = { course: CourseSections; summary: FilterSummary };

/**
 * Filters one course's sections. `history` is the course's history result as
 * the grades-history service returned it, or null when the caller chose not
 * to read any. Null reports "not-requested"; a service "no-history" result
 * reports confirmed absence. The returned course keeps its shape: same
 * status, provenance and diagnostic, sections replaced.
 */
export function applySectionFilters(
  course: CourseSections,
  filters: SectionFilter[],
  minInstructorGpaHundredths: number | null,
  history: HistoryResult<CourseHistory> | null,
): FilteredCourse {
  const gradeHistory: GradeHistoryStatus =
    history === null
      ? { status: "not-requested" }
      : history.status === "unavailable"
        ? { status: "unavailable", reason: history.error.reason }
        : { status: history.status };
  // Samples count as sections too: they are proper options and core can judge
  // them; a "missing" course just has none.
  const sections = course.sections;
  let kept = 0;
  let unknown = 0;
  const passing = sections.filter((section) => {
    const outcome = evaluateSectionFilters(section, filters);
    if (outcome === "fail") return false;
    if (outcome === "unknown") {
      unknown += 1;
      return false;
    }
    if (minInstructorGpaHundredths === null) return true;
    const evidence = instructorEvidence(section, history === null ? null : history.status === "ok" ? history.data : null);
    // No accepted evidence is unknown — the section might pass, and its count
    // explains the empty result. A known mean below the threshold is a
    // definite fail: hidden, but never counted as unknown.
    if (evidence.kind !== "known") {
      unknown += 1;
      return false;
    }
    return evidence.meanGradePointsHundredths >= minInstructorGpaHundredths;
  });
  kept = passing.length;
  const summary: FilterSummary = {
    applied: filters,
    minInstructorGpaHundredths,
    gradeHistory,
    hidden: { total: sections.length - kept, unknown },
  };
  return { course: { ...course, sections: passing }, summary };
}
