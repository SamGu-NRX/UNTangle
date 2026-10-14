import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CACHE_TTL_MS, GradesDiskCache } from "@/lib/grades-history/cache";
import { GradesMcpClient } from "@/lib/grades-history/client";
import { GradesLimiter } from "@/lib/grades-history/limiter";
import { GradesHistoryService } from "@/lib/grades-history/service";
import type { HistoryResult } from "@/lib/grades-history/types";
import { startFakeMcp } from "./fake-mcp";
import type { FakeOptions } from "./fake-mcp";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup(options: FakeOptions = {}) {
  const fake = startFakeMcp(options);
  cleanups.push(fake.stop);
  const directory = await mkdtemp(path.join(tmpdir(), "untangle-cache-semantics-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  let now = 0;
  const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
  const client = new GradesMcpClient({ endpoint: fake.endpoint, limiter: new GradesLimiter(clock), now: clock.now });
  const cache = new GradesDiskCache(directory, CACHE_TTL_MS, clock.now);
  return { fake, directory, client, cache, advance: (ms: number) => { now += ms; }, service: new GradesHistoryService(client, cache) };
}

test("confirmed absence survives a new service and expires exactly after one day", async () => {
  const { fake, service, client, cache, advance } = await setup();
  const absent = { status: "no-history", source: "untgrades.app", data: null } satisfies HistoryResult<never>;
  expect(await service.getCourseHistory("NONE", "9999")).toEqual(absent);
  expect(await cache.get("v2:course:NONE:9999")).toBeNull();
  advance(86_399_999);
  expect(await new GradesHistoryService(client, cache).getCourseHistory("NONE", "9999")).toEqual(absent);
  expect(fake.requests.length).toBe(1);
  advance(1);
  expect(await service.getCourseHistory("NONE", "9999")).toEqual(absent);
  expect(fake.requests.length).toBe(2);
});

test("validated empty instructor lists are cached and concurrent misses share the complete lookup", async () => {
  const { fake, service, cache } = await setup();
  const replies = await Promise.all(Array.from({ length: 8 }, () => service.getInstructorHistory("Nobody", "Here")));
  expect(replies).toEqual(Array.from({ length: 8 }, () => ({ status: "no-history", source: "untgrades.app", data: null })));
  expect(await cache.get('v2:instructor:{"firstName":"Nobody","lastName":"Here"}')).toMatchObject([{ totalCourses: 0, nextOffset: null }]);
  expect(fake.requests.length).toBe(1);
});

test.each([
  { status: 500 },
  { status: 429, retryAfter: "1" },
  { status: 503, retryAfter: "1" },
  { body: "invalid JSON" },
])("unavailable is never cached: %j", async (reply) => {
  const { fake, service, cache, advance } = await setup({ replies: [reply] });
  expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "unavailable", data: null });
  expect(await cache.get("v2:course:CSCE:1030")).toBeUndefined();
  advance(3_000);
  expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "ok", data: { total: 861, sectionCount: 11 } });
  expect(fake.requests.length).toBe(2);
});

test("cache read failure becomes storage unavailable before an upstream call", async () => {
  const { fake, directory, client } = await setup();
  const file = path.join(directory, "file");
  await writeFile(file, "not a directory");
  const service = new GradesHistoryService(client, new GradesDiskCache(file));
  expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "unavailable", error: { reason: "storage" } });
  expect(fake.requests.length).toBe(0);
});

test.each(["CSCE", "NONE"])("cache write failure never reports success or absence for %s", async (subject) => {
  const { fake, directory, client } = await setup();
  const file = path.join(directory, "file");
  await writeFile(file, "not a directory");
  const disk = new GradesDiskCache(file);
  // Reading a miss succeeds, but the actual disk write fails for both a
  // validated generation and confirmed absence.
  const service = new GradesHistoryService(client, { get: async () => undefined, set: disk.set.bind(disk), remove: disk.remove.bind(disk) });
  expect(await service.getCourseHistory(subject, "1030")).toMatchObject({ status: "unavailable", error: { reason: "storage" } });
  expect(fake.requests.length).toBe(1);
});

test("failed invalidation is storage unavailable rather than malformed history", async () => {
  const { directory, client } = await setup();
  const file = path.join(directory, "file");
  await writeFile(file, "not a directory");
  const disk = new GradesDiskCache(file);
  const service = new GradesHistoryService(client, { get: async () => ({}), set: disk.set.bind(disk), remove: disk.remove.bind(disk) });
  expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "unavailable", error: { reason: "storage" } });
});
