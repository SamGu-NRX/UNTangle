import type { SearchItem } from "@/components/ui/SearchPalette";

type SearchableCourse = { code: string; title: string; creditHours: number };

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Ranks catalog courses for ⌘K: a code match ("csce 21", "csce21") before
 * a title that starts with the query, before a title containing every
 * word. Ties keep catalog order. This is the shell's interim search; the
 * Courses view owns the full one (instructors, status, buildings) and can
 * hand its own sections to the palette.
 */
export function searchCourses(courses: SearchableCourse[], query: string, limit = 8): SearchItem[] {
  const q = normalize(query);
  if (!q) return [];
  const compactQ = q.replace(/ /g, "");
  const words = q.split(" ");
  const scored: Array<{ course: SearchableCourse; score: number; index: number }> = [];
  courses.forEach((course, index) => {
    const code = normalize(course.code);
    const compactCode = code.replace(/ /g, "");
    const title = normalize(course.title);
    let score = 0;
    if (compactCode.startsWith(compactQ)) score = 4;
    else if (compactCode.includes(compactQ)) score = 3;
    else if (title.startsWith(q)) score = 2;
    else if (words.every((word) => title.includes(word))) score = 1;
    if (score) scored.push({ course, score, index });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ course }) => ({
      id: course.code,
      code: course.code,
      title: course.title,
      meta: `${course.creditHours} cr`,
    }));
}

/** "CSCE 2100" → "/courses/CSCE/2100", the course detail route. */
export function courseHref(code: string): string {
  const [subject, number] = code.split(/\s+/);
  return `/courses/${subject}/${number}`;
}
