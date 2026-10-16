import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { Policy, RequirementNode } from "@untangle/core/degree/types";
import { allSlots, parseUnits, unitOptions } from "../src/degree/derive";
import { normalizeConnector, parseCourseListText, readCatalogPage } from "../src/degree/sections";
import { buildDegreeData } from "../src/degree/build";

/**
 * The catalog data dir is committed, so tests parse the real captured pages
 * the way the build does; small HTML fixtures cover extractor edge cases.
 */

const dataDir = path.resolve(import.meta.dir, "../data/catalog/unt-2026-27");

describe("parseCourseListText", () => {
  test("extracts subject/number codes and titles from catalog bullets", () => {
    const parsed = parseCourseListText("MATH 1710 - Calculus I");
    expect(parsed).toEqual([{ courses: [{ code: "MATH 1710", title: "Calculus I" }], connector: null }]);
  });

  test("reads a trailing conjunction printed in the title", () => {
    const parsed = parseCourseListText("CSCE 1030 - Computer Science I and/or");
    expect(parsed).toEqual([{ courses: [{ code: "CSCE 1030", title: "Computer Science I" }], connector: "or" }]);
  });

  test("unknown trailing text is not a connector", () => {
    expect(parseCourseListText("CSCE 1030 - Computer Science I (preferred)")).toEqual([
      { courses: [{ code: "CSCE 1030", title: "Computer Science I (preferred)" }], connector: null },
    ]);
  });
});

describe("normalizeConnector", () => {
  test("maps catalog connector prose", () => {
    expect(normalizeConnector("or")).toBe("or");
    expect(normalizeConnector("OR")).toBe("or");
    expect(normalizeConnector("and")).toBe("and");
    expect(normalizeConnector("with either")).toBe("with either");
    expect(normalizeConnector("and/or")).toBe("or");
    expect(normalizeConnector("or with")).toBe("with either");
    expect(normalizeConnector("something else")).toBeNull();
  });
});

describe("readCatalogPage", () => {
  test("a void tag does not absorb following sections", () => {
    const page = readCatalogPage("fixture.html", "https://catalog.unt.edu/fixture", [
      '<div class="acalog-core">',
      "  <h2 id=\"One\">One</h2>",
      "  <hr>",
      "  <p>first paragraph</p>",
      "</div>",
      '<div class="acalog-core">',
      "  <h2 id=\"Two\">Two</h2>",
      "  <p>second paragraph</p>",
      "</div>",
    ].join("\n"));
    expect(page.sections.map((section) => section.heading)).toEqual(["One", "Two"]);
    expect(page.sections[0]!.items).toContainEqual({ type: "paragraph", text: "first paragraph" });
  });

  test("finds catalog blocks nested inside page wrappers", () => {
    const page = readCatalogPage("fixture.html", "https://catalog.unt.edu/fixture", [
      "<html><body>",
      '<div class="acalog-body">',
      '  <div class="acalog-core"><h2 id="One">One</h2></div>',
      "</div>",
      "</body></html>",
    ].join("\n"));
    expect(page.sections.map((section) => section.heading)).toEqual(["One"]);
  });
});

