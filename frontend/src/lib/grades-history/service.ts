import { GradesMcpClient } from "./client";
import type { GradesCache } from "./cache";
import { GradesError, NoHistoryError, malformed } from "./errors";
import { courseInput, instructorInput, searchInput, parseCoursePage, parseInstructorPage, parseSearch } from "./parse";
import type { CoursePage, InstructorPage } from "./parse";
import { normalizeCourse, sumCounts, totals } from "./normalize";
import type { CourseHistory, GradeSearch, HistoryResult, InstructorHistory } from "./types";

export function failure<T>(error: unknown): HistoryResult<T> {
  if (error instanceof NoHistoryError) return { status: "no-history", source: "untgrades.app", data: null };
  const known = error instanceof GradesError ? error : new GradesError("upstream", "Grade history request failed");
  return { status: "unavailable", source: "untgrades.app", data: null, error: { reason: known.reason, message: known.message, ...(known.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: known.retryAfterSeconds }) } };
}
async function result<T>(load: () => Promise<T | null>): Promise<HistoryResult<T>> {
  try {
    const data = await load();
    return data === null ? { status: "no-history", source: "untgrades.app", data: null } : { status: "ok", source: "untgrades.app", data };
  } catch (error) { return failure(error); }
}

type Page = { offset: number; nextOffset: number | null };
function parseGeneration<T extends Page>(value: unknown, parse: (value: unknown) => T, check: (page: T, first: T | undefined) => void): T[] {
  if (!Array.isArray(value) || value.length === 0) malformed("history generation", "a nonempty array of complete source pages");
  const pages: T[] = [];
  let offset: number | null = 0;
  for (const raw of value) {
    const page = parse(raw);
    if (offset === null || page.offset !== offset) malformed("history page offsets", "contiguous pages without rows after the final page");
    check(page, pages[0]);
    pages.push(page);
    offset = page.nextOffset;
  }
  if (offset !== null) malformed("history generation", "all pages through the final page");
  return pages;
}
async function loadGeneration<T extends Page>(load: (offset: number) => Promise<unknown>, parse: (value: unknown) => T, check: (page: T, first: T | undefined) => void): Promise<unknown[]> {
  const raw: unknown[] = [];
  let first: T | undefined;
  let offset = 0;
  for (;;) {
    let value: unknown;
    try { value = await load(offset); } catch (error) {
      if (error instanceof NoHistoryError && raw.length > 0) malformed("course continuation page", "history for the course already returned on earlier pages");
      throw error;
    }
    const page = parse(value);
    if (page.offset !== offset) malformed("history page offsets", "the requested offset");
    check(page, first);
    first ??= page;
    raw.push(value);
    if (page.nextOffset === null) return raw;
    offset = page.nextOffset;
  }
}

