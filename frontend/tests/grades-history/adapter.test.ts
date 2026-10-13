import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GradesMcpClient, parseRpc, parseToolResult, retryAfterMs } from "@/lib/grades-history/client";
import { GradesDiskCache } from "@/lib/grades-history/cache";
import { GradesLimiter } from "@/lib/grades-history/limiter";
import { parseCoursePage, parseInstructorPage, parseSearch } from "@/lib/grades-history/parse";
import { sumCounts, toGradeData } from "@/lib/grades-history/normalize";
import { GradesHistoryService } from "@/lib/grades-history/service";
import { createGradesHandlers } from "@/lib/grades-history/http";
import { toChartData } from "@/lib/grades";
import courseFixture from "./fixtures/course.json";
import coursePageFixture from "./fixtures/course-page.json";
import instructorPageFixture from "./fixtures/instructor-page.json";
import searchFixture from "./fixtures/search.json";
import { startFakeMcp } from "./fake-mcp";
import type { FakeOptions } from "./fake-mcp";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function fastClock() {
  let now = 0;
  return { now: () => now, sleep: async (ms: number) => { now += ms; }, advance: (ms: number) => { now += ms; } };
}
async function setup(options: FakeOptions = {}, paced = true) {
  const fake = startFakeMcp(options);
  cleanups.push(fake.stop);
  const directory = await mkdtemp(path.join(tmpdir(), "untangle-grades-test-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const clock = fastClock();
  const limiter = new GradesLimiter(clock, paced ? 15_000 : 0);
  const client = new GradesMcpClient({ endpoint: fake.endpoint, limiter, now: clock.now });
  const cache = new GradesDiskCache(directory, 3_600_000, clock.now);
  return { fake, directory, clock, limiter, client, cache, service: new GradesHistoryService(client, cache) };
}

describe("grades boundary parsing", () => {
  test("captured data retains pagination, multiword names, and totals", () => {
    const page = parseCoursePage(parseToolResult(coursePageFixture.result));
    expect(page).toMatchObject({ totalSections: 11, offset: 0, nextOffset: 2, total: 861, counts: { A: 249, W: 97 } });
    expect(page.sections[0]).toMatchObject({ instructor: { id: '["Pradhumna Lal","Shrestha"]', name: "Pradhumna Lal Shrestha" }, year: "2026", counts: { A: 20, W: 10 } });
    expect(parseInstructorPage(parseToolResult(instructorPageFixture.result))).toMatchObject({ totalCourses: 5, nextOffset: 2 });
    expect(parseSearch(parseToolResult(searchFixture.result)).instructors[1].id).toBe('["Pradhumna Lal","Shrestha"]');
  });
  test("text-only tool results and JSON-RPC errors have explicit handling", () => {
    expect(parseSearch(parseToolResult({ content: [{ type: "text", text: '{"courses":[],"instructors":[]}' }] }))).toEqual({ courses: [], instructors: [] });
    expect(() => parseRpc('{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Missing tool"}}', 1)).toThrow("JSON-RPC error -32601: Missing tool");
  });
  test.each([
    ["bad JSON", "{"], ["wrong version", '{"jsonrpc":"1.0","id":1,"result":{}}'],
    ["wrong id", '{"jsonrpc":"2.0","id":2,"result":{}}'], ["missing result", '{"jsonrpc":"2.0","id":1}'],
    ["both error/result", '{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"bad"},"result":{}}'],
  ])("rejects malformed RPC: %s", (_label, body) => { expect(() => parseRpc(body, 1)).toThrow("untgrades.app:"); });
  test("bad counts and pagination fail specifically instead of being coerced", () => {
    const original = courseFixture.result.structuredContent;
    expect(() => parseCoursePage({ ...original, aggregateGrades: { ...original.aggregateGrades, A: "249" } })).toThrow("course.aggregateGrades.A");
    expect(() => parseCoursePage({ ...original, totalGrades: 860 })).toThrow("course.totalGrades");
    expect(() => parseCoursePage({ ...original, aggregateGrades: { ...original.aggregateGrades, W: -1 } })).toThrow("course.aggregateGrades.W");
    expect(() => parseCoursePage({ ...original, nextOffset: 0 })).toThrow("course.pagination");
    expect(() => parseToolResult({ content: [{ type: "text", text: "not JSON" }] })).toThrow("tool text");
    expect(() => parseToolResult({ content: [], isError: "true" })).toThrow("tool isError");
  });
  test("unknown grade labels survive while GradeData maps known labels", () => {
    const source = { A: 4, B: 2, C: 1, D: 0, F: 1, W: 1, WF: 2, Hidden: 3, "*": 5 };
    const page = parseCoursePage({ ...courseFixture.result.structuredContent, aggregateGrades: source, totalGrades: 19, gpa: 3 });
    expect(page.counts["*"]).toBe(5);
    expect(sumCounts([{ ...page.counts, toString: 2 }, { ...page.counts, toString: 3 }])).toMatchObject({ A: 8, "*": 10, toString: 5 });
    const grades = toGradeData(page.counts);
    expect(grades).toMatchObject({ gradeA: 4, gradeW: 1, gradeWF: 2, gradeSuppressed: 3, totalEnroll: 19 });
    expect(toChartData(grades).find((entry) => entry.grade === "A")).toEqual({ grade: "A", count: 4, color: "#2e7d50", percentage: 21.1 });
  });
});

describe("disk cache", () => {
  test("miss, hit, expiry, and persistence", async () => {
    const { directory } = await setup();
    const clock = fastClock();
    const cache = new GradesDiskCache(directory, 100, clock.now);
    expect(await cache.get("CSCE/1030")).toBeUndefined();
    await cache.set("CSCE/1030", { grades: 861 });
    expect(await cache.get("CSCE/1030")).toEqual({ grades: 861 });
    expect(await new GradesDiskCache(directory, 100, clock.now).get("CSCE/1030")).toEqual({ grades: 861 });
    expect(await readdir(directory)).toHaveLength(1);
    clock.advance(100);
    expect(await cache.get("CSCE/1030")).toBeUndefined();
    await cache.set("CSCE/1030", { grades: 862 });
    expect(await cache.get("CSCE/1030")).toEqual({ grades: 862 });
  });
  test("a corrupt cache fails specifically without contacting upstream", async () => {
    const { service, cache, directory, fake } = await setup();
    await cache.set("v2:course:CSCE:1030", {});
    const [filename] = await readdir(directory);
    await writeFile(path.join(directory, filename), "broken");
    expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "unavailable", error: { reason: "storage", message: "Grade history cache contains invalid JSON" } });
    expect(fake.requests).toHaveLength(0);
  });
});

