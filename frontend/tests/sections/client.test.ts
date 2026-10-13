import { afterEach, expect, test } from "bun:test";
import type { CourseSections } from "../../src/lib/sections/model";
import { getCourseSections } from "../../src/lib/sections/client";

const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
afterEach(() => { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout; });
const fallback: CourseSections = { term: "spring-2027", courseCode: "MATH 1680", status: "unavailable", availability: "sample", provenance: { kind: "sample", source: "bundled", note: "Sample sections" }, diagnostic: { code: "upstream_error", message: "upstream timeout" }, sections: [] };

test("the browser receives the proxy's fallback after its upstream deadline", async () => {
  AbortSignal.timeout = () => originalTimeout(1);
  globalThis.fetch = (async (_input, init) => {
    await Bun.sleep(10);
    init?.signal?.throwIfAborted();
    return Response.json(fallback);
  }) as typeof fetch;
  expect(await getCourseSections("spring-2027", "MATH 1680")).toEqual(fallback);
});

test("lowercase course input uses the normalized path and accepts its echo", async () => {
  let path: string | URL | Request | undefined;
  globalThis.fetch = (async (input) => { path = input; return Response.json(fallback); }) as typeof fetch;
  expect((await getCourseSections("spring-2027", "math 1680")).courseCode).toBe("MATH 1680");
  expect(path).toBe("/api/sections/spring-2027/MATH/1680");
});