export class GradesHistoryService {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly client: GradesMcpClient, private readonly cache: GradesCache) {}

  private async cached<T>(key: string, load: () => Promise<unknown>, parse: (value: unknown) => T): Promise<T> {
    let request = this.pending.get(key);
    if (!request) {
      request = (async () => {
        const cached = await this.cache.get(key);
        if (cached === null) throw new NoHistoryError("Cached course not found");
        if (cached !== undefined) {
          try { parse(cached); } catch (error) { await this.cache.remove(key); throw error; }
          return cached;
        }
        let value: unknown;
        try { value = await load(); } catch (error) {
          if (!(error instanceof NoHistoryError)) throw error;
          await this.cache.set(key, null);
          throw error;
        }
        parse(value);
        // A complete validated generation gets one atomic write and one expiry.
        await this.cache.set(key, value);
        return value;
      })();
      this.pending.set(key, request);
    }
    try { return parse(await request); } finally {
      if (this.pending.get(key) === request) this.pending.delete(key);
    }
  }

  private courseHistory(subject: string, number: string): Promise<CourseHistory> {
    const args = courseInput(subject, number);
    const check = (page: CoursePage, first: CoursePage | undefined) => {
      if (page.course.subject !== args.prefix || page.course.number !== args.number) malformed("course page identity", "the requested course");
      if (first && (page.totalSections !== first.totalSections || page.total !== first.total || page.gpa !== first.gpa || page.course.title !== first.course.title || Object.keys({ ...page.counts, ...first.counts }).some((grade) => page.counts[grade] !== first.counts[grade]))) malformed("course pages", "consistent metadata and aggregate counts");
    };
    const parse = (value: unknown) => {
      const pages = parseGeneration(value, parseCoursePage, check);
      const sections = pages.flatMap((page) => page.sections);
      const ids = sections.map((s) => JSON.stringify([s.year, s.term, s.sectionNumber, s.instructor.firstName, s.instructor.lastName]));
      if (new Set(ids).size !== ids.length) malformed("course sections", "unique term/section/instructor rows");
      const history = normalizeCourse(pages[0].course, sections);
      const expected = pages[0].counts;
      if (history.total !== pages[0].total || Object.keys({ ...history.counts, ...expected }).some((grade) => (history.counts[grade] ?? 0) !== (expected[grade] ?? 0))) malformed("course section totals", "the full-course aggregate counts");
      return history;
    };
    // v2 excludes v1's independently expiring page records.
    return this.cached(`v2:course:${args.prefix}:${args.number}`, () => loadGeneration((offset) => this.client.call("get_course_grades", { ...args, offset, limit: 50 }), parseCoursePage, check), parse);
  }

  getCourseHistory(subject: string, number: string): Promise<HistoryResult<CourseHistory>> {
    return result(async () => {
      const history = await this.courseHistory(subject, number);
      return history.sectionCount === 0 ? null : history;
    });
  }

  getInstructorHistory(firstName: string, lastName: string): Promise<HistoryResult<InstructorHistory>> {
    return result(async () => {
      const args = instructorInput(firstName, lastName);
      const check = (page: InstructorPage, first: InstructorPage | undefined) => {
        if (page.instructor.firstName !== args.firstName || page.instructor.lastName !== args.lastName || (first && page.totalCourses !== first.totalCourses)) malformed("instructor page identity/offset", "consistent metadata matching the request");
      };
      const parse = (value: unknown) => {
        const pages = parseGeneration(value, parseInstructorPage, check);
        const courses = pages.flatMap((p) => p.courses);
        if (new Set(courses.map((c) => `${c.subject}:${c.number}`)).size !== courses.length) malformed("instructor courses", "unique courses");
        return { instructor: pages[0].instructor, courses };
      };
      const key = `v2:instructor:${JSON.stringify(args)}`;
      const listed = await this.cached(key, () => loadGeneration((offset) => this.client.call("get_instructor_courses", { ...args, offset, limit: 50 }), parseInstructorPage, check), parse);
      if (listed.courses.length === 0) return null;
      const identity = listed.instructor;
      const courses: CourseHistory[] = [];
      try {
        // Sequential fanout lets upstream cooldown stop subsequent courses immediately.
        for (const c of listed.courses) {
          let full: CourseHistory;
          try { full = await this.courseHistory(c.subject, c.number); } catch (error) {
            if (error instanceof NoHistoryError) malformed("instructor course list", "courses with available section history");
            throw error;
          }
          const sections = full.terms.flatMap((t) => t.sections.filter((s) => s.instructor.firstName === identity.firstName && s.instructor.lastName === identity.lastName).map((s) => ({ sectionNumber: s.sectionNumber, instructor: s.instructor, year: t.year, term: t.term, counts: s.counts })));
          if (!sections.length) malformed("instructor course sections", "at least one section for the listed instructor");
          courses.push(normalizeCourse(full.course, sections));
        }
        return { instructor: identity, courses, ...totals(sumCounts(courses.map((c) => c.counts))) };
      } catch (error) {
        if (error instanceof GradesError && error.reason === "malformed") await this.cache.remove(key);
        throw error;
      }
    });
  }

  searchGrades(query: string): Promise<HistoryResult<GradeSearch>> {
    return result(async () => {
      const normalized = searchInput(query);
      const data = await this.cached(`v2:search:${normalized}`, () => this.client.call("search_grades", { query: normalized }), parseSearch);
      return data.courses.length || data.instructors.length ? data : null;
    });
  }
}
