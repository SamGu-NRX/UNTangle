/**
 * Real-suite planted defects: journey, honesty, a11y-polish (full real stack).
 *
 * The lead's requirement: a harness that only fails on a fake suite proves
 * nothing about the real ones. Each UI suite gets one defect planted at the
 * boundary that suite actually observes, then the REAL suite runs on the REAL
 * stack and the named case must FAIL with a nonzero runner exit:
 *
 *   journey      — the landing's "Continue as guest" <Link> becomes a bare
 *                  <div> (same text, no link role): every guest journey case
 *                  fails at persona activation (journey.ts drives
 *                  getByRole("link", { name: "Continue as guest" })).
 *   honesty      — /schedule claims "100% accurate — guaranteed optimal —
 *                  perfect schedule": no-fabricated-precision fails naming the
 *                  matched phrase (honesty.ts reads /schedule body text).
 *   a11y-polish  — /courses ships an informative image with empty alt text
 *                  not marked decorative: image-icon-labeling fails ("img
 *                  with empty alt not marked decorative").
 *
 * The suites landed on the integration branch at 17dd066; case IDs are
 * derived from the suites' own describe() where practical so the tests track
 * the landed definitions instead of a hardcoded count.
 *
 * Heavy: each test boots the full real stack (Postgres, backend build,
 * frontend build, a real browser) — ~10-25 min cold, less warm. Gate:
 * SELFTEST_HEAVY=1, run ONE SUITE AT A TIME (never concurrently with other
 * Playwright work on this shared 2-core host):
 *
 *   SELFTEST_HEAVY=1 bun test selftest/real-ui-suites-planted-defect.test.ts -t journey
 *   SELFTEST_HEAVY=1 bun test selftest/real-ui-suites-planted-defect.test.ts -t honesty
 *   SELFTEST_HEAVY=1 bun test selftest/real-ui-suites-planted-defect.test.ts -t a11y-polish
 *
 * Run evidence (scorecard JSON + runner stdout) lands in
 * /home/user/work/ui-plant-runs/<ts>/ and is treated as the primary evidence
 * for the report.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateScorecard } from "../scorecard";
import type { CaseRecord, Scorecard } from "../scorecard";
import { EVALS_DIR, REPO_RUN_TS, spawnBounded, type SpawnResult } from "./helpers";

/** Persistent target checkout (a local clone of this repo) — shared with the persistence-faults test; serial runs only. */
const TARGET_DIR = "/home/user/work/untangle-selftest-target";
const RUNS_DIR = "/home/user/work/ui-plant-runs";
const REPO_ROOT = "/home/user/work/clone-selftests";

const LANDING_CLIENT = "frontend/src/components/landing-client.tsx";
const SCHEDULE_PAGE = "frontend/src/app/schedule/page.tsx";
const COURSES_PAGE = "frontend/src/app/courses/page.tsx";

let targetSha = "";
const runDirs: string[] = [];

/** Heavy gate: full real-stack recipes run only under SELFTEST_HEAVY=1. */
const HEAVY = process.env.SELFTEST_HEAVY === "1";

/** Files planted during a test, with their original contents, for try/finally revert. */
const plantedFiles: Array<{ relPath: string; original: string | null }> = [];

beforeAll(async () => {
  // Plain (non-heavy) runs skip every test below; do not clone the real
  // target (or init its submodule) just to skip all of them.
  if (!HEAVY) return;
  if (!existsSync(path.join(TARGET_DIR, ".git"))) {
    const clone = await spawnBounded("git", [
      "clone", "--local", "--branch", "obv/untangle-evals-f1-selftests",
      REPO_ROOT, TARGET_DIR,
    ], { timeoutMs: 300_000 });
    if (clone.code !== 0) throw new Error(`cloning the UI-plant target failed: ${clone.stderr.slice(-500)}`);
  }
  const sub = await spawnBounded("git", ["submodule", "update", "--init", "backend"], {
    cwd: TARGET_DIR, timeoutMs: 600_000,
  });
  if (sub.code !== 0) throw new Error(`submodule init failed: ${sub.stderr.slice(-500)}`);
  const sha = await spawnBounded("git", ["rev-parse", "HEAD"], { cwd: TARGET_DIR, timeoutMs: 15_000 });
  if (sha.code !== 0) throw new Error(`rev-parse failed: ${sha.stderr.slice(-300)}`);
  targetSha = sha.stdout.trim();
  mkdirSync(RUNS_DIR, { recursive: true });
});

