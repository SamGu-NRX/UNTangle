import { afterEach, describe, expect, test } from "bun:test";
import fixture from "./fixtures/spring-2027.json";
import { createBrowserSectionSource, loadBrowserSectionSource } from "../../src/lib/sections/client";
import { createSectionsConfig, parseSectionsConfig, vsbUrls } from "../../src/lib/sections/config";
import { parseVsbTerm } from "../../src/lib/sections/vsb";
import { realCourseResult } from "../../src/lib/sections/results";
import { parseProxyCourse } from "../../src/lib/sections/wire";
import type { CourseSections } from "../../src/lib/sections/model";

const servers: Pick<ReturnType<typeof Bun.serve>, "stop">[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
const subjectFixture = (subject: string) => ({ ...fixture, courses: Object.fromEntries(Object.entries(fixture.courses).filter(([code]) => code.startsWith(`${subject} `))) });
function fallback(code = "MATH 1680"): CourseSections {
  const data = parseVsbTerm(fixture, "spring-2027");
  const result = realCourseResult(data, { status: "ok", checkedAt: "2026-10-13T12:00:00.000Z", updatedAt: fixture.updated_at, diagnostic: null }, code);
  if (!result) throw new Error(`Fixture missing ${code}`);
  return result;
}
const directConfig = () => createSectionsConfig({ mode: "direct", urls: { ...vsbUrls, origin: "https://fake-vsb.test" } });
describe("browser sections from vsb", () => {
  test("direct mode fetches a real local fake origin and preserves linked normalization/provenance", async () => {
    const paths: string[] = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      paths.push(new URL(request.url).pathname);
      return Response.json(subjectFixture("MATH"), { headers: { "Access-Control-Allow-Origin": "*" } });
    } });
    servers.push(server);
    const config = createSectionsConfig({ mode: "direct", urls: { ...vsbUrls, origin: server.url.origin } });
    const source = createBrowserSectionSource({ config });
    const result = await source.getCourseSections("spring-2027", "MATH 1680");
    expect(paths).toEqual(["/data/spring-2027/MATH.json"]);
    expect(result).toMatchObject({ status: "ok", availability: "sections", provenance: { kind: "real", source: "vsb.untgrades.app", updated_at: fixture.updated_at } });
    expect(result.sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
    expect(result.sections[0].meetings.map(m => [m.day, m.startMinutes, m.buildingId])).toEqual([["Tue", 575, "cury"], ["Thu", 575, "cury"], ["Mon", 480, "gab"]]);
    expect(result.sections[0].components[1]).toMatchObject({ role: "required-linked", classNumber: "6863", seats: { open: 33 } });
  });
  test("direct subject requests are single-flight and use CORS without credentials", async () => {
    const upstream = Promise.withResolvers<Response>();
    let calls = 0;
    const source = createBrowserSectionSource({ config: directConfig(), fetcher: async (url, init) => {
      calls++; expect(url).toBe("https://fake-vsb.test/data/spring-2027/MATH.json");
      expect(init).toMatchObject({ mode: "cors", credentials: "omit", redirect: "error", cache: "no-cache" });
      return upstream.promise;
    } });
    const pending = [source.getCourseSections("spring-2027", "MATH 1680"), source.getCourseSections("spring-2027", "MATH 1680")];
    upstream.resolve(Response.json(subjectFixture("MATH")));
    const results = await Promise.all(pending);
    expect(results.map(result => result.sections[0].id)).toEqual(["vsb:spring-2027:MATH 1680:6862+6863", "vsb:spring-2027:MATH 1680:6862+6863"]);
    await source.getCourseSections("spring-2027", "MATH 1680"); expect(calls).toBe(1);
  });
  test("simulated browser CORS rejection falls back to a per-course proxy and backs off", async () => {
    const paths: string[] = [];
    const source = createBrowserSectionSource({ config: directConfig(), fetcher: async url => {
      paths.push(url);
      if (url.startsWith("https://fake-vsb.test")) throw new TypeError("CORS blocked: Failed to fetch");
      return Response.json(fallback());
    } });
    const result = await source.getCourseSections("spring-2027", "MATH 1680");
    expect(result).toMatchObject({ status: "ok", provenance: { kind: "real" }, freshness: { diagnostic: { code: "upstream_error" } } });
    expect(result.freshness.diagnostic?.message).toContain("CORS blocked");
    expect(result.sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
    await source.getCourseSections("spring-2027", "MATH 1680");
    expect(paths).toEqual(["https://fake-vsb.test/data/spring-2027/MATH.json", "/api/sections/spring-2027/MATH/1680", "/api/sections/spring-2027/MATH/1680"]);
  });
  test("missing subject files use the proxy, never the whole-term origin URL", async () => {
    const paths: string[] = [];
    const source = createBrowserSectionSource({ config: directConfig(), fetcher: async url => {
      paths.push(url); return url.startsWith("https://fake-vsb.test") ? new Response(null, { status: 404 }) : Response.json(fallback());
    } });
    expect((await source.getCourseSections("spring-2027", "MATH 1680")).sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
    expect(paths).toEqual(["https://fake-vsb.test/data/spring-2027/MATH.json", "/api/sections/spring-2027/MATH/1680"]);
  });
  test("oversized Content-Length cancels the file and uses the proxy", async () => {
    let cancelled = false;
    const source = createBrowserSectionSource({ config: directConfig(), fetcher: async url => {
      if (!url.startsWith("https://fake-vsb.test")) return Response.json(fallback());
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "Content-Length": "16000000" } });
    } });
    const result = await source.getCourseSections("spring-2027", "MATH 1680");
    expect(cancelled).toBe(true);
    expect(result.sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
    expect(result.freshness.diagnostic?.message).toContain("oversized downloads are refused");
  });
  test("streams without a length header are cancelled at the byte limit", async () => {
    let cancelled = false;
    const source = createBrowserSectionSource({ config: createSectionsConfig({ ...directConfig(), maxDirectBytes: 128 }), fetcher: async url => {
      if (!url.startsWith("https://fake-vsb.test")) return Response.json(fallback());
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(129)); }, cancel() { cancelled = true; } }));
    } });
    const result = await source.getCourseSections("spring-2027", "MATH 1680");
    expect(cancelled).toBe(true);
    expect(result.freshness.diagnostic?.message).toContain("exceeds 128 bytes");
    expect(result.provenance.kind).toBe("real");
  });
  test("full-term data masquerading as a subject and changed schemas are refused", async () => {
    for (const raw of [fixture, { ...subjectFixture("MATH"), schema_version: 3 }]) {
      const source = createBrowserSectionSource({ config: directConfig(), fetcher: async url => Response.json(url.startsWith("https://fake-vsb.test") ? raw : fallback()) });
      const result = await source.getCourseSections("spring-2027", "MATH 1680");
      expect(result).toMatchObject({ provenance: { kind: "real" }, freshness: { diagnostic: { code: "schema_error" } } });
      expect(result.sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
    }
  });
  test("term metadata is lazy and ages to stale without a whole-term download", async () => {
    let now = 1000, calls = 0;
    const source = createBrowserSectionSource({ config: directConfig(), now: () => now, fetcher: async () => { calls++; return Response.json(subjectFixture("MATH")); } });
    expect(await source.getTerms()).toMatchObject([{ id: "spring-2027", freshness: { status: "unavailable" } }]);
    expect(calls).toBe(0);
    await source.getCourseSections("spring-2027", "MATH 1680");
    expect(await source.getTerms()).toMatchObject([{ id: "spring-2027", provenance: { kind: "real" }, freshness: { status: "ok" } }]);
    now += 15 * 60_000;
    expect((await source.freshness("spring-2027")).status).toBe("stale");
    expect(calls).toBe(1);
  });
  test.each(["samples", "offline"])("failed direct revalidation preserves stale real options when proxy is %s", async proxyState => {
    let now = 1000, directCalls = 0;
    const result = fallback();
    const sample = { ...result, status: "unavailable", freshness: { ...result.freshness, status: "unavailable" }, availability: "missing",
      provenance: { kind: "sample", source: "synthetic fixture", term: null, updated_at: null, note: "Synthetic sample" }, sections: [] };
    const source = createBrowserSectionSource({ config: directConfig(), now: () => now, fetcher: async (url, init) => {
      if (url.startsWith("https://fake-vsb.test")) {
        directCalls++; expect(init.cache).toBe("no-cache");
        if (directCalls === 1) return Response.json(subjectFixture("MATH"));
        throw new TypeError("CORS blocked during revalidation");
      }
      if (proxyState === "offline") throw new TypeError("proxy offline");
      return Response.json(sample);
    } });
    await source.getCourseSections("spring-2027", "MATH 1680"); now += 15 * 60_000;
    const stale = await source.getCourseSections("spring-2027", "MATH 1680");
    expect(stale).toMatchObject({ status: "stale", provenance: { kind: "real" }, freshness: { checkedAt: "1970-01-01T00:00:01.000Z", diagnostic: { code: "upstream_error" } } });
    expect(stale.sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
    expect((await source.freshness("spring-2027")).status).toBe("stale");
    expect(directCalls).toBe(2);
  });
  test("proxy mode and runtime configuration loader use the same source contract", async () => {
    const paths: string[] = [];
    const source = await loadBrowserSectionSource(async url => {
      paths.push(url); return Response.json(url.endsWith("/config") ? createSectionsConfig() : fallback());
    });
    expect((await source.getCourseSections("spring-2027", "MATH 1680")).sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
    expect(paths).toEqual(["/api/sections/config", "/api/sections/spring-2027/MATH/1680"]);
  });
  test("proxy term listing and freshness validate the shared normalized contract", async () => {
    const result = fallback();
    const source = createBrowserSectionSource({ config: createSectionsConfig(), fetcher: async () => Response.json({ terms: [
      { id: "spring-2027", label: "2027 Spring", freshness: result.freshness, provenance: result.provenance },
    ] }) });
    expect(await source.getTerms()).toMatchObject([{ id: "spring-2027", provenance: { kind: "real", source: "vsb.untgrades.app" } }]);
    expect(await source.freshness("spring-2027")).toMatchObject({ status: "ok", checkedAt: "2026-10-13T12:00:00.000Z" });
    expect(await source.freshness("fall-2027")).toMatchObject({ status: "unavailable" });
  });
  test("proxy samples remain labeled and keep synthetic ids after a direct failure", async () => {
    const raw = { ...fallback(), status: "unavailable", freshness: { ...fallback().freshness, status: "unavailable" },
      availability: "sample", provenance: { kind: "sample", source: "synthetic fixture", term: null, updated_at: null, note: "Synthetic sample" },
      sections: [{ ...fallback().sections[0], id: "math-1680-001", term: null }] };
    const source = createBrowserSectionSource({ config: directConfig(), fetcher: async url => {
      if (url.startsWith("https://fake-vsb.test")) throw new TypeError("CORS blocked");
      return Response.json(raw);
    } });
    expect(await source.getCourseSections("spring-2027", "MATH 1680")).toMatchObject({ status: "unavailable", availability: "sample", provenance: { kind: "sample" }, sections: [{ id: "math-1680-001", term: null }] });
  });
});
describe("direct configuration and proxy boundaries", () => {
  test("unsafe whole-term/direct combinations are rejected before a phone can fetch", () => {
    expect(() => createSectionsConfig({ mode: "direct", fileLayout: "term-only" })).toThrow("direct whole-term downloads are refused on all devices");
    expect(() => createSectionsConfig({ mode: "direct", maxDirectBytes: 16_000_000 })).toThrow("at most 2 MiB");
    expect(() => createSectionsConfig({ mode: "direct", urls: { ...vsbUrls, subjectPath: "/data/{term}.json?subject={subject}" } })).toThrow("subject-file {subject} path placeholder");
    expect(() => createSectionsConfig({ mode: "direct", urls: { ...vsbUrls, subjectPath: "/data/{subject}/../{term}.json" } })).toThrow("subject path must retain its subject");
    expect(() => parseSectionsConfig({ mode: "direct", fileLayout: "term-only", urls: vsbUrls, maxDirectBytes: 1024 })).toThrow("direct whole-term downloads are refused");
    expect(() => createSectionsConfig({ mode: "automatic" })).toThrow("SECTIONS_MODE must be direct or proxy");
  });
  test("malformed normalized proxy fields and contradictory provenance fail loudly", () => {
    const valid = fallback();
    expect(() => parseProxyCourse({ ...valid, sections: [{ ...valid.sections[0], meetings: [{ ...valid.sections[0].meetings[0], day: ["Tue"] }] }] }, "spring-2027", "MATH 1680")).toThrow("proxy.course");
    expect(() => parseProxyCourse({ ...valid, availability: "sample" }, "spring-2027", "MATH 1680")).toThrow("proxy.course.provenance");
    expect(parseProxyCourse(valid, "spring-2027", "MATH 1680").sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
  });
});
