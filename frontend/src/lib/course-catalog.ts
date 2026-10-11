import { courses as bundledCourses } from "@/lib/seed-data";
import type { Course } from "@/lib/types";

/**
 * Catalog-backed deep-link helpers for the course journey.
 *
 * The bundled catalog is the only authority on course identity: a deep link
 * either resolves to a catalog row or is reported as an unknown code. Nothing
 * here fabricates a course for a code the catalog does not know.
 */

export type CourseLocator =
  | { kind: "found"; course: Course }
  | { kind: "unknown-code"; code: string };

export function normalizeCourseCode(subject: string, number: string): string {
  return `${subject.trim().toUpperCase()} ${number.trim().toUpperCase()}`;
}

export function findCatalogCourse(catalog: Course[], code: string): Course | undefined {
  return catalog.find((course) => course.code === code);
}

/** Resolve a `/courses/[subject]/[number]` deep link against the catalog. */
export function resolveCourseLocator(
  subject: string,
  number: string,
  catalog: Course[] = bundledCourses,
): CourseLocator {
  const code = normalizeCourseCode(subject, number);
  const course = findCatalogCourse(catalog, code);
  return course ? { kind: "found", course } : { kind: "unknown-code", code };
}

/** Stable href for a catalog course code ("CSCE 3444" → "/courses/CSCE/3444"). */
export function courseDetailsHref(code: string): string {
  const [subject, number] = code.split(/\s+/);
  return `/courses/${subject}/${number}`;
}