afterAll(() => {
  revertAll();
});

/** Replace one exact occurrence of `find` in a target file; throws if the anchor is missing or ambiguous. */
function plant(relPath: string, find: string, replace: string): void {
  const abs = path.join(TARGET_DIR, relPath);
  if (!existsSync(abs)) throw new Error(`plant anchor file missing: ${relPath}`);
  let source = readFileSync(abs, "utf8");
  if (source.split(find).length !== 2 && source.includes(replace)) {
    // A previous run was killed between plant and revert (its process never
    // reached the try/finally). Restore the file from git so the plant starts
    // from the clean checkout instead of failing on its own leftover.
    const restore = spawnSync("git", ["checkout", "--", relPath], { cwd: TARGET_DIR, timeout: 30_000 });
    if (restore.status !== 0) {
      throw new Error(`restoring a stale plant in ${relPath} failed: ${restore.stderr?.toString().slice(-300)}`);
    }
    source = readFileSync(abs, "utf8");
  }
  const parts = source.split(find);
  if (parts.length !== 2) {
    throw new Error(`plant anchor in ${relPath} must match exactly once, found ${parts.length - 1}`);
  }
  if (!plantedFiles.some((p) => p.relPath === relPath)) {
    plantedFiles.push({ relPath, original: source });
  }
  writeFileSync(abs, parts[0] + replace + parts[1]);
}

/** Restore every planted file; deletes files the plants created. */
function revertAll(): void {
  for (const { relPath, original } of plantedFiles.reverse()) {
    const abs = path.join(TARGET_DIR, relPath);
    if (original === null) {
      if (existsSync(abs)) unlinkSync(abs);
    } else {
      writeFileSync(abs, original);
    }
  }
  plantedFiles.length = 0;
}

async function runSuite(suite: string): Promise<SpawnResult> {
  const taskId = `selftest-ui-plant-${suite}-${Date.now()}`;
  const outDir = path.join(RUNS_DIR, String(Date.now()));
  mkdirSync(outDir, { recursive: true });
  runDirs.push(outDir);
  return spawnBounded(
    process.execPath,
    [
      REPO_RUN_TS,
      "--target-dir", TARGET_DIR,
      "--target-sha", targetSha,
      "--suite", suite,
      "--out", path.join(outDir, "card.json"),
      "--task-id", taskId,
    ],
    { cwd: EVALS_DIR, timeoutMs: 2_400_000 },
  );
}

function readCard(): Scorecard {
  const dir = runDirs[runDirs.length - 1];
  return JSON.parse(readFileSync(path.join(dir, "card.json"), "utf8")) as Scorecard;
}

function caseById(card: Scorecard, id: string): CaseRecord | undefined {
  return card.cases.find((c) => c.id === id);
}

function noteOf(c: CaseRecord | undefined): string {
  return c?.note ?? "";
}

