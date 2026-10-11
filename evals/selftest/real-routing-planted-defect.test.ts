/**
 * Real-suite planted defect: routing.
 *
 * The routing suite's boundary is the app's POST /api/map/resolve and
 * /api/map/route endpoints (evals/suites/routing.ts): it POSTs the fixture
 * roster, checks resolution status/coords, then checks every reported
 * distance against a great-circle floor (the walk-speed bar means no
 * honest path can be shorter than the straight line).
 *
 * These tests point the stubbed-stack harness copy at a throwaway HTTP app
 * implementing that boundary — the lead's "mutated /api/map/route response"
 * defect — and assert the REAL suite's verdicts:
 *
 *   healthy app (legal distances)  -> 3 x pass                     -> exit 0
 *   planted sub-geodesic distances -> route-geodesic-floor FAILS
 *     ("< great-circle" note) while building coverage and latency still
 *     pass                                                   -> exit 1
 *
 * The suite paces one request per ~1.05 s (54 fixture requests), so each
 * run takes ~1.5-2 minutes wall clock.
 *
 * Run: bun test evals/selftest/real-routing-planted-defect.test.ts
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
  startFakeRoutingApp,
  type FakeRoutingApp,
  type HarnessCopy,
} from "./helpers";

let root: string;
let harness: HarnessCopy;
let app: FakeRoutingApp | null = null;

beforeAll(() => {
  root = makeTempRoot("real-routing");
  harness = makeHarnessCopy(root, { stubStack: true });
});

afterAll(async () => {
  if (app !== null) await app.stop();
  rmSync(root, { recursive: true, force: true });
});

async function runRouting(targetDir: string, out: string): Promise<{ code: number | null; card: Scorecard; stderr: string }> {
  if (app === null) throw new Error("fake routing app not started");
  const r = await runRunner({
    harness,
    targetDir,
    suite: "routing",
    outPath: out,
    taskId: "selftest-real-routing",
    timeoutMs: 240_000,
    // The routing suite resolves its base URL as
    // env.UNTANGLE_BASE_URL ?? ctx.frontendOrigin ?? the dev default
    // (suites/routing.ts); the suite's own standalone knob points it at the
    // fake app (nothing listens on the stub stack's port).
    env: { UNTANGLE_BASE_URL: app.origin },
  });
  return { code: r.code, card: readCard(out) as Scorecard, stderr: r.stderr };
}

function caseRecord(card: Scorecard, caseId: string) {
  const record = card.cases.find((c) => c.id === caseId);
  expect(record).toBeDefined();
  return record as NonNullable<(typeof card.cases)[number]>;
}

describe("real-suite planted defect: routing", () => {
  test(
    "healthy fake app (legal distances): all three routing cases pass and the run exits 0",
    async () => {
      const target = makeFakeTarget(root, "target-routing-clean");
      app = startFakeRoutingApp(harness);
      const out = path.join(root, "clean", "card.json");
      const { code, card } = await runRouting(target, out);
      await app.stop();
      app = null;

      expect(code).toBe(0);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);
      expect(card.cases.map((c) => c.id).sort()).toEqual([
        "building-coverage",
        "route-geodesic-floor",
        "route-latency",
      ]);
      for (const record of card.cases) {
        expect(record.status).toBe("pass");
      }
    },
    { timeout: 300_000 },
  );

  test(
    "planted /api/map/route returning sub-geodesic distances: route-geodesic-floor fails naming the violation while building-coverage still passes; run exits 1",
    async () => {
      const target = makeFakeTarget(root, "target-routing-plant");
      app = startFakeRoutingApp(harness, { plantSubGeodesic: true });
      const out = path.join(root, "planted", "card.json");
      const { code, card } = await runRouting(target, out);
      await app.stop();
      app = null;

      expect(code).toBe(1);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);

      const floor = caseRecord(card, "route-geodesic-floor");
      expect(floor.status).toBe("fail");
      // The suite's measured for geodesic-floor is a structured object
      // ({pairs, violations, minDistanceOverGreatCircle, observedSources}).
      const m = floor.measured as unknown as { violations: number };
      expect(m.violations).toBeGreaterThanOrEqual(1);
      // The fail note carries the violation verbatim:
      // "<pair>: distanceMeters <d> < great-circle <gc>".
      expect(floor.note).toContain("< great-circle");

      // The plant only mutated /api/map/route: resolution and latency are
      // unaffected, so those cases still pass (specificity, not a blanket fail).
      const coverage = caseRecord(card, "building-coverage");
      expect(coverage.status).toBe("pass");
      const latency = caseRecord(card, "route-latency");
      expect(latency.status).toBe("pass");
    },
    { timeout: 300_000 },
  );
});
