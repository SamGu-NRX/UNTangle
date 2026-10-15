import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Mirror } from "../../src/release-job/mirror";
import { startStubMirror, stubPolicy, type StubMirror } from "./stub";

describe("Mirror", () => {
  let stub: StubMirror;

  beforeAll(() => {
    stub = startStubMirror({
      "/data/spring-2027.json": { body: '{"schema_version":2}', etag: '"v1"', lastModified: "Wed, 14 Oct 2026 18:00:00 GMT" },
      "/data/spring-2027/MATH.json": { body: '{"schema_version":2}', etag: '"m1"' },
      "/data/spring-2027/CSCE.json": { body: '{"schema_version":2}', etag: '"c1"', delayMs: 150 },
      "/data/spring-2027/PHIL.json": { body: '{"schema_version":2}', etag: '"p1"', delayMs: 150 },
      "/data/spring-2027/BROK.json": { body: "broken", etag: '"b1"', status: 500 },
    });
  });

  afterAll(async () => {
    await stub.stop();
  });

  test("a 200 becomes a fetched outcome and remembers the validators", async () => {
    const mirror = new Mirror({ policy: stubPolicy(stub.url), baseUrl: `${stub.url}/data/` });
    const outcome = await mirror.fetchFile("spring-2027");
    expect(outcome).toMatchObject({ kind: "fetched", body: '{"schema_version":2}', etag: '"v1"' });
    expect(mirror.state.files[`${stub.url}/data/spring-2027.json`]).toMatchObject({ etag: '"v1"', lastModified: "Wed, 14 Oct 2026 18:00:00 GMT" });
  });

  test("a second fetch sends the validators and reads a 304 as not-modified", async () => {
    const mirror = new Mirror({ policy: stubPolicy(stub.url), baseUrl: `${stub.url}/data/` });
    await mirror.fetchFile("spring-2027");
    const outcome = await mirror.fetchFile("spring-2027");
    expect(outcome).toEqual({ kind: "not-modified" });
  });

  test("a timed-out request is an error, not a throw", async () => {
    const slow = startStubMirror({
      "/data/spring-2027.json": { body: "slow", delayMs: 1_000 },
    });
    try {
      const mirror = new Mirror({ policy: stubPolicy(slow.url), baseUrl: `${slow.url}/data/`, timeoutMs: 100 });
      const outcome = await mirror.fetchFile("spring-2027");
      expect(outcome.kind).toBe("error");
      if (outcome.kind === "error") expect(outcome.message).toContain("timed out");
    } finally {
      await slow.stop();
    }
  });

  test("a body over the size cap is an error", async () => {
    const mirror = new Mirror({ policy: stubPolicy(stub.url), baseUrl: `${stub.url}/data/`, maxBytes: 4 });
    const outcome = await mirror.fetchFile("spring-2027");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") expect(outcome.message).toContain("exceeds");
  });

  test("the minimum interval defers a too-soon second fetch of one URL", async () => {
    const requestsBefore = stub.requests.length;
    const policy = { ...stubPolicy(stub.url), minIntervalMs: 60_000 };
    const mirror = new Mirror({ policy, baseUrl: `${stub.url}/data/` });
    expect(await mirror.fetchFile("spring-2027")).toMatchObject({ kind: "fetched" });
    const outcome = await mirror.fetchFile("spring-2027");
    expect(outcome).toEqual({ kind: "deferred", reason: "min-interval" });
    expect(stub.requests.slice(requestsBefore).filter(path => path === "/data/spring-2027.json")).toHaveLength(1);
  });

  test("the hourly cap defers a fetch beyond the budget across URLs", async () => {
    const policy = { ...stubPolicy(stub.url), maxRequestsPerHour: 2 };
    const mirror = new Mirror({ policy, baseUrl: `${stub.url}/data/` });
    expect(await mirror.fetchFile("spring-2027")).toMatchObject({ kind: "fetched" });
    expect(await mirror.fetchFile("spring-2027", "MATH")).toMatchObject({ kind: "fetched" });
    const outcome = await mirror.fetchFile("spring-2027", "CSCE");
    expect(outcome).toEqual({ kind: "deferred", reason: "hourly-budget" });
  });

  test("fetchFiles runs under the policy's concurrency and never exceeds it", async () => {
    const policy = { ...stubPolicy(stub.url), maxConcurrency: 2 };
    const mirror = new Mirror({ policy, baseUrl: `${stub.url}/data/` });
    const results = await mirror.fetchFiles([
      { term: "spring-2027", subject: "CSCE" },
      { term: "spring-2027", subject: "PHIL" },
    ]);
    expect(results.map(result => result.outcome.kind)).toEqual(["fetched", "fetched"]);
    // Two delayed files were in flight together: the pool really ran at two.
    expect(stub.maxInFlight).toBe(2);
  });

  test("fetchFiles keeps going when one file errors", async () => {
    const policy = { ...stubPolicy(stub.url), maxConcurrency: 1 };
    const mirror = new Mirror({ policy, baseUrl: `${stub.url}/data/` });
    const results = await mirror.fetchFiles([
      { term: "spring-2027", subject: "BROK" },
      { term: "spring-2027", subject: "MATH" },
    ]);
    const kinds = results.map(result => result.outcome.kind);
    expect(kinds).toContain("error");
    expect(kinds).toContain("fetched");
  });

  test("a URL outside the policy's prefixes is refused before any request", () => {
    const requestsBefore = stub.requests.length;
    const mirror = new Mirror({ policy: stubPolicy(stub.url), baseUrl: "https://elsewhere.example/data/" });
    expect(() => mirror.urlFor("spring-2027")).toThrow(/outside the policy/);
    expect(stub.requests.slice(requestsBefore)).toHaveLength(0);
  });

  test("a 404 is absent", async () => {
    const mirror = new Mirror({ policy: stubPolicy(stub.url), baseUrl: `${stub.url}/data/` });
    expect(await mirror.fetchFile("fall-2027")).toEqual({ kind: "absent" });
  });
});
