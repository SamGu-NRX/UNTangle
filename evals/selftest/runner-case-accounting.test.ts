/**
 * Scenario 1a: the runner records case failures as exit code 1 — and a run
 * whose cases all pass or are honestly not-applicable as exit 0.
 *
 * These spawn the real runner binary (a bounded subprocess) against a
 * throwaway COPY of the harness whose stack.ts is a healthy stub, plus
 * throwaway fake suites: no Postgres, no backend, no frontend build, no
 * browser. What is under test is the runner's own accounting: outcome ->
 * case record -> summary -> exit code, and the scorecard it writes.
 *
 *   fakesuite  on a bare target -> 1 pass + 1 not-applicable -> exit 0
 *   failsuite  one case returns fail                            -> exit 1
 *   throwsuite one case throws                                  -> exit 1
 *   crashysuite describe() throws                                -> exit 1
 *
 * Run: bun test evals/selftest/runner-case-accounting.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";
import { validateScorecard } from "../scorecard";
import type { Scorecard } from "../scorecard";
import {
  makeFakeTarget,
  makeHarnessCopy,
  makeTempRoot,
  readCard,
  runRunner,
  writeFakeSuites,
  type HarnessCopy,
} from "./helpers";

let root: string;
let harness: HarnessCopy;
let bareTarget: string;

beforeAll(() => {
  root = makeTempRoot("accounting");
  harness = makeHarnessCopy(root, { stubStack: true });
  writeFakeSuites(harness);
  bareTarget = makeFakeTarget(root, "target-bare");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runner case accounting (stubbed-stack harness copy)", () => {
  test(
    "green + honestly not-applicable cases exit 0 and produce a valid scorecard",
    async () => {
      const out = path.join(root, "green", "card.json");
      const r = await runRunner({
        harness,
        targetDir: bareTarget,
        suite: "fakesuite",
        outPath: out,
        taskId: "selftest-green",
      });
      expect(r.code).toBe(0);
      expect(r.timedOut).toBeFalse();

      const card = readCard(out) as Scorecard;
      expect(validateScorecard(card)).toEqual([]);
      expect(card.infrastructure.ok).toBeTrue();
      expect(card.infrastructure.brokenStep).toBeNull();

      const green = card.cases.find((c) => c.id === "always-green");
      const descriptor = card.cases.find((c) => c.id === "descriptor-hash-matches-data");
      expect(green?.status).toBe("pass");
      // A bare target has no dataset to hash: honest skip, not a failure.
      expect(descriptor?.status).toBe("not-applicable");
      expect(descriptor?.note).toContain("nothing to hash");
      expect(r.stderr).toContain("[run] 1/2 pass, 0 fail, 1 n/a");
    },
    120_000,
  );

  test(
    "a failing case exits 1 and is recorded as fail with its note",
    async () => {
      const out = path.join(root, "fail", "card.json");
      const r = await runRunner({
        harness,
        targetDir: bareTarget,
        suite: "failsuite",
        outPath: out,
        taskId: "selftest-fail",
      });
      expect(r.code).toBe(1);

      const card = readCard(out) as Scorecard;
      expect(validateScorecard(card)).toEqual([]);
      // The stack never broke — this is a case failure, not an infra failure.
      expect(card.infrastructure.ok).toBeTrue();
      expect(card.cases).toHaveLength(1);
      const record = card.cases[0];
      expect(record?.id).toBe("deliberate-fail");
      expect(record?.status).toBe("fail");
      expect(record?.note).toContain("deliberate failure planted");
      expect(r.stderr).toContain("[run] 0/1 pass, 1 fail, 0 n/a");
    },
    120_000,
  );

  test(
    "a throwing case exits 1 and is recorded as fail with the case-threw note",
    async () => {
      const out = path.join(root, "throw", "card.json");
      const r = await runRunner({
        harness,
        targetDir: bareTarget,
        suite: "throwsuite",
        outPath: out,
        taskId: "selftest-throw",
      });
      expect(r.code).toBe(1);

      const card = readCard(out) as Scorecard;
      expect(validateScorecard(card)).toEqual([]);
      const record = card.cases[0];
      expect(record?.id).toBe("deliberate-throw");
      expect(record?.status).toBe("fail");
      expect(record?.note).toBe("case threw: deliberate case exception planted by the self-test fixtures");
      expect(record?.measured).toBeNull();
    },
    120_000,
  );

  test(
    "a suite whose describe() crashes exits 1 with a crash case record",
    async () => {
      const out = path.join(root, "crash", "card.json");
      const r = await runRunner({
        harness,
        targetDir: bareTarget,
        suite: "crashysuite",
        outPath: out,
        taskId: "selftest-crash",
      });
      expect(r.code).toBe(1);

      const card = readCard(out) as Scorecard;
      expect(validateScorecard(card)).toEqual([]);
      expect(card.cases).toHaveLength(1);
      const record = card.cases[0];
      expect(record?.id).toBe("(suite crashed before any case result)");
      expect(record?.status).toBe("fail");
      expect(record?.note).toContain("describe() exploded");
    },
    120_000,
  );
});
