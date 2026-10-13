import { expect, test } from "bun:test";
import fixture from "./fixtures/spring-2027.json";
import { VsbTermCache } from "../../src/lib/sections/cache";
import { createSectionSource } from "../../src/lib/sections/source";
import { createSectionsConfig, vsbUrls } from "../../src/lib/sections/config";

const config = createSectionsConfig({ urls: { ...vsbUrls, origin: "https://fake-vsb.test" } });
const math = { ...fixture, courses: { "MATH 1680": fixture.courses["MATH 1680"] } };
test("proxy prefers published subject files and shares their in-flight fetch", async () => {
  const paths: string[] = [];
  const cache = new VsbTermCache({ config, terms: ["spring-2027"], fetcher: async url => { paths.push(url); return Response.json(math); } });
  const source = createSectionSource(cache);
  const results = await Promise.all([source.getCourseSections("spring-2027", "MATH 1680"), source.getCourseSections("spring-2027", "MATH 1680")]);
  expect(paths).toEqual(["https://fake-vsb.test/data/spring-2027/MATH.json"]);
  expect(results.map(result => result.sections[0].id)).toEqual(["vsb:spring-2027:MATH 1680:6862+6863", "vsb:spring-2027:MATH 1680:6862+6863"]);
});
test("missing subject files fall back to one shared whole-term fetch server-side", async () => {
  const paths: string[] = [];
  const cache = new VsbTermCache({ config, terms: ["spring-2027"], fetcher: async url => {
    paths.push(url); return url.endsWith("/spring-2027.json") ? Response.json(fixture) : new Response(null, { status: 404 });
  } });
  const source = createSectionSource(cache);
  const results = await Promise.all([source.getCourseSections("spring-2027", "MATH 1680"), source.getCourseSections("spring-2027", "ACCT 5120")]);
  expect(results.map(result => result.courseCode)).toEqual(["MATH 1680", "ACCT 5120"]);
  expect(paths).toEqual(["https://fake-vsb.test/data/spring-2027/MATH.json", "https://fake-vsb.test/data/spring-2027/ACCT.json", "https://fake-vsb.test/data/spring-2027.json"]);
  await source.getCourseSections("spring-2027", "MATH 1680"); expect(paths).toHaveLength(3);
});
test("invalid subject shape cannot masquerade as real subject data", async () => {
  const paths: string[] = [];
  const cache = new VsbTermCache({ config, terms: ["spring-2027"], fetcher: async url => { paths.push(url); return Response.json(fixture); } });
  const result = await createSectionSource(cache).getCourseSections("spring-2027", "MATH 1680");
  expect(result).toMatchObject({ status: "ok", provenance: { kind: "real" }, freshness: { diagnostic: { code: "schema_error" } } });
  expect(result.freshness.diagnostic?.message).toContain("expected only MATH courses");
  expect(paths).toEqual(["https://fake-vsb.test/data/spring-2027/MATH.json", "https://fake-vsb.test/data/spring-2027.json"]);
});
test("a course missing from a partial subject file still checks the term before samples", async () => {
  const whole = { ...fixture, courses: { ...fixture.courses, "MATH 1710": { ...fixture.courses["MATH 1680"], course_code: "MATH 1710" } } };
  const paths: string[] = [];
  const cache = new VsbTermCache({ config, terms: ["spring-2027"], fetcher: async url => { paths.push(url); return Response.json(url.endsWith("/MATH.json") ? math : whole); } });
  const result = await createSectionSource(cache).getCourseSections("spring-2027", "MATH 1710");
  expect(result).toMatchObject({ status: "ok", availability: "sections", provenance: { kind: "real" } });
  expect(result.sections[0].id).toBe("vsb:spring-2027:MATH 1710:6862+6863");
  expect(paths).toEqual(["https://fake-vsb.test/data/spring-2027/MATH.json", "https://fake-vsb.test/data/spring-2027.json"]);
});
