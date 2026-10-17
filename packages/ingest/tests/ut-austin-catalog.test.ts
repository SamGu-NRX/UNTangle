import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseCatalogCoursePage, type UtAustinCatalogPage } from "../src/ut-austin/catalog";

/**
 * The fixtures are saved copies of public catalog.utexas.edu course pages,
 * captured once, politely, on October 15, 2026. Each fixture's source URL and
 * capture date are recorded in fixtures/ut-austin/SOURCES.md — the single
 * metadata record — and the tests read them from that file rather than from a
 * hard-coded map, so a replaced or added fixture cannot keep stale metadata:
 * any HTML file without a SOURCES.md row fails these tests. Tests never fetch.
 */

const fixturesDir = join(import.meta.dir, "fixtures", "ut-austin");
const sourcesText = readFileSync(join(fixturesDir, "SOURCES.md"), "utf8");

/** One `| `catalog/x.html` | url | date | how |` row of SOURCES.md. */
type SourceRow = { file: string; sourceUrl: string; capturedAt: string };

const sourceRows: SourceRow[] = [...sourcesText.matchAll(/^\| `([^`]+)` \| (\S+) \| (\d{4}-\d{2}-\d{2}) \|/gm)].map(
  ([, file, sourceUrl, capturedAt]) => ({ file, sourceUrl, capturedAt }),
);

const metaBySource = Object.fromEntries(sourceRows.map((row) => [row.sourceUrl, row]));

const pages: Record<string, UtAustinCatalogPage> = Object.fromEntries(
  sourceRows.map(({ file, sourceUrl, capturedAt }) => [
    sourceUrl,
    parseCatalogCoursePage(readFileSync(join(fixturesDir, file), "utf8"), { sourceUrl, capturedAt }),
  ]),
);

const cs = pages["https://catalog.utexas.edu/courses/c_s/"];
const math = pages["https://catalog.utexas.edu/courses/m/"];
const phy = pages["https://catalog.utexas.edu/courses/phy/"];

describe("SOURCES.md", () => {
  test("lists every fixture file, and every listed file exists", () => {
    const onDisk = readdirSync(join(fixturesDir, "catalog"))
      .filter((name) => name.endsWith(".html"))
      .map((name) => `catalog/${name}`)
      .sort();
    const listed = sourceRows.map((row) => row.file).sort();
    expect(listed).toEqual(onDisk);
    expect(listed.length).toBeGreaterThan(0);
  });

  test("parses into well-formed metadata rows", () => {
    for (const row of sourceRows) {
      expect(row.sourceUrl.startsWith("https://catalog.utexas.edu/courses/")).toBe(true);
      expect(row.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("parseCatalogCoursePage", () => {
  test("reads the department from the page title", () => {
    expect(cs.department).toEqual({ name: "Computer Science", abbreviation: "C S" });
    expect(math.department).toEqual({ name: "Mathematics", abbreviation: "M" });
    expect(phy.department).toEqual({ name: "Physics", abbreviation: "PHY" });
  });

  test("yields one record per course block on each saved page", () => {
    // Block counts observed in the captured pages themselves.
    expect(cs.records).toHaveLength(190);
    expect(math.records).toHaveLength(139);
    expect(phy.records).toHaveLength(130);
    // The captured pages are healthy: nothing was reported malformed.
    expect(cs.invalid).toEqual([]);
    expect(math.invalid).toEqual([]);
    expect(phy.invalid).toEqual([]);
  });

  test("every record carries its source URL and capture date from SOURCES.md", () => {
    for (const page of [cs, math, phy]) {
      const meta = metaBySource[page.sourceUrl];
      for (const record of page.records) {
        expect(record.sourceUrl).toBe(page.sourceUrl);
        expect(record.capturedAt).toBe(meta.capturedAt);
        expect(record.code.length).toBeGreaterThan(0);
        expect(record.title.length).toBeGreaterThan(0);
      }
    }
  });

  test("codes never repeat on one page", () => {
    for (const page of [cs, math, phy]) {
      const codes = page.records.map((record) => record.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  test("parses a plain lower-division course", () => {
    const record = cs.records.find((entry) => entry.code === "C S 301K");
    expect(record).toMatchObject({
      title: "Foundations of Logical Thought",
      hours: 3,
      hoursText: "3 Hours",
      lectureHours: 3,
      labHours: 0,
      gradeMode: "Student Option",
      academicLevel: "Lower Division",
    });
    expect(record?.description.startsWith("Introductory logic in the context of computing")).toBe(true);
    // The block states no prerequisite, so both prerequisite fields stay null.
    expect(record?.prerequisiteLabel).toBeNull();
    expect(record?.prerequisiteText).toBeNull();
  });

  test("reads fractional lecture and lab hours", () => {
    expect(phy.records.find((entry) => entry.code === "PHY 338K")?.lectureHours).toBe(1.5);
    expect(phy.records.find((entry) => entry.code === "PHY 353L")?.labHours).toBe(4.5);
  });

  test("keeps hours as text and null for variable-hour courses", () => {
    const record = math.records.find((entry) => entry.code === "M 175T");
    expect(record?.hoursText).toBe("1-4 Hours");
    expect(record?.hours).toBeNull();
  });

  test("expands multi-code topic blocks with the block's abbreviation", () => {
    const record = math.records.find((entry) => entry.code === "M 175T");
    expect(record?.codes).toEqual(["M 175T", "M 275T", "M 375T", "M 475T"]);
  });

  test("separates the prerequisite label from its text", () => {
    const record = math.records.find((entry) => entry.code === "M 175T");
    expect(record?.prerequisiteLabel).toBe("Pre/Corequisites");
    expect(record?.prerequisiteText).toBe("Upper-division standing; additional prerequisites vary with the topic.");
  });

  test("reads the shared Pre/Corequisites label UT prints on every block", () => {
    // The current catalog labels the field Pre/Corequisites even when the
    // block states only prerequisites; the raw distinction lives in the text.
    const withPrereq = phy.records.find((entry) => entry.prerequisiteText !== null);
    expect(withPrereq?.prerequisiteLabel).toBe("Pre/Corequisites");
    expect(withPrereq?.prerequisiteText?.length).toBeGreaterThan(0);
    expect(phy.records.filter((entry) => entry.prerequisiteText !== null).length).toBeGreaterThan(50);
  });

  test("keeps restrictions and same-as notes", () => {
    const restricted = cs.records.find((entry) => entry.restrictions !== null);
    expect(restricted?.restrictions).toContain("Restricted to computer science majors.");
    const shared = cs.records.find((entry) => entry.sameAs !== null);
    expect(shared?.sameAs?.startsWith("Same as: ")).toBe(true);
  });

  test("extracts Texas core component codes where the block carries one", () => {
    expect(cs.records.find((entry) => entry.coreCode === "093")).toBeDefined();
    expect(math.records.find((entry) => entry.coreCode === "020")).toBeDefined();
  });

  test("reads TCCN equivalents on physics courses", () => {
    expect(phy.records.filter((entry) => entry.tccn !== null).length).toBeGreaterThan(0);
  });

  test("the current catalog carries no Skills and Experience flags", () => {
    // UT retired the flags effective April 2025; the field stays for
    // archived captures (docs/research/ut-austin/README.md, "Flags").
    expect(cs.records.every((entry) => entry.flags.length === 0)).toBe(true);
  });

  test("decodes entities and spacing from the Courseleaf markup", () => {
    const technicalWriting = cs.records.find((entry) => entry.code === "C S 234");
    expect(technicalWriting?.title).toBe("Technical Writing");
    expect(technicalWriting?.hours).toBe(2);
    for (const page of [cs, math, phy]) {
      for (const record of page.records) {
        expect(record.description).not.toMatch(/&nbsp;|&amp;|&#\d+;/);
        expect(record.title).not.toMatch(/\xa0/);
      }
    }
  });

  test("fails loudly on a page without course blocks", () => {
    expect(() =>
      parseCatalogCoursePage("<html><body><h1>Page Not Found</h1></body></html>", {
        sourceUrl: "https://catalog.utexas.edu/courses/nowhere/",
        capturedAt: "2026-10-15",
      }),
    ).toThrow("No course blocks found");
  });

  test("reports a malformed block instead of dropping it", () => {
    // One healthy block between two malformed ones, so the indices prove the
    // invalid blocks keep their saved positions and their raw text.
    const block = (inner: string) => `<div class="courseblock">${inner}<div class="courseblockextra"><p>Body text.</p></div></div>`;
    const good = block('<span class="text detail-ut_code">C S 301K</span> <span class="text detail-title">Foundations of Logical Thought</span>.');
    const noTitle = block('<span class="text detail-ut_code">C S 999</span>, this block lost its title span.');
    const noCode = block('<span class="text detail-title">Orphaned title</span>');
    const page = parseCatalogCoursePage(good + noTitle + noCode, {
      sourceUrl: "https://catalog.utexas.edu/courses/c_s/",
      capturedAt: "2026-10-15",
    });

    expect(page.records.map((record) => record.code)).toEqual(["C S 301K"]);
    expect(page.invalid).toHaveLength(2);
    expect(page.invalid[0].index).toBe(1);
    expect(page.invalid[0].reason).toBe("missing detail-title");
    expect(page.invalid[0].sourceText).toContain("this block lost its title span");
    expect(page.invalid[1].index).toBe(2);
    expect(page.invalid[1].reason).toBe("missing detail-ut_code");
    expect(page.invalid[1].sourceText).toContain("Orphaned title");
  });

  test("reports a block whose code carries no readable course number", () => {
    const html = '<div class="courseblock"><span class="text detail-ut_code">?</span><span class="text detail-title">Untitled</span></div>';
    const page = parseCatalogCoursePage(html, {
      sourceUrl: "https://catalog.utexas.edu/courses/c_s/",
      capturedAt: "2026-10-15",
    });
    expect(page.records).toHaveLength(0);
    expect(page.invalid).toHaveLength(1);
    expect(page.invalid[0].reason).toBe('detail-ut_code "?" has no readable course code');
    expect(page.invalid[0].sourceText).toContain("Untitled");
  });
});