describe("MCP replay and history service", () => {
  test("course pagination produces full term totals and fresh services reuse disk pages", async () => {
    const { service, fake, client, cache } = await setup({ pageSize: 2 });
    const history = await service.getCourseHistory("csce", "1030");
    expect(history).toMatchObject({ status: "ok", source: "untgrades.app", data: { sectionCount: 11, total: 861, gpa: 2.39, counts: { A: 249, W: 97 }, grades: { totalEnroll: 861 }, terms: [{ year: "2026", term: "Spring", total: 438 }, { year: "2025", term: "Fall", total: 423 }] } });
    expect(fake.requests.map((r) => r.args.offset)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(await new GradesHistoryService(client, cache).getCourseHistory("CSCE", "1030")).toEqual(history);
    expect(fake.requests).toHaveLength(6);
  });
  test("instructor list pagination has no duplicate or omitted courses", async () => {
    const { client } = await setup({ pageSize: 2 });
    const first = parseInstructorPage(await client.call("get_instructor_courses", { firstName: "Pradhumna Lal", lastName: "Shrestha", limit: 50 }));
    const second = parseInstructorPage(await client.call("get_instructor_courses", { firstName: "Pradhumna Lal", lastName: "Shrestha", offset: first.nextOffset ?? 0, limit: 50 }));
    const last = parseInstructorPage(await client.call("get_instructor_courses", { firstName: "Pradhumna Lal", lastName: "Shrestha", offset: second.nextOffset ?? 0, limit: 50 }));
    expect([...first.courses, ...second.courses, ...last.courses].map((c) => c.number)).toEqual(["1030", "4915", "4927", "4907", "4910"]);
    expect(last.nextOffset).toBeNull();
  });
  test("instructor history includes only the requested instructor's sections", async () => {
    // Only CSCE 1030 section rows were captured; narrow the course list locally.
    const { service } = await setup({ instructorCourseOnly: true });
    const history = await service.getInstructorHistory("Pradhumna Lal", "Shrestha");
    expect(history).toMatchObject({ status: "ok", data: { total: 394, counts: { A: 86, B: 58, C: 63, D: 43, F: 89, W: 55 }, courses: [{ sectionCount: 4, total: 394 }] } });
    if (history.status !== "ok") throw new Error("Expected instructor history");
    expect(history.data.courses[0].terms.flatMap((t) => t.sections).map((s) => s.instructor.id)).toEqual(Array(4).fill('["Pradhumna Lal","Shrestha"]'));
  });
  test("search and confirmed missing history have distinct results", async () => {
    const { service } = await setup();
    expect(await service.searchGrades("CSCE 1030")).toMatchObject({ status: "ok", data: { courses: [{ subject: "CSCE", number: "1030" }] } });
    expect(await service.searchGrades("absent")).toEqual({ status: "no-history", source: "untgrades.app", data: null });
    expect(await service.getCourseHistory("ZZZZ", "9999")).toEqual({ status: "no-history", source: "untgrades.app", data: null });
    expect(await service.getInstructorHistory("Nobody", "Here")).toEqual({ status: "no-history", source: "untgrades.app", data: null });
  });
  test("confirmed missing courses are cached and expired pages refetch", async () => {
    const { service, fake, clock } = await setup();
    expect(await service.getCourseHistory("ZZZZ", "9999")).toEqual({ status: "no-history", source: "untgrades.app", data: null });
    expect(await service.getCourseHistory("ZZZZ", "9999")).toEqual({ status: "no-history", source: "untgrades.app", data: null });
    expect(fake.requests).toHaveLength(1);
    expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "ok", data: { total: 861 } });
    clock.advance(3_600_000);
    expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "ok", data: { total: 861 } });
    expect(fake.requests).toHaveLength(3);
  });
  test("a missing course in an instructor's list is unavailable, not no-history", async () => {
    const { service } = await setup();
    expect(await service.getInstructorHistory("Pradhumna Lal", "Shrestha")).toMatchObject({ status: "unavailable", error: { reason: "malformed", message: "untgrades.app: instructor course list must be courses with available section history" } });
  });
  test("429 without Retry-After uses a minute cooldown and recovers", async () => {
    const { service, fake, clock } = await setup({ replies: [{ status: 429 }] }, false);
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "unavailable", error: { retryAfterSeconds: 60 } });
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "unavailable", error: { reason: "throttled" } });
    clock.advance(60_000);
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "ok", data: { instructors: [{ name: "Binod Shrestha" }, { name: "Pradhumna Lal Shrestha" }] } });
    expect(fake.requests).toHaveLength(2);
  });
  test("a wrong-tool Course not found error is an upstream failure", async () => {
    const { service } = await setup({ transform: () => ({ isError: true, content: [{ type: "text", text: "Course not found" }] }) });
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "unavailable", error: { reason: "upstream" } });
  });
  test("concurrent callers for the same page share the request", async () => {
    const { service, fake } = await setup({}, false);
    const results = await Promise.all(Array.from({ length: 8 }, () => service.getCourseHistory("CSCE", "1030")));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill("ok"));
    expect(results[0]).toMatchObject({ data: { total: 861 } });
    expect(fake.requests).toHaveLength(1);
  });
  test("delayed disk misses cannot start a second upstream request", async () => {
    const { directory, client, fake } = await setup({}, false);
    class DelayedMissCache extends GradesDiskCache {
      reads = 0;
      override async get(key: string) {
        const read = ++this.reads;
        const value = await super.get(key);
        if (read === 2) await new Promise((resolve) => setTimeout(resolve, 30));
        return value;
      }
    }
    const service = new GradesHistoryService(client, new DelayedMissCache(directory));
    const histories = await Promise.all([service.getCourseHistory("CSCE", "1030"), service.getCourseHistory("CSCE", "1030")]);
    expect(histories).toMatchObject([{ status: "ok", data: { total: 861 } }, { status: "ok", data: { total: 861 } }]);
    expect(fake.requests).toHaveLength(1);
  });
  test("wrong instructor identity is not cached and the next request recovers", async () => {
    let wrong = true;
    const { service, fake } = await setup({ instructorCourseOnly: true, transform: (result, request) => {
      if (request.name !== "get_instructor_courses" || !wrong) return result;
      wrong = false;
      return { ...result, structuredContent: { firstName: "Wrong", lastName: "Shrestha", totalCourses: 0, offset: 0, nextOffset: null, courses: [] } };
    } });
    expect(await service.getInstructorHistory("Pradhumna Lal", "Shrestha")).toMatchObject({ status: "unavailable", error: { reason: "malformed" } });
    expect(await service.getInstructorHistory("Pradhumna Lal", "Shrestha")).toMatchObject({ status: "ok", data: { total: 394 } });
    expect(fake.requests).toHaveLength(3);
  });
  test("JSON transport works alongside SSE", async () => {
    const { service } = await setup({ replies: [{ sse: false }] });
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "ok", data: { instructors: [{ name: "Binod Shrestha" }, { name: "Pradhumna Lal Shrestha" }] } });
  });
  test.each([429, 503])("HTTP %d honors Retry-After and blocks subsequent calls", async (status) => {
    const { service, fake } = await setup({ replies: [{ status, retryAfter: "120" }] }, false);
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "unavailable", error: { reason: status === 429 ? "throttled" : "upstream", retryAfterSeconds: 120 } });
    expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "unavailable", error: { reason: "throttled", retryAfterSeconds: 120 } });
    expect(fake.requests).toHaveLength(1);
  });
  test("Retry-After dates, zero, and invalid values", () => {
    expect(retryAfterMs("Tue, 13 Oct 2026 12:10:00 GMT", Date.parse("2026-10-13T12:09:00Z"))).toBe(60_000);
    expect(retryAfterMs("0", 0)).toBe(0);
    expect(retryAfterMs("bad", 0)).toBeNull();
  });
  test("malformed pagination returns unavailable", async () => {
    const { service } = await setup({ transform: (result) => ({ ...result, structuredContent: { ...courseFixture.result.structuredContent, nextOffset: 0 } }) });
    expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "unavailable", error: { reason: "malformed", message: "untgrades.app: course.pagination must be contiguous pages ending at the declared total" } });
  });
  test("metadata changes between pages are rejected", async () => {
    const { service } = await setup({ pageSize: 2, transform: (result, request) => {
      if (request.offset === 0) return result;
      return { ...result, structuredContent: { ...courseFixture.result.structuredContent, offset: request.offset, sections: courseFixture.result.structuredContent.sections.slice(request.offset, request.offset + 2), nextOffset: request.offset + 2, totalSections: 12 } };
    } });
    expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "unavailable", error: { reason: "malformed", message: "untgrades.app: course pages must be consistent metadata and aggregate counts" } });
  });
  test("a missing continuation page is malformed and invalidated before recovery", async () => {
    let failContinuation = true;
    const { service, fake } = await setup({ pageSize: 2, transform: (result, request) => {
      if (request.name === "get_course_grades" && request.offset === 2 && failContinuation) {
        failContinuation = false;
        return { isError: true, content: [{ type: "text", text: "Course not found" }] };
      }
      return result;
    } });
    expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "unavailable", error: { reason: "malformed", message: "untgrades.app: course continuation page must be history for the course already returned on earlier pages" } });
    expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "ok", data: { total: 861 } });
    expect(fake.requests.map((r) => r.args.offset)).toEqual([0, 2, 0, 2, 4, 6, 8, 10]);
  });
  test("broken JSON-RPC returns unavailable", async () => {
    const { service } = await setup({ replies: [{ body: '{"jsonrpc":"2.0","id":99,"result":{}}' }] });
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "unavailable", error: { reason: "malformed", message: "untgrades.app: JSON-RPC version/id must be 2.0 with matching id 1" } });
  });
  test("transport disconnect returns unavailable", async () => {
    const { service, fake } = await setup();
    fake.stop();
    expect(await service.searchGrades("Shrestha")).toMatchObject({ status: "unavailable", error: { reason: "upstream" } });
  });
});

