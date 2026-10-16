/**
 * Browse all's enumeration (src/lib/optimizer/enumerate.ts) against the
 * brute-force reference: every schedule that fits, in Auto's order, twins
 * included, with an honest total, and Auto's own entry point unchanged.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LIST_LIMIT, enumerateSchedules, MAX_LIST_LIMIT, type EnumerateResult } from "@/lib/optimizer/enumerate";
import { optimize } from "@/lib/optimizer/optimize";
import { prepare } from "@/lib/optimizer/prepare";
import { OptimizerInputError, type OptimizeRequest, type OptSection } from "@/lib/optimizer/types";
import { smallInstance, termInstance } from "./checks";
import { generateInstance } from "./generator";
import { enumerateValid, violations, type RefSchedule } from "./reference";

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
const TERM_SEEDS = Array.from({ length: 300 }, (_, i) => 7001 + i);

const listed = (result: EnumerateResult) => result.schedules.map((schedule) => [schedule.byCourse, schedule.cost, schedule.breakdown.daysOnCampus, schedule.breakdown.gapMinutes]);
const expected = (valid: RefSchedule[]) => valid.map((schedule) => [schedule.byCourse, schedule.cost, schedule.breakdown.daysOnCampus, schedule.breakdown.gapMinutes]);

/** Every disagreement with the reference on one request, as readable strings. */
function disagreements(request: OptimizeRequest, label: string, limit = MAX_LIST_LIMIT, enumerate = enumerateSchedules): string[] {
  const valid = enumerateValid(request);
  const result = enumerate({ ...request, limit });
  if (valid.length === 0) return result.status === "infeasible" ? [] : [`${label}: expected infeasible, got ${result.status}`];
  const problems: string[] = [];
  if (result.status !== "listed") return [`${label}: expected listed, got ${result.status}`];
  if (JSON.stringify(listed(result)) !== JSON.stringify(expected(valid.slice(0, limit)))) problems.push(`${label}: rows differ from the reference's first ${limit}`);
  if (result.total !== valid.length || !result.totalExact) problems.push(`${label}: total ${result.total}${result.totalExact ? "" : "+"}, reference ${valid.length}`);
  if (!result.schedules.every((schedule) => schedule.proven)) problems.push(`${label}: a complete search left a row unproven`);
  return problems;
}

/** Two sections of one course with the same meetings in the same buildings: ranking keeps only one. */
const twins = (a: OptSection, b: OptSection) =>
  a.id !== b.id &&
  JSON.stringify(a.meetings.map((m) => [m.day, m.start, m.end, m.buildingId, m.dates ?? null])) ===
    JSON.stringify(b.meetings.map((m) => [m.day, m.start, m.end, m.buildingId, m.dates ?? null]));

