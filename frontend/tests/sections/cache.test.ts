import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/spring-2027.json";
import { VsbTermCache } from "../../src/lib/sections/cache";
import { createSectionSource } from "../../src/lib/sections/source";
import { createSectionsHandlers } from "../../src/lib/sections/http";
import { createSectionsConfig } from "../../src/lib/sections/config";

const wholeTermConfig = createSectionsConfig({ fileLayout: "term-only" });
const response = () => Response.json(fixture, { headers: { ETag: '"term-v2"', "Last-Modified": "Sun, 04 Oct 2026 19:02:54 GMT" } });
describe("section cache and HTTP behavior with fake upstream", () => {
  test("cold concurrent course requests share one fetch and return course slices", async () => {
    const upstream = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    let calls = 0;
    let seenHeaders = new Headers();
    const cache = new VsbTermCache({ config: wholeTermConfig, terms: ["spring-2027"], fetcher: async (url, init) => {
      expect(url).toBe("https://vsb.untgrades.app/data/spring-2027.json");
      calls++; seenHeaders = new Headers(init.headers); started.resolve(); return upstream.promise;
    } });
    const handlers = createSectionsHandlers(createSectionSource(cache));
    const pending = [handlers.course("spring-2027", "math", "1680"), handlers.course("spring-2027", "ACCT", "5120")];
    await started.promise; upstream.resolve(response());
    const [math, acct] = await Promise.all(pending);
    expect(calls).toBe(1);
    expect(seenHeaders.get("user-agent")).toContain("UNTangle/1.0");
    expect(math.status).toBe(200);
    expect(math.headers.get("cache-control")).toBe("no-store");
    const mathBody = await math.json();
    expect(mathBody).toMatchObject({ courseCode: "MATH 1680", status: "ok", availability: "sections", provenance: { kind: "real", source: "vsb.untgrades.app", updated_at: fixture.updated_at } });
    expect(mathBody.sections.map((s: { courseCode: string }) => s.courseCode)).toEqual(["MATH 1680"]);
    expect(await acct.json()).toMatchObject({ courseCode: "ACCT 5120", sections: [{ id: "vsb:spring-2027:ACCT 5120:1002" }] });
    await handlers.course("spring-2027", "MATH", "1680");
    expect(calls).toBe(1);
  });
  test("fresh memory is reused; a new proxy process fetches its own transient data", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return response(); };
    const cache = new VsbTermCache({ config: wholeTermConfig, terms: ["spring-2027"], now: () => 1000, fetcher });
    await cache.get("spring-2027");
    expect((await cache.get("spring-2027")).freshness).toMatchObject({ status: "ok", checkedAt: "1970-01-01T00:00:01.000Z" });
    expect(calls).toBe(1);
    const restarted = new VsbTermCache({ config: wholeTermConfig, terms: ["spring-2027"], now: () => 1001, fetcher });
    const result = await restarted.get("spring-2027");
    expect(result.data?.courses.get("MATH 1680")?.sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
    expect(calls).toBe(2);
  });
  test("stale responses return immediately, share a refresh and honor 304 validators", async () => {
    let now = 1000, calls = 0;
    const refresh = Promise.withResolvers<Response>();
    const background: Promise<void>[] = [];
    let validators = new Headers();
    const cache = new VsbTermCache({ config: wholeTermConfig, terms: ["spring-2027"], now: () => now, ttlMs: 100,
      retainBackground: work => { background.push(work); }, fetcher: async (_url, init) => {
        calls++; validators = new Headers(init.headers); return calls === 1 ? response() : refresh.promise;
      } });
    await cache.get("spring-2027"); now = 1101;
    const handlers = createSectionsHandlers(createSectionSource(cache));
    const stale = await handlers.course("spring-2027", "MATH", "1680");
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({ status: "stale", provenance: { kind: "real" } });
    expect((await cache.get("spring-2027")).freshness.status).toBe("stale");
    expect(calls).toBe(2);
    expect(validators.get("if-none-match")).toBe('"term-v2"');
    expect(validators.get("if-modified-since")).toBe("Sun, 04 Oct 2026 19:02:54 GMT");
    refresh.resolve(new Response(null, { status: 304 })); await Promise.all(background);
    expect((await cache.get("spring-2027")).freshness).toMatchObject({ status: "ok", checkedAt: "1970-01-01T00:00:01.101Z", updatedAt: fixture.updated_at });
    expect((await cache.get("spring-2027")).data?.courses.get("MATH 1680")?.sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
  });
  test("stale upstream failure retains real options and applies retry backoff", async () => {
    let now = 1000, calls = 0;
    const background: Promise<void>[] = [];
    const cache = new VsbTermCache({ config: wholeTermConfig, terms: ["spring-2027"], now: () => now, ttlMs: 100, retryMs: 200,
      retainBackground: work => { background.push(work); }, fetcher: async () => { calls++; return calls === 1 ? response() : new Response(null, { status: 503 }); } });
    await cache.get("spring-2027"); now = 1101; await cache.get("spring-2027"); await Promise.all(background);
    const result = await createSectionSource(cache).getCourseSections("spring-2027", "MATH 1680");
    expect(result).toMatchObject({ status: "stale", provenance: { kind: "real" }, freshness: { diagnostic: { code: "upstream_error", message: "vsb term spring-2027: HTTP 503" } } });
    expect(result.sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
    expect(calls).toBe(2);
    now = 1302; await cache.get("spring-2027"); await Promise.all(background);
    expect(calls).toBe(3);
  });
  test.each([404, 503])("cold HTTP %i returns unavailable samples without 500", async status => {
    const cache = new VsbTermCache({ config: wholeTermConfig, terms: ["spring-2027"], fetcher: async () => new Response(null, { status }) });
    const source = createSectionSource(cache);
    const result = await createSectionsHandlers(source).course("spring-2027", "MATH", "1680");
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({ status: "unavailable", availability: "sample", provenance: { kind: "sample", term: null, updated_at: null } });
    expect(body.sections.length).toBeGreaterThan(0);
    expect(body.sections[0].term).toBeNull();
    expect(body.sections[0].id).toBe("math-1680-001");
    expect(await source.getCourseSections("spring-2027", "ZZZZ 9999")).toMatchObject({ status: "unavailable", availability: "missing", sections: [] });
  });
  test("network exception and malformed JSON are unavailable with diagnostics", async () => {
    for (const fetcher of [async () => { throw new Error("offline"); }, async () => new Response("{bad")]) {
      const cache = new VsbTermCache({ config: wholeTermConfig, terms: ["spring-2027"], fetcher });
      expect((await cache.get("spring-2027")).freshness).toMatchObject({ status: "unavailable", diagnostic: { code: "upstream_error" } });
    }
  });
  test("unknown schema is loud on cold fetch and cannot replace stale good options", async () => {
    let now = 1000, calls = 0;
    const background: Promise<void>[] = [];
    const bad = () => Response.json({ ...fixture, schema_version: 3 });
    const cold = new VsbTermCache({ config: wholeTermConfig, terms: ["spring-2027"], fetcher: async () => bad() });
    expect((await cold.get("spring-2027")).freshness).toMatchObject({ status: "unavailable", diagnostic: { code: "schema_error", message: "vsb schema v2: $.schema_version: unsupported version 3; expected 2" } });
    const cache = new VsbTermCache({ config: wholeTermConfig, terms: ["spring-2027"], now: () => now, ttlMs: 100,
      retainBackground: work => { background.push(work); }, fetcher: async () => ++calls === 1 ? response() : bad() });
    await cache.get("spring-2027");
    now = 1101; await cache.get("spring-2027"); await Promise.all(background);
    expect((await cache.get("spring-2027")).freshness).toMatchObject({ status: "stale", diagnostic: { code: "schema_error" } });
    expect((await cache.get("spring-2027")).data?.courses.get("MATH 1680")?.sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
  });
  test("real no_classes stays empty; missing course and unsupported term use samples", async () => {
    let calls = 0;
    const cache = new VsbTermCache({ config: wholeTermConfig, terms: ["spring-2027"], fetcher: async () => { calls++; return response(); } });
    const source = createSectionSource(cache);
    expect(await source.getCourseSections("spring-2027", "AARS 6810")).toMatchObject({ status: "ok", availability: "no_classes", provenance: { kind: "real" }, sections: [] });
    expect(await source.getCourseSections("spring-2027", "MATH 1710")).toMatchObject({ status: "unavailable", availability: "sample", provenance: { kind: "sample" } });
    expect(await source.getCourseSections("fall-2027", "MATH 1680")).toMatchObject({ status: "unavailable", availability: "sample" });
    expect(calls).toBe(1);
    const terms = await createSectionsHandlers(source).terms();
    expect(await terms.json()).toMatchObject({ terms: [{ id: "spring-2027", label: "2027 Spring", freshness: { status: "ok" }, provenance: { kind: "real" } }] });
  });
  test("invalid route inputs return 400 without fetching", async () => {
    let calls = 0;
    const cache = new VsbTermCache({ config: wholeTermConfig, terms: ["spring-2027"], fetcher: async () => { calls++; return response(); } });
    const handlers = createSectionsHandlers(createSectionSource(cache));
    for (const args of [["../secret", "MATH", "1680"], ["spring-2027", "../", "1680"], ["spring-2027", "MATH", "bad"]]) {
      expect((await handlers.course(args[0], args[1], args[2])).status).toBe(400);
    }
    expect(calls).toBe(0);
  });
  test("route normalizes lowercase number suffixes and accepts legacy three-digit codes", async () => {
    const raw = { ...fixture, courses: {
      "MEEN 5940Z": { ...fixture.courses["MATH 1680"], course_code: "MEEN 5940Z" },
      "MATH 340": { ...fixture.courses["MATH 1680"], course_code: "MATH 340" },
    } };
    const cache = new VsbTermCache({ config: wholeTermConfig, terms: ["spring-2027"], fetcher: async () => Response.json(raw) });
    const handlers = createSectionsHandlers(createSectionSource(cache));
    expect(await (await handlers.course("spring-2027", "meen", "5940z")).json()).toMatchObject({ courseCode: "MEEN 5940Z", availability: "sections", status: "ok" });
    expect(await (await handlers.course("spring-2027", "MATH", "340")).json()).toMatchObject({ courseCode: "MATH 340", availability: "sections", status: "ok" });
  });
});
