/**
 * Everything the Courses view knows about one school. The view, the model and
 * the panel read only this profile and the engine's portable types; another
 * school supplies its own profile (catalog, transcript mapping, grade policy,
 * term and link-outs) and nothing else changes.
 */
import prerequisiteTable from "@/lib/course-catalog/prerequisites.json";
import {
  adaptUntCatalog,
  courseReferences,
  evidenceFromUntTranscript,
  normalizeUntCourseId,
  untAdapter,
  type CatalogCourse,
  type Evidence,
  type SchoolAdapter,
} from "@/lib/prereq";
import { gradeHistorySources, type GradeHistorySource } from "@/lib/course-history";
import { planningTerm } from "@/lib/planner-sections";
import { courses as seedCourses } from "@/lib/seed-data";
import type { TranscriptCourseRecord } from "@/lib/types";

export type CatalogEntry = {
  id: string;
  title: string;
  department: string;
  credits: number;
  description: string;
};

export type InstructorRef = { name: string };
export type LinkOut = { key: string; label: string; href: string; hint: string };

export type SchoolProfile = {
  catalog: readonly CatalogCourse[];
  entries: ReadonlyMap<string, CatalogEntry>;
  /** Original requirement text, shown beside the readable rule. */
  ruleSource(id: string): string;
  dependents(id: string): string[];
  adapter: SchoolAdapter;
  evidenceFromTranscript(records: readonly TranscriptCourseRecord[]): Evidence;
  /** Returns null for codes the school's id format rejects. */
  normalizeId(code: string): string | null;
  planningTerm: string;
  /** Credit budget Auto fills for the planning term. */
  autoCreditBudget: number;
  linkOuts(instructor: InstructorRef, courseId: string): LinkOut[];
  gradeHistory: GradeHistorySource;
  /** "CSCE 1030" -> ["CSCE", "1030"] for URLs and grade lookups. */
  splitId(id: string): [string, string];
};

const safeNormalize = (code: string) => {
  try {
    return normalizeUntCourseId(code);
  } catch {
    return null;
  }
};

/** Seed titles carry Texas common-course equivalents after two spaces: "Computer Science I  (COSC 1336 or COSC 1436)". */
const displayTitle = (title: string) => title.replace(/\s{2,}\(.*\)\s*$/, "").trim();

let cached: SchoolProfile | null = null;

export function untProfile(): SchoolProfile {
  if (cached) return cached;
  const entries = new Map<string, CatalogEntry>(
    seedCourses.map((course) => [
      course.code,
      {
        id: course.code,
        title: displayTitle(course.title),
        department: course.department,
        credits: course.creditHours,
        description: course.description,
      },
    ]),
  );
  const raw = prerequisiteTable as Array<[string, string, string]>;
  const catalog = adaptUntCatalog(
    raw.map(([course_number, number_of_hours, prerequisites]) => ({
      course_number,
      number_of_hours,
      prerequisites,
      prerequisites_course_codes: [],
    })),
    new Map([...entries.values()].map((entry) => [entry.id, entry.credits])),
  );
  const ruleText = new Map(raw.map(([code, , text]) => [normalizeUntCourseId(code), text.trim()]));
  const dependents = new Map<string, string[]>();
  for (const course of catalog) {
    for (const id of courseReferences(course.prerequisite)) {
      dependents.set(id, [...(dependents.get(id) ?? []), course.id]);
    }
  }
  cached = {
    catalog,
    entries,
    ruleSource: (id) => ruleText.get(id) ?? "",
    dependents: (id) => dependents.get(id) ?? [],
    adapter: untAdapter,
    evidenceFromTranscript: evidenceFromUntTranscript,
    normalizeId: safeNormalize,
    // The term the planner loads real sections for (lib/planner-sections.ts).
    planningTerm: planningTerm.label,
    // A full-time UNT undergraduate load is 12+ hours; 15 is the common
    // four-year pace. Not a degree-plan rule; change it with the school config.
    autoCreditBudget: 15,
    linkOuts: untLinkOuts,
    gradeHistory: gradeHistorySources.untgrades,
    splitId: (id) => {
      const [subject, number] = id.split(" ");
      return [subject, number];
    },
  };
  return cached;
}

/**
 * Per-instructor link-outs, checked against the live sites on 2026-10-13:
 * - RateMyProfessors school 1252 is University of North Texas (1257 is
 *   Minnesota). The search page lists matching UNT professors.
 * - The Faculty Information System (facultyinfo.unt.edu) is public under Texas
 *   HB 2504. Profiles are keyed by EUID, which UNTangle does not have, so both
 *   links open its name search; the profile it lists holds syllabi and the CV,
 *   and SPOT results sit under that profile's Previous Courses tab. The SPOT
 *   link adds the course so the search states what the student is after.
 */
export function untLinkOuts(instructor: InstructorRef, courseId: string): LinkOut[] {
  const name = encodeURIComponent(instructor.name);
  return [
    {
      key: "rmp",
      label: "RateMyProf",
      href: `https://www.ratemyprofessors.com/search/professors/1252?q=${name}`,
      hint: `Ratings for ${instructor.name} on RateMyProfessors`,
    },
    {
      key: "syllabi",
      label: "Syllabi & CV",
      href: `https://facultyinfo.unt.edu/faculty-search?name=${name}`,
      hint: `${instructor.name} in UNT's Faculty Information System`,
    },
    {
      key: "spot",
      label: "SPOT",
      href: `https://facultyinfo.unt.edu/faculty-search?name=${name}&course=${encodeURIComponent(courseId)}`,
      hint: `SPOT course evaluations for ${instructor.name}, under Previous Courses on their profile`,
    },
  ];
}
