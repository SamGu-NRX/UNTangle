import { describe, expect, test } from "bun:test";
import { inferStatuses, parseUntPrerequisite, untAdapter } from "../../src/lib/prereq";
import type { CatalogCourse, Completion, Evidence } from "../../src/lib/prereq";
import corpus from "../../../tools/prereq-corpus/coverage.json";

const catalog: CatalogCourse[] = corpus.courses.map((row) => ({
  id: row.courseId,
  credits: 3,
  prerequisite: parseUntPrerequisite(row.source).expression,
}));
const passed = (courseId: string): Completion => ({ courseId, grade: "A", credits: 3 });
const covered = (evidence: Evidence) => inferStatuses(catalog, evidence, untAdapter).coverage;

describe("coverage on real catalog rules", () => {
  test("ECON 4030 covers ECON 1100 and ECON 1110, not the replaceable ECON 4630", () => {
    const result = covered({ transcript: [passed("ECON 4030")] });
    expect(result.get("ECON 1100")).toBe("ECON 4030");
    expect(result.get("ECON 1110")).toBe("ECON 4030");
    expect(result.has("ECON 4630")).toBe(false);
  });

  test("TECM 4920 covers TECM 2700 despite its added department consent", () => {
    expect(covered({ transcript: [passed("TECM 4920")] }).get("TECM 2700")).toBe("TECM 4920");
  });

  test("SPAN 3001 does not cover SPAN 2050, which allowed an equivalent", () => {
    expect(covered({ transcript: [passed("SPAN 3001")] }).has("SPAN 2050")).toBe(false);
  });

  test("BIOL 4801 does not cover CHEM 2380 behind its consent exception", () => {
    expect(covered({ transcript: [passed("BIOL 4801")] }).has("CHEM 2380")).toBe(false);
  });

  test("a course with credit is never reported as covered", () => {
    const result = covered({ transcript: [passed("ECON 4030"), passed("ECON 1100")] });
    expect(result.has("ECON 1100")).toBe(false);
    expect(result.get("ECON 1110")).toBe("ECON 4030");
  });

  test("a non-done override or an unresolved grade keeps a course out of coverage", () => {
    const overrides = new Map([["ECON 1100", { status: "locked" as const, reason: "Student says no." }]]);
    expect(covered({ transcript: [passed("ECON 4030")], overrides }).has("ECON 1100")).toBe(false);
    expect(covered({ transcript: [passed("ECON 4030"), { courseId: "ECON 1110", grade: "F", credits: 3 }] }).has("ECON 1110")).toBe(false);
  });
});

/**
 * One probe course per catalog course, each requiring exactly that course.
 * A probe is satisfied through closure (its reason is the closure witness)
 * exactly when its target is in `coverage`. Probes are never completed, so
 * they change no closure fact.
 */
describe("coverage matches what the statuses treat as satisfied through closure", () => {
  const probes: CatalogCourse[] = catalog.map((course) => ({
    id: `PROBE ${course.id}`,
    credits: 3,
    prerequisite: { kind: "course", courseId: course.id, source: course.id },
  }));
  const ids = catalog.map((course) => course.id).sort();

  // Deterministic transcripts: seeded picks of 1 to 8 passed courses.
  let seed = 20261013;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const transcripts = Array.from({ length: 40 }, () =>
    Array.from({ length: 1 + Math.floor(next() * 8) }, () => ids[Math.floor(next() * ids.length)]),
  );

  test.each(transcripts.map((transcript, index) => [index, transcript] as const))("transcript %i", (_index, transcript) => {
    const result = inferStatuses([...catalog, ...probes], { transcript: transcript.map(passed) }, untAdapter);
    for (const id of ids) {
      const done = result.statuses.get(id)?.status === "done";
      const throughClosure = result.statuses.get(`PROBE ${id}`)?.reason.kind === "closure";
      if (done) {
        expect(result.coverage.has(id)).toBe(false);
        continue;
      }
      if (throughClosure !== result.coverage.has(id)) {
        throw new Error(`${id}: probe through closure ${throughClosure}, coverage ${result.coverage.has(id)} for [${transcript.join(", ")}]`);
      }
    }
  });

  test("the property is not vacuous", () => {
    const counts = transcripts.map((transcript) => inferStatuses(catalog, { transcript: transcript.map(passed) }, untAdapter).coverage.size);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(20);
  });
});
