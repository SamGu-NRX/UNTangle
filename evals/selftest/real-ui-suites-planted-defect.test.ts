/**
 * Real-suite planted defects: journey, honesty, a11y-polish — SKIP-GUARDED.
 *
 * These three suites are mid-final-pass on another thread
 * (branch obv/untangle-evals-f1-ui-suites @ 98a1a21); the lead's steer
 * (2026-10-11): write their defect tests against the case IDs those suites
 * declare, but do NOT run heavy Playwright verification passes until the
 * suites have landed and the host is free — earlier concurrent full-stack
 * runs collided. Each test below is therefore skipped with its plant design
 * recorded; enabling one is: remove `test.skip` and run the same recipe as
 * the persistence-faults planted-defect test (real stack on the
 * /home/user/work/untangle-selftest-target checkout).
 *
 * All three suites observe the rendered DOM of the real app (Playwright),
 * so the plant for each is a runtime patch of the TARGET checkout's
 * frontend — a throwaway copy, never this repo's tree — that introduces the
 * defect the suite should catch:
 *
 *   journey        cases journey/<journey>-<persona>-<viewport>
 *                  (discover|instructor|build|save|plan|map|auth ×
 *                  guest|registered × desktop|mobile = 28 cases)
 *     plant: make "Continue as guest" inaccessible (remove the link's
 *     accessible name / switch to a bare div) → every case whose journey
 *     starts from the guest entry point fails with the suite's honest
 *     "contract element missing" note naming the element.
 *
 *   honesty        cases honesty/rmp-labels-when-unavailable,
 *                  honesty/sample-data-notice, honesty/stale-rating-notice,
 *                  honesty/unverified-savings-disclaimer,
 *                  honesty/no-fabricated-precision
 *     plant: strip the sample-data notice from the UI while the dataset is
 *     still sample data → honesty/sample-data-notice fails.
 *
 *   a11y-polish    cases a11y/keyboard-core-path, a11y/focus-indicator,
 *                  a11y/reduced-motion, a11y/no-horizontal-overflow-mobile,
 *                  a11y/image-icon-labeling
 *     plant: render an unlabeled icon-only control (alt=""/aria-hidden on a
 *     meaningful icon) → a11y/image-icon-labeling fails (axe "image-alt"
 *     style rule).
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
  type HarnessCopy,
} from "./helpers";

let root: string;
let harness: HarnessCopy;

beforeAll(() => {
  root = makeTempRoot("real-ui-suites");
  harness = makeHarnessCopy(root, { stubStack: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("real-suite planted defects: journey / honesty / a11y-polish (skip-guarded until those suites land)", () => {
  test.skip(
    "journey: an inaccessible guest entry point fails the guest cases with the contract element named in the note",
    async () => {
      // When enabled: patch the target copy's guest-entry control, run the
      // real runner with --suite journey on the real stack, and assert:
      //   - exit code 1, infrastructure.ok true;
      //   - for every case journey/<j>-guest-<v>: status "fail" and a note
      //     naming the missing "Continue as guest" element;
      //   - registered-persona cases are untouched by the plant (either pass
      //     or fail for their own reasons — assert only that the guest notes
      //     name the planted element).
      const target = makeFakeTarget(root, "target-journey-plant");
      const out = path.join(root, "journey-plant", "card.json");
      const r = await runRunner({
        harness,
        targetDir: target,
        suite: "journey",
        outPath: out,
        taskId: "selftest-real-journey",
        timeoutMs: 1_500_000,
      });
      const card = readCard(out) as Scorecard;
      validateScorecard(card);
      expect(r.code).toBe(1);
      expect(card.cases.filter((c) => c.id.startsWith("journey/") && c.id.includes("-guest-")).length)
        .toBe(14);
    },
    { timeout: 1_800_000 },
  );

  test.skip(
    "honesty: removing the sample-data notice fails honesty/sample-data-notice",
    async () => {
      // When enabled: patch the target copy's frontend so the sample-data
      // notice is not rendered while the dataset is still sample data, run
      // --suite honesty on the real stack, assert exit 1, infrastructure.ok
      // true, and that honesty/sample-data-notice fails with a note naming
      // the missing notice, while the other honesty cases keep their own
      // verdicts.
      const target = makeFakeTarget(root, "target-honesty-plant");
      const out = path.join(root, "honesty-plant", "card.json");
      const r = await runRunner({
        harness,
        targetDir: target,
        suite: "honesty",
        outPath: out,
        taskId: "selftest-real-honesty",
        timeoutMs: 1_500_000,
      });
      const card = readCard(out) as Scorecard;
      validateScorecard(card);
      expect(r.code).toBe(1);
      const notice = card.cases.find((c) => c.id === "honesty/sample-data-notice");
      expect(notice?.status).toBe("fail");
    },
    { timeout: 1_800_000 },
  );

  test.skip(
    "a11y-polish: an unlabeled icon-only control fails a11y/image-icon-labeling",
    async () => {
      // When enabled: patch the target copy's frontend to ship an unlabeled
      // icon-only control, run --suite a11y-polish on the real stack, assert
      // exit 1, infrastructure.ok true, and that a11y/image-icon-labeling
      // fails while the other a11y cases keep their own verdicts.
      const target = makeFakeTarget(root, "target-a11y-plant");
      const out = path.join(root, "a11y-plant", "card.json");
      const r = await runRunner({
        harness,
        targetDir: target,
        suite: "a11y-polish",
        outPath: out,
        taskId: "selftest-real-a11y",
        timeoutMs: 1_500_000,
      });
      const card = readCard(out) as Scorecard;
      validateScorecard(card);
      expect(r.code).toBe(1);
      const labeling = card.cases.find((c) => c.id === "a11y/image-icon-labeling");
      expect(labeling?.status).toBe("fail");
    },
    { timeout: 1_800_000 },
  );
});
