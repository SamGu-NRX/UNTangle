import { expect, test } from "bun:test";
import { inferStatuses, normalizeUntCourseId, parseUntPrerequisite, untAdapter } from "../../src/lib/prereq";
import type { CatalogCourse } from "../../src/lib/prereq";
import coverage from "../../../tools/prereq-corpus/coverage.json";

const catalog = new Map<string, CatalogCourse>(coverage.courses.map(row => [row.courseId, { id: row.courseId, credits: 3, prerequisite: parseUntPrerequisite(row.source).expression }]));
const ranks = ["F", "D", "C", "B", "A"];
function ids(text: string): string[] {
  return [...new Set([...text.matchAll(/\b[A-Z]{2,5}\s*\d{4}[A-Z]?\b/gi)].map(match => normalizeUntCourseId(match[0])))];
}

// This oracle reads catalog wording directly so a missing minGrade AST node cannot hide a parser defect.
function statedMinimums(text: string): Map<string, string> {
  const result = new Map<string, string>();
  let previous: string[] = [];
  for (const sentence of text.split(/\.\s+|\.\s*$/)) {
    let start = 0;
    for (const match of sentence.matchAll(/\b([A-D])\s+or\s+(?:better|higher)\b/gi)) {
      const before = sentence.slice(start, match.index);
      const after = sentence.slice(match.index + match[0].length);
      const shared = /\b(?:all|each)\b[^;]*$/i.test(before);
      const both = /\bboth\b[^;]*$/i.test(before);
      let courses: string[];
      if (/^\s+in\s*:?\s*/i.test(after)) courses = ids(after);
      else if (both) {
        const prefix = sentence.slice(0, match.index);
        const pair = ids(prefix.slice(prefix.lastIndexOf(";") + 1));
        courses = pair.length === 2 ? pair : [];
        if (ids(prefix).length === 0 && previous.length === 2) courses = previous;
      }
      else if (shared) courses = ids(sentence.slice(0, match.index));
      else courses = ids(before.slice(before.lastIndexOf(";") + 1));
      if (shared && courses.length === 0) courses = previous;
      for (const id of courses) {
        const minimum = match[1].toUpperCase();
        if (ranks.indexOf(minimum) > ranks.indexOf(result.get(id) ?? "F")) result.set(id, minimum);
      }
      start = match.index + match[0].length;
    }
    const letterList = sentence.match(/Grade of A,\s*B,\s*or C in\s+(.+)/i);
    if (letterList) for (const id of ids(letterList[1])) result.set(id, "C");
    previous = ids(sentence);
  }
  return result;
}

function relevantCatalog(id: string): CatalogCourse[] {
  const reachable = new Map<string, CatalogCourse>();
  const queue = [id];
  for (let index = 0; index < queue.length; index++) {
    const next = queue[index];
    if (reachable.has(next)) continue;
    const entry = catalog.get(next);
    if (!entry) continue;
    reachable.set(next, entry);
    queue.push(...ids(entry.prerequisite.source));
  }
  return [...reachable.values()];
}

function eligible(entries: readonly CatalogCourse[], target: string, courses: readonly string[], lowered?: { id: string; grade: string }): boolean {
  const transcript = courses.map(courseId => ({ courseId, grade: courseId === lowered?.id ? lowered.grade : "A", credits: 3 }));
  return inferStatuses(entries, { transcript, earnedHours: 180 }, untAdapter).statuses.get(target)?.status === "eligible";
}

test("explicit shared grades cross mandatory and alternative groups and preserve earlier thresholds", () => {
  for (const text of ["MATH 1710; MATH 1720 all with a grade of C or better", "MATH 1710; or MATH 1720 each with a grade of C or better", "MATH 1710 with a grade of D or better; MATH 1720 all with a grade of C or better"]) {
    const entry: CatalogCourse = { id: "target", credits: 3, prerequisite: parseUntPrerequisite(text).expression };
    expect(eligible([entry], "target", ["MATH 1710", "MATH 1720"], { id: "MATH 1710", grade: "D" })).toBe(text.includes("; or "));
    expect(eligible([entry], "target", ["MATH 1710"], { id: "MATH 1710", grade: "D" })).toBe(false);
  }
});

test("closure retains every threshold when a shared grade wraps an earlier minimum", () => {
  const source = "MATH 1710 with a grade of D or better; MATH 1720 all with a grade of C or better";
  const admitted: CatalogCourse = { id: "admitted", credits: 3, prerequisite: parseUntPrerequisite(source).expression };
  const target: CatalogCourse = { id: "target", credits: 3, prerequisite: parseUntPrerequisite("MATH 1710 with a grade of C or better").expression };
  const result = inferStatuses([admitted, target], { transcript: [{ courseId: "admitted", grade: "A" }] }, untAdapter);
  expect(result.statuses.get("target")?.status).toBe("eligible");
  expect(inferStatuses([admitted, target], { transcript: [{ courseId: "admitted", grade: "A" }, { courseId: "MATH 1710", grade: "D" }] }, untAdapter).statuses.get("target")?.status).toBe("locked");
});

