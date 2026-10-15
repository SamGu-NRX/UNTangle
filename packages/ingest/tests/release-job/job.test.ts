import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runReleaseJob } from "../../src/release-job/job";
import { startStubMirror, stubPolicy, type StubFile, type StubMirror } from "./stub";

/**
 * vsb-spring-2027.json is the checked-in acceptance fixture: a real
 * vsb.untgrades.app schema v2 term file cut to seven courses (source URL and
 * date recorded beside it in section-release.test.ts).
 */
const fixturePath = path.join(import.meta.dir, "..", "fixtures", "vsb-spring-2027.json");
const termBody = readFileSync(fixturePath, "utf8");

/** A term file with one changed seat count, for diff tests. */
const changedBody = (() => {
  const raw = JSON.parse(termBody) as { courses: Record<string, { sections: Array<{ linked_sections: Array<{ open_seats: number }> }> }> };
  raw.courses["MATH 1680"].sections[0].linked_sections[0].open_seats = 3;
  return JSON.stringify(raw);
})();

/** A term file missing three of its seven courses, for the sanity check. The three dropped courses all carry sections. */
const shrunkenBody = (() => {
  const raw = JSON.parse(termBody) as { courses: Record<string, unknown>; coverage: Record<string, number> };
  for (const code of ["ACCT 5120", "BCIS 4740", "DBAS 6003"]) delete raw.courses[code];
  raw.coverage.catalog_courses = 4;
  raw.coverage.completed_courses = 4;
  raw.coverage.courses_with_options = 3;
  return JSON.stringify(raw);
})();

const subjectBody = (openSeats: number): string => {
  const raw = JSON.parse(termBody) as { courses: Record<string, { sections: Array<{ linked_sections: Array<{ open_seats: number }> }> }> };
  const course = raw.courses["MATH 1680"];
  // A subject file carries only its own subject's courses.
  const mathOnly = { schema_version: 2, term: "2027 Spring", updated_at: new Date().toISOString(), courses: { "MATH 1680": course } };
  mathOnly.courses["MATH 1680"].sections[0].linked_sections[0].open_seats = openSeats;
  return JSON.stringify(mathOnly);
};

