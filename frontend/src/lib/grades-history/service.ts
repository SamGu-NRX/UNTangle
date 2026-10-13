import { GradesMcpClient } from "./client";
import { GradesDiskCache } from "./cache";
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

export class GradesHistoryService {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly client: GradesMcpClient, private readonly cache: GradesDiskCache) {}

  private async page<T>(key: string, load: () => Promise<unknown>, parse: (value: unknown) => T): Promise<T> {
    let request = this.pending.get(key);
    if (!request) {
      request = (async () => {
        const cached = await this.cache.get(key);
        if (cached === null) throw new NoHistoryError("Cached course not found");
        if (cached !== undefined) { parse(cached); return cached; }
        let value: unknown;
        try { value = await load(); } catch (error) {
          if (!(error instanceof NoHistoryError)) throw error;
          await this.cache.set(key, null);
          throw error;
        }
        parse(value);
        await this.cache.set(key, value);
        return value;
      })();
      this.pending.set(key, request);
    }
    try { return parse(await request); } finally {
      if (this.pending.get(key) === request) this.pending.delete(key);
    }
  }

  private async courseHistory(subject: string, number: string): Promise<CourseHistory> {
    const args = courseInput(subject, number);
    const pages: CoursePage[] = [];
    let offset = 0;
    const keys: string[] = [];
    try {
      do {
        const key = `v1:course:${args.prefix}:${args.number}:${offset}`;
        keys.push(key);
        const page = await this.page(key, () => this.client.call("get_course_grades", { ...args, offset, limit: 50 }), (value) => {
          const parsed = parseCoursePage(value);
          if (parsed.offset !== offset || parsed.course.subject !== args.prefix || parsed.course.number !== args.number) malformed("course page identity/offset", "the requested course and offset");
          const first = pages[0];
          if (first && (parsed.totalSections !== first.totalSections || parsed.total !== first.total || parsed.course.title !== first.course.title || Object.keys({ ...parsed.counts, ...first.counts }).some((grade) => parsed.counts[grade] !== first.counts[grade]))) malformed("course pages", "consistent metadata and aggregate counts");
          return parsed;
        });
        pages.push(page);
        if (page.nextOffset === null) break;
        offset = page.nextOffset;
      } while (true);
      const sections = pages.flatMap((page) => page.sections);
      const ids = sections.map((s) => JSON.stringify([s.year, s.term, s.sectionNumber, s.instructor.id]));
      if (new Set(ids).size !== ids.length) malformed("course sections", "unique term/section/instructor rows");
      const history = normalizeCourse(pages[0].course, sections);
      const expected = pages[0].counts;
      if (history.total !== pages[0].total || Object.keys({ ...history.counts, ...expected }).some((grade) => (history.counts[grade] ?? 0) !== (expected[grade] ?? 0))) malformed("course section totals", "the full-course aggregate counts");
      return { ...history, gpa: pages[0].gpa };
    } catch (error) {
      const missingPage = error instanceof NoHistoryError && pages.length > 0;
      if (missingPage || (error instanceof GradesError && error.reason === "malformed")) {
        await Promise.all(keys.map((key) => this.cache.remove(key)));
      }
      if (missingPage) malformed("course continuation page", "history for the course already returned on earlier pages");
      throw error;
    }
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
      const pages: InstructorPage[] = [];
      let offset = 0;
      const keys: string[] = [];
      try {
        do {
          const key = `v1:instructor:${JSON.stringify(args)}:${offset}`;
          keys.push(key);
          const page = await this.page(key, () => this.client.call("get_instructor_courses", { ...args, offset, limit: 50 }), (value) => {
            const parsed = parseInstructorPage(value);
            if (parsed.offset !== offset || parsed.instructor.firstName !== args.firstName || parsed.instructor.lastName !== args.lastName || (pages[0] && parsed.totalCourses !== pages[0].totalCourses)) malformed("instructor page identity/offset", "consistent metadata matching the request");
            return parsed;
          });
          pages.push(page);
          if (page.nextOffset === null) break;
          offset = page.nextOffset;
        } while (true);
        const listed = pages.flatMap((p) => p.courses);
        if (new Set(listed.map((c) => `${c.subject}:${c.number}`)).size !== listed.length) malformed("instructor courses", "unique courses");
        if (listed.length === 0) return null;
        const identity = pages[0].instructor;
        const courses: CourseHistory[] = [];
        // Sequential fanout lets upstream cooldown stop subsequent courses immediately.
        for (const c of listed) {
          let full: CourseHistory;
          try { full = await this.courseHistory(c.subject, c.number); } catch (error) {
            if (error instanceof NoHistoryError) malformed("instructor course list", "courses with available section history");
            throw error;
          }
          const sections = full.terms.flatMap((t) => t.sections.filter((s) => s.instructor.id === identity.id).map((s) => ({ sectionNumber: s.sectionNumber, instructor: s.instructor, year: t.year, term: t.term, counts: s.counts })));
          if (!sections.length) malformed("instructor course sections", "at least one section for the listed instructor");
          courses.push(normalizeCourse(full.course, sections));
        }
        return { instructor: identity, courses, ...totals(sumCounts(courses.map((c) => c.counts))) };
      } catch (error) {
        if (error instanceof GradesError && error.reason === "malformed") await Promise.all(keys.map((key) => this.cache.remove(key)));
        throw error;
      }
    });
  }

  searchGrades(query: string): Promise<HistoryResult<GradeSearch>> {
    return result(async () => {
      const normalized = searchInput(query);
      const data = await this.page(`v1:search:${normalized}`, () => this.client.call("search_grades", { query: normalized }), parseSearch);
      return data.courses.length || data.instructors.length ? data : null;
    });
  }
}
