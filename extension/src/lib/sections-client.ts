/**
 * The sections client: per-course section lists from the UNTangle proxy,
 * cached per session so a page of rows resolves against upstream once.
 * The route is unauthenticated but the fetch still carries the session,
 * per the service worker's single-credential rule.
 */
import type { CourseSections } from "../shared/api-types";
import { UNTANGLE_ORIGIN } from "../config";
import type { SessionCache, FetchLike } from "./planner-client";

export type CourseSectionsOutcome = { ok: true; result: CourseSections } | { ok: false; status: number };

export class SectionsClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly base: string = UNTANGLE_ORIGIN,
    private readonly cache: SessionCache,
  ) {}

  async forCourse(term: string, courseCode: string): Promise<CourseSectionsOutcome> {
    const key = `sections:${term}:${courseCode}`;
    const cached = await this.cache.get(key);
    if (cached && isEcho(cached, term, courseCode)) return { ok: true, result: cached as CourseSections };

    const [subject, number] = courseCode.split(" ");
    if (!subject || !number) return { ok: false, status: 0 };
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.base}/api/sections/${encodeURIComponent(term)}/${encodeURIComponent(subject)}/${encodeURIComponent(number)}`,
        { credentials: "include" },
      );
    } catch (error) {
      console.warn(`sections fetch failed:`, error);
      return { ok: false, status: 0 };
    }
    if (!response.ok) return { ok: false, status: response.status };
    // The route is this repo's own proxy and builds the CourseSections type;
    // like frontend/src/lib/sections/client.ts, only the echo is checked.
    const result: CourseSections = await response.json();
    if (!isEcho(result, term, courseCode)) return { ok: false, status: response.status };
    await this.cache.set(key, result);
    return { ok: true, result };
  }
}

function isEcho(result: unknown, term: string, courseCode: string): boolean {
  if (typeof result !== "object" || result === null) return false;
  const record = result as Record<string, unknown>;
  return record.term === term && record.courseCode === courseCode;
}
