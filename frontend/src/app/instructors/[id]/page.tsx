import { redirect } from "next/navigation";

/**
 * Instructor pages are replaced by the instructor picker in the course panel
 * (docs/design/untangle-v3-opus/HANDOFF.md §5). Old links carry a numeric id
 * from the retired Express backend's SQLite table, which its seed script
 * reassigned on every run, and the untgrades.app history keys instructors by
 * name, so no id can be mapped to a course. Every old link lands on Courses.
 */
export default function InstructorRedirectPage(): never {
  redirect("/courses");
}
