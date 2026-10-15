import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCatalogCoursePage, type CatalogPageMeta, type UtAustinCatalogPage } from "../src/ut-austin/catalog";

/**
 * The fixtures are saved copies of public catalog.utexas.edu course pages,
 * captured once, politely (three seconds apart), on October 15, 2026. Each
 * fixture's source URL and capture date are recorded in
 * fixtures/ut-austin/SOURCES.md and stamped onto every record the parser
 * yields. Tests never fetch.
 */

const fixturesDir = join(import.meta.dir, "fixtures", "ut-austin", "catalog");

const pages: Record<string, UtAustinCatalogPage> = Object.fromEntries(
  Object.entries({
    "c-s.html": "https://catalog.utexas.edu/courses/c-s/",
    "m.html": "https://catalog.utexas.edu/courses/m/",
    "phy.html": "https://catalog.utexas.edu/courses/phy/",
  }).map(([file, sourceUrl]) => {
    const meta: CatalogPageMeta = { sourceUrl, capturedAt: "2026-10-15" };
    return [sourceUrl, parseCatalogCoursePage(readFileSync(join(fixturesDir, file), "utf8"), meta)];
  }),
);

const cs = pages["https://catalog.utexas.edu/courses/c-s/"];
const math = pages["https://catalog.utexas.edu/courses/m/"];
const phy = pages["https://catalog.utexas.edu/courses/phy/"];

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
  });

  test("every record carries its source URL and capture date", () => {
    for (const page of [cs, math, phy]) {
      for (const record of page.records) {
        expect(record.sourceUrl).toBe(page.sourceUrl);
        expect(record.capturedAt).toBe("2026-10-15");
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
});
