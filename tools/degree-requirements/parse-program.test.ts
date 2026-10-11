import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildRequirements, parseCourseleafBlocks, parseDegreeMeta, parseProgramTitle } from "./parse-program.mjs";
import { evaluateDegreeRequirements } from "../../frontend/src/lib/degree/degree-requirements";
import type { DegreeRequirements } from "../../frontend/src/lib/degree/degree-requirements";

const fixture = readFileSync(new URL("./fixtures/cs-2023-24-archived.html", import.meta.url), "utf8");
const html = fixture.slice(fixture.indexOf('<div class="acalog-core">'));
const blocks = parseCourseleafBlocks(html);

const identity = {
  majorId: "cs",
  majorName: "Computer Science, BS",
  catalogYear: "2023-2024 (archived fixture)",
  sourceUrl: "http://web.archive.org/web/20241010152103/http://catalog.unt.edu/preview_program.php?catoid=32&poid=13823&returnto=3544",
  fetchedAt: "2026-10-11T00:00:00.000Z",
  sourceSha256: "fixture-bytes",
};
const reqs = buildRequirements(blocks, identity as unknown as Parameters<typeof buildRequirements>[1]);
const hoursFor = (code: string): number | null =>
  ({ "PHYS 1710": 3, "PHYS 1730": 1, "PHYS 2220": 3, "PHYS 2240": 1, "MATH 1780": 3, "MATH 3680": 3 })[code] ?? null;

describe("parseCourseleafBlocks — archived 2023-24 Computer Science BS page", () => {
  test("extracts degree meta and major hours", () => {
    expect(reqs.totalHours).toBe(120);
    expect(reqs.advancedHours).toBe(42);
    expect(reqs.majorHours).toBe(55);
  });

  test("major requirements section: 13 required courses incl CSCE 4999, two plus-clauses, two choose blocks, one note", () => {
    const major = reqs.sections[0];
    expect(major.label).toBe("Major requirements");
    expect(major.hoursLabel).toBe("55 hours");
    const courses = major.items.filter((i) => i.kind === "course");
    expect(courses).toHaveLength(13);
    expect(courses[0]).toMatchObject({ kind: "course", courseCode: "CSCE 1030" });
    expect(courses[12]).toMatchObject({ kind: "course", courseCode: "CSCE 4999", title: "Senior Thesis" });
    const chooses = major.items.filter((i) => i.kind === "choose");
    expect(chooses).toHaveLength(2);
    expect(chooses[0]).toMatchObject({ label: "CSCE core, 6 hours", chooseHours: 6 });
    expect(chooses[0].options).toHaveLength(5);
    expect(chooses[0].options.map((o: any) => o.courseCode)).toEqual(["CSCE 3530", "CSCE 4115", "CSCE 4430", "CSCE 4600", "CSCE 4650"]);
    expect(chooses[1]).toMatchObject({ label: "CSCE breadth courses, 6 hours", chooseHours: 6 });
    expect(chooses[1].options).toHaveLength(8);
    // plus-clauses are advisor items, not machine requirements
    const advisors = major.items.filter((i) => i.kind === "advisor");
    expect(advisors).toHaveLength(3); // plus-6, plus-9, Note
    expect(advisors[0].note).toContain("plus 6 hours chosen from CSCE Advanced Elective Courses or CSCE 4999");
    expect(advisors[1].note).toContain("plus 9 hours chosen from CSCE Advanced Elective Courses");
    expect(advisors[2].note).toContain("maximum of 6 hours");
  });

  test("other required courses: the MATH or-alternative binds only its two branches", () => {
    const other = reqs.sections[1];
    expect(other.label).toBe("Other required courses");
    const codes = other.items.map((i: any) => (i.kind === "anyOf" ? `anyOf(${i.items.map((x: any) => x.courseCode).join("|")})` : i.courseCode ?? i.kind));
    expect(codes).toEqual(["EENG 2710", "MATH 1710", "MATH 1720", "anyOf(MATH 1780|MATH 3680)", "MATH 2700", "TECM 2700", "group", "advisor"]);
  });

  test("laboratory science opens a nested group filled by the two h4 blocks", () => {
    const lab = reqs.sections[1].items[6] as any;
    expect(lab.kind).toBe("group");
    expect(lab.label).toBe("Laboratory science");
    expect(lab.hoursLabel).toBe("16 hours");
    const [required, choose8] = lab.items;
    expect(required.kind).toBe("group");
    expect(required.hoursLabel).toBe("8 hours");
    expect(required.items.map((i: any) => i.courseCode)).toEqual(["PHYS 1710", "PHYS 1730", "PHYS 2220", "PHYS 2240"]);
    expect(choose8.kind).toBe("choose");
    expect(choose8.chooseHours).toBe(8);
    expect(choose8.options).toHaveLength(8);
    expect(choose8.options.map((o: any) => o.courseCode ?? `anyOf(${o.items.map((x: any) => x.courseCode).join("|")})`)).toEqual([
      "BIOL 1710",
      "BIOL 1720",
      "BIOL 1760",
      "CHEM 1410",
      "anyOf(CHEM 1430|CHEM 1415)",
      "CHEM 1435",
      "CHEM 1420",
      "CHEM 1440",
    ]);
  });

  test("non-enumerable prose stays advisor: TECM pattern, Minor, Electives, policies", () => {
    const notes = reqs.advisorNotes.join("\n");
    expect(notes).toContain("Any 4000-level TECM course");
    expect(notes).toContain("Optional.");
    expect(notes).toContain("Hours required for electives may vary");
    expect(notes).toContain("grade point average of 2.0");
    expect(notes).toContain("Department policies");
    expect(reqs.advisorNotes.length).toBeGreaterThanOrEqual(8);
  });

  test("parsed tree evaluates: one or-branch satisfies the alternative; partial lab pair", () => {
    const p1 = evaluateDegreeRequirements(reqs as unknown as DegreeRequirements, [{ code: "MATH 1780" }], [], hoursFor);
    const anyOfNode = p1.sections[1].items[3];
    expect(anyOfNode.status).toBe("satisfied");
    expect(anyOfNode.hoursDone).toBe(3);
    const p2 = evaluateDegreeRequirements(reqs as unknown as DegreeRequirements, [], [], hoursFor);
    expect(p2.sections[1].items[3].status).toBe("unmet");
    const p3 = evaluateDegreeRequirements(
      reqs as unknown as DegreeRequirements,
      [{ code: "PHYS 1710" }, { code: "PHYS 1730" }],
      [],
      hoursFor,
    );
    const lab = p3.sections[1].items[6];
    expect(lab.status).toBe("unmet"); // choose-8 untouched, required group half done
    expect(lab.children[0].status).toBe("unmet");
    expect(lab.children[0].hoursDone).toBe(4);
  });

  test("program title parser strips the catalog suffix", () => {
    expect(parseProgramTitle("<title>Program: Computer Science, BS - University of North Texas - Modern Campus Catalog\u2122</title>")).toBe("Computer Science, BS");
  });
});

describe("parseDegreeMeta", () => {
  test("reads the published minimums", () => {
    const meta = parseDegreeMeta("A minimum of 120 semester hours, of which 42 must be advanced");
    expect(meta).toEqual({ totalHours: 120, advancedHours: 42 });
  });
});
