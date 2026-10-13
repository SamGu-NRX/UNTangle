import { expect, test } from "bun:test";
import { inferStatuses, normalizeUntCourseId, parseUntPrerequisite, requirementKey, untAdapter } from "../../src/lib/prereq";
import type { CatalogCourse, Prerequisite, Reason } from "../../src/lib/prereq";
import coverage from "../../../tools/prereq-corpus/coverage.json";

const catalog: CatalogCourse[] = coverage.courses.map(row => ({ id: row.courseId, credits: 3, prerequisite: parseUntPrerequisite(row.source).expression }));
const byId = new Map(catalog.map(row => [row.id, row]));
const source = (id: string): string => {
  const row = coverage.courses.find(row => row.courseId === id);
  if (!row) throw new Error(`Missing catalog fixture: ${id}`);
  return row.source;
};
const passed = (courseId: string) => ({ courseId, grade: "A", credits: 3 });
const course = (courseId: string): Prerequisite => ({ kind: "course", courseId, source: courseId });
const probe = (prerequisite: Prerequisite): CatalogCourse => ({ id: "probe", credits: 3, prerequisite });
const status = (text: string, transcript: ReturnType<typeof passed>[]) => inferStatuses([probe(parseUntPrerequisite(text).expression)], { transcript }, untAdapter).statuses.get("probe")?.status;

test("SPAN 3001 completion cannot prove SPAN 2050 when equivalent credit was allowed", () => {
  expect(source("SPAN 3001")).toBe("SPAN 2050 or its equivalent.");
  expect(source("SPAN 3520")).toBe("SPAN 2050 .");
  const result = inferStatuses(catalog, { transcript: [passed("SPAN 3001")] }, untAdapter);
  expect(result.statuses.get("SPAN 3520")?.status).toBe("locked");
  expect(status(source("SPAN 3001"), [passed("SPAN 2050")])).toBe("eligible");
  const expression = parseUntPrerequisite(source("SPAN 3001")).expression;
  expect(expression).toMatchObject({ kind: "and", children: [{ kind: "or", escape: "equivalent", children: [{ kind: "course", courseId: "SPAN 2050" }, { kind: "unknown", escape: "equivalent" }] }] });
});

test("BIOL 4801's consent exception cannot prove CHEM 2380 for CHEM 4351", () => {
  expect(source("BIOL 4801")).toContain("If these requirements are not met, department consent is required.");
  expect(source("CHEM 4351")).toBe("C or better in each of the following: CHEM 2380 , CHEM 3451 and CHEM 3452 .");
  const result = inferStatuses(catalog, { transcript: [passed("BIOL 4801"), passed("CHEM 3451"), passed("CHEM 3452")] }, untAdapter);
  expect(result.statuses.get("CHEM 4351")?.status).toBe("locked");
  const expression = parseUntPrerequisite(source("BIOL 4801")).expression;
  expect(expression.kind).toBe("and");
  if (expression.kind !== "and") throw new Error("BIOL 4801 must retain its later policy conjuncts.");
  expect(expression.children[0]).toMatchObject({ kind: "or", escape: "consent", children: [{ kind: "and" }, { kind: "consent" }] });
});

test("ECON 4030's replacement modifies ECON 4630 and cannot prove it through closure", () => {
  const text = source("ECON 4030");
  expect(text).toContain("ECON 4630 can be replaced with MATH 3680 or DSCI 3710 with a grade of C or better");
  const result = inferStatuses([...catalog, probe(course("ECON 4630"))], { transcript: [passed("ECON 4030"), passed("MATH 3680")] }, untAdapter);
  expect(result.statuses.get("probe")?.status).toBe("locked");
  expect(status(text, [passed("ECON 1100"), passed("ECON 1110"), passed("MATH 3680")])).toBe("eligible");
  expect(status(text, [passed("ECON 1100"), passed("ECON 1110"), passed("ECON 4630")])).toBe("eligible");
  expect(status(text, [{ ...passed("ECON 1100"), grade: "D" }, { ...passed("ECON 1110"), grade: "D" }, { ...passed("MATH 3680"), grade: "C" }])).toBe("eligible");
  expect(status(text, [passed("MATH 3680")])).toBe("locked");
});

test("mandatory separators retain their meaning at every parenthesis depth", () => {
  const transcript = [{ courseId: "MATH 1710", grade: "C", credits: 3 }];
  for (const text of [
    "(MATH 1710 or MATH 1720; MATH 1830)",
    "(MATH 1710 or MATH 1720, and MATH 1830)",
    "MATH 1710 or MATH 1720; MATH 1830",
    "MATH 1710 or MATH 1720, and MATH 1830",
    "(((MATH 1710 or MATH 1720; MATH 1830)))",
  ]) {
    expect(status(text, transcript)).toBe("locked");
    expect(status(text, [...transcript, passed("MATH 1830")])).toBe("eligible");
  }
});

