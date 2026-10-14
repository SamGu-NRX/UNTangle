import { expect, test } from "bun:test";
import rows from "../../src/lib/course-catalog/prerequisites.json";
import { courseReferences, inferStatuses, parseUntPrerequisite, untAdapter } from "../../src/lib/prereq";
import type { CatalogCourse, Evidence, Prerequisite } from "../../src/lib/prereq";

function parse(id: string) {
  const row = rows.find(([code]) => code === id);
  if (!row) throw new Error(`Missing catalog fixture: ${id}`);
  return parseUntPrerequisite(row[2]);
}

function catalog(...ids: string[]): CatalogCourse[] {
  return ids.map(id => ({ id, credits: 3, prerequisite: parse(id).expression }));
}

function assess(id: string, evidence: Evidence) {
  return inferStatuses(catalog(id), evidence, untAdapter).statuses.get(id)!;
}

const passed = (...ids: string[]) => ids.map(courseId => ({ courseId, grade: "A" }));

function advisorSources(node: Prerequisite): string[] {
  if (node.kind === "unknown" || node.kind === "consent") return [node.source];
  if (node.kind === "and" || node.kind === "or") return node.children.flatMap(advisorSources);
  if (node.kind === "corequisite" || node.kind === "minGrade") return advisorSources(node.requirement);
  return [];
}

test("CSCE 2100/2110 concurrent permissions are annotations, with no companion requirement", () => {
  const first = parse("CSCE2100");
  const second = parse("CSCE2110");
  expect(first.coverage).toBe("full");
  expect(second.coverage).toBe("full");
  expect(first.annotations).toEqual(["Can be taken concurrently with CSCE 2110 "]);
  expect(second.annotations).toEqual(["Corequisite(s): This course can be taken concurrently with CSCE 2100 "]);
  expect(courseReferences(first.expression)).toEqual(["CSCE 1040", "CSCE 1045", "MATH 1710"]);
  expect(courseReferences(second.expression)).toEqual(["CSCE 1040", "CSCE 1045"]);
  expect(assess("CSCE2100", { transcript: passed("CSCE 1040", "MATH 1710") }).status).toBe("eligible");
  expect(assess("CSCE2100", { transcript: passed("CSCE 1040") }).status).toBe("locked");
  expect(assess("CSCE2110", { transcript: passed("CSCE 1040") }).status).toBe("eligible");
  expect(assess("CSCE2110", { transcript: [{ courseId: "CSCE 1040", grade: "D" }] }).status).toBe("locked");
  expect(assess("CSCE2110", { transcript: passed("CSCE 1045") }).status).toBe("eligible");
  expect(assess("CSCE2110", {}).status).toBe("locked");
  const result = inferStatuses(catalog("CSCE2100", "CSCE2110"), { transcript: passed("CSCE2100") }, untAdapter);
  expect(result.statuses.get("CSCE2110")!.status).toBe("eligible");
  expect(result.cycles).toEqual([]);
});

test("may be taken concurrently retains a requirement that planned enrollment can satisfy", () => {
  expect(parse("MTSE3001").coverage).toBe("full");
  expect(assess("MTSE3001", {}).status).toBe("locked");
  expect(assess("MTSE3001", { planned: ["MTSE 3000"] }).status).toBe("eligible");
  expect(assess("MTSE3001", { transcript: passed("MTSE 3000") }).status).toBe("eligible");
  expect(parse("MATH2000").coverage).toBe("partial");
  expect(assess("MATH2000", { planned: ["MATH 1810"] }).status).toBe("unknown");
});

test("either may be taken concurrently permits either alternative in the same term", () => {
  // Isolate the complete sentence from unrelated descriptive physics prose.
  const sentence = parse("PHYS2220").source.split(". ")[1];
  const prerequisite = parseUntPrerequisite(sentence).expression;
  const course = { id: "target", credits: 3, prerequisite };
  for (const math of ["MATH 1720", "MATH 1830"]) {
    expect(inferStatuses([course], { planned: [math] }, untAdapter).statuses.get("target")!.status).toBe("eligible");
  }
  expect(inferStatuses([course], {}, untAdapter).statuses.get("target")!.status).toBe("locked");
});