describe("route status mapping", () => {
  test("ok and no-history return HTTP 200, and both instructor inputs work", async () => {
    const { service } = await setup({ instructorCourseOnly: true });
    const handlers = createGradesHandlers(service);
    const course = await handlers.course("CSCE", "1030");
    expect(course.status).toBe(200);
    expect(await course.json()).toMatchObject({ status: "ok", source: "untgrades.app", data: { total: 861 } });
    const missing = await handlers.course("ZZZZ", "9999");
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ status: "no-history", source: "untgrades.app", data: null });
    expect(await (await handlers.instructor('["Pradhumna Lal","Shrestha"]')).json()).toMatchObject({ status: "ok", data: { total: 394 } });
    expect(await (await handlers.instructorByName(new Request("http://local/api/grades/instructors?firstName=Pradhumna%20Lal&lastName=Shrestha"))).json()).toMatchObject({ status: "ok", data: { total: 394 } });
  });
  test.each([429, 503])("upstream HTTP %d becomes unavailable HTTP 200", async (status) => {
    const { service } = await setup({ replies: [{ status, retryAfter: "90" }] });
    const reply = await createGradesHandlers(service).search(new Request("http://local/api/grades/search?q=Shrestha"));
    expect(reply.status).toBe(200);
    expect(reply.headers.get("Retry-After")).toBe("90");
    expect(await reply.json()).toMatchObject({ status: "unavailable", source: "untgrades.app", data: null, error: { reason: status === 429 ? "throttled" : "upstream" } });
  });
  test("malformed upstream returns unavailable HTTP 200", async () => {
    const { service } = await setup({ replies: [{ body: "invalid JSON" }] });
    const reply = await createGradesHandlers(service).course("CSCE", "1030");
    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({ status: "unavailable", error: { reason: "malformed" } });
  });
  test("invalid inputs return HTTP 400 without upstream calls", async () => {
    const { service, fake } = await setup();
    const handlers = createGradesHandlers(service);
    for (const reply of [await handlers.instructor("42"), await handlers.course("../", "1030"), await handlers.course("CSCE", "abcd"), await handlers.course("CSCE", "10a0"), await handlers.search(new Request("http://local/api/grades/search?q=x")), await handlers.instructorByName(new Request("http://local/api/grades/instructors"))]) {
      expect(reply.status).toBe(400);
      expect(await reply.json()).toMatchObject({ status: "unavailable", source: "untgrades.app", error: { reason: "invalid-request" } });
    }
    expect(fake.requests).toHaveLength(0);
  });
});
