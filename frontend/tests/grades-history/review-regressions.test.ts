import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GradesMcpClient, object, retryAfterMs } from "@/lib/grades-history/client";
import { GradesDiskCache } from "@/lib/grades-history/cache";
import { GradesLimiter } from "@/lib/grades-history/limiter";
import { GradesHistoryService } from "@/lib/grades-history/service";
import { createGradesHandlers } from "@/lib/grades-history/http";
import { decodeInstructorId, parseSearch } from "@/lib/grades-history/parse";
import { startFakeMcp } from "./fake-mcp";
import type { FakeOptions } from "./fake-mcp";
import courseFixture from "./fixtures/course.json";
import instructorFixture from "./fixtures/instructor.json";
import searchFixture from "./fixtures/search-course.json";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(options: FakeOptions = {}, maxWaitMs = 15_000) {
  const fake = startFakeMcp(options);
  cleanups.push(fake.stop);
  const directory = await mkdtemp(path.join(tmpdir(), "untangle-grades-review-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  let now = 0;
  const clock = { now: () => now, sleep: async (ms: number) => { now += ms; }, advance: (ms: number) => { now += ms; } };
  const client = new GradesMcpClient({ endpoint: fake.endpoint, limiter: new GradesLimiter(clock, maxWaitMs), now: clock.now, timeoutMs: 500 });
  const cache = new GradesDiskCache(directory, 3_600_000, clock.now);
  const service = new GradesHistoryService(client, cache);
  return { fake, client, service, cache, clock, directory, handlers: createGradesHandlers(service) };
}

describe("PR 30 review regressions", () => {
  test("1: contradictory not-found text and structured history are malformed and never cached as absence", async () => {
    let contradict = true;
    const { handlers, fake } = await setup({ transform: (result) => {
      if (!contradict) return result;
      contradict = false;
      return { ...result, isError: true, content: [{ type: "text", text: "Course not found" }] };
    } });
    const first = await handlers.course("CSCE", "1030");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "unavailable", error: { reason: "malformed", message: "untgrades.app: tool error result must be error content without structured success data" } });
    expect(await (await handlers.course("CSCE", "1030")).json()).toMatchObject({ status: "ok", data: { total: 861 } });
    expect(fake.requests).toHaveLength(2);
  });

  test("2: comma name pairs have different IDs, round-trip through the route, and never merge sections", async () => {
    // Synthetic identities exercise a collision in the old comma-delimited IDs.
    const pairA = { firstName: "C", lastName: "A,B" };
    const pairB = { firstName: "B,C", lastName: "A" };
    const found = parseSearch({ courses: [], instructors: [pairA, pairB] });
    expect(found.instructors.map((i) => i.id)).toEqual(['["C","A,B"]', '["B,C","A"]']);
    expect(decodeInstructorId(found.instructors[0].id)).toEqual(pairA);
    expect(decodeInstructorId(found.instructors[1].id)).toEqual(pairB);
    const { handlers } = await setup({ transform: (result, request) => {
      if (request.name === "get_instructor_courses") return { ...result, structuredContent: { ...instructorFixture.result.structuredContent, firstName: request.args.firstName, lastName: request.args.lastName, totalCourses: 1, nextOffset: null, courses: instructorFixture.result.structuredContent.courses.slice(0, 1) } };
      if (request.name !== "get_course_grades") return result;
      const data = courseFixture.result.structuredContent;
      return { ...result, structuredContent: { ...data, sections: data.sections.map((s, i) => ({ ...s, instructor: i === 0 ? pairA : i === 1 ? pairB : s.instructor })) } };
    } });
    const a = await handlers.instructor(found.instructors[0].id);
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({ status: "ok", data: { instructor: pairA, total: 105, courses: [{ sectionCount: 1, total: 105 }] } });
    expect(await (await handlers.instructor(found.instructors[1].id)).json()).toMatchObject({ status: "ok", data: { instructor: pairB, total: 92, courses: [{ sectionCount: 1, total: 92 }] } });
  });

  test.each(["-1", "+1", "1.5", "1e2", "2026-10-13T12:10:00Z", "Wed, 13 Oct 2026 12:10:00 GMT", "Tue, 31 Feb 2026 12:10:00 GMT"])("3: invalid Retry-After %s uses the minute fallback", async (header) => {
    expect(retryAfterMs(header, Date.parse("2026-10-13T12:09:00Z"))).toBeNull();
    const { service, fake } = await setup({ replies: [{ status: 429, retryAfter: header }] }, 0);
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "unavailable", error: { retryAfterSeconds: 60 } });
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "unavailable", error: { reason: "throttled", retryAfterSeconds: 60 } });
    expect(fake.requests).toHaveLength(1);
  });
  test("3: valid delta-seconds and the three HTTP-date formats retain their delays", () => {
    const now = Date.parse("2026-10-13T12:09:00Z");
    expect(retryAfterMs("120", now)).toBe(120_000);
    for (const date of ["Tue, 13 Oct 2026 12:10:00 GMT", "Tuesday, 13-Oct-26 12:10:00 GMT", "Tue Oct 13 12:10:00 2026"]) expect(retryAfterMs(date, now)).toBe(60_000);
  });

  test.each(["Tue, 13 Oct 2026 12:10:00 GMT", "Tuesday, 13-Oct-26 12:10:00 GMT", "Tue Oct 13 12:10:00 2026"])("3: HTTP-date %s is UTC and honors a ten-minute cooldown", async (header) => {
    const now = Date.UTC(2026, 9, 13, 12, 0, 0);
    expect(retryAfterMs(header, now)).toBe(600_000);
    const { client, cache, clock, fake } = await setup({ replies: [{ status: 429, retryAfter: header }] }, 0);
    clock.advance(now);
    const service = new GradesHistoryService(client, cache);
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "unavailable", error: { retryAfterSeconds: 600 } });
    clock.advance(60_000);
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "unavailable", error: { reason: "throttled", retryAfterSeconds: 540 } });
    expect(fake.requests).toHaveLength(1);
    clock.advance(540_000);
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "ok", data: { instructors: [{ name: "Binod Shrestha" }, { name: "Pradhumna Lal Shrestha" }] } });
    expect(fake.requests).toHaveLength(2);
  });

  test("4: all pages share one expiry and a refresh reads a complete new generation", async () => {
    let changed = false;
    const { service, fake, clock, directory } = await setup({ pageSize: 2, transform: (result, request) => {
      if (!changed) return result;
      const data = object(result.structuredContent, "test course data");
      const original = courseFixture.result.structuredContent;
      return { ...result, structuredContent: { ...data, totalGrades: 862, aggregateGrades: { ...original.aggregateGrades, A: 250 }, sections: original.sections.slice(request.offset, request.offset + 2).map((s, i) => request.offset === 0 && i === 0 ? { ...s, grades: { ...s.grades, A: 21 } } : s) } };
    } });
    expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "ok", data: { total: 861 } });
    expect(await readdir(directory)).toHaveLength(1);
    changed = true;
    // Earlier v1 pages would have expired here while later continuation pages remained fresh.
    clock.advance(3_590_000);
    expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "ok", data: { total: 861 } });
    expect(fake.requests).toHaveLength(6);
    clock.advance(10_001);
    expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "ok", data: { total: 862, counts: { A: 250 } } });
    expect(fake.requests.map((r) => r.args.offset)).toEqual([0, 2, 4, 6, 8, 10, 0, 2, 4, 6, 8, 10]);
  });

  test.each([0, 2])("5: GPA that contradicts A-F counts on page %d is malformed", async (badOffset) => {
    const { handlers } = await setup({ pageSize: 2, transform: (result, request) => request.offset === badOffset ? { ...result, structuredContent: { ...object(result.structuredContent, "test course data"), gpa: 3.99 } } : result });
    const reply = await handlers.course("CSCE", "1030");
    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({ status: "unavailable", error: { reason: "malformed", message: "untgrades.app: course.gpa must be the A-F weighted mean rounded to two decimal places" } });
  });

  test("6: SSE notifications and responses for other IDs precede the matching result", async () => {
    const { service } = await setup({ notificationsBeforeResult: true, sseChunkBytes: 7 });
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "ok", data: { instructors: [{ name: "Binod Shrestha" }, { name: "Pradhumna Lal Shrestha" }] } });
  });
  test("6: an open SSE stream returns and is cancelled after the result", async () => {
    const { service, fake } = await setup({ notificationsBeforeResult: true, keepSseOpen: true, sseChunkBytes: 3 });
    expect(await service.searchGrades("CSCE 1030")).toMatchObject({ status: "ok", data: { courses: [{ subject: "CSCE", number: "1030" }] } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([fake.cancelled, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("SSE source was not cancelled after the result")), 1_000); })]);
      expect(fake.cancelledStreams).toBe(1);
    } finally { clearTimeout(timer); }
  });

  test("7: malformed search course identities are unavailable and cannot poison the cache", async () => {
    let wrong = true;
    const { handlers, fake } = await setup({ transform: (result) => {
      if (!wrong) return result;
      wrong = false;
      return { ...result, structuredContent: { ...searchFixture.result.structuredContent, courses: [{ ...searchFixture.result.structuredContent.courses[0], number: "1030/" }] } };
    } });
    const request = new Request("http://local/api/grades/search?q=CSCE%201030");
    const first = await handlers.search(request);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "unavailable", error: { reason: "malformed", message: "untgrades.app: courses[0].number must be 1-12 uppercase letters or digits" } });
    expect(await (await handlers.search(request)).json()).toMatchObject({ status: "ok", data: { courses: [{ number: "1030" }] } });
    expect(fake.requests).toHaveLength(2);
  });
  test("7: malformed instructor course identities never turn a valid caller into HTTP 400", async () => {
    const { handlers, fake } = await setup({ instructorCourseOnly: true, transform: (result, request) => {
      if (request.name !== "get_instructor_courses") return result;
      return { ...result, structuredContent: { ...instructorFixture.result.structuredContent, totalCourses: 1, nextOffset: null, courses: [{ ...instructorFixture.result.structuredContent.courses[0], number: "1030/" }] } };
    } });
    const reply = await handlers.instructor('["Pradhumna Lal","Shrestha"]');
    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({ status: "unavailable", error: { reason: "malformed" } });
    expect(fake.requests.map((r) => r.name)).toEqual(["get_instructor_courses"]);
  });
});