test("all eligible catalog targets reject lowered grades on essential stated minimums", () => {
  let eligibleTargets = 0;
  const gradedTargets = new Set<string>();
  let probes = 0;
  for (const row of coverage.courses) {
    const entries = relevantCatalog(row.courseId);
    let courses = ids(row.source).filter(id => id !== row.courseId);
    if (!eligible(entries, row.courseId, courses)) continue;
    eligibleTargets++;
    // Remove redundant OR branches before lowering one grade; another passing branch may legitimately qualify.
    for (const id of [...courses]) {
      const reduced = courses.filter(other => other !== id);
      if (eligible(entries, row.courseId, reduced)) courses = reduced;
    }
    const minimums = statedMinimums(row.source);
    let tested = false;
    for (const id of courses) {
      const minimum = minimums.get(id);
      if (!minimum) continue;
      const grade = ranks[ranks.indexOf(minimum) - 1];
      if (eligible(entries, row.courseId, courses, { id, grade })) throw new Error(row.courseId + " stayed eligible after " + id + " fell below stated " + minimum + ".");
      probes++;
      tested = true;
    }
    if (tested) gradedTargets.add(row.courseId);
  }
  expect(coverage.courses.length).toBe(656);
  expect(eligibleTargets).toBeGreaterThan(300);
  for (const id of ["CSCE 1040", "MATH 1720", "MEEN 3210", "MEEN 3230", "MEEN 3240", "MEEN 4110", "MEEN 4140", "MEEN 4150", "MEEN 4315"]) expect(gradedTargets.has(id)).toBe(true);
  expect(probes).toBeGreaterThan(0);
  console.info("Grade thresholds: 656 entries, " + eligibleTargets + " eligible targets, " + gradedTargets.size + " graded targets, " + probes + " single-grade probes.");
});

const sharedRows = coverage.courses.filter(row => /\b(?:all|each|both)\b[^.;]*\b[A-D]\s+or\s+(?:better|higher)/i.test(row.source));
test("all shared-grade catalog clauses have direct negative cases and exhaustive branch probes", () => {
  let sharedSubsets = 0;
  let sharedProbes = 0;
  for (const row of sharedRows) {
    const courseIds = ids(row.source).filter(id => id !== row.courseId);
    const minimums = statedMinimums(row.source);
    expect(minimums.size).toBeGreaterThan(0);
    const entry = catalog.get(row.courseId)!;
    const entries = [entry];
    // Every shared-grade source gets negative evidence, including rules that also require advisor review.
    const transcript = courseIds.map(courseId => ({ courseId, grade: minimums.has(courseId) ? ranks[ranks.indexOf(minimums.get(courseId)!) - 1] : "A", credits: 3 }));
    expect(inferStatuses(entries, { transcript, earnedHours: 180 }, untAdapter).statuses.get(row.courseId)?.status).not.toBe("eligible");
    expect(courseIds.length).toBeLessThanOrEqual(10);
    // Exhaust the small source lists to exercise every OR branch, not just one greedy witness.
    for (let mask = 0; mask < 2 ** courseIds.length; mask++) {
      const subset = courseIds.filter((_, index) => (mask & (1 << index)) !== 0);
      if (!eligible(entries, row.courseId, subset)) continue;
      sharedSubsets++;
      for (const id of subset) {
        const minimum = minimums.get(id);
        if (!minimum || eligible(entries, row.courseId, subset.filter(other => other !== id))) continue;
        const grade = ranks[ranks.indexOf(minimum) - 1];
        if (eligible(entries, row.courseId, subset, { id, grade })) throw new Error(row.courseId + " stayed eligible with " + id + " below shared " + minimum + ".");
        sharedProbes++;
      }
    }
  }
  expect(sharedRows.length).toBeGreaterThanOrEqual(30);
  expect(sharedProbes).toBeGreaterThan(50);
  expect(coverage.courses.find(row => row.courseId === "MEEN 3210")?.source).toBe("MEEN 3120 ; MEEN 3110 ; MEEN 3250 all with a grade of C or better.");
  for (const id of ["MEEN 3210", "MEEN 3230", "MEEN 3240", "MEEN 4110", "MEEN 4140", "MEEN 4150", "MEEN 4315"]) {
    const row = coverage.courses.find(row => row.courseId === id)!;
    const entry = catalog.get(id)!;
    const courseIds = ids(row.source);
    expect(eligible([entry], id, courseIds)).toBe(true);
    const transcript = courseIds.map(courseId => ({ courseId, grade: courseId === courseIds[0] ? "D" : "A", credits: 3 }));
    expect(inferStatuses([entry], { transcript, earnedHours: 180 }, untAdapter).statuses.get(id)?.status).toBe("locked");
  }
  console.info("Shared grade wording: " + sharedRows.length + " sources, " + sharedSubsets + " eligible subsets, " + sharedProbes + " single-grade probes.");
});
