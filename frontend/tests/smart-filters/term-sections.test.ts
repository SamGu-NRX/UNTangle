import { describe, expect, test } from "bun:test";
import fixture from "../sections/fixtures/spring-2027.json";
import { SectionsProxy } from "@/lib/sections/proxy";

type Route = (url: string) => Promise<Response>;

const termUrl = "https://vsb.untgrades.app/data/spring-2027.json";

function proxyWith(route: Route) {
  const background: Promise<void>[] = [];
  const proxy = new SectionsProxy({
    fetcher: (url) => route(url),
    now: () => 1_000,
    retain: (work) => {
      background.push(work);
    },
  });
  return { proxy, settle: () => Promise.all(background) };
}

describe("getTermSections", () => {
  test("serves every course with its sections from the term file", async () => {
    const vsb = proxyWith(async (url) => (url === termUrl ? Response.json(fixture) : new Response(null, { status: 404 })));
    const term = await vsb.proxy.getTermSections("spring-2027");
    if (term.status === "unavailable") {
      throw new Error(`expected the term source to load: ${JSON.stringify(term.diagnostic)}`);
    }
    expect(term.courses.length).toBeGreaterThan(0);
    for (const course of term.courses) {
      // Courses whose record failed to parse are left out, never half-served.
      expect(course.sections.length).toBeGreaterThan(0);
    }
    expect(term.provenance.kind).toBe("real");
    expect(term.checkedAt).toBeTruthy();
    expect(term.courses.map((course) => course.courseCode)).toContain("MATH 1680");
  });

  test("an unsupported term never reaches vsb", async () => {
    const vsb = proxyWith(() => {
      throw new Error("no fetch expected");
    });
    const term = await vsb.proxy.getTermSections("summer-2020");
    expect(term).toEqual({ status: "unavailable", diagnostic: { code: "upstream_error", message: "No vsb source for summer-2020" } });
  });

  test("a down vsb is unavailable, not a throw", async () => {
    const vsb = proxyWith(async () => new Response(null, { status: 503 }));
    const term = await vsb.proxy.getTermSections("spring-2027");
    expect(term.status).toBe("unavailable");
  });
});
