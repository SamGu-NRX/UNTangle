import { courses } from "@/lib/seed-data";

const catalogCodes = new Set(courses.map((course) => course.code));

/**
 * The catalog code for `/courses/[subject]/[number]`, or null when the
 * segments are not a course code or name a course the catalog lacks. Next
 * has already decoded the segments; decoding again turned `%25` into a
 * URIError (a 500) instead of a 404.
 */
export function courseIdFromRoute(subject: string, number: string): string | null {
  const s = subject.trim().toUpperCase();
  const n = number.trim().toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(s) || !/^\d{4}[A-Z]?$/.test(n)) return null;
  const id = `${s} ${n}`;
  return catalogCodes.has(id) ? id : null;
}