test("one-of lists do not rewrite a comma inside a nested mandatory pair", () => {
  const text = "one of the following: (MATH 1710, MATH 1720) or MATH 1830";
  expect(status(text, [passed("MATH 1710")])).toBe("locked");
  expect(status(text, [passed("MATH 1710"), passed("MATH 1720")])).toBe("eligible");
  expect(status(text, [passed("MATH 1830")])).toBe("eligible");
  expect(status("one of the following: (MATH 1710, MATH 1720), MATH 1830", [passed("MATH 1710")])).toBe("locked");
});

test("canonical requirement keys grow linearly through 16 and 64 wrappers", () => {
  function wrapped(depth: number): Prerequisite {
    let node = course('opaque:"course"');
    for (let index = 0; index < depth; index++) node = { kind: "minGrade", grade: "C", requirement: node, source: "ignored source" };
    return node;
  }
  const key16 = requirementKey(wrapped(16));
  const key32 = requirementKey(wrapped(32));
  const key64 = requirementKey(wrapped(64));
  expect(key16.length).toBeLessThan(1000);
  expect(key64.length - key32.length).toBe(2 * (key32.length - key16.length));
  expect(Array.isArray(JSON.parse(key64))).toBe(true);
  const a: Prerequisite = { kind: "and", children: [wrapped(16), course("other")], source: "one" };
  const b: Prerequisite = { kind: "and", children: [...a.children].reverse(), source: "two" };
  expect(requirementKey(a)).toBe(requirementKey(b));
  expect(requirementKey({ ...a, escape: "replacement" })).not.toBe(requirementKey(a));
});

function references(text: string): string[] {
  return [...new Set([...text.matchAll(/\b[A-Z]{2,5}\s*\d{4}[A-Z]?\b/gi)].map(match => normalizeUntCourseId(match[0])))];
}

test("all 656 catalog entries preserve eligibility monotonicity under positive-course deletion", () => {
  let comparisons = 0;
  let eligibleBaselines = 0;
  for (const row of coverage.courses) {
    const ids = references(row.source).filter(id => id !== row.courseId);
    const reachable = new Map<string, CatalogCourse>();
    const queue = [row.courseId];
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      if (reachable.has(id)) continue;
      const entry = byId.get(id);
      if (!entry) continue;
      reachable.set(id, entry);
      queue.push(...references(entry.prerequisite.source));
    }
    const relevantCatalog = [...reachable.values()];
    const eligible = (remaining: readonly string[]) => inferStatuses(relevantCatalog, { transcript: remaining.map(passed), earnedHours: 180 }, untAdapter).statuses.get(row.courseId)?.status === "eligible";
    const baseline = eligible(ids);
    if (baseline) eligibleBaselines++;
    for (const id of ids) {
      const reduced = ids.filter(other => other !== id);
      const reducedEligible = eligible(reduced);
      comparisons++;
      if (reducedEligible && !baseline) throw new Error(`Deleting ${id} newly made ${row.courseId} eligible.`);
      for (const other of reduced) {
        comparisons++;
        if (eligible(reduced.filter(candidate => candidate !== other)) && !reducedEligible) throw new Error(`Deleting ${id}, then ${other}, newly made ${row.courseId} eligible.`);
      }
    }
  }
  expect(coverage.courses.length).toBe(656);
  expect(comparisons).toBeGreaterThan(500);
  expect(eligibleBaselines).toBeGreaterThan(200);
  console.info(`Catalog monotonicity: 656 entries, ${comparisons} deletion comparisons, ${eligibleBaselines} eligible baselines.`);
});

function closureSources(reason: Reason): string[] {
  return [...(reason.kind === "closure" && reason.courseId ? [reason.courseId] : []), ...(reason.children ?? []).flatMap(closureSources)];
}

test("no catalog escape rule supplies any closure-derived satisfaction", () => {
  const escaped = coverage.courses.filter(row => /\bconsent\b|\bequivalents?\b|\breplac(?:e|ed|ement)\b|\bexceptions?\b|\bwaiv(?:e|er|ed)\b|\bsubstitut(?:e|ed|ion)\b/i.test(row.source));
  let probes = 0;
  for (const row of escaped) {
    for (const id of references(row.source)) for (const graded of [false, true]) {
      const prerequisite: Prerequisite = graded ? { kind: "minGrade", grade: "C", requirement: course(id), source: id } : course(id);
      const result = inferStatuses([byId.get(row.courseId)!, probe(prerequisite)], { transcript: [passed(row.courseId)] }, untAdapter);
      const sources = closureSources(result.statuses.get("probe")!.reason);
      if (sources.includes(row.courseId)) throw new Error(`${row.courseId} has an escape clause but supplied closure for ${id}.`);
      probes++;
    }
    const identicalRule = inferStatuses([byId.get(row.courseId)!, probe(parseUntPrerequisite(row.source).expression)], { transcript: [passed(row.courseId)] }, untAdapter);
    expect(closureSources(identicalRule.statuses.get("probe")!.reason).includes(row.courseId)).toBe(false);
  }
  expect(escaped.length).toBeGreaterThan(100);
  expect(probes).toBeGreaterThan(100);
  console.info(`Escape closure: ${escaped.length} catalog entries, ${probes} atomic and grade probes.`);
});
