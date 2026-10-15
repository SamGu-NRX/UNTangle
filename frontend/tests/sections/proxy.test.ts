import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/spring-2027.json";
import { ttlMs, retryMs } from "../../src/lib/sections/config";
import { SectionsProxy } from "../../src/lib/sections/proxy";

const termUrl = "https://vsb.untgrades.app/data/spring-2027.json";
const subjectUrl = (subject: string) => termUrl.replace(".json", `/${subject}.json`);
const mathId = "vsb:spring-2027:MATH 1680:6862+6863";
const validators = { ETag: '"v1"', "Last-Modified": "Sun, 04 Oct 2026 19:02:54 GMT" };

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

/** By default vsb serves the fixture as the term file and has no subject files. */
const termOnly: Route = url => url === termUrl
  ? Response.json(fixture, { headers: validators })
  : new Response(null, { status: 404 });

function fakeVsb(route: Route = termOnly) {
  const calls: { url: string; headers: Headers }[] = [];
  const background: Promise<void>[] = [];
  let now = 1_000;
  const proxy = new SectionsProxy({
    fetcher: async (url, init) => {
      calls.push({ url, headers: new Headers(init.headers) });
      return route(url, init);
    },
    now: () => now,
    retain: work => { background.push(work); },
  });
  return {
    proxy,
    urls: () => calls.map(call => call.url),
    termCalls: () => calls.filter(call => call.url === termUrl),
    advance: (ms: number) => { now += ms; },
    settle: () => Promise.all(background),
  };
}

describe("cache", () => {
  test("concurrent cold requests share one fetch per file", async () => {
    const upstream = Promise.withResolvers<Response>();
    const vsb = fakeVsb(url => (url === termUrl ? upstream.promise : termOnly(url, {})));
    const pending = Promise.all([
      vsb.proxy.getCourseSections("spring-2027", "MATH 1680"),
      vsb.proxy.getCourseSections("spring-2027", "MATH 1680"),
      vsb.proxy.getCourseSections("spring-2027", "ACCT 5120"),
    ]);
    upstream.resolve(Response.json(fixture));
    const [first, second, acct] = await pending;
    expect([first.sections[0].id, second.sections[0].id]).toEqual([mathId, mathId]);
    expect(acct).toMatchObject({ status: "ok", availability: "sections", courseCode: "ACCT 5120" });
    expect(vsb.urls()).toEqual([termUrl, subjectUrl("MATH"), subjectUrl("ACCT")]);
  });

  test("stale data answers at once; one revalidation sends validators; 304 renews it", async () => {
    const refresh = Promise.withResolvers<Response>();
    let termRequests = 0;
    const vsb = fakeVsb((url, init) =>
      url === termUrl && ++termRequests > 1 ? refresh.promise : termOnly(url, init));
    await vsb.proxy.getCourseSections("spring-2027", "MATH 1680");
    vsb.advance(ttlMs);
    const stale = await vsb.proxy.getCourseSections("spring-2027", "MATH 1680");
    await vsb.proxy.getCourseSections("spring-2027", "MATH 1680");
    expect(stale).toMatchObject({ status: "stale", provenance: { kind: "real" } });
    expect(vsb.termCalls()).toHaveLength(2);
    expect(vsb.termCalls()[1].headers.get("if-none-match")).toBe('"v1"');
    expect(vsb.termCalls()[1].headers.get("if-modified-since")).toBe(validators["Last-Modified"]);
    refresh.resolve(new Response(null, { status: 304 }));
    await vsb.settle();
    const renewed = await vsb.proxy.getCourseSections("spring-2027", "MATH 1680");
    const checkedAt = new Date(1_000 + ttlMs).toISOString();
    expect(renewed).toMatchObject({ status: "ok", checkedAt });
    expect(renewed.sections[0].id).toBe(mathId);
  });

  test("stale real data survives an upstream failure and a schema change", async () => {
    const answers = [
      () => Response.json(fixture),
      () => new Response(null, { status: 503 }),
      () => Response.json({ ...fixture, schema_version: 3 }),
    ];
    let termRequests = 0;
    const vsb = fakeVsb((url, init) =>
      url === termUrl ? answers[termRequests++]() : termOnly(url, init));
    const read = () => vsb.proxy.getCourseSections("spring-2027", "MATH 1680");
    await read();
    vsb.advance(ttlMs);
    await read();
    await vsb.settle();
    const afterOutage = await read();
    expect(afterOutage).toMatchObject({
      status: "stale",
      diagnostic: { code: "upstream_error", message: `vsb ${termUrl}: HTTP 503` },
    });
    expect(afterOutage.sections[0].id).toBe(mathId);
    expect(vsb.termCalls()).toHaveLength(2);
    vsb.advance(retryMs);
    await read();
    await vsb.settle();
    const afterSchemaChange = await read();
    expect(afterSchemaChange)
      .toMatchObject({ status: "stale", diagnostic: { code: "schema_error" } });
    expect(afterSchemaChange.sections[0].id).toBe(mathId);
  });
});

