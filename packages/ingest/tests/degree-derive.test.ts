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

  test("an or with marker yields the same units as a with either marker", () => {
    const items = (text: string): FlowItem[] => [group("BIOL 4510"), { type: "marker", text }, group("BIOL 3800")];
    const expected = parseUnits(items("with either"));
    expect(expected).toEqual([{ must: ["BIOL 4510"], either: ["BIOL 3800"], anyOf: [], orBefore: false }]);
    expect(parseUnits(items("or with"))).toEqual(expected);
  });

  test("an unreadable marker after a course group throws with its text", () => {
    expect(() => parseUnits([group("BIOL 4510"), { type: "marker", text: "nor" }])).toThrow('Unreadable course connector: "nor"');
  });

  test("an unreadable course-group connector throws even at the end of a run", () => {
    const runs: FlowItem[][] = [
      [group("BIOL 4510", "nor"), group("BIOL 3800")],
      [group("BIOL 4510", "nor")],
      [group("BIOL 1710", "and/or"), group("BIOL 1720", "nor")],
    ];
    for (const items of runs) expect(() => parseUnits(items)).toThrow('Unreadable course connector: "nor"');
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
  "math-bsmth": [
    "Hours required and general/college requirements", "Major requirements", "Mathematics core, 19 hours", "Depth requirement, 9 hours", "Analysis", "Plus two of the following:",
    "Algebra", "Plus two of the following", "Probability/statistics", "Geometry/topology", "Breadth requirement, 9 hours", "Mathematics electives, 6 hours", "Laboratory science",
    "Option 1, Biology emphasis", "Plus one of the following", "Option 2, Chemistry emphasis", "Option 3, Physics emphasis", "Option 4", "Option 5",
    "Plus one of the following lecture and laboratory combinations", "Foreign language", "Option 1", "Option 2", "Computer programming", "Minor requirements", "Other requirements",
  ],
  "biology-bsbio": [
    "Hours required and general/college requirements", "Foundation course requirements", "Biology courses:", "One of the following courses (with lab, if indicated):", "Chemistry courses:",
    "Math courses:", "Biology requirements", "Options for the second 2000 level course requirement (with lab, if indicated):", "Advanced biology requirements:",
    "Physiology requirement options (with lab):", "Advanced biology electives:", "Other course requirements", "Chemistry requirements", "Plus 4 advanced hours chosen from", "Electives", "Other requirements",
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

  test("CS BS, CE BS, Mathematics BSMTH, Biology BSBIO and the core are served, all from the 2026-27 catalog", () => {
    expect(data.catalogId).toBe("unt-2026-27");
    expect(data.programs.map((entry) => [entry.id, entry.courseSharing])).toEqual([["cs-bs", "advisor"], ["ce-bs", "advisor"], ["math-bsmth", "advisor"], ["biology-bsbio", "advisor"], ["core", "forbidden"]]);
    expect(data.pages.map((page) => page.file)).toEqual(["cs-bs.html", "ce-bs.html", "core-curriculum.html", "degree-requirements.html", "math-bsmth.html", "biology-bsbio.html"]);
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

describe("Mathematics BSMTH and Biology BSBIO: explicit structure from the captured pages", () => {
  const data = buildDegreeData(dataDir, "2026-10-15T00:00:00.000Z");
  const program = (id: string) => data.programs.find((candidate) => candidate.id === id)!;
  const find = (id: string, name: string): RequirementNode => {
    const walk = (nodes: RequirementNode[]): RequirementNode | null => {
      for (const node of nodes) {
        if (node.name === name) return node;
        const nested = node.kind === "group" ? walk(node.children) : node.kind === "choice" ? walk(node.branches.map((branch) => branch.node)) : null;
        if (nested) return nested;
      }
      return null;
    };
    const found = walk(program(id).requirements);
    if (!found) throw new Error(`no node ${name} in ${id}`);
    return found;
  };
  const slots = (node: RequirementNode): string[] => {
    if (node.kind !== "all" && node.kind !== "choose") throw new Error(`${node.name} is a ${node.kind} node`);
    return node.items.map((slot) => slot.alternatives.map((option) => option.must.join("+")).join(" | "));
  };
  const paragraph = (file: string, heading: string, text: string): void => {
    const section = loadPage(file).sections.find((candidate) => candidate.heading === heading);
    expect(section?.items.some((item) => item.type === "paragraph" && item.text.includes(text))).toBe(true);
  };
  const outline = (nodes: RequirementNode[]): string[] => nodes.map((node) =>
    node.kind === "group" ? `${node.name} [${node.children.map((child) => child.name).join("; ")}]`
    : node.kind === "choice" ? `${node.name} {${node.branches.map((branch) => branch.name).join("; ")}}`
    : node.name);

  test("the pages state the hours the trees encode", () => {
    for (const file of ["math-bsmth.html", "biology-bsbio.html"]) paragraph(file, "Hours required and general/college requirements", "A minimum of 120 semester hours, of which 36 must be advanced");
    paragraph("math-bsmth.html", "Major requirements", "43 hours of mathematics courses, which must include:");
    paragraph("math-bsmth.html", "Depth requirement, 9 hours", "9 hours from one of the following areas");
    paragraph("math-bsmth.html", "Mathematics electives, 6 hours", "Two additional upper-level mathematics courses chosen from mathematics course numbered 3350 or above.");
    paragraph("math-bsmth.html", "Option 2", "Complete 6 hours of technical writing courses from the following:");
    paragraph("biology-bsbio.html", "Biology requirements", "and 16 advanced biology elective hours (of which 2 courses must be with laboratory)");
    paragraph("biology-bsbio.html", "Chemistry requirements", "Students must complete a minor in chemistry with a minimum of 20 hours.");
  });

  test("Mathematics node inventory", () => {
    expect(outline(program("math-bsmth").requirements)).toEqual([
      "Total hours: 120", "Advanced hours: 36",
      "Major requirements, 43 hours [43-hour major minimum; Mathematics core, 19 hours; MATH 2000 substitution; Depth and breadth, 18 hours; Mathematics electives, 6 hours]",
      "Laboratory science {Option 1, Biology emphasis; Option 2, Chemistry emphasis; Option 3, Physics emphasis; Option 4; Option 5}",
      "Foreign language {Option 1; Option 2}",
      "Computer programming", "Programming competency exam", "Minor requirements", "GPA 2.0 in major mathematics courses numbered 3350 or above", "College of Science requirements",
      "Advanced hours at UNT: 24", "Advanced hours in the major at UNT: 12", "Residency", "Overall GPA", "UNT GPA", "Communication core grade",
    ]);
  });

  test("Mathematics core: one calculus slot holding the footnote's three sequences, then four required courses", () => {
    expect(slots(find("math-bsmth", "Mathematics core, 19 hours"))).toEqual([
      "MATH 1710+MATH 1720 | MATH 1810+MATH 1820+MATH 1830 | MATH 1710+MATH 1820+MATH 1830", "MATH 2000", "MATH 2700", "MATH 2730", "MATH 3000",
    ]);
  });

  test("Mathematics depth and breadth: each depth area is a branch with its own breadth picks", () => {
    const choice = find("math-bsmth", "Depth and breadth, 18 hours");
    if (choice.kind !== "choice") throw new Error("unexpected shape");
    expect(choice.branches.map((branch) => outline([branch.node])[0])).toEqual([
      "Analysis depth, with breadth [Analysis depth: MATH 3610; Analysis depth: two more; Breadth: one Algebra course; Breadth: one Probability/statistics course; Breadth: one Geometry/topology course]",
      "Algebra depth, with breadth [Algebra depth: MATH 3510; Algebra depth: two more; Breadth: one Analysis course; Breadth: one Probability/statistics course; Breadth: one Geometry/topology course]",
      "Probability/statistics depth, with breadth [Probability/statistics depth, 9 hours; Breadth: one Geometry/topology course; Breadth: MATH 3510 or MATH 3610]",
      "Geometry/topology depth, with breadth [Geometry/topology depth, 9 hours; Breadth: one Probability/statistics course; Breadth: MATH 3510 or MATH 3610]",
    ]);
    const analysisMore = find("math-bsmth", "Analysis depth: two more");
    expect(analysisMore.kind === "choose" && analysisMore.count).toBe(2);
    expect(slots(analysisMore)).toEqual(["MATH 3350", "MATH 3410", "MATH 3420", "MATH 3740", "MATH 4080", "MATH 4100", "MATH 4200", "MATH 4520"]);
    expect(slots(find("math-bsmth", "Algebra depth: two more"))).toEqual(["MATH 3400", "MATH 4010", "MATH 4430", "MATH 4450", "MATH 4510"]);
    expect(slots(find("math-bsmth", "Breadth: one Analysis course"))).toEqual(["MATH 3610", "MATH 3350", "MATH 3410", "MATH 3420", "MATH 3740", "MATH 4080", "MATH 4100", "MATH 4200", "MATH 4520"]);
    const probability = find("math-bsmth", "Probability/statistics depth, 9 hours");
    expect(probability.kind === "hours" && [probability.hours, probability.options.map((option) => option.must.join("+"))]).toEqual([9, ["STAT 3680", "MATH 4610", "STAT 4650"]]);
    const geometry = find("math-bsmth", "Geometry/topology depth, 9 hours");
    expect(geometry.kind === "hours" && [geometry.hours, geometry.options.map((option) => option.must.join("+"))]).toEqual([9, ["MATH 3740", "MATH 4060", "MATH 4080", "MATH 4500"]]);
    const proof = find("math-bsmth", "Breadth: MATH 3510 or MATH 3610");
    expect(proof.kind === "choice" && outline(proof.branches.map((branch) => branch.node))).toEqual([
      "MATH 3610 as the Analysis course [MATH 3610; Breadth: one Algebra course]",
      "MATH 3510 as the Algebra course [Breadth: one Analysis course; MATH 3510]",
    ]);
  });

  test("Mathematics electives are an advisory MATH 3350-4999 pool of 6 hours", () => {
    const pool = find("math-bsmth", "Mathematics electives, 6 hours");
    expect(pool.kind === "pool" && [pool.hours, pool.match]).toEqual([6, { subjects: ["MATH"], minLevel: 3350, maxLevel: 4999 }]);
  });

  test("Mathematics laboratory science: Option 3's or is between whole physics tracks", () => {
    expect(slots(find("math-bsmth", "BIOL 1710, BIOL 1720 and BIOL 1760"))).toEqual(["BIOL 1710+BIOL 1720+BIOL 1760"]);
    expect(slots(find("math-bsmth", "Plus one physical science lecture and laboratory"))).toEqual(["PHYS 1510+PHYS 1530 | PHYS 1710+PHYS 1730 | CHEM 1410+CHEM 1430"]);
    expect(slots(find("math-bsmth", "General chemistry I and II with laboratories"))).toEqual(["CHEM 1410+CHEM 1430", "CHEM 1420+CHEM 1440"]);
    expect(slots(find("math-bsmth", "Calculus-based physics sequence"))).toEqual(["PHYS 1510+PHYS 1530+PHYS 1520+PHYS 1540 | PHYS 1710+PHYS 1730+PHYS 2220+PHYS 2240"]);
    expect(slots(find("math-bsmth", "GEOL 1610 and GEOG 1710"))).toEqual(["GEOL 1610", "GEOG 1710"]);
    expect(slots(find("math-bsmth", "Plus one lecture and laboratory combination"))).toEqual(["PHYS 1710+PHYS 1730 | CHEM 1410+CHEM 1430"]);
    expect(find("math-bsmth", "Option 2, Chemistry emphasis").kind === "group" && outline([find("math-bsmth", "Option 2, Chemistry emphasis")])).toEqual(["Option 2, Chemistry emphasis [General chemistry I and II with laboratories; Third laboratory science course]"]);
    expect(find("math-bsmth", "Double major laboratory science").kind).toBe("note");
  });

  test("Mathematics foreign language and programming", () => {
    const writing = find("math-bsmth", "Technical writing, 6 hours");
    expect(writing.kind === "hours" && [writing.hours, writing.options.map((option) => option.must.join("+"))]).toEqual([6, ["TECM 2700", "TECM 4180", "TECM 4190", "TECM 4250", "TECM 4700"]]);
    expect(slots(find("math-bsmth", "Computer programming"))).toEqual(["CSCE 1010 | CSCE 1020 | CSCE 1030"]);
  });

  test("Biology node inventory", () => {
    expect(outline(program("biology-bsbio").requirements)).toEqual([
      "Total hours: 120", "Advanced hours: 36",
      "Foundation course requirements [Biology foundation courses; One 2000-level biology course; Chemistry foundation courses; Math foundation course; Foundation courses: C or better and a 2.5 GPA]",
      "Biology requirements [Second 2000-level biology course; Advanced biology requirements; Physiology course with laboratory; Advanced biology electives, 16 hours; Two advanced biology electives with laboratory; Biology requirements: C or higher]",
      "Other course requirements",
      "Chemistry requirements [CHEM 2380 and CHEM 3220; Plus 4 advanced hours; Chemistry minor: C or higher]",
      "Electives", "Department grade and attempt rules", "College of Science requirements",
      "Advanced hours at UNT: 24", "Advanced hours in the major at UNT: 12", "Residency", "Overall GPA", "UNT GPA", "Communication core grade",
    ]);
  });

  test("Biology foundation courses keep the page's honors alternatives", () => {
    expect(slots(find("biology-bsbio", "Biology foundation courses"))).toEqual(["BIOL 1710 | BIOL 1711", "BIOL 1720 | BIOL 1722", "BIOL 1750 | BIOL 1760 | BIOL 1761"]);
    expect(slots(find("biology-bsbio", "Chemistry foundation courses"))).toEqual(["CHEM 1410 | CHEM 1412 | CHEM 1413", "CHEM 1430", "CHEM 1420 | CHEM 1422 | CHEM 1423", "CHEM 1440", "CHEM 2370", "CHEM 3210"]);
    expect(slots(find("biology-bsbio", "Math foundation course"))).toEqual(["MATH 1650"]);
  });

  test("Biology lists printed without connectors keep each lecture with its laboratory", () => {
    const options = "BIOL 2041+BIOL 2042 | BIOL 2140 | BIOL 2241 | BIOL 2251";
    expect(slots(find("biology-bsbio", "One 2000-level biology course"))).toEqual([options]);
    expect(slots(find("biology-bsbio", "Second 2000-level biology course"))).toEqual([options]);
    expect(slots(find("biology-bsbio", "Physiology course with laboratory"))).toEqual(["BIOL 4501+BIOL 4502 | BIOL 4503+BIOL 4504 | BIOL 4510+BIOL 3800 | BIOL 4510+BIOL 4505"]);
    expect(slots(find("biology-bsbio", "Other course requirements"))).toEqual(["MATH 1710 | MATH 1810", "PHYS 1410+PHYS 1430 | PHYS 1510+PHYS 1530", "PHYS 1420+PHYS 1440 | PHYS 1520+PHYS 1540"]);
    const plus4 = find("biology-bsbio", "Plus 4 advanced hours");
    expect(plus4.kind === "hours" && [plus4.hours, plus4.options.map((option) => option.must.join("+"))]).toEqual([4, ["CHEM 3451+CHEM 3452", "CHEM 3530", "BIOC 3621+BIOC 3622", "BIOC 4540+BIOC 4550"]]);
    expect(slots(find("biology-bsbio", "Advanced biology requirements"))).toEqual(["BIOL 3451", "BIOL 3452", "BIOL 3510", "BIOL 3520"]);
    expect(slots(find("biology-bsbio", "CHEM 2380 and CHEM 3220"))).toEqual(["CHEM 2380", "CHEM 3220"]);
  });

  test("Biology advanced electives: 16 hours from the page's 90 listed courses", () => {
    const electives = find("biology-bsbio", "Advanced biology electives, 16 hours");
    if (electives.kind !== "hours") throw new Error("unexpected shape");
    expect(electives.hours).toBe(16);
    expect(electives.options).toHaveLength(90);
    expect([electives.options[0]!.must, electives.options.at(-1)!.must]).toEqual([["BIOL 3000"], ["BIOL 4951"]]);
  });

  test("the grade rules the audit cannot scope are shown with their quotes, not checked", () => {
    const notes = (id: string) => {
      const into: [string, string][] = [];
      const walk = (node: RequirementNode): void => {
        if (node.kind === "policy" && node.policy.type === "note") into.push([node.name, node.quote]);
        if (node.kind === "group") node.children.forEach(walk);
      };
      program(id).requirements.forEach(walk);
      return into;
    };
    expect(notes("math-bsmth")).toEqual([
      ["GPA 2.0 in major mathematics courses numbered 3350 or above", "Students must achieve a grade point average of at least 2.0 in all mathematics courses which are applied toward a mathematics major and are numbered 3350 or above."],
    ]);
    expect(notes("biology-bsbio").map(([name, quote]) => [name, quote.split(". ")[0]])).toEqual([
      ["Foundation courses: C or better and a 2.5 GPA", "The Foundation course requirements listed below must be completed before enrollment in 3000 and 4000 level courses required for the major"],
      ["Biology requirements: C or higher", "In addition to the biology foundation courses, students must complete with a C or higher a second 2000 level biology course, the advanced biology requirements, one physiology course with laboratory, and 16 advanced biology elective hours (of which 2 courses must be with laboratory)."],
      ["Chemistry minor: C or higher", "Students must complete a minor in chemistry with a minimum of 20 hours"],
      ["Department grade and attempt rules", "Only two attempts will be allowed for each biology and biochemistry course in the degree"],
    ]);
  });

  test("an explicit list that no longer matches its section stops the build", () => {
    const university = loadPage("degree-requirements.html");
    const dropCourse = (file: string, heading: string, code: string): CatalogPage => {
      const page = loadPage(file);
      return {
        ...page,
        sections: page.sections.map((section) => section.heading !== heading ? section : {
          ...section,
          items: section.items.filter((item) => !(item.type === "courseGroup" && item.courses.some((course) => course.code === code))),
        }),
      };
    };
    const derive = (id: string) => PROGRAM_SPECS.find((spec) => spec.id === id)!.derive;
    expect(() => derive("biology-bsbio")(dropCourse("biology-bsbio.html", "Physiology requirement options (with lab):", "BIOL 4505"), university))
      .toThrow('section "Physiology requirement options (with lab):" no longer matches its explicit structure (not encoded: none; not on the page: BIOL 4505)');
    expect(() => derive("math-bsmth")(dropCourse("math-bsmth.html", "Mathematics core, 19 hours", "MATH 1830"), university))
      .toThrow('section "Mathematics core, 19 hours" no longer matches its explicit structure');
  });
});
