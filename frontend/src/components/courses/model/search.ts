/**
 * The one search model behind ⌘K and the phone search sheet: code, title and
 * instructor matches, ranked so a typed code wins over a word in a title.
 */
import type { Instructor } from "@/lib/sections/model";

/** The parts of an option (lib/sections Section) the index reads. */
type InstructedOption = { courseCode: string; instructor: Instructor; components: ReadonlyArray<{ instructor: Instructor }> };

export type SearchCourse = { id: string; title: string };
export type SearchInstructor = { name: string; courseIds: string[] };
export type SearchResults = { courses: SearchCourse[]; instructors: SearchInstructor[] };

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Instructors of the given options, each component's included. A display
 * name naming several people ("Allen Mann; Ana Ruiz") is split, and an
 * option without one (staff, TBA) adds nobody.
 */
export function instructorIndex(sections: readonly InstructedOption[]): SearchInstructor[] {
  const byName = new Map<string, Set<string>>();
  for (const section of sections) {
    const displays = [section.instructor, ...section.components.map((component) => component.instructor)].map((i) => i.display);
    for (const name of new Set(displays.flatMap((display) => display?.split("; ") ?? []))) {
      byName.set(name, (byName.get(name) ?? new Set()).add(section.courseCode));
    }
  }
  return [...byName.entries()]
    .map(([name, ids]) => ({ name, courseIds: [...ids].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function courseScore(course: SearchCourse, query: string, words: string[]): number {
  const code = compact(course.id);
  const q = compact(query);
  if (q && code === q) return 100;
  if (q && code.startsWith(q)) return 80;
  // "1030" alone should find CSCE 1030.
  if (q && /^\d/.test(q) && code.slice(code.search(/\d/)).startsWith(q)) return 70;
  const title = course.title.toLowerCase();
  if (words.every((word) => title.includes(word))) return title.startsWith(words[0]) ? 50 : 40;
  if (words.every((word) => `${course.id} ${title}`.toLowerCase().includes(word))) return 30;
  return 0;
}

/**
 * @param preferred course ids that win ties, such as the student's major core:
 *   "1720" should list MATH 1720 before BIOL 1720 for a Computer Science student.
 */
export function searchCatalog(
  query: string,
  courses: readonly SearchCourse[],
  instructors: readonly SearchInstructor[],
  preferred: ReadonlySet<string> = new Set(),
  limits = { courses: 8, instructors: 4 },
): SearchResults {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { courses: [], instructors: [] };
  const scored = courses
    .map((course) => {
      const score = courseScore(course, query, words);
      return { course, score: score > 0 && preferred.has(course.id) ? score + 5 : score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.course.id.localeCompare(b.course.id))
    .slice(0, limits.courses)
    .map((entry) => entry.course);
  const matchedInstructors = instructors
    .filter((instructor) => words.every((word) => instructor.name.toLowerCase().includes(word)))
    .slice(0, limits.instructors);
  return { courses: scored, instructors: matchedInstructors };
}
