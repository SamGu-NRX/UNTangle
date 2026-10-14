/**
 * The grades client: instructor grade history for one row, built on the
 * grades routes' HistoryResult envelope (ok | no-history | unavailable) and
 * the instructor-matching library's abstain-first discipline. Results cache
 * per instructor id in the session cache so a page of rows respects the
 * upstream rate limit. Throttled responses surface their Retry-After rather
 * than being retried into a burst.
 */
import { matchInstructor } from "../../../frontend/src/lib/instructors/match";
import type { GradeSearch, HistoryResult, InstructorHistory } from "../shared/api-types";
import type { GradesVerdict } from "../shared/messages";
import { UNTANGLE_ORIGIN } from "../config";
import type { FetchLike, SessionCache } from "./planner-client";

export class GradesClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly base: string = UNTANGLE_ORIGIN,
    private readonly cache: SessionCache,
  ) {}

  /** Grade history for the row's instructor in this course, or an honest non-answer. */
  async historyForInstructor(instructorRaw: string, subject: string, number: string): Promise<GradesVerdict> {
    const search = await this.fetchEnvelope<GradeSearch>(`/api/grades/search?q=${encodeURIComponent(instructorRaw)}`);
    if (search.kind !== "envelope") return search.verdict;
    if (search.result.status === "no-history") return { kind: "no-history", detail: "no-instructor-history" };
    if (search.result.status === "unavailable") return unavailable(search.result);

    // Abstain-first: a weak or ambiguous match renders "no confident match",
    // never a guess.
    const match = matchInstructor(instructorRaw, search.result.data.instructors);
    if (match.candidateId === null) return { kind: "no-match", reason: match.reason };

    const cacheKey = `grades:${match.candidateId}`;
    const cached = await this.cache.get(cacheKey);
    const history: InstructorHistory | null = isInstructorHistory(cached)
      ? cached
      : await this.fetchInstructorHistory(match.candidateId);
    if (history === null) return { kind: "no-history", detail: "no-instructor-history" };
    if (!cached) await this.cache.set(cacheKey, history);
    return historyForCourse(history, subject, number);
  }

  private async fetchInstructorHistory(candidateId: string): Promise<InstructorHistory | null> {
    const fetched = await this.fetchEnvelope<InstructorHistory>(
      `/api/grades/instructors/${encodeURIComponent(candidateId)}`,
    );
    if (fetched.kind !== "envelope") return null;
    if (fetched.result.status !== "ok") return null;
    return fetched.result.data;
  }

  private async fetchEnvelope<T>(path: string):
    Promise<{ kind: "envelope"; result: HistoryResult<T> } | { kind: "error"; verdict: GradesVerdict }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, { credentials: "include", cache: "no-store" });
    } catch {
      return { kind: "error", verdict: { kind: "unavailable", message: "UNTangle could not reach the grade history service." } };
    }
    const retryAfter = response.headers.get("Retry-After");
    const retryAfterSeconds = retryAfter === null || !/^\d+$/.test(retryAfter) ? undefined : Number(retryAfter);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        kind: "error",
        verdict: {
          kind: "unavailable",
          message: `The grade history service answered HTTP ${response.status}.`,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        },
      };
    }
    return { kind: "envelope", result: body as HistoryResult<T> };
  }
}

function isInstructorHistory(value: unknown): value is InstructorHistory {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.counts === "object" && typeof record.total === "number" && Array.isArray(record.courses);
}

function unavailable(result: Extract<HistoryResult<never>, { status: "unavailable" }>): GradesVerdict {
  return {
    kind: "unavailable",
    message: result.error.message,
    ...(result.error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.error.retryAfterSeconds }),
  };
}

/** The instructor's history reduced to this course's distribution and GPA. */
export function historyForCourse(history: InstructorHistory, subject: string, number: string): GradesVerdict {
  const course = history.courses.find(
    candidate => candidate.course.subject === subject && candidate.course.number === number,
  );
  if (!course) return { kind: "no-history", detail: "no-course-history" };
  return {
    kind: "history",
    instructorName: history.instructor.name,
    courseCode: `${course.course.subject} ${course.course.number}`,
    gpa: course.gpa,
    total: course.total,
    counts: course.counts,
  };
}
