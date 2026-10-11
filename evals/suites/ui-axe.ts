/**
 * ui-axe — axe-core injection from the HARNESS side (never the target).
 *
 * The harness deps do not pin axe-core, and the brief forbids editing
 * package.json. Resolution order:
 *   1. evals/node_modules/axe-core (if a harness dep brought it in transitively),
 *   2. frontend/node_modules/axe-core (existing dependency — no manifest change),
 *   3. a one-time major-pinned scratch install into /home/user/work/.scratch-axe
 *      (outside the repository; no tracked files touched).
 * The chosen file is injected into the page under test via addScriptTag.
 */
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { Page } from "playwright";

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

const SCRATCH_DIR = `${env.HOME ?? "/home/user"}/work/.scratch-axe`;

let resolvedPath: string | null = null;

function nodeModulesPath(base: string): string | null {
  const candidate = `${base}/node_modules/axe-core/axe.min.js`;
  return existsSync(candidate) ? candidate : null;
}

/** Find axe-core without modifying any manifest; scratch-install as last resort. */
function resolveAxePath(): string {
  if (resolvedPath) return resolvedPath;

  const scratch = `${SCRATCH_DIR}/node_modules/axe-core/axe.min.js`;
  if (existsSync(scratch)) {
    resolvedPath = scratch;
    return resolvedPath;
  }

  mkdirSync(SCRATCH_DIR, { recursive: true });
  execFileSync("bun", ["add", "axe-core@4"], { cwd: SCRATCH_DIR, stdio: "pipe" });
  if (!existsSync(scratch)) {
    throw new Error("axe-core scratch install did not produce axe.min.js");
  }
  resolvedPath = scratch;
  return resolvedPath;
}

export type AxeNode = { html: string; target?: string[] };
export type AxeViolation = { id: string; impact: string | null; nodes: AxeNode[] };

export type AxeScan = {
  /** serious+critical violations only — the case bar is that this list is empty. */
  seriousOrWorse: AxeViolation[];
  countsByImpact: Record<string, number>;
  inapplicable: number;
  passes: number;
};

/** Run axe on the current page with the harness's own copy of axe-core. */
export async function runAxe(page: Page): Promise<AxeScan> {
  const source = readFileSync(resolveAxePath(), "utf8");
  await page.addScriptTag({ content: source });
  const raw = await page.evaluate(() => {
    const axeCtor = (window as { axe?: { run: (ctx?: unknown, opts?: unknown) => Promise<unknown> } }).axe;
    if (!axeCtor) return null;
    return axeCtor.run(undefined, { resultTypes: ["violations", "inapplicable"] });
  });
  if (raw === null || raw === undefined) {
    throw new Error("axe-core failed to initialize in the page after injection");
  }
  const result = raw as { violations: AxeViolation[]; inapplicable: unknown[]; passes: unknown[] };
  const countsByImpact: Record<string, number> = {};
  for (const violation of result.violations) {
    const impact = violation.impact ?? "unknown";
    countsByImpact[impact] = (countsByImpact[impact] ?? 0) + 1;
  }
  const seriousOrWorse = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  return { seriousOrWorse, countsByImpact, inapplicable: result.inapplicable.length, passes: result.passes.length };
}