describe("enumeration against the reference", () => {
  test("a generated 6-course instance lists exactly the reference's combinations, twins included", () => {
    const request = generateInstance(4, { courses: 6, sectionsPerCourse: [2, 4], style: "realistic", constraintDensity: 0.3 });
    expect(request.courses).toHaveLength(6);
    const valid = enumerateValid(request);
    expect(valid.length).toBeGreaterThan(50);
    expect(disagreements(request, "seed 4")).toEqual([]);

    // Two listed combinations that differ only by one course's section, where
    // those sections meet at the same times in the same rooms.
    const result = enumerateSchedules({ ...request, limit: MAX_LIST_LIMIT });
    const sectionOf = (code: string, id: string) => request.courses.find((c) => c.code === code)!.sections.find((s) => s.id === id)!;
    const pair = result.schedules.flatMap((x, i) =>
      result.schedules.slice(i + 1).flatMap((y) => {
        const differing = Object.keys(x.byCourse).filter((code) => x.byCourse[code] !== y.byCourse[code]);
        return differing.length === 1 && twins(sectionOf(differing[0], x.byCourse[differing[0]]), sectionOf(differing[0], y.byCourse[differing[0]]))
          ? [{ code: differing[0], ids: [x.byCourse[differing[0]], y.byCourse[differing[0]]] }]
          : [];
      }),
    )[0];
    expect(pair).toBeDefined();
    // Auto's preparation drops one of that pair; the list's keeps both.
    const ranked = prepare(request).candidates.map((c) => c.section.id);
    expect(pair.ids.filter((id) => ranked.includes(id))).toHaveLength(1);
    const kept = prepare(request, Number.POSITIVE_INFINITY, () => 0, { keepTwins: true }).candidates.map((c) => c.section.id);
    expect(pair.ids.every((id) => kept.includes(id))).toBe(true);
  });

  test("lists exactly the reference's valid schedules on 400 seeded instances", () => {
    expect(SEEDS.flatMap((seed) => disagreements(smallInstance(seed), `seed ${seed}`))).toEqual([]);
  });

  test("lists exactly the reference's valid schedules on 300 dated instances, walking check on and off", () => {
    const problems = TERM_SEEDS.flatMap((seed) => [
      ...disagreements(termInstance(seed, true), `dated seed ${seed}, walking`),
      ...disagreements(termInstance(seed, false), `dated seed ${seed}`),
    ]);
    expect(problems).toEqual([]);
  });

  test("a short list is exactly the reference's best few, with the full count behind it", () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const request = smallInstance(seed);
      const valid = enumerateValid(request);
      if (valid.length <= 5) continue;
      checked += 1;
      expect(disagreements(request, `seed ${seed}, limit 5`, 5)).toEqual([]);
    }
    expect(checked).toBeGreaterThan(60);
  });

  test("the first row is Auto's first option", () => {
    for (const seed of SEEDS.slice(0, 120)) {
      const request = smallInstance(seed);
      const auto = optimize(request);
      const list = enumerateSchedules(request);
      if (auto.status !== "optimal") continue;
      expect(list.status).toBe("listed");
      expect(list.schedules[0].byCourse).toEqual(auto.schedules[0].byCourse);
      expect(list.schedules[0].cost).toBe(auto.schedules[0].cost);
    }
  });

  test("nothing fits: the same explanation Auto gives", () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const request = smallInstance(seed);
      const auto = optimize(request);
      if (auto.status !== "infeasible") continue;
      checked += 1;
      const list = enumerateSchedules(request);
      expect(list.status).toBe("infeasible");
      if (list.status === "infeasible") expect(list.explanation).toEqual(auto.explanation);
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("budgets and bounds", () => {
  const big = generateInstance(1000, { courses: 8, sectionsPerCourse: 40, style: "realistic", constraintDensity: 0.2 });

  test("a rank pass cut short marks every row unproven, and every row still fits", () => {
    const result = enumerateSchedules({ ...big, limit: 50, rankNodes: 2_000, countNodes: 2_000 });
    expect(result.status).toBe("listed");
    expect(result.schedules.length).toBeGreaterThan(0);
    expect(result.schedules.every((schedule) => !schedule.proven)).toBe(true);
    const sections = big.courses.flatMap((course) => course.sections);
    for (const schedule of result.schedules) {
      expect(violations(big, Object.values(schedule.byCourse).map((id) => sections.find((s) => s.id === id)!))).toEqual([]);
    }
  });

  // The proven side of this rule needs a rank pass that ran out after its last valid schedule, which
  // these seeds never produce (the search ends at its last leaf); they check the unproven side.
  test("a rank pass cut short is unproven unless the count shows every schedule is listed", () => {
    let checked = 0;
    for (const seed of SEEDS.slice(0, 200)) {
      const request = smallInstance(seed);
      const valid = enumerateValid(request);
      if (valid.length < 10) continue;
      for (const rankNodes of [10, 30, 100]) {
        const result = enumerateSchedules({ ...request, limit: MAX_LIST_LIMIT, rankNodes, countNodes: 1_000_000 });
        // Only rank passes that ran out and still listed something.
        if (result.status !== "listed" || result.stats.rankNodes <= rankNodes) continue;
        checked += 1;
        expect(result.totalExact).toBe(true);
        expect(result.total).toBe(valid.length);
        expect(result.schedules.every((schedule) => schedule.proven)).toBe(result.schedules.length === valid.length);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  test("a count cut short says at least, and never less than the rows listed", () => {
    const result = enumerateSchedules({ ...big, limit: 20, countNodes: 5_000 });
    expect(result.status).toBe("listed");
    expect(result.totalExact).toBe(false);
    expect(result.total).toBeGreaterThanOrEqual(result.schedules.length);
    expect(result.schedules).toHaveLength(20);
  });

  test("the same request gives the same list (node budgets, no clock)", () => {
    const run = () => JSON.stringify(enumerateSchedules({ ...big, limit: 30, rankNodes: 50_000, countNodes: 50_000 }).schedules);
    expect(run()).toBe(run());
  });

  test("the list's limit is checked loudly", () => {
    const request = smallInstance(3);
    expect(() => enumerateSchedules({ ...request, limit: 0 })).toThrow(OptimizerInputError);
    expect(() => enumerateSchedules({ ...request, limit: MAX_LIST_LIMIT + 1 })).toThrow(OptimizerInputError);
    expect(() => enumerateSchedules({ ...request, rankNodes: 0 })).toThrow(OptimizerInputError);
    expect(DEFAULT_LIST_LIMIT).toBeLessThanOrEqual(MAX_LIST_LIMIT);
  });

  test("Auto's k still rejects values outside 1..20", () => {
    const request = smallInstance(3);
    expect(() => optimize({ ...request, k: 21 })).toThrow(OptimizerInputError);
    expect(() => optimize({ ...request, k: 0 })).toThrow(OptimizerInputError);
    expect(() => optimize({ ...request, k: 20 })).not.toThrow();
  });
});

// As in mutation.test.ts: plant one bug in a copy of the engine and check the comparison above catches it.
const created: string[] = [];
afterAll(() => created.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function mutant(file: string, from: string, to: string): Promise<typeof enumerateSchedules> {
  const dir = mkdtempSync(join(tmpdir(), "untangle-enumerate-mutant-"));
  created.push(dir);
  cpSync(join(import.meta.dir, "../../src/lib/optimizer"), dir, { recursive: true });
  const path = join(dir, file);
  const text = readFileSync(path, "utf8");
  if (text.split(from).length !== 2) throw new Error(`mutation target in ${file} must occur once: ${from}`);
  writeFileSync(path, text.replace(from, to));
  return ((await import(join(dir, "enumerate.ts"))) as { enumerateSchedules: typeof enumerateSchedules }).enumerateSchedules;
}

describe("the comparison catches planted bugs", () => {
  const caught = (fn: typeof enumerateSchedules) => {
    const six = generateInstance(4, { courses: 6, sectionsPerCourse: [2, 4], style: "realistic", constraintDensity: 0.3 });
    return [disagreements(six, "seed 4", MAX_LIST_LIMIT, fn), ...SEEDS.slice(0, 120).map((seed) => disagreements(smallInstance(seed), `seed ${seed}`, 5, fn))].flat();
  };
  for (const { name, file, from, to } of [
    { name: "the list drops twins like ranking does", file: "prepare.ts", from: "(options.keepTwins ? kept : dropTwins(kept, walkingMatters))", to: "dropTwins(kept, walkingMatters)" },
    { name: "the rank pass prunes against the best schedule, not the last one kept", file: "search.ts", from: "best = options.collect(leaf);", to: "options.collect(leaf); if (best === null || leafBefore(leaf, best)) best = leaf;" },
    { name: "the count stops at the list's length", file: "enumerate.ts", from: "if (!ranked.complete || kept.length === limit) {", to: "if (!ranked.complete) {" },
  ]) {
    test(name, async () => {
      expect(caught(await mutant(file, from, to)).length).toBeGreaterThan(0);
    });
  }
});
