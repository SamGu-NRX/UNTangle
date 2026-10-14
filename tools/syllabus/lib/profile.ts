/**
 * Parse a facultyinfo.unt.edu faculty profile page into structured teaching
 * rows. The page is server-rendered Drupal: each scheduled course is one
 * `<tr>` inside a `profile-courses-table` with cells
 *
 *   course.section | course title | term | [Syllabus link] | [SPOT link]
 *
 * The syllabus link, when posted, is an `<a class="profile-syllabus">` inside
 * the row and usually points at the S3 mirror. A row without one means the
 * instructor has not posted a syllabus for that section; that is a fact about
 * coverage and must be preserved, not padded.
 */

export interface TeachingRow {
  courseCode: string;
  section: string;
  title: string;
  term: string;
  syllabusUrl: string | null;
}

export interface FacultyProfile {
  name: string | null;
  profileUrl: string;
  rows: TeachingRow[];
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "CSCE 3201.402" -> { courseCode: "CSCE 3201", section: "402" } */
export function parseCourseCell(cell: string): { courseCode: string; section: string } | null {
  const match = cell.trim().match(/^([A-Z]{2,5})\s?(\d{4})\.(\d{3})$/);
  if (!match) return null;
  return { courseCode: `${match[1]} ${match[2]}`, section: match[3] };
}

function rowsFromTable(html: string, profileUrl: string): TeachingRow[] {
  const rows: TeachingRow[] = [];
  const trPattern = /<tr>([\s\S]*?)<\/tr>/g;
  for (const tr of html.matchAll(trPattern)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) => td[1]);
    if (cells.length < 3) continue;
    const course = parseCourseCell(stripTags(cells[0]));
    if (!course) continue;
    const title = stripTags(cells[1]);
    const term = stripTags(cells[2]);
    const link = tr[1].match(/<a[^>]*class="[^"]*profile-syllabus[^"]*"[^>]*href="([^"]+)"/);
    const plainLink = link ? link[1] : tr[1].match(/<a[^>]*href="(https?:[^"]+)"[^>]*>\s*Syllabus\s*</)?.[1];
    rows.push({
      courseCode: course.courseCode,
      section: course.section,
      title,
      term,
      syllabusUrl: plainLink ?? null,
    });
  }
  return rows;
}

export function parseProfile(html: string, profileUrl: string): FacultyProfile {
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const name = heading ? stripTags(heading[1]).replace(/\s*-\s*UNT.*$/i, "").trim() : null;
  return { name: name || null, profileUrl, rows: rowsFromTable(html, profileUrl) };
}
