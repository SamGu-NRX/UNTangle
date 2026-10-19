import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(report.fetched.map(entry => entry.kind)).toEqual(["not-modified"]);
    expect(report.wrote).toBe(false);
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

type RawTerm = {
  coverage: Record<string, number>;
  courses: Record<string, { sections: Array<{ linked_sections: Array<{ open_seats: number }> }> }>;
};

const editTerm = (edit: (raw: RawTerm) => void): string => {
  const raw = JSON.parse(termBody) as RawTerm;
  edit(raw);
  return JSON.stringify(raw);
};

/** A MATH subject file holding exactly these courses, taken from the term file's MATH 1680. */
const mathFile = (courses: Record<string, number>): string => {
  const source = (JSON.parse(termBody) as RawTerm).courses["MATH 1680"];
  const entries = Object.entries(courses).map(([code, openSeats]) => {
    const course = JSON.parse(JSON.stringify(source)) as typeof source;
    course.sections[0].linked_sections[0].open_seats = openSeats;
    return [code, course];
  });
  return JSON.stringify({ schema_version: 2, term: "2027 Spring", updated_at: "2027-01-02T00:00:00Z", courses: Object.fromEntries(entries) });
};

describe("runReleaseJob, one run at a time", () => {
  let stub: StubMirror;
  let files: Record<string, StubFile>;
  let outDir: string;

  beforeEach(() => {
    files = { "/data/spring-2027.json": { body: termBody, etag: '"v1"' } };
    stub = startStubMirror(files);
    outDir = mkdtempSync(path.join(os.tmpdir(), "release-job-run-"));
  });

  afterEach(async () => {
    await stub.stop();
    rmSync(outDir, { recursive: true, force: true });
  });

  const job = (overrides: Partial<Parameters<typeof runReleaseJob>[0]> = {}) =>
    runReleaseJob({ termId: "spring-2027", outDir, baseUrl: `${stub.url}/data/`, policy: stubPolicy(stub.url), watchTerms: [], ...overrides });

  const publishedCourses = (file: string | undefined) => {
    const release = JSON.parse(readFileSync(path.join(outDir, file ?? "missing"), "utf8")) as {
      courses: Array<{ courseCode: string; sections?: Array<{ components: Array<{ openSeats: { value?: number } }> }> }>;
    };
    return new Map(release.courses.map(course => [course.courseCode, course.sections?.[0]?.components[0]?.openSeats.value]));
  };

  test("a 304 retries publishing after a pointer write fails", async () => {
    const pointerPath = path.join(outDir, "pointers", "spring-2027.json");
    mkdirSync(pointerPath, { recursive: true });
    writeFileSync(path.join(pointerPath, "obstruction"), "block the pointer rename");
    const lastModified = "Fri, 01 Jan 2027 00:00:00 GMT";
    files["/data/spring-2027.json"] = { body: changedBody, etag: '"v2"', lastModified };

    await expect(job()).rejects.toMatchObject({ code: "EISDIR", syscall: "rename" });
    const state = JSON.parse(readFileSync(path.join(outDir, "state.json"), "utf8")) as {
      files: Record<string, { etag: string; lastModified: string }>;
    };
    expect(state.files[`${stub.url}/data/spring-2027.json`]).toMatchObject({ etag: '"v2"', lastModified });

    rmSync(pointerPath, { recursive: true });
    const report = await job();
    expect(report.fetched.map(entry => entry.kind)).toEqual(["not-modified"]);
    expect(report.outcome).toBe("published");
    expect(report.wrote).toBe(true);
    const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as { releaseId: string; file: string };
    expect(report.releaseId).toBe(pointer.releaseId);
    expect(report.file).toBe(pointer.file);
    expect(publishedCourses(pointer.file).get("MATH 1680")).toBe(3);
  });

  test("a 304 without subjects keeps the subject files the published release was built with", async () => {
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    expect((await job({ subjects: ["MATH"] })).outcome).toBe("published");
    const pointerPath = path.join(outDir, "pointers", "spring-2027.json");
    const before = readFileSync(pointerPath, "utf8");

    const report = await job();
    expect(report.fetched.map(entry => entry.kind)).toEqual(["not-modified"]);
    expect(report.outcome).toBe("unchanged");
    expect(report.subjects).toEqual([{ subject: "MATH", applied: true, detail: "kept from the published release, from the cached body" }]);
    expect(readFileSync(pointerPath, "utf8")).toBe(before);
    expect(publishedCourses((JSON.parse(before) as { file: string }).file).get("MATH 1680")).toBe(7);
  });

  test("a 304 that cannot reapply a published subject file publishes nothing", async () => {
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    expect((await job({ subjects: ["MATH"] })).outcome).toBe("published");
    const pointerPath = path.join(outDir, "pointers", "spring-2027.json");
    const before = readFileSync(pointerPath, "utf8");
    const mathUrl = `${stub.url}/data/spring-2027/MATH.json`;
    rmSync(path.join(outDir, "bodies", `${createHash("sha256").update(mathUrl).digest("hex")}.json`));

    const report = await job();
    expect(report.outcome).toBe("error");
    expect(report.reason).toBe("subject-unavailable");
    expect(report.subjects).toEqual([{ subject: "MATH", applied: false, detail: "in the published release, but no cached body" }]);
    expect(readFileSync(pointerPath, "utf8")).toBe(before);
  });

  test("a 304 without subjects publishes nothing over a release with no overlay record, until a run with subjects records one", async () => {
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    expect((await job({ subjects: ["MATH"] })).outcome).toBe("published");
    // A release published before records existed.
    rmSync(path.join(outDir, "overlays"), { recursive: true });
    const pointerPath = path.join(outDir, "pointers", "spring-2027.json");
    const before = readFileSync(pointerPath, "utf8");

    const unknown = await job();
    expect(unknown.fetched.map(entry => entry.kind)).toEqual(["not-modified"]);
    expect(unknown.outcome).toBe("error");
    expect(unknown.reason).toBe("overlay-unknown");
    expect(readFileSync(pointerPath, "utf8")).toBe(before);

    // The same content rebuilt with MATH records its subjects; after that a 304 keeps MATH.
    expect((await job({ subjects: ["MATH"] })).outcome).toBe("unchanged");
    const kept = await job();
    expect(kept.outcome).toBe("unchanged");
    expect(kept.subjects).toEqual([{ subject: "MATH", applied: true, detail: "kept from the published release, from the cached body" }]);
    expect(readFileSync(pointerPath, "utf8")).toBe(before);
  });

  test("a 304 that requests only some subjects publishes nothing over a release with no overlay record", async () => {
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    files["/data/spring-2027/ACCT.json"] = { body: mathFile({ "ACCT 5120": 4 }), etag: '"a1"' };
    expect((await job({ subjects: ["MATH", "ACCT"] })).outcome).toBe("published");
    // A release published before records existed.
    rmSync(path.join(outDir, "overlays"), { recursive: true });
    const pointerPath = path.join(outDir, "pointers", "spring-2027.json");
    const before = readFileSync(pointerPath, "utf8");

    const report = await job({ subjects: ["MATH"] });
    expect(report.fetched.map(entry => entry.kind)).toEqual(["not-modified", "not-modified"]);
    expect(report.outcome).toBe("error");
    expect(report.reason).toBe("overlay-unknown");
    expect(report.detail).toContain("has no record of the subject files it was built with");
    expect(readFileSync(pointerPath, "utf8")).toBe(before);
    expect(existsSync(path.join(outDir, "overlays"))).toBe(false);
    expect(publishedCourses((JSON.parse(before) as { file: string }).file).get("ACCT 5120")).toBe(4);
  });

  test("a 304 retries a release whose pointer write failed, over a release with no overlay record", async () => {
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    expect((await job({ subjects: ["MATH"] })).outcome).toBe("published");
    // A release published before records existed.
    rmSync(path.join(outDir, "overlays"), { recursive: true });
    const pointerPath = path.join(outDir, "pointers", "spring-2027.json");
    const legacy = readFileSync(pointerPath, "utf8");

    // A 200 with subjects whose pointer write fails: the temporary file's path is a directory.
    files["/data/spring-2027.json"] = { body: changedBody, etag: '"v2"' };
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 9 }), etag: '"m2"' };
    const blocker = `${pointerPath}.tmp-${process.pid}`;
    mkdirSync(blocker, { recursive: true });
    writeFileSync(path.join(blocker, "obstruction"), "block the pointer write");
    await expect(job({ subjects: ["MATH"] })).rejects.toMatchObject({ syscall: "open" });
    expect(readFileSync(pointerPath, "utf8")).toBe(legacy);

    rmSync(blocker, { recursive: true });
    const report = await job({ subjects: ["MATH"] });
    expect(report.fetched.map(entry => entry.kind)).toEqual(["not-modified", "not-modified"]);
    expect(report.outcome).toBe("published");
    const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as { releaseId: string; file: string };
    expect(report.releaseId).toBe(pointer.releaseId);
    expect(pointer.releaseId).not.toBe((JSON.parse(legacy) as { releaseId: string }).releaseId);
    expect(publishedCourses(pointer.file).get("MATH 1680")).toBe(9);
  });

  test("a retry with MATH publishes a pending MATH,MATH release over a release with no overlay record", async () => {
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    expect((await job({ subjects: ["MATH"] })).outcome).toBe("published");
    rmSync(path.join(outDir, "overlays"), { recursive: true });
    const pointerPath = path.join(outDir, "pointers", "spring-2027.json");
    const legacy = readFileSync(pointerPath, "utf8");

    files["/data/spring-2027.json"] = { body: changedBody, etag: '"v2"' };
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 9 }), etag: '"m2"' };
    const blocker = `${pointerPath}.tmp-${process.pid}`;
    mkdirSync(blocker, { recursive: true });
    writeFileSync(path.join(blocker, "obstruction"), "block the pointer write");
    await expect(job({ subjects: ["MATH", "MATH"] })).rejects.toMatchObject({ syscall: "open" });
    // The pending release's record, as a build before canonical subjects wrote it.
    const records = readdirSync(path.join(outDir, "overlays"));
    expect(records).toHaveLength(1);
    writeFileSync(path.join(outDir, "overlays", records[0] as string), JSON.stringify({ subjects: ["MATH", "MATH"] }));

    rmSync(blocker, { recursive: true });
    const report = await job({ subjects: ["MATH"] });
    expect(report.outcome).toBe("published");
    const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as { releaseId: string; file: string };
    expect(pointer.releaseId).not.toBe((JSON.parse(legacy) as { releaseId: string }).releaseId);
    expect(publishedCourses(pointer.file).get("MATH 1680")).toBe(9);
  });

  test("a request for math and MATH is recorded as MATH once", async () => {
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    const report = await job({ subjects: ["math", " MATH"] });
    expect(report.outcome).toBe("published");
    expect(report.subjects).toEqual([{ subject: "MATH", applied: true }]);
    const records = readdirSync(path.join(outDir, "overlays"));
    expect(records).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(outDir, "overlays", records[0] as string), "utf8"))).toEqual({ subjects: ["MATH"] });
  });

  test("a refused run still saves the request log, including the watch's request", async () => {
    files["/data/spring-2027.json"] = { body: '{"schema_version":3}', etag: '"v4"' };
    const report = await job({ watchTerms: ["fall-2027"] });
    expect(report.outcome).toBe("refused");
    const state = JSON.parse(readFileSync(path.join(outDir, "state.json"), "utf8")) as { files: Record<string, unknown>; requests: string[] };
    expect(Object.keys(state.files).sort()).toEqual([`${stub.url}/data/fall-2027.json`, `${stub.url}/data/spring-2027.json`]);
    expect(state.requests).toHaveLength(2);
  });

  test("a term file that claims an incomplete scrape stays refused after a subject overlay", async () => {
    files["/data/spring-2027.json"] = { body: editTerm(raw => { raw.coverage.catalog_courses = 8; }), etag: '"v1"' };
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    const report = await job({ subjects: ["MATH"] });
    expect(report.outcome).toBe("refused");
    expect(report.reason).toBe("partial");
  });

  test("a term file that is not JSON is refused, not thrown, when subjects are requested", async () => {
    files["/data/spring-2027.json"] = { body: termBody.slice(0, 100), etag: '"v1"' };
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    const report = await job({ subjects: ["MATH"] });
    expect(report.outcome).toBe("refused");
    expect(report.reason).toBe("invalid-json");
  });

  test("a subject file replaces its subject's slice and nothing outside it", async () => {
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1690": 7, "CSCE 2110": 7 }), etag: '"m1"' };
    const report = await job({ subjects: ["MATH"] });
    expect(report.outcome).toBe("published");
    const courses = publishedCourses(report.file);
    expect(courses.has("MATH 1690")).toBe(true);
    expect(courses.has("MATH 1680")).toBe(false);
    expect(courses.has("CSCE 2110")).toBe(false);
  });

  test("a subject file that answers 304 is applied from the cached body", async () => {
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    expect((await job({ subjects: ["MATH"] })).outcome).toBe("published");
    files["/data/spring-2027.json"] = { body: editTerm(raw => { raw.courses["ACCT 5120"].sections[0].linked_sections[0].open_seats = 1; }), etag: '"v2"' };
    const report = await job({ subjects: ["MATH"] });
    expect(report.fetched.map(entry => entry.kind)).toEqual(["fetched", "not-modified"]);
    expect(report.outcome).toBe("published");
    const courses = publishedCourses(report.file);
    expect(courses.get("MATH 1680")).toBe(7);
    expect(courses.get("ACCT 5120")).toBe(1);
  });

  test("a term file that answers 304 still checks the subject files", async () => {
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    expect((await job({ subjects: ["MATH"] })).outcome).toBe("published");
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 9 }), etag: '"m2"' };
    const report = await job({ subjects: ["MATH"] });
    expect(report.fetched.map(entry => entry.kind)).toEqual(["not-modified", "fetched"]);
    expect(report.outcome).toBe("published");
    expect(publishedCourses(report.file).get("MATH 1680")).toBe(9);
  });

  test("validators are dropped for a file whose body is no longer cached", async () => {
    expect((await job()).outcome).toBe("published");
    rmSync(path.join(outDir, "bodies"), { recursive: true });
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    const report = await job({ subjects: ["MATH"] });
    expect(report.fetched.map(entry => entry.kind)).toEqual(["fetched", "fetched"]);
    expect(report.outcome).toBe("published");
  });

  test("the report says which subject files were applied and why the others were not", async () => {
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    files["/data/spring-2027/BADS.json"] = { body: '{"schema_version":1}', etag: '"b1"' };
    const report = await job({ subjects: ["BADS", "MATH", "NONE"] });
    expect(report.subjects.sort((a, b) => a.subject.localeCompare(b.subject))).toEqual([
      { subject: "BADS", applied: false, detail: "BADS.json: schema_version 1 is not 2" },
      { subject: "MATH", applied: true },
      { subject: "NONE", applied: false, detail: "HTTP 404: the mirror has no file for this subject" },
    ]);
  });

  test("a watch that refetches another term's file does not leave that term a stale cached body", async () => {
    const fall = (seats: number) => editTerm(raw => {
      (raw as unknown as { term: string }).term = "2027 Fall";
      raw.courses["MATH 1680"].sections[0].linked_sections[0].open_seats = seats;
    });
    files["/data/fall-2027.json"] = { body: fall(1), etag: '"f1"' };
    expect((await job({ termId: "fall-2027" })).outcome).toBe("published");
    files["/data/fall-2027.json"] = { body: fall(2), etag: '"f2"' };
    expect((await job({ watchTerms: ["fall-2027"] })).termWatch[0]?.schemaOk).toBe(true);
    const report = await job({ termId: "fall-2027" });
    expect(report.fetched.map(entry => entry.kind)).toEqual(["fetched"]);
    expect(report.outcome).toBe("published");
    expect(publishedCourses(report.file).get("MATH 1680")).toBe(2);
  });

  test("a subject the hourly budget defers is applied from its cached body", async () => {
    let clock = Date.parse("2027-01-10T12:00:00Z");
    const policy = { ...stubPolicy(stub.url), maxRequestsPerHour: 3 };
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    expect((await job({ policy, now: () => clock, subjects: ["MATH"] })).outcome).toBe("published");
    clock += 16 * 60_000;
    const report = await job({ policy, now: () => clock, subjects: ["MATH"] });
    expect(report.fetched.map(entry => entry.kind)).toEqual(["not-modified", "deferred"]);
    expect(report.subjects).toEqual([{ subject: "MATH", applied: true, detail: "from the cached body; the fetch was deferred" }]);
    expect(report.outcome).toBe("unchanged");
  });

  test("a deferred subject with no cached body publishes nothing", async () => {
    const policy = { ...stubPolicy(stub.url), maxRequestsPerHour: 1 };
    files["/data/spring-2027/MATH.json"] = { body: mathFile({ "MATH 1680": 7 }), etag: '"m1"' };
    const report = await job({ policy, subjects: ["MATH"] });
    expect(report.outcome).toBe("error");
    expect(report.reason).toBe("subject-unavailable");
    expect(existsSync(path.join(outDir, "pointers", "spring-2027.json"))).toBe(false);
  });

  test("state saved before attemptedAt existed still holds the minimum interval", async () => {
    const clock = Date.parse("2027-01-10T12:00:00Z");
    const url = `${stub.url}/data/spring-2027.json`;
    const old = { files: { [url]: { etag: null, lastModified: null, fetchedAt: new Date(clock - 2 * 60_000).toISOString() } }, requests: [] };
    writeFileSync(path.join(outDir, "state.json"), JSON.stringify(old));
    const policy = { ...stubPolicy(stub.url), minIntervalMs: 15 * 60_000 };
    const report = await job({ policy, now: () => clock });
    expect(report.outcome).toBe("error");
    expect(report.reason).toBe("deferred");
    expect(stub.requests).toEqual([]);
  });

  test("a watched term that is the job's own term reuses the term fetch", async () => {
    const policy = { ...stubPolicy(stub.url), minIntervalMs: 60_000 };
    const report = await job({ policy, watchTerms: ["spring-2027"] });
    expect(report.termWatch).toEqual([
      { termId: "spring-2027", appeared: true, schemaOk: true, detail: expect.stringContaining("schema v2 accepted"), sourceObservedAt: expect.any(String) },
    ]);
    expect(stub.requests).toEqual(["/data/spring-2027.json"]);
  });
});

describe("release-job CLI", () => {
  test("a flag that only starts with a known name is an unknown argument", async () => {
    const child = Bun.spawn(["bun", "packages/ingest/src/release-job/cli.ts", "--outdated", "somewhere"], { cwd: path.join(import.meta.dir, "..", "..", "..", ".."), stdout: "pipe", stderr: "pipe" });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).toBe(1);
    expect(stderr).toContain('unknown argument "--outdated"');
  });

  test("missing required flags prints usage and exits 1 without fetching", async () => {
    const child = Bun.spawn(["bun", "packages/ingest/src/release-job/cli.ts"], { cwd: path.join(import.meta.dir, "..", "..", "..", ".."), stdout: "pipe", stderr: "pipe" });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).toBe(1);
    expect(stderr).toContain("--term is required");
    expect(stderr).toContain("usage:");
  });
});
