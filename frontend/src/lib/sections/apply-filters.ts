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

import type { ClassDay, MeetingMode, SectionFilter } from "@untangle/core/filters";
import type { CourseHistory, HistoryResult } from "@/lib/grades-history/types";
import { evaluateSectionFilters } from "./filterable";
import { instructorEvidence } from "./instructor-evidence";
import type { CourseSections } from "./model";

/** Parsed query parameters: validated filters, plus the optional grade threshold in hundredths. */
export type ParsedFilterParams = { filters: SectionFilter[]; minInstructorGpaHundredths: number | null };

const CLASS_DAYS: ClassDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MEETING_MODES: MeetingMode[] = ["in-person", "online-timed", "online-async"];
const SITE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INSTRUCTOR_NAME = /^\S(?: ?\S)*$/;
const isIntegerMinute = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 24 * 60;
const isBoundedNumber = (value: unknown, max: number): value is number => typeof value === "number" && value >= 0 && value <= max;

/**
 * Validates one filter against the shape `SectionFilterSchema` accepts in
 * `@untangle/contracts/filters`, the contract this file mirrors: each kind
 * carries exactly its fields (unknown extra fields are rejected), lists are
 * non-empty and free of duplicates, and the window/credit bounds are
 * well-formed. The frontend does not depend on the contracts package, so
 * this mirror keeps the accepted wire form identical; a contract change must
 * update both.
 */
function oneFilter(value: unknown, index: number): SectionFilter | { error: string } {
  const fail = (message: string): { error: string } => ({ error: `filters rejected: ${index} ${message}` });
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("is not an object");
  const filter = value as Record<string, unknown>;
  const kind = filter.kind;
  const allowedKinds = ["open-seats", "modality", "site", "days", "time-window", "instructor", "credit-hours"];
  if (typeof kind !== "string" || !allowedKinds.includes(kind)) return fail(`has an unknown filter kind ${JSON.stringify(kind ?? null)}`);
  const extra = Object.keys(filter)
    .filter((key) => key !== "kind")
    .sort()
    .join(",");
  const exact = (fields: string): boolean => extra === fields;
  const choices = (values: unknown, allowed: readonly string[] | null, field: string): string[] | { error: string } => {
    if (!Array.isArray(values) || values.length === 0) return fail(`needs a non-empty ${field} list`);
    for (const entry of values) {
      if (typeof entry !== "string" || (allowed !== null && !allowed.includes(entry))) return fail(`has an unknown ${field} value ${JSON.stringify(entry)}`);
    }
    if (new Set(values).size !== values.length) return fail(`has a duplicate ${field} value`);
    return values as string[];
  };
  switch (kind) {
    case "open-seats": {
      if (!exact("minimum")) return fail("carries fields other than minimum");
      if (!isBoundedNumber(filter.minimum, Number.MAX_SAFE_INTEGER) || !Number.isInteger(filter.minimum) || filter.minimum < 1) {
        return fail("needs a whole minimum of at least 1");
      }
      return { kind: "open-seats", minimum: filter.minimum };
    }
    case "modality": {
      if (!exact("allowed")) return fail("carries fields other than allowed");
      const allowed = choices(filter.allowed, MEETING_MODES, "allowed");
      return "error" in allowed ? allowed : { kind: "modality", allowed: allowed as MeetingMode[] };
    }
    case "site": {
      if (!exact("allowed")) return fail("carries fields other than allowed");
      const allowed = choices(filter.allowed, null, "allowed");
      if ("error" in allowed) return allowed;
      for (const entry of allowed) {
        if (entry.length > 64 || !SITE_ID.test(entry)) return fail(`has an unknown allowed site ${JSON.stringify(entry)}`);
      }
      return { kind: "site", allowed };
    }
    case "days": {
      if (!exact("allowed")) return fail("carries fields other than allowed");
      const allowed = choices(filter.allowed, CLASS_DAYS, "allowed");
      return "error" in allowed ? allowed : { kind: "days", allowed: allowed as ClassDay[] };
    }
    case "time-window": {
      if (!exact("earliestStart,latestEnd")) return fail("carries fields other than earliestStart and latestEnd");
      if (filter.earliestStart !== null && !isIntegerMinute(filter.earliestStart)) return fail("needs an earliest start from 0 to 1440 or null");
      if (filter.latestEnd !== null && !isIntegerMinute(filter.latestEnd)) return fail("needs a latest end from 0 to 1440 or null");
      if (filter.earliestStart === null && filter.latestEnd === null) return fail("bounds at least one side");
      if (filter.earliestStart !== null && filter.latestEnd !== null && filter.latestEnd <= filter.earliestStart) {
        return fail("has a latest end at or before its earliest start");
      }
      return { kind: "time-window", earliestStart: filter.earliestStart as number | null, latestEnd: filter.latestEnd as number | null };
    }
    case "instructor": {
      if (!exact("match,names")) return fail("carries fields other than match and names");
      if (filter.match !== "only" && filter.match !== "not") return fail(`has an unknown match ${JSON.stringify(filter.match ?? null)}`);
      const names = choices(filter.names, null, "names");
      if ("error" in names) return names;
      for (const name of names) {
        if (name.length > 100 || !INSTRUCTOR_NAME.test(name)) return fail(`has a malformed instructor name ${JSON.stringify(name)}`);
      }
      return { kind: "instructor", match: filter.match, names };
    }
    default: {
      if (!exact("max,min")) return fail("carries fields other than min and max");
      if (filter.min !== null && !isBoundedNumber(filter.min, 40)) return fail("needs a min from 0 to 40 or null");
      if (filter.max !== null && !isBoundedNumber(filter.max, 40)) return fail("needs a max from 0 to 40 or null");
      if (filter.min === null && filter.max === null) return fail("bounds at least one side");
      if (filter.min !== null && filter.max !== null && filter.max < filter.min) return fail("has a max below its min");
      return { kind: "credit-hours", min: filter.min as number | null, max: filter.max as number | null };
    }
  }
}

/** The wire form of a filter list: an array where each kind appears at most once. */
function parseFilters(raw: unknown): { ok: true; filters: SectionFilter[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "filters must be a JSON array of section filters" };
  const filters: SectionFilter[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const parsed = oneFilter(raw[index], index);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    if (seen.has(parsed.kind)) return { ok: false, error: `filters rejected: ${index} A second "${parsed.kind}" filter.` };
    seen.add(parsed.kind);
    filters.push(parsed);
  }
  return { ok: true, filters };
}

/**
 * Reads the filter query parameters. `filters` is a URL-encoded JSON array
 * per SectionFiltersSchema (each kind at most once); `minInstructorGpa` is a
 * number from 0 to 4, at most two decimals (whole hundredths, exact).
 */
export function parseSectionFilterParams(params: URLSearchParams): ParsedFilterParams | { error: string } {
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

/** Why grade evidence is what it is, so an empty result can be explained. */
export type GradeHistoryStatus = { status: "ok" | "no-history" | "unavailable"; reason?: string };

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
 * to read any (no threshold requested). The returned course keeps its shape:
 * same status, provenance and diagnostic, sections replaced.
 */
export function applySectionFilters(
  course: CourseSections,
  filters: SectionFilter[],
  minInstructorGpaHundredths: number | null,
  history: HistoryResult<CourseHistory> | null,
): FilteredCourse {
  const gradeHistory: GradeHistoryStatus =
    history === null
      ? { status: "no-history" }
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
    if (evidence.kind !== "known" || evidence.meanGradePointsHundredths < minInstructorGpaHundredths) {
      unknown += 1;
      return false;
    }
    return true;
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