describe("parseUnits", () => {
  test("an and-conjunction continues the unit; an or marker starts a new unit", () => {
    const units = parseUnits([
      { type: "courseGroup", courses: [{ code: "CSCE 1030", title: "" }], connector: "and" },
      { type: "courseGroup", courses: [{ code: "CSCE 1031", title: "" }], connector: null },
      { type: "marker", text: "or" },
      { type: "courseGroup", courses: [{ code: "CSCE 2100", title: "" }], connector: null },
      { type: "courseGroup", courses: [{ code: "CSCE 2110", title: "" }], connector: null },
    ]);
    expect(units).toEqual([
      { must: ["CSCE 1030", "CSCE 1031"], either: [], orBefore: false },
      { must: ["CSCE 2100"], either: [], orBefore: true },
      { must: ["CSCE 2110"], either: [], orBefore: false },
    ]);
    const slots = allSlots(units);
    expect(slots).toHaveLength(2);
    // The or marker makes CSCE 2100 an alternative of the first slot; CSCE
    // 2110 has no connector of its own, so it opens the next slot.
    expect(slots[0]!.alternatives).toEqual([{ must: ["CSCE 1030", "CSCE 1031"] }, { must: ["CSCE 2100"] }]);
    expect(slots[1]!.alternatives).toEqual([{ must: ["CSCE 2110"] }]);
  });

  test("with either adds the following courses as alternatives of the same unit", () => {
    const units = parseUnits([
      { type: "courseGroup", courses: [{ code: "BIOL 4510", title: "" }], connector: "with either" },
      { type: "courseGroup", courses: [{ code: "BIOL 3800", title: "" }], connector: null },
      { type: "marker", text: "or" },
      { type: "courseGroup", courses: [{ code: "BIOL 4510", title: "" }], connector: "with either" },
      { type: "courseGroup", courses: [{ code: "BIOL 4505", title: "" }], connector: null },
    ]);
    expect(unitOptions(units[0]!)).toEqual([{ must: ["BIOL 4510", "BIOL 3800"] }]);
    expect(units).toHaveLength(2);
    expect(units[1]!.orBefore).toBe(true);
    expect(unitOptions(units[1]!)).toEqual([{ must: ["BIOL 4510", "BIOL 4505"] }]);
  });

  test("headings and paragraphs between course runs do not end the run", () => {
    const units = parseUnits([
      { type: "paragraph", text: "intro" },
      { type: "courseGroup", courses: [{ code: "MATH 1710", title: "" }], connector: null },
      { type: "heading", text: "some note", level: 4, anchor: null },
      { type: "courseGroup", courses: [{ code: "MATH 1720", title: "" }], connector: null },
    ]);
    expect(units).toHaveLength(2);
  });
});

describe("derived requirement trees on the captured catalog pages", () => {
  const data = buildDegreeData(dataDir, "2026-10-15T00:00:00.000Z");

  test("the five programs derive with citations back to their pages", () => {
    expect(data.programs.map((program) => program.id)).toEqual(["cs-bs", "ce-bs", "math-bsmth", "biology-bsbio", "core"]);
    for (const program of data.programs) {
      expect(program.requirements.length).toBeGreaterThan(0);
      expect(program.sourceUrl).toContain("catalog.unt.edu");
    }
  });

  test("CS other-required courses keep the catalog's or-alternatives for calculus", () => {
    const cs = data.programs.find((program) => program.id === "cs-bs")!;
    const other = cs.requirements.find((node) => node.name === "Other required courses");
    expect(other?.kind).toBe("all");
    if (other?.kind !== "all") return;
    const mathSlot = other.items.find((slot) => slot.alternatives.some((option) => option.must.includes("MATH 1710")));
    expect(mathSlot).toBeDefined();
    expect(mathSlot!.alternatives.map((option) => option.must)).toEqual([
      ["MATH 1710"],
      ["MATH 1810", "MATH 1820"],
    ]);
  });

  test("the math depth requirement offers all four catalog branches", () => {
    const math = data.programs.find((program) => program.id === "math-bsmth")!;
    const depth = math.requirements.find((node) => node.kind === "choice" && node.name.startsWith("Depth requirement"));
    expect(depth).toBeDefined();
    expect(depth?.kind === "choice" ? depth.branches.map((branch) => branch.name) : []).toEqual([
      "Analysis",
      "Algebra",
      "Probability/statistics",
      "Geometry/topology",
    ]);
  });

  test("the biology physiology options flatten lecture-with-either-lab pairs", () => {
    const bio = data.programs.find((program) => program.id === "biology-bsbio")!;
    const biologyRequirements = bio.requirements.find((node) => node.kind === "group" && node.name === "Biology requirements");
    expect(biologyRequirements).toBeDefined();
    if (biologyRequirements?.kind !== "group") return;
    const physiology = biologyRequirements.children.find((node) => node.name === "Physiology requirement (with lab)");
    expect(physiology?.kind === "choose" ? physiology.options : []).toContainEqual({ must: ["BIOL 4510", "BIOL 3800"] });
  });

  test("core shared courses are the intersection of core lists and program lists", () => {
    const cs = data.programs.find((program) => program.id === "cs-bs")!;
    expect(cs.coreSharedCourses).toContain("MATH 1710");
    expect(cs.coreSharedCourses).toContain("TECM 2700");
    expect(cs.coreSharedCourses).not.toContain("CSCE 3600");
    const core = data.programs.find((program) => program.id === "core")!;
    expect(core.coreSharedCourses.length).toBeGreaterThan(100);
  });

  test("every derived node carries a citation into its source page", () => {
    for (const program of data.programs) {
      const walk = (node: { citation: unknown; children?: unknown[]; branches?: { node: unknown }[] }): void => {
        expect(node.citation).toBeDefined();
        for (const child of node.children ?? []) walk(child as never);
        for (const branch of node.branches ?? []) walk(branch.node as never);
      };
      for (const node of program.requirements) walk(node as never);
    }
  });
});

