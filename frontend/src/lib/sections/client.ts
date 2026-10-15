import { clientTimeoutMs } from "./config";
import type { CourseSections } from "./model";

/**
 * The course and section a myUNT class number names, or null when the term
 * has no such number. Throws when the sections can't be read right now, so
 * "no match" is only ever said after looking.
 */
export async function findClassNumber(term: string, number: string): Promise<{ courseCode: string; sectionId: string } | null> {
  const response = await fetch(`/api/sections/${encodeURIComponent(term)}/class/${encodeURIComponent(number)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(clientTimeoutMs),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Class number ${number} in ${term}: HTTP ${response.status}`);
  const { courseCode, sectionId }: { courseCode: string; sectionId: string } = await response.json();
  return { courseCode, sectionId };
}

/** One course's enrollment options for a term, from UNTangle's sections proxy. */
export async function getCourseSections(term: string, courseCode: string): Promise<CourseSections> {
  courseCode = courseCode.trim().toUpperCase();
  const [subject, number] = courseCode.split(" ");
  const path = [term, subject, number].map(encodeURIComponent).join("/");
  const response = await fetch(`/api/sections/${path}`, {
    cache: "no-store",
    // Leave room for both upstream deadlines, but bound a stalled connection to this app.
    signal: AbortSignal.timeout(clientTimeoutMs),
  });
  if (!response.ok) throw new Error(`Sections for ${term} ${courseCode}: HTTP ${response.status}`);
  // The proxy is this app's own route and builds this type, so only the echo is checked.
  const result: CourseSections = await response.json();
  if (result.term !== term || result.courseCode !== courseCode) {
    throw new Error(`Asked for ${term} ${courseCode}, got ${result.term} ${result.courseCode}`);
  }
  return result;
}
