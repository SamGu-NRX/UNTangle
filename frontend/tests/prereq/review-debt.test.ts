import { expect, test } from "bun:test";
import { detectCycles, inferStatuses, parseUntPrerequisite, untAdapter } from "../../src/lib/prereq";
import type { CatalogCourse, Prerequisite } from "../../src/lib/prereq";
const course = (id: string, prerequisite: Prerequisite): CatalogCourse => ({ id, credits: 3, prerequisite });
const requirement: Prerequisite = { kind: "course", courseId: "CSCE 1010", source: "CSCE 1010" };

test("satisfied course-or-consent stays eligible while consent alone needs review", () => {
  const catalog = [course("target", parseUntPrerequisite("CSCE 1010 or consent of instructor").expression)];
  expect(inferStatuses(catalog, { transcript: [{ courseId: "CSCE 1010", grade: "A", credits: 3 }] }, untAdapter).statuses.get("target")?.status).toBe("eligible");
  expect(inferStatuses(catalog, { transcript: [] }, untAdapter).statuses.get("target")?.status).toBe("unknown");
});

test("a graded concurrent retake remains unknown after a subthreshold grade", () => {
  const catalog = [course("target", { kind: "corequisite", source: "concurrent C", requirement: { kind: "minGrade", grade: "C", source: "C", requirement } })];
  for (const grade of ["D", "F"]) {
    expect(inferStatuses(catalog, { transcript: [{ courseId: "CSCE 1010", grade, credits: 3 }], inProgress: ["CSCE 1010"] }, untAdapter).statuses.get("target")?.status).toBe("unknown");
  }
  expect(inferStatuses(catalog, { transcript: [{ courseId: "CSCE 1010", grade: "C", credits: 3 }], inProgress: ["CSCE 1010"] }, untAdapter).statuses.get("target")?.status).toBe("eligible");
});

test("standalone cycle detection rejects duplicate IDs in either order", () => {
  const entries = [course("CSCE 1010", requirement), course("CSCE 1010", { kind: "and", children: [], source: "none" })];
  expect(() => detectCycles(entries)).toThrow("Duplicate catalog course ID: CSCE 1010");
  expect(() => detectCycles([...entries].reverse())).toThrow("Duplicate catalog course ID: CSCE 1010");
});

test("completion cannot supply closure for an empty OR", () => {
  const impossible: Prerequisite = { kind: "or", children: [], source: "no alternative" };
  const catalog = [course("completed", impossible), course("target", impossible)];
  expect(inferStatuses(catalog, { transcript: [{ courseId: "completed", grade: "A", credits: 3 }] }, untAdapter).statuses.get("target")?.status).toBe("locked");
});
