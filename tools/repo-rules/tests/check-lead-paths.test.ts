import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LEAD_OWNED_PATHS,
  isAgentBranch,
  leadOwnedPathsTouched,
  parseLeadOwnedPaths,
} from "../src/check-lead-paths";
import { git, initRepo } from "./git-repo";
import { repoRoot, run, scratchDir, writeFiles } from "./helpers";

const realPatterns = parseLeadOwnedPaths(readFileSync(path.join(repoRoot, LEAD_OWNED_PATHS), "utf8"));
const modified = (filePath: string) => ({ status: "M", path: filePath });

describe("the repository's lead-owned paths", () => {
  test.each([
    "package.json",
    "bun.lock",
    "turbo.json",
    "packages/core/package.json",
    "packages/core/tsconfig.json",
    "packages/contracts/src/ids.ts",
    "packages/sync/src/engine.ts",
    "packages/tokens/src/index.ts",
    "frontend/drizzle/0010_documents.sql",
    "frontend/src/app/api/planner/route.ts",
    "frontend/src/lib/persistence.ts",
    "frontend/src/app/api/v1/sync/route.ts",
    "frontend/src/lib/auth-config.ts",
    "frontend/src/lib/auth.ts",
    "frontend/src/app/api/auth/[...all]/route.ts",
    "frontend/src/components/planner-provider.tsx",
    "frontend/src/components/shell/AppShell.tsx",
    "frontend/src/app/layout.tsx",
    "frontend/src/components/auth-client.tsx",
    "frontend/src/components/forgot-password-client.tsx",
    "frontend/src/app/auth/page.tsx",
    "frontend/src/app/forgot-password/page.tsx",
    "frontend/src/components/ui/Button.tsx",
    ".github/workflows/ci.yml",
    ".github/lead-owned-paths.txt",
    "tools/repo-rules/src/check-lead-paths.ts",
  ])("claim %s", (filePath) => {
    expect(leadOwnedPathsTouched(realPatterns, [modified(filePath)])).toHaveLength(1);
  });

  test.each([
    "packages/core/src/planner.ts",
    "packages/core/tests/planner.test.ts",
    "packages/ingest/src/sections.ts",
    "frontend/src/components/courses/model/filters.ts",
    "frontend/src/lib/optimizer/optimize.ts",
    "frontend/tests/planner-core.test.ts",
    "tests/pending-acceptance.txt",
    "docs/design/surfaces.md",
    "data/plans/cs-2026.json",
  ])("leave %s to agents", (filePath) => {
    expect(leadOwnedPathsTouched(realPatterns, [modified(filePath)])).toEqual([]);
  });
});

describe("leadOwnedPathsTouched", () => {
  test("names each touched path once, with the first glob that claims it", () => {
    const patterns = ["packages/contracts/**", "packages/*/package.json"];
    const changes = [
      modified("packages/contracts/package.json"),
      modified("packages/contracts/package.json"),
      modified("packages/core/src/a.ts"),
    ];
    expect(leadOwnedPathsTouched(patterns, changes)).toEqual([
      { path: "packages/contracts/package.json", pattern: "packages/contracts/**" },
    ]);
  });

  test("counts both sides of a rename, so a file can't be moved out of a lead path", () => {
    const changes = [{ status: "R", previousPath: "packages/contracts/src/ids.ts", path: "packages/core/src/ids.ts" }];
    expect(leadOwnedPathsTouched(["packages/contracts/**"], changes)).toEqual([
      { path: "packages/contracts/src/ids.ts", pattern: "packages/contracts/**" },
    ]);
  });
});

describe("parseLeadOwnedPaths", () => {
  test("rejects a glob written from / or ./", () => {
    expect(() => parseLeadOwnedPaths("/package.json\n./bun.lock")).toThrow(
      '.github/lead-owned-paths.txt has problems:\n  line 1: "/package.json" must be a glob from the repo root, with / between directories\n  line 2: "./bun.lock"',
    );
  });

  test("rejects a list with no paths, which would turn the check off", () => {
    expect(() => parseLeadOwnedPaths("# nothing\n")).toThrow("lists no paths");
  });
});

test.each([
  ["obv/filters", true],
  ["obv/", true],
  ["untangle/foundations", false],
  ["fix/obv/filters", false],
  ["obvious/filters", false],
])("isAgentBranch(%p) is %p", (ref, expected) => {
  expect(isAgentBranch(ref)).toBe(expected);
});

describe("the check, run against real commits", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = scratchDir());
    initRepo(dir, {
      [LEAD_OWNED_PATHS]: "package.json\npackages/contracts/**\n",
      "package.json": "{}\n",
      "packages/contracts/src/ids.ts": "export {};\n",
      "packages/core/src/planner.ts": "export {};\n",
    });
  });
  afterEach(() => cleanup());

  const script = path.resolve(import.meta.dir, "../src/check-lead-paths.ts");
  function check(headRef: string) {
    return run([process.execPath, "--no-env-file", script], dir, {
      BASE_SHA: "base",
      HEAD_SHA: git(dir, ["rev-parse", "HEAD"]),
      HEAD_REF: headRef,
    });
  }
  function commit(files: Record<string, string>) {
    writeFiles(dir, files);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "change"]);
  }

  test("fails an agent PR that touches a lead-owned path, and names it", () => {
    commit({ "packages/contracts/src/ids.ts": "export const changed = 1;\n" });
    const result = check("obv/filters");
    expect(result.output).toContain("packages/contracts/src/ids.ts (packages/contracts/**)");
    expect(result.output).toContain("Only Sam's approving review of the PR's current commit lifts this check.");
    expect(result.exitCode).toBe(1);
  });

  test("passes an agent PR that stays out of lead-owned paths", () => {
    commit({ "packages/core/src/planner.ts": "export const changed = 1;\n" });
    const result = check("obv/filters");
    expect(result.output).toContain("The PR touches no lead-owned path.");
    expect(result.exitCode).toBe(0);
  });

  test("judges by the base branch's list, so a PR can't shorten it", () => {
    commit({ [LEAD_OWNED_PATHS]: "nothing-here\n", "package.json": '{ "name": "x" }\n' });
    const result = check("obv/filters");
    expect(result.output).toContain("  package.json (package.json)");
    expect(result.exitCode).toBe(1);
  });


  test("ignores branches that aren't agent branches", () => {
    commit({ "package.json": '{ "name": "x" }\n' });
    const result = check("untangle/foundations");
    expect(result.output).toContain("Skipped: untangle/foundations is not an agent branch (obv/*).");
    expect(result.exitCode).toBe(0);
  });
});
