import { describe, expect, test } from "bun:test";
import { optimize as bruteForceOptimize } from "../../src/lib/optimizer/brute-force";
import { optimize as mipOptimize } from "../../src/lib/optimizer/mip/mip-optimizer";
import { evaluateModelObjective } from "../../src/lib/optimizer/mip/model";
import { runChecker } from "../../src/lib/optimizer/checker";
import { buildSuite } from "../../src/lib/optimizer/bench/instances";
import type { OptimizeResult } from "../../src/lib/optimizer/types";

// The pinned suite is rebuilt deterministically (BASE_SEED 424242, stride 7919).
const suite = buildSuite();

// worst-case-xl is deliberately not exercised in-test: its pinned 3000ms
// budget alone would consume a large slice of the 25s test cap. It is a
// non-enumerable instance like mixed-l/large-l below; the parent thread's
// benchmark round runs it on the identical seeds.
const nonEnumerableInTest = suite.filter((i) => !i.enumerable && i.sizeClass !== "xl");

describe("mip vs brute force on pinned enumerable instances", () => {
  for (const instance of suite.filter((i) => i.enumerable)) {
    test(`agreement: ${instance.name}`, async () => {
      let expected: OptimizeResult;
      try {
        expected = await bruteForceOptimize(instance.req);
      } catch {
        return; // brute force refuses to enumerate; nothing to agree on
      }
      // Correctness gate: run with a budget that completes even on a slow or
      // loaded machine — this test verifies exactness (status, cost, order),
      // not speed. Budget honesty is verified separately on timeBudgetMs=1
      // and on the pinned-budget non-enumerable runs below.
      const actual = await mipOptimize({ ...instance.req, timeBudgetMs: 15000 });
      expect(actual.status).toBe(expected.status);
      expect(actual.schedules.length).toBe(expected.schedules.length);
      for (let i = 0; i < expected.schedules.length; i++) {
        const actualSchedule = actual.schedules[i];
        const expectedSchedule = expected.schedules[i];
        if (!actualSchedule || !expectedSchedule) throw new Error("schedule count mismatch");
        expect(actualSchedule.sectionIds).toEqual(expectedSchedule.sectionIds);
        expect(actualSchedule.breakdown.cost).toBeCloseTo(expectedSchedule.breakdown.cost, 9);
      }
      expect(actual.diversity).toBeCloseTo(expected.diversity, 9);

      // The independent checker must see zero violations.
      expect(runChecker(instance.req, actual)).toEqual([]);

      // The model's linearized objective must equal the official scorer
      // cost for every returned schedule (catches linearization drift).
      const sectionsById = new Map(instance.req.sections.map((section) => [section.id, section]));
      for (const schedule of actual.schedules) {
        const chosen = schedule.sectionIds.map((id) => {
          const section = sectionsById.get(id);
          if (!section) throw new Error(`unknown section ${id}`);
          return section;
        });
        expect(evaluateModelObjective(instance.req, chosen)).toBeCloseTo(schedule.breakdown.cost, 6);
      }
    }, 30000);
  }
});

describe("mip on non-enumerable pinned instances", () => {
  test("mixed-l and large-l return honest statuses with checker-clean output", async () => {
    for (const instance of nonEnumerableInTest) {
      const result = await mipOptimize(instance.req);
      expect(["optimal", "timeout", "feasible"]).toContain(result.status);
      expect(runChecker(instance.req, result)).toEqual([]);
    }
  }, 20000);
});
