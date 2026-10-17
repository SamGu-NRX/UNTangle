import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RequirementNode } from "@untangle/core/degree/types";
import { PROGRAM_SPECS, allSlots, parseUnits, unitOptions } from "../src/degree/derive";
import { normalizeConnector, parseCourseListText, readCatalogPage, type CatalogPage, type FlowItem } from "../src/degree/sections";
import { buildDegreeData } from "../src/degree/build";

/**
 * The catalog data dir is committed, so tests parse the real captured pages
 * the way the build does; small HTML fixtures cover extractor edge cases.
 */

const dataDir = path.resolve(import.meta.dir, "../data/catalog/unt-2026-27");
const loadPage = (file: string): CatalogPage => readCatalogPage(file, `https://catalog.unt.edu/${file}`, readFileSync(path.join(dataDir, file), "utf8"));
const group = (code: string, connector: string | null = null): FlowItem => ({ type: "courseGroup", courses: [{ code, title: "" }], connector });

describe("parseCourseListText", () => {
  test("extracts subject/number codes and titles from catalog bullets", () => {
    expect(parseCourseListText("MATH 1710 - Calculus I")).toEqual([{ courses: [{ code: "MATH 1710", title: "Calculus I" }], connector: null }]);
  });

  test("reads a trailing conjunction printed in the title", () => {
    expect(parseCourseListText("BIOL 1710 - Biology for Science Majors I and/or")).toEqual([{ courses: [{ code: "BIOL 1710", title: "Biology for Science Majors I" }], connector: "and/or" }]);
  });

  test("a title ending in the letters of a conjunction keeps them", () => {
    // Before the word-boundary fix this read as "Accelerat" plus "or", which
    // made UNIV 2300 and WGST 2100 alternatives in Component Area Option B.
    expect(parseCourseListText("UNIV 2300 - UNT Braven Career and Leadership Accelerator")).toEqual([
      { courses: [{ code: "UNIV 2300", title: "UNT Braven Career and Leadership Accelerator" }], connector: null },
    ]);
  });

  test("unknown trailing text is not a connector", () => {
    expect(parseCourseListText("CSCE 1030 - Computer Science I (preferred)")).toEqual([{ courses: [{ code: "CSCE 1030", title: "Computer Science I (preferred)" }], connector: null }]);
  });

  test("an internal or splits one bullet into two alternatives", () => {
    const pieces = parseCourseListText("HIST 2610 - United States History to 1865 or HIST 2620 - United States History Since 1865");
    expect(pieces.map((piece) => piece.connector)).toEqual(["or", null]);
    const units = parseUnits(pieces.map((piece) => ({ type: "courseGroup", courses: piece.courses, connector: piece.connector })));
    expect(allSlots(units)).toEqual([{ alternatives: [{ must: ["HIST 2610"] }, { must: ["HIST 2620"] }] }]);
  });

  test("an internal and keeps one required combination, and an and before prose stays in the title", () => {
    expect(parseCourseListText("CHEM 1410 - General Chemistry I and CHEM 1430 - Laboratory").map((piece) => piece.connector)).toEqual(["and", null]);
    expect(parseCourseListText("BIOL 2041 - Microbiology and Laboratory Procedures")).toEqual([{ courses: [{ code: "BIOL 2041", title: "Microbiology and Laboratory Procedures" }], connector: null }]);
  });
});

test("normalizeConnector keeps and/or distinct from or", () => {
  expect(["or", "OR", "and", "and/or", "with either", "or with", "something else"].map(normalizeConnector)).toEqual(["or", "or", "and", "and/or", "with either", "with either", null]);
});

describe("readCatalogPage", () => {
  test("a void tag does not absorb following sections", () => {
    const page = readCatalogPage("fixture.html", "https://catalog.unt.edu/fixture", [
      '<div class="acalog-core">', '  <h2 id="One">One</h2>', "  <hr>", "  <p>first paragraph</p>", "</div>",
      '<div class="acalog-core">', '  <h2 id="Two">Two</h2>', "  <p>second paragraph</p>", "</div>",
    ].join("\n"));
    expect(page.sections.map((section) => section.heading)).toEqual(["One", "Two"]);
    expect(page.sections[0]!.items).toContainEqual({ type: "paragraph", text: "first paragraph" });
  });

  test("finds catalog blocks nested inside page wrappers", () => {
    const page = readCatalogPage("fixture.html", "https://catalog.unt.edu/fixture", ["<html><body>", '<div class="acalog-body">', '  <div class="acalog-core"><h2 id="One">One</h2></div>', "</div>", "</body></html>"].join("\n"));
    expect(page.sections.map((section) => section.heading)).toEqual(["One"]);
  });
});