describe("subject files", () => {
  test("a published subject file is used, and the term file covers courses it lacks", async () => {
    const term = {
      ...fixture,
      courses: { ...fixture.courses, "MATH 1710": { ...fixture.courses["MATH 1680"], course_code: "MATH 1710" } },
    };
    const subjectFile = { ...fixture, note: "MATH subject file", courses: {
      "MATH 1680": fixture.courses["MATH 1680"],
    } };
    const vsb = fakeVsb(url => Response.json(url === termUrl ? term : subjectFile));
    const fromSubject = await vsb.proxy.getCourseSections("spring-2027", "MATH 1680");
    const fromTerm = await vsb.proxy.getCourseSections("spring-2027", "MATH 1710");
    expect(fromSubject.provenance).toMatchObject({ kind: "real", note: "MATH subject file" });
    expect(fromTerm.provenance).toMatchObject({ kind: "real", note: fixture.note });
    expect(fromTerm.sections[0].id).toBe("vsb:spring-2027:MATH 1710:6862+6863");
    expect(vsb.urls()).toEqual([termUrl, subjectUrl("MATH")]);
  });

  test("after a 404 for a real subject, no subject file is tried within the TTL", async () => {
    const vsb = fakeVsb();
    expect((await vsb.proxy.getCourseSections("spring-2027", "MATH 1680")).status).toBe("ok");
    expect((await vsb.proxy.getCourseSections("spring-2027", "ACCT 5120")).status).toBe("ok");
    expect(vsb.urls()).toEqual([termUrl, subjectUrl("MATH")]);
  });

  test("a subject the term lacks never reaches vsb", async () => {
    const vsb = fakeVsb();
    const result = await vsb.proxy.getCourseSections("spring-2027", "ZZZZ 1000");
    expect(result).toMatchObject({ status: "unavailable", availability: "missing", sections: [] });
    expect(vsb.urls()).toEqual([termUrl]);
  });
});

describe("results", () => {
  test("one bad course is a schema_error while the others are still served", async () => {
    const broken = structuredClone(fixture);
    broken.courses["MATH 1680"].sections[0].meetings[0].start_time = "25:00PM";
    const vsb = fakeVsb((url, init) =>
      url === termUrl ? Response.json(broken) : termOnly(url, init));
    const math = await vsb.proxy.getCourseSections("spring-2027", "MATH 1680");
    expect(math).toMatchObject({ status: "unavailable", diagnostic: { code: "schema_error" } });
    expect(math.diagnostic?.message).toContain("meetings[0].start_time: invalid time");
    const acct = await vsb.proxy.getCourseSections("spring-2027", "ACCT 5120");
    expect(acct).toMatchObject({ status: "ok", availability: "sections" });
  });

  test("real no_classes stays empty; no usable record falls back to labeled samples", async () => {
    const vsb = fakeVsb();
    expect(await vsb.proxy.getCourseSections("spring-2027", "AARS 6810"))
      .toMatchObject({ status: "ok", availability: "no_classes", sections: [] });
    const sample = await vsb.proxy.getCourseSections("spring-2027", "MATH 1710");
    expect(sample).toMatchObject({ status: "unavailable", availability: "sample" });
    expect(sample.provenance.kind).toBe("sample");
    expect(sample.sections[0].components.map(c => c.role)).toEqual(["primary"]);

    const down = fakeVsb(() => new Response(null, { status: 503 }));
    const cold = await down.proxy.getCourseSections("spring-2027", "MATH 1680");
    expect(cold).toMatchObject({ availability: "sample", diagnostic: { code: "upstream_error" } });
    expect(cold.sections[0].id).toBe("math-1680-001");
  });
});

describe("route", () => {
  test("malformed input is a 400 that never reaches vsb", async () => {
    const vsb = fakeVsb();
    const bad = [
      ["../secret", "MATH", "1680"],
      ["spring-2027", "../", "1680"],
      ["spring-2027", "MATH", "bad"],
      ["spring-2027", "MA", "1680"],
      ["spring-2027", "MATHS", "1680"],
    ];
    for (const [term, subject, number] of bad) {
      expect((await vsb.proxy.respond(term, subject, number)).status).toBe(400);
    }
    expect(vsb.urls()).toEqual([]);
  });

  test("valid input is normalized and never cached by the browser", async () => {
    const response = await fakeVsb().proxy.respond("spring-2027", "math", "1680");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ courseCode: "MATH 1680", status: "ok" });
  });
});
