/**
 * An enrollment option as core's section filters read it.
 *
 * `Section` in model.ts already carries the structural subset
 * (@untangle/core/filters names it FilterableSection for exactly this), so
 * the mapping is flattening components' seats and meetings. The context is
 * the part the section cannot know: the course's credit hours from the
 * bundled catalogue and the campus site of every place a meeting can be in.
 *
 * Sites, conservatively: on-campus catalogue buildings are UNT Denton, and
 * so are the room codes the planner counts as Denton sites (MGV, MHA); the
 * Frisco codes map to unt-frisco. Off-campus catalogue buildings map to
 * unt-other — the planner's "another UNT site" (planner-sections.ts
 * otherSiteOf: off-campus except Discovery Park, which stays Denton) — so a
 * section meeting there never passes a Denton site filter. A place the
 * directory does not name is unknown, and unknown never satisfies a site
 * filter (docs/architecture/README.md). Pure and import-safe from client code.
 */

import { evaluateFilters, type FilterableSection, type FilterContext, type SiteDirectory, type SectionFilter } from "@untangle/core/filters";
import { campusBuildings } from "@/lib/campus-locations";
import { DISCOVERY_PARK_ID } from "@/lib/planner-sections";
import { courses } from "@/lib/seed-data";
import type { Section } from "./model";

/** Campus sites the directory names: Denton, Frisco, and "another UNT site". */
const DENTON = "unt-denton";
const FRISCO = "unt-frisco";
const OTHER = "unt-other";

/** Room codes the campus catalogue does not map, with their sites (planner-sections.ts). */
const roomCodeSites: Readonly<Record<string, string>> = { MGV: DENTON, MHA: DENTON, FRLD: FRISCO, FRISCO: FRISCO };

export const siteDirectory: SiteDirectory = {
  byBuildingId: Object.fromEntries(
    campusBuildings.map((building) => [
      building.id,
      building.isOffCampus && building.id !== DISCOVERY_PARK_ID ? OTHER : DENTON,
    ]),
  ),
  byRoomCode: roomCodeSites,
};

/** Credit hours from the bundled catalogue; null when it does not list the course. */
export function creditHoursOf(courseCode: string): number | null {
  const course = courses.find((course) => course.code === courseCode);
  if (!course) return null;
  return typeof course.creditHours === "number" && Number.isFinite(course.creditHours) ? course.creditHours : null;
}

export function filterContextForCourse(courseCode: string): FilterContext {
  return { creditHours: creditHoursOf(courseCode), sites: siteDirectory };
}

/** The structural subset core judges; a parsed section passes in as is. */
export function filterableSection(section: Section): FilterableSection {
  return {
    status: section.status,
    instructor: { display: section.instructor.display },
    // A detailed section row is its own component: its seats stand in when
    // the source lists no separate linked components.
    components: (section.components.length > 0 ? section.components : [{ seats: section.seats }]).map((component) => ({
      seats: { open: component.seats.open },
    })),
    meetings: section.meetings.map((meeting) => ({
      kind: meeting.kind,
      buildingId: meeting.buildingId,
      buildingCode: meeting.buildingCode,
      day: meeting.day,
      startMinutes: meeting.startMinutes,
      endMinutes: meeting.endMinutes,
      async: meeting.async,
    })),
  };
}

/**
 * The option's outcome under the filter list: "pass", "fail", or "unknown"
 * when the data cannot judge it. An empty list passes.
 */
export function evaluateSectionFilters(section: Section, filters: readonly SectionFilter[]): "pass" | "fail" | "unknown" {
  return evaluateFilters(filterableSection(section), filters, filterContextForCourse(section.courseCode));
}