describe("review round ten: pool matches stay advisory", () => {
  const data = buildDegreeData(dataDir, "2026-10-15T00:00:00.000Z");

  test("the mathematics hours policy is scoped to confirmed major coursework", () => {
    const math = data.programs.find((program) => program.id === "math-bsmth")!;
    const findSubjectHours = (node: RequirementNode): Extract<Policy, { type: "subjectHours" }> | null => {
      if (node.kind === "policy" && node.policy.type === "subjectHours") return node.policy;
      if (node.kind === "group") {
        for (const child of node.children) {
          const hit = findSubjectHours(child);
          if (hit !== null) return hit;
        }
      }
      if (node.kind === "choice") {
        for (const branch of node.branches) {
          const hit = findSubjectHours(branch.node);
          if (hit !== null) return hit;
        }
      }
      return null;
    };
    let scoped: Extract<Policy, { type: "subjectHours" }> | null = null;
    for (const node of math.requirements) {
      const hit = findSubjectHours(node);
      if (hit !== null) scoped = hit;
    }
    // Field assertions: toEqual's inference cannot pair the Policy union with
    // a plain object literal.
    expect(scoped?.type).toBe("subjectHours");
    expect(scoped?.hours).toBe(43);
    expect(scoped?.subjects).toEqual(["MATH", "STAT"]);
    expect(scoped?.courseScope).toEqual({ kind: "major" });
  });
});

describe("review round nine: connectors between a bullet's own courses", () => {
  test("an internal or splits one bullet into two alternatives", () => {
    const pieces = parseCourseListText("HIST 2610 - United States History to 1865 or HIST 2620 - United States History Since 1865");
    expect(pieces).toEqual([
      { courses: [{ code: "HIST 2610", title: "United States History to 1865" }], connector: "or" },
      { courses: [{ code: "HIST 2620", title: "United States History Since 1865" }], connector: null },
    ]);
    const items = pieces.map((piece) => ({ type: "courseGroup" as const, courses: piece.courses, connector: piece.connector }));
    const units = parseUnits(items);
    expect(units).toEqual([
      { must: ["HIST 2610"], either: [], orBefore: false },
      { must: ["HIST 2620"], either: [], orBefore: true },
    ]);
    // The or-joined unit extends the first slot's alternatives: one course of
    // the bullet satisfies it, not both.
    expect(allSlots(units)).toEqual([{ alternatives: [{ must: ["HIST 2610"] }, { must: ["HIST 2620"] }] }]);
  });

  test("an internal and/or reads as or", () => {
    const pieces = parseCourseListText("CSCE 1030 - Computer Science I and/or CSCE 1035 - Computer Science II");
    expect(pieces.map((piece) => piece.connector)).toEqual(["or", null]);
  });

  test("an internal and keeps one required combination", () => {
    const pieces = parseCourseListText("CHEM 1410 - General Chemistry I and CHEM 1430 - Laboratory Connections");
    expect(pieces.map((piece) => piece.connector)).toEqual(["and", null]);
    const items = pieces.map((piece) => ({ type: "courseGroup" as const, courses: piece.courses, connector: piece.connector }));
    expect(parseUnits(items)).toEqual([{ must: ["CHEM 1410", "CHEM 1430"], either: [], orBefore: false }]);
  });

  test("an and followed by prose stays inside the title", () => {
    const pieces = parseCourseListText("BIOL 2041 - Microbiology and Laboratory Procedures");
    expect(pieces).toEqual([{ courses: [{ code: "BIOL 2041", title: "Microbiology and Laboratory Procedures" }], connector: null }]);
  });
});
