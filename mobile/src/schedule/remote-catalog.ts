import type { CourseOptions, SectionCatalog } from "@/lib/planner-sections";
import type { CourseSections } from "@/lib/sections/model";

/**
 * A synchronous SectionCatalog over sections already fetched for the
 * planned courses (see useScheduleView). Unknown courses answer `loading`,
 * which the builders treat as no options.
 */
export function catalogFromSections(fetched: readonly CourseSections[]): SectionCatalog {
  const byCode = new Map<string, CourseOptions>();
  for (const result of fetched) {
    byCode.set(result.courseCode, { status: "ready", result });
  }
  return (courseCode) => byCode.get(courseCode) ?? { status: "loading" };
}
