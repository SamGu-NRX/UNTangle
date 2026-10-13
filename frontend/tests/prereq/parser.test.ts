import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { adaptUntCatalog, parseUntPrerequisite, normalizeUntCourseId, untAdapter } from "../../src/lib/prereq/unt";
import { inferStatuses } from "../../src/lib/prereq/engine";
import type { Prerequisite, UntCatalogEntry } from "../../src/lib/prereq";
import golden from "./golden.json";
import coverage from "../../../tools/prereq-corpus/coverage.json";
import seed from "../../src/lib/generated/seed-data.json";

function shape(node: Prerequisite): string {
  switch (node.kind) {
    case "course": return node.courseId;
    case "and": case "or": return `${node.kind}(${node.children.map(shape).join(",")})`;
    case "minGrade": return `grade:${node.grade}(${shape(node.requirement)})`;
    case "corequisite": return `coreq(${shape(node.requirement)})`;
    case "standing": return `standing:${node.minimum}`;
    case "consent": return "consent";
    case "unknown": return "unknown";
  }
}

describe("catalog golden interpretations", () => {
  for (const fixture of golden) test(fixture.courseId, () => {
    const result = parseUntPrerequisite(fixture.source);
    expect(fixture.coverage).toBe(result.coverage);
    expect(shape(result.expression)).toBe(fixture.expected);
    expect(result.source).toBe(fixture.source);
    expect(result.expression.source).toBe(fixture.source);
  });
});

test("shared trailing grade applies to both OR alternatives", () => {
  const text = "CSCE 1030 or CSCE 1035 with a grade of C or better";
  expect(shape(parseUntPrerequisite(text).expression)).toBe("and(or(grade:C(CSCE 1030),grade:C(CSCE 1035)))");
});

test("semicolon co-requisite retains source and mandatory conjunction", () => {
  const result = parseUntPrerequisite("MATH 1710; co-requisite: PHYS 1730");
  expect(result.coverage).toBe("full");
  expect(shape(result.expression)).toBe("and(and(MATH 1710,coreq(PHYS 1730)))");
});

test("ambiguous course list and unknown text remain unknown", () => {
  for (const source of ["CSCE 1030, CSCE 1035 or MATH 1710", "placement test of at least 80", "MATH 1710 unless exempt"]) {
    const result = parseUntPrerequisite(source);
    expect(result.coverage).toBe("unknown");
    expect(result.expression.source).toBe(source);
    expect(shape(result.expression)).toBe("and(unknown)");
  }
});

test("standing after an explicit alternative list applies to every alternative", () => {
  const result = parseUntPrerequisite("C or better in one of the following: PSYC 3100 or PSYC 3620 and Junior Standing.");
  expect(shape(result.expression)).toBe("and(and(or(grade:C(PSYC 3100),grade:C(PSYC 3620)),standing:junior))");
});

test("annotations remain available", () => {
  const result = parseUntPrerequisite("MATH 1710. Recommended: study algebra. Core Category: Mathematics");
  expect(result.coverage).toBe("full");
  expect(result.annotations).toEqual(["Recommended: study algebra", "Core Category: Mathematics"]);
});

test("opaque ids are normalized only by the UNT boundary", () => {
  expect(normalizeUntCourseId("math1681x")).toBe("MATH 1681X");
  expect(() => normalizeUntCourseId("invalid")).toThrow("Invalid UNT course code");
});

test("all 656 bundled sources match the report and produce engine assessments", async () => {
  const directory = resolve(import.meta.dir, "../../../courses");
  const counts = { full: 0, partial: 0, unknown: 0 };
  const sources = new Map<string, string>();
  const catalogEntries: UntCatalogEntry[] = [];
  for (const file of (await readdir(directory)).filter(file => file.endsWith(".json")).sort()) {
    const entries: UntCatalogEntry[] = JSON.parse(await readFile(resolve(directory, file), "utf8"));
    catalogEntries.push(...entries);
    for (const entry of entries) {
      const result = parseUntPrerequisite(entry.prerequisites);
      counts[result.coverage]++;
      expect(result.expression.source).toBe(entry.prerequisites);
      sources.set(entry.course_number, entry.prerequisites);
    }
  }
  expect(sources.size).toBe(656);
  expect(counts).toEqual(coverage.counts);
  expect(golden.length).toBeGreaterThanOrEqual(40);
  for (const fixture of golden) expect(sources.get(fixture.courseId)).toBe(fixture.source);
  const catalog = adaptUntCatalog(catalogEntries, new Map(seed.courses.map(course => [course.code, course.creditHours])));
  const result = inferStatuses(catalog, {}, untAdapter);
  expect(result.statuses.size).toBe(656);
  expect([...result.statuses.values()].some(course => course.status === "done" || course.status === "taking")).toBe(false);
  for (const entry of catalogEntries) if (parseUntPrerequisite(entry.prerequisites).coverage !== "full") {
    expect(result.statuses.get(normalizeUntCourseId(entry.course_number))?.status).toBe("unknown");
  }
});
