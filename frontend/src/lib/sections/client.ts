import { clientTimeoutMs } from "./config";
import type { CourseSections } from "./model";

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