describe("parseUnits", () => {
  test("an and continues the unit, an or starts an alternative, no connector starts a new slot", () => {
    const units = parseUnits([group("CSCE 1030", "and"), group("CSCE 1031"), { type: "marker", text: "or" }, group("CSCE 2100"), group("CSCE 2110")]);
    expect(allSlots(units)).toEqual([
      { alternatives: [{ must: ["CSCE 1030", "CSCE 1031"] }, { must: ["CSCE 2100"] }] },
      { alternatives: [{ must: ["CSCE 2110"] }] },
    ]);
  });

  test("with either adds the following courses as alternatives of the same unit", () => {
    const units = parseUnits([group("BIOL 4510", "with either"), group("BIOL 3800"), { type: "marker", text: "or" }, group("BIOL 4510", "with either"), group("BIOL 4505")]);
    expect(units.map(unitOptions)).toEqual([[{ must: ["BIOL 4510", "BIOL 3800"] }], [{ must: ["BIOL 4510", "BIOL 4505"] }]]);
    expect(units[1]!.orBefore).toBe(true);
  });

  test("and/or with a shared lab gives each lecture with the lab, and both lectures as two picks", () => {
    // The CS lab science bullets: "BIOL 1710 and/or", "BIOL 1720", "and", "BIOL 1760".
    const units = parseUnits([group("BIOL 1710", "and/or"), group("BIOL 1720"), { type: "marker", text: "and" }, group("BIOL 1760")]);
    expect(units).toEqual([{ must: ["BIOL 1760"], either: [], anyOf: ["BIOL 1710", "BIOL 1720"], orBefore: false }]);
    expect(unitOptions(units[0]!)).toEqual([
      { must: ["BIOL 1710", "BIOL 1760"] },
      { must: ["BIOL 1720", "BIOL 1760"] },
      { must: ["BIOL 1710", "BIOL 1720", "BIOL 1760"], counts: 2 },
    ]);
  });

  test("an and/or between wider groups is refused, not guessed", () => {
    expect(() => parseUnits([group("CHEM 1410", "and"), group("CHEM 1430", "and/or"), group("CHEM 1420")])).toThrow(/only one course on each side/);
  });

  test("headings and paragraphs between course runs do not end the run", () => {
    expect(parseUnits([{ type: "paragraph", text: "intro" }, group("MATH 1710"), { type: "heading", text: "note", level: 4, anchor: null }, group("MATH 1720")])).toHaveLength(2);
  });
});

/**
 * Every section each derivation reads. Removing any one of them from the
 * captured page must stop the derivation by name; a requirement that drops
 * out of a derived plan without an error is the failure this guards.
 */
const EXPECTED_SECTIONS: Record<string, string[]> = {
  "cs-bs": [
    "Hours required and general/college requirements", "Major requirements", "Other required courses", "CSCE core, 6 hours", "CSCE breadth courses, 6 hours",
    "Choose 2 courses (6-8 hours) from the following courses", "3 hours selected from", "Note", "Minor", "Electives", "Department policies",
  ],
  "ce-bs": [
    "Hours required and general/college requirements", "Major requirements", "Other required courses", "Specialization area, 9 hours", "Real-Time and Embedded Systems",
    "VLSI and Electronics", "Communication and Networks", "Computer Systems", "Artificial intelligence and machine learning", "Note", "Minor", "Electives", "Department policies",
  ],
  core: [
    "University Core Curriculum Requirements", "Communication, 6 hours", "Group 1", "Group 2", "Mathematics, 3 hours", "Life and Physical Sciences, 6 hours",
    "Language, Philosophy and Culture, 3 hours", "Creative Arts, 3 hours", "American History, 6 hours", "Government/Political Science, 6 hours",
    "Social and Behavioral Sciences, 3 hours", "Component Area Option, 6 hours", "Component Area Option A", "Component Area Option B",
    "Transfer of the Core Curriculum", "Advanced Standing Examination (AP/IB/CLEP)",
  ],
};
const UNIVERSITY_SECTIONS = ["Minimum Hour Requirements", "Residence", "Grade Point Average (GPA)", "English Composition Proficiency"];