test("concurrent enrollment remains mandatory unless the catalog recommends it", () => {
  expect(assess("BMEN2320", { transcript: passed("BMEN 1300", "BMEN 2210"), planned: ["BMEN 1400"] }).status).toBe("eligible");
  expect(assess("BMEN2320", { transcript: passed("BMEN 1300", "BMEN 2210") }).status).toBe("locked");
  expect(parse("BIOL1750").expression).toMatchObject({ children: [{ kind: "corequisite" }] });
  expect(assess("BIOL1750", { planned: ["BIOL 1710"] }).status).toBe("unknown");
  expect(advisorSources(parse("BIOL1750").expression)).toEqual(["consent of department"]);
  expect(parse("MATH4060").annotations).toEqual(["Prior or concurrent enrollment in MATH 3510 or MATH 3610 is strongly recommended"]);
  expect(assess("MATH4060", { transcript: passed("MATH 3000") }).status).toBe("eligible");
  expect(assess("MATH4060", {}).status).toBe("locked");
  expect(parse("BIOL2041").annotations).toContain("Corequisite(s): Concurrent enrollment in BIOL 2042 is recommended but not required");
  expect(courseReferences(parse("BIOL2041").expression)).toEqual(["CHEM 1420"]);
  expect(assess("BIOL2041", { transcript: passed("BIOL 1710", "BIOL 1750", "CHEM 1420") }).status).toBe("unknown");
  expect(parse("BIOL3510").annotations).toContain("Concurrent enrollment in CHEM 2380 strongly encouraged");
  expect(parse("MATH3410").annotations).toContain("MATH 2700 recommended (may be taken concurrently)");
});

test("major conditions stay scoped while independent CSCE 2610 prerequisites decide failures", () => {
  const parsed = parse("CSCE2610");
  expect(parsed.coverage).toBe("partial");
  expect(courseReferences(parsed.expression)).toEqual(["CSCE 2100"]);
  expect(advisorSources(parsed.expression)).toEqual([
    "CSCI majors: EENG 2710", "CMPE majors: EENG 2710 taken concurrently with EENG 2711 ",
  ]);
  expect(assess("CSCE2610", {}).status).toBe("locked");
  expect(assess("CSCE2610", { transcript: [{ courseId: "CSCE 2100", grade: "D" }] }).status).toBe("locked");
  expect(assess("CSCE2610", { transcript: passed("CSCE 2100") }).status).toBe("unknown");
  const qualified = assess("CSCE2610", { transcript: passed("CSCE 2100", "EENG 2710", "EENG 2711") });
  expect(qualified.status).toBe("unknown");
  expect(JSON.stringify(qualified.reason)).toContain("Check with advisor: CSCI majors: EENG 2710");
  const probe = (courseId: string): CatalogCourse => ({ id: `probe:${courseId}`, credits: 3, prerequisite: { kind: "course", courseId, source: courseId } });
  const result = inferStatuses([catalog("CSCE2610")[0], ...["CSCE 2100", "EENG 2710", "EENG 2711"].map(probe)], { transcript: passed("CSCE2610") }, untAdapter);
  expect(result.statuses.get("probe:CSCE 2100")!.status).toBe("eligible");
  expect(result.statuses.get("probe:EENG 2710")!.status).toBe("locked");
  expect(result.statuses.get("probe:EENG 2711")!.status).toBe("locked");
  for (const id of ["COMM3325", "JOUR3315", "JOUR4480"]) {
    expect(parse(id).coverage).toBe("unknown");
    expect(courseReferences(parse(id).expression)).toEqual([]);
    expect(assess(id, {}).status).toBe("unknown");
  }
});


test("concurrent permissions with unsupported conditions still require an advisor", () => {
  const source = "This course can be taken concurrently with CSCE 2100 only with instructor approval";
  const parsed = parseUntPrerequisite(source);
  expect(parsed.coverage).toBe("unknown");
  expect(parsed.annotations).toEqual([]);
  expect(advisorSources(parsed.expression)).toEqual([source]);
});