describe("runReleaseJob", () => {
  let stub: StubMirror;
  let outDir: string;
  let files: Record<string, StubFile>;

  const job = (overrides: Partial<Parameters<typeof runReleaseJob>[0]> = {}) =>
    runReleaseJob({
      termId: "spring-2027",
      outDir,
      baseUrl: `${stub.url}/data/`,
      policy: stubPolicy(stub.url),
      watchTerms: [],
      ...overrides,
    });

  beforeAll(() => {
    files = {
      "/data/spring-2027.json": { body: termBody, etag: '"v1"' },
      "/data/spring-2027/MATH.json": { body: subjectBody(7), etag: '"m1"' },
      "/data/spring-2027/BADS.json": { body: '{"schema_version":1}', etag: '"b1"' },
    };
    stub = startStubMirror(files);
    outDir = mkdtempSync(path.join(os.tmpdir(), "release-job-"));
  });

  afterAll(async () => {
    await stub.stop();
    rmSync(outDir, { recursive: true, force: true });
  });

  const pointerFile = () => readFileSync(path.join(outDir, "pointers", "spring-2027.json"), "utf8");

  test("a first run publishes and writes content plus the pointer", async () => {
    const report = await job();
    expect(report.outcome).toBe("published");
    expect(report.file).toBeDefined();
    if (report.outcome !== "published" || report.file === undefined) return;
    expect(report.sanity).toEqual({ ok: true });
    expect(report.diff).toBeNull();
    expect(existsSync(path.join(outDir, report.file))).toBe(true);
    const pointer = JSON.parse(pointerFile()) as { file: string; releaseId: string };
    expect(pointer.file).toBe(report.file);
    const written = JSON.parse(readFileSync(path.join(outDir, report.file), "utf8")) as { manifest: { counts: { courses: number } } };
    expect(written.manifest.counts.courses).toBe(7);
  });

  test("a second identical run is unchanged and rewrites nothing", async () => {
    const before = pointerFile();
    const report = await job();
    expect(report.outcome).toBe("unchanged");
    expect(pointerFile()).toBe(before);
  });

  test("a changed upstream publishes with a diff and the previous release id", async () => {
    files["/data/spring-2027.json"] = { body: changedBody, etag: '"v2"' };
    const report = await job();
    expect(report.outcome).toBe("published");
    expect(report.diff?.changes.some(change => change.kind === "seats")).toBe(true);
    expect(report.previousReleaseId).toBeDefined();
  });

  test("a shrunken upstream is refused and the pointer stays put", async () => {
    const before = pointerFile();
    files["/data/spring-2027.json"] = { body: shrunkenBody, etag: '"v3"' };
    const report = await job();
    expect(report.outcome).toBe("refused");
    expect(report.reason).toBe("sanity-check");
    expect(pointerFile()).toBe(before);
  });

  test("a schema-version change is refused before anything is built", async () => {
    files["/data/spring-2027.json"] = { body: '{"schema_version":3}', etag: '"v4"' };
    const report = await job();
    expect(report.outcome).toBe("refused");
    expect(report.reason).toBe("unsupported-schema");
    expect(report.wrote).toBe(false);
  });

  test("a body cut off mid-JSON is refused and the pointer stays put", async () => {
    // Partial response: the fetch itself succeeds, the whole-file parse does
    // not. The last good release stays published and the run reports why.
    // The seed run publishes a body whose hash differs from both changedBody
    // (already the pointer) and termBody (the 304 test below publishes it), so
    // the shared outDir's state chain stays intact for the later tests.
    const seedBody = (() => {
      const raw = JSON.parse(termBody) as { courses: Record<string, { sections: Array<{ linked_sections: Array<{ open_seats: number }> }> }> };
      raw.courses["MATH 1680"].sections[0].linked_sections[0].open_seats = 98;
      return JSON.stringify(raw);
    })();
    files["/data/spring-2027.json"] = { body: seedBody, etag: '"v7"' };
    const first = await job();
    expect(first.outcome).toBe("published");
    const before = pointerFile();
    files["/data/spring-2027.json"] = { body: termBody.slice(0, Math.floor(termBody.length / 2)), etag: '"v8"' };
    const report = await job();
    expect(report.outcome).toBe("refused");
    expect(report.reason).toBe("invalid-json");
    expect(report.wrote).toBe(false);
    expect(pointerFile()).toBe(before);
  });

  test("a 304 leaves the published release in place", async () => {
    // Restore the original body under its original etag: the first run
    // publishes it (the pointer still holds the changed release), the second
    // run's validators match and the mirror answers 304.
    files["/data/spring-2027.json"] = { body: termBody, etag: '"v1"' };
    const first = await job();
    expect(first.outcome).toBe("published");
    const before = pointerFile();
    const report = await job();
    expect(report.outcome).toBe("unchanged");
    expect(report.reason).toBe("not-modified");
    expect(pointerFile()).toBe(before);
  });

  test("a dry run fetches and reports but writes nothing", async () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), "release-job-dry-"));
    try {
      const report = await job({ outDir: empty, dryRun: true });
      expect(report.outcome).toBe("published");
      expect(report.wrote).toBe(false);
      expect(existsSync(path.join(empty, "pointers", "spring-2027.json"))).toBe(false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("a valid subject file overlays its seats onto the term file", async () => {
    files["/data/spring-2027.json"] = { body: termBody, etag: '"v5"' };
    const report = await job({ subjects: ["MATH"] });
    expect(report.outcome).toBe("published");
    if (report.outcome !== "published" || report.file === undefined) return;
    // The release stores courses as an array; the MATH component's seat fact
    // carries the overlay's value, not the term file's 99.
    const written = JSON.parse(readFileSync(path.join(outDir, report.file), "utf8")) as {
      courses: Array<{ courseCode: string; sections: Array<{ components: Array<{ openSeats: { state: string; value?: number } }> }> }>;
    };
    const math = written.courses.find(course => course.courseCode === "MATH 1680");
    expect(math?.sections[0]?.components[0]?.openSeats).toMatchObject({ state: "known", value: 7 });
  });

  test("a subject file with a foreign schema version is skipped, not fatal", async () => {
    // Fresh validators for both files, so this run really fetches them: the
    // mirror would otherwise answer 304 from the previous run's state and the
    // overlays would never be consulted.
    files["/data/spring-2027.json"] = { body: termBody, etag: '"v6"' };
    files["/data/spring-2027/MATH.json"] = { body: subjectBody(9), etag: '"m2"' };
    const report = await job({ subjects: ["BADS", "MATH"] });
    expect(report.outcome).toBe("published");
    // Term, BADS and MATH all fetched; BADS failed its schema check and was
    // dropped from the overlay, MATH applied.
    expect(report.fetched.filter(entry => entry.kind === "fetched")).toHaveLength(3);
  });

  test("a watched term that is absent gets an appeared=false report", async () => {
    // The term file's validators match now, so this run is a 304 — and the
    // watch still runs: the watchdog is a report, not a side effect of
    // publishing.
    const report = await job({ watchTerms: ["fall-2027"] });
    expect(report.outcome).toBe("unchanged");
    expect(report.termWatch).toEqual([
      { termId: "fall-2027", appeared: false, schemaOk: null, detail: expect.stringContaining("404"), sourceObservedAt: null },
    ]);
  });

  test("an absent term file is an error, not a refusal", async () => {
    const report = await job({ termId: "summer-2027" });
    expect(report.outcome).toBe("error");
    expect(report.reason).toBe("absent-upstream");
  });
});

describe("release-job CLI", () => {
  test("missing required flags prints usage and exits 1 without fetching", async () => {
    const child = Bun.spawn(["bun", "packages/ingest/src/release-job/cli.ts"], { cwd: path.join(import.meta.dir, "..", "..", "..", ".."), stdout: "pipe", stderr: "pipe" });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).toBe(1);
    expect(stderr).toContain("--term is required");
    expect(stderr).toContain("usage:");
  });
});