describe("real-suite planted defect: journey (full real stack, broken guest entry)", () => {
  test.skipIf(!HEAVY)(
    "bare-div guest entry: exit 1, infrastructure.ok true, every guest journey case failing",
    async () => {
      plant(
        LANDING_CLIENT,
        `          <Link href="/courses" className="btn-primary">
            Continue as guest
          </Link>`,
        `          {/* planted defect: the guest entry lost its link role */}
          <div className="btn-primary">Continue as guest</div>`,
      );
      let r: SpawnResult;
      try {
        r = await runSuite("journey");
      } finally {
        revertAll();
      }

      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(1);
      validateScorecard(JSON.parse(readFileSync(path.join(runDirs[runDirs.length - 1], "card.json"), "utf8")));
      const card = readCard();

      // The defect is a CASE failure, not an infrastructure failure: every
      // stack step passed and the run honestly blamed the cases.
      expect(card.infrastructure.ok).toBe(true);
      expect(card.stack.every((s) => s.status === "pass")).toBe(true);

      // Case IDs derived from the landed suite definition: every guest case
      // fails (they all start by activating the guest persona via the link
      // the plant removed).
      const { default: journeySuite } = await import("../suites/journey");
      const specs = await journeySuite.describe();
      const guestIds = specs
        .map((c) => c.id)
        .filter((id) => /^journey\/.+-(guest)-(desktop|mobile)$/.test(id));
      expect(guestIds.length).toBeGreaterThan(0);

      for (const id of guestIds) {
        const c = caseById(card, id);
        expect(c).toBeDefined();
        expect(c?.status).toBe("fail");
      }

      // The failures name the boundary the plant broke (the persona
      // activation locator is in the harness error the case recorded).
      const withEvidence = guestIds.filter((id) => /Continue as guest/i.test(noteOf(caseById(card, id))));
      expect(withEvidence.length).toBeGreaterThan(0);
    },
    2_700_000,
  );
});

describe("real-suite planted defect: honesty (full real stack, fabricated precision on /schedule)", () => {
  test.skipIf(!HEAVY)(
    "precision overclaim: exit 1, infrastructure.ok true, no-fabricated-precision failing and naming the phrase",
    async () => {
      plant(
        SCHEDULE_PAGE,
        "  return <ScheduleClient />;",
        `  return (
    <div>
      {/* planted defect: fabricated precise guarantees */}
      <p>100% accurate — guaranteed optimal — perfect schedule.</p>
      <ScheduleClient />
    </div>
  );`,
      );
      let r: SpawnResult;
      try {
        r = await runSuite("honesty");
      } finally {
        revertAll();
      }

      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(1);
      validateScorecard(JSON.parse(readFileSync(path.join(runDirs[runDirs.length - 1], "card.json"), "utf8")));
      const card = readCard();

      expect(card.infrastructure.ok).toBe(true);
      expect(card.stack.every((s) => s.status === "pass")).toBe(true);

      const fabricated = caseById(card, "honesty/no-fabricated-precision");
      expect(fabricated).toBeDefined();
      expect(fabricated?.status).toBe("fail");
      expect(noteOf(fabricated)).toContain("100% accurate");
    },
    2_700_000,
  );
});

describe("real-suite planted defect: a11y-polish (full real stack, unlabeled informative image on /courses)", () => {
  test.skipIf(!HEAVY)(
    "empty-alt informative image: exit 1, infrastructure.ok true, image-icon-labeling failing",
    async () => {
      plant(
        COURSES_PAGE,
        "  return <CoursesClient />;",
        `  return (
    <div>
      {/* planted defect: informative image shipped without alt text */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" />
      <CoursesClient />
    </div>
  );`,
      );
      let r: SpawnResult;
      try {
        r = await runSuite("a11y-polish");
      } finally {
        revertAll();
      }

      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(1);
      validateScorecard(JSON.parse(readFileSync(path.join(runDirs[runDirs.length - 1], "card.json"), "utf8")));
      const card = readCard();

      expect(card.infrastructure.ok).toBe(true);
      expect(card.stack.every((s) => s.status === "pass")).toBe(true);

      const labeling = caseById(card, "a11y/image-icon-labeling");
      expect(labeling).toBeDefined();
      expect(labeling?.status).toBe("fail");
      expect(noteOf(labeling)).toContain("empty alt");
    },
    2_700_000,
  );
});