describe("a missing catalog section stops the derivation", () => {
  const university = loadPage("degree-requirements.html");
  const without = (page: CatalogPage, heading: string): CatalogPage => ({ ...page, sections: page.sections.filter((section) => section.heading !== heading) });

  for (const spec of PROGRAM_SPECS) {
    const page = loadPage(spec.file);
    test(`${spec.id}: every expected section is present, and removing any one fails loudly`, () => {
      expect(() => spec.derive(page, university)).not.toThrow();
      for (const heading of EXPECTED_SECTIONS[spec.id]!) {
        expect(page.sections.some((section) => section.heading === heading)).toBe(true);
        expect(() => spec.derive(without(page, heading), university)).toThrow(`expected section "${heading}" is missing`);
      }
    });
  }

  test("the university page's sections are required by the majors", () => {
    const cs = PROGRAM_SPECS.find((spec) => spec.id === "cs-bs")!;
    for (const heading of UNIVERSITY_SECTIONS) {
      expect(() => cs.derive(loadPage(cs.file), without(university, heading))).toThrow(`expected section "${heading}" is missing`);
    }
  });
});

describe("derived requirement trees on the captured catalog pages", () => {
  const data = buildDegreeData(dataDir, "2026-10-15T00:00:00.000Z");
  const program = (id: string) => data.programs.find((candidate) => candidate.id === id)!;
  const names = (nodes: RequirementNode[]): string[] => nodes.map((node) => (node.kind === "group" ? `${node.name} [${node.children.map((child) => child.name).join("; ")}]` : node.name));

  test("only CS BS, CE BS and the core are served, all from the 2026-27 catalog", () => {
    expect(data.catalogId).toBe("unt-2026-27");
    expect(data.programs.map((entry) => [entry.id, entry.courseSharing])).toEqual([["cs-bs", "advisor"], ["ce-bs", "advisor"], ["core", "forbidden"]]);
    expect(data.programs.map((entry) => entry.id)).toEqual(["cs-bs", "ce-bs", "core"]);
    expect(data.pages.map((page) => page.file)).toEqual(["cs-bs.html", "ce-bs.html", "core-curriculum.html", "degree-requirements.html"]);
    for (const entry of data.programs) expect(entry.sourceUrl).toContain("catalog.unt.edu/preview_program.php?catoid=40");
  });

  // The full node inventory: a requirement that silently disappears, or
  // appears, changes these lists.
  test("CS BS node inventory", () => {
    expect(names(program("cs-bs").requirements)).toEqual([
      "Total hours: 120", "Advanced hours: 42",
      "Major requirements [Required courses; 55-hour major minimum; CSCE advanced electives, 6 hours]",
      "Other required courses", "CSCE core, 6 hours", "CSCE breadth courses, 6 hours", "Laboratory science, 6-8 hours (choose 2)", "Technical writing, 3 hours",
      "Note", "Minor", "Electives", "Minimum grade of C (major courses)",
      "Advanced hours at UNT: 24", "Advanced hours in the major at UNT: 12", "Residency", "Overall GPA", "UNT GPA", "Communication core grade",
    ]);
  });

  test("CE BS node inventory", () => {
    expect(names(program("ce-bs").requirements)).toEqual([
      "Total hours: 121", "Advanced hours: 39",
      "Major requirements [Required courses; 52-hour major minimum]",
      "Other required courses", "Specialization area, 9 hours",
      "Note", "Minor", "Electives", "Minimum grade of C (major courses)",
      "Total hours: 120", "Advanced hours at UNT: 24", "Advanced hours in the major at UNT: 12", "Residency", "Overall GPA", "UNT GPA", "Communication core grade",
    ]);
  });

  test("core node inventory", () => {
    expect(names(program("core").requirements)).toEqual([
      "Core total: 42 hours",
      "Communication, 6 hours [Communication Group 1; Communication Group 2; Communication core grade]",
      "Mathematics, 3 hours", "Life and Physical Sciences, 6 hours", "Language, Philosophy and Culture, 3 hours", "Creative Arts, 3 hours",
      "American History, 6 hours", "Government/Political Science, 6 hours", "Social and Behavioral Sciences, 3 hours",
      "Component Area Option, 6 hours", "Component Area Option double-dip rule", "Option A other-core courses", "Other ways to complete the core",
    ]);
  });

  test("CS required courses: all seventeen the page lists", () => {
    const major = program("cs-bs").requirements.find((node) => node.name === "Major requirements");
    if (major?.kind !== "group" || major.children[0]?.kind !== "all") throw new Error("unexpected shape");
    expect(major.children[0].items.map((slot) => slot.alternatives.map((option) => option.must.join("+")).join(" | "))).toEqual([
      "CSCE 1010", "CSCE 1015", "CSCE 1030", "CSCE 1040", "CSCE 2100", "CSCE 2110", "CSCE 2120", "CSCE 2130", "CSCE 2610",
      "CSCE 3444", "CSCE 3550", "CSCE 3600", "CSCE 4010", "CSCE 4110", "CSCE 4350", "CSCE 4901", "CSCE 4902",
    ]);
  });

  test("CS lab science: BIOL lectures need BIOL 1760, and equivalent chemistry pairs share a slot", () => {
    const lab = program("cs-bs").requirements.find((node) => node.name.startsWith("Laboratory science"));
    if (lab?.kind !== "choose") throw new Error("unexpected shape");
    expect(lab.count).toBe(2);
    expect(lab.items.map((slot) => slot.alternatives.map((option) => option.must.join("+") + (option.counts ? ` x${option.counts}` : "")).join(" | "))).toEqual([
      "BIOL 1112", "BIOL 1132",
      "BIOL 1710+BIOL 1760 | BIOL 1720+BIOL 1760 | BIOL 1710+BIOL 1720+BIOL 1760 x2",
      "BIOL 2301+BIOL 2311", "BIOL 2302+BIOL 2312",
      "CHEM 1410+CHEM 1430 | CHEM 1415+CHEM 1435", "CHEM 1420+CHEM 1440",
      "GEOG 1710", "GEOL 1610", "PHYS 1052", "PHYS 1062", "PHYS 1270",
      "PHYS 1410+PHYS 1430", "PHYS 1420+PHYS 1440", "PHYS 1710+PHYS 1730", "PHYS 2220+PHYS 2240",
    ]);
  });

  test("CE other required courses keep the catalog's calculus alternatives and lecture-lab pairs", () => {
    const other = program("ce-bs").requirements.find((node) => node.name === "Other required courses");
    if (other?.kind !== "all") throw new Error("unexpected shape");
    expect(other.items.map((slot) => slot.alternatives.map((option) => option.must.join("+")).join(" | "))).toEqual([
      "CHEM 1410+CHEM 1430 | CHEM 1415+CHEM 1435", "EENG 2610+EENG 2611", "EENG 2710+EENG 2711", "EENG 3510",
      "MATH 1710 | MATH 1810+MATH 1820", "MATH 1720 | MATH 1830", "MATH 2730", "PHYS 1710+PHYS 1730", "PHYS 2220+PHYS 2240", "TECM 2700",
    ]);
  });

  test("Component Area Option B lists UNIV 2300 and WGST 2100 as separate courses", () => {
    const option = program("core").requirements.find((node) => node.name === "Component Area Option, 6 hours");
    if (option?.kind !== "choice") throw new Error("unexpected shape");
    const plusB = option.branches[1]!.node;
    if (plusB.kind !== "group" || plusB.children[1]?.kind !== "hours") throw new Error("unexpected shape");
    expect(plusB.children[1].options.slice(-3)).toEqual([{ must: ["UNIV 2100"] }, { must: ["UNIV 2300"] }, { must: ["WGST 2100"] }]);
  });

  test("core shared courses are the intersection of core lists and program lists", () => {
    expect(program("cs-bs").coreSharedCourses).toContain("MATH 1710");
    expect(program("cs-bs").coreSharedCourses).toContain("TECM 2700");
    expect(program("cs-bs").coreSharedCourses).not.toContain("CSCE 3600");
  });

  test("every derived node carries a citation into a captured page", () => {
    const files = new Set(data.pages.map((page) => page.file));
    const walk = (node: RequirementNode): void => {
      expect(files.has(node.citation.page)).toBe(true);
      if (node.kind === "group") node.children.forEach(walk);
      if (node.kind === "choice") node.branches.forEach((branch) => walk(branch.node));
    };
    for (const entry of data.programs) entry.requirements.forEach(walk);
  });
});
