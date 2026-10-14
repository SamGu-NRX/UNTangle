import type { CourseSections } from "@/lib/sections/model";

import { apiFetch, type FetchLike } from "./http";

/**
 * One course's enrollment options for a term, from UNTangle's sections proxy.
 *
 * Mobile mirror of frontend/src/lib/sections/client.ts with an absolute base
 * URL instead of a same-origin relative path; the response must echo the
 * requested term and course code, or the data is rejected.
 */
export async function fetchCourseSections(
  term: string,
  courseCode: string,
  fetchLike: FetchLike,
): Promise<CourseSections> {
  const [subject, number] = courseCode.split(" ");
  const path = [term, subject, number].map(encodeURIComponent).join("/");
  const response = await apiFetch(`/api/sections/${path}`, { fetchLike });
  if (!response.ok) {
    throw new Error(`Sections for ${term} ${courseCode}: HTTP ${response.status}`);
  }
  // The proxy is this app's own route and builds this type, so only the echo is checked.
  const result: CourseSections = await response.json();
  if (result.term !== term || result.courseCode !== courseCode) {
    throw new Error(`Asked for ${term} ${courseCode}, got ${result.term} ${result.courseCode}`);
  }
  return result;
}
