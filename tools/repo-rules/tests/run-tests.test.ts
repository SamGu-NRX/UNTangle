import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bunTestArgs, findTestFiles, planTests, testedWorkspaces } from "../src/run-tests";
import { repoRoot, run, scratchDir, testFile, writeFiles } from "./helpers";

let dir: string;
let cleanup: () => void;
beforeEach(() => ({ dir, cleanup } = scratchDir()));
afterEach(() => cleanup());

describe("findTestFiles", () => {
  test("finds exactly the files `bun test` runs", () => {
    const names = [
      "a.test.ts", "b.test.tsx", "c.test.js", "d.test.jsx", "e.test.mjs", "f.test.mts", "g.test.cjs", "h.test.cts",
      "i_test.ts", "j.spec.ts", "k_spec.ts", "sub/deeper/l.test.ts",
      // Not test files, or in places Bun doesn't look.
      "helpers.ts", "m.tests.ts", "n-test.ts", "node_modules/pkg/o.test.ts", "sub/node_modules/p.test.ts",
      ".hidden/q.test.ts", "sub/.cache/r.test.ts",
    ];
    writeFiles(dir, Object.fromEntries(names.map((name) => [name, testFile([{ name, passes: true }])])));

    const report = path.join(dir, "junit.xml");
    const bun = run([process.execPath, "test", "--reporter=junit", `--reporter-outfile=${report}`], dir);
    expect(bun.exitCode).toBe(0);
    const bunRan = [...readFileSync(report, "utf8").matchAll(/<testsuite name="([^"]+\.\w+)"/g)].map((match) => match[1]).sort();

    expect(bunRan).toEqual(
      ["a.test.ts", "b.test.tsx", "c.test.js", "d.test.jsx", "e.test.mjs", "f.test.mts", "g.test.cjs", "h.test.cts",
        "i_test.ts", "j.spec.ts", "k_spec.ts", "sub/deeper/l.test.ts"].sort(),
    );
    expect(findTestFiles(dir)).toEqual(bunRan);
  });
});

describe("planTests", () => {
  const tested = ["pkg", "other", "pkg-extra"];
  beforeEach(() =>
    writeFiles(dir, {
      "pkg/tests/a.test.ts": "",
      "pkg/tests/b.test.ts": "",
      "pkg/tests/c.test.ts": "",
      "other/tests/a.test.ts": "",
    }),
  );

  test("leaves out listed files, and runs a file with listed names on its own", () => {
    const list = [
      "pkg/tests/a.test.ts",
      "pkg/tests/b.test.ts::group one test",
      "pkg/tests/b.test.ts::group another test",
      "other/tests/a.test.ts",
    ].join("\n");
    expect(planTests(dir, path.join(dir, "pkg"), list, tested)).toEqual({
      runs: [
        { files: ["tests/c.test.ts"], skippedNames: [] },
        { files: ["tests/b.test.ts"], skippedNames: ["group one test", "group another test"] },
      ],
      skipped: ["pkg/tests/a.test.ts", "pkg/tests/b.test.ts::group one test", "pkg/tests/b.test.ts::group another test"],
    });
  });

  test("doesn't mistake a package whose name starts the same for this one", () => {
    writeFiles(dir, { "pkg-extra/tests/a.test.ts": "" });
    expect(planTests(dir, path.join(dir, "pkg"), "pkg-extra/tests/a.test.ts", tested).runs).toEqual([
      { files: ["tests/a.test.ts", "tests/b.test.ts", "tests/c.test.ts"], skippedNames: [] },
    ]);
  });

  test("plans no run when every file is pending", () => {
    const list = "pkg/tests/a.test.ts\npkg/tests/b.test.ts\npkg/tests/c.test.ts";
    expect(planTests(dir, path.join(dir, "pkg"), list, tested).runs).toEqual([]);
  });

  test("fails on a listed file that doesn't exist, in any package", () => {
    expect(() => planTests(dir, path.join(dir, "pkg"), "other/tests/gone.test.ts", tested)).toThrow(
      "line 1: other/tests/gone.test.ts doesn't exist",
    );
  });

  test("fails on a listed file that no package's tests would ever run", () => {
    writeFiles(dir, { "tests/feature.test.ts": "" });
    expect(() => planTests(dir, path.join(dir, "pkg"), "tests/feature.test.ts", tested)).toThrow(
      "line 1: tests/feature.test.ts is in no workspace whose test script CI runs",
    );
  });

  test("fails on a malformed list", () => {
    expect(() => planTests(dir, path.join(dir, "pkg"), "pkg/tests/a.ts", tested)).toThrow("is not a test file name");
  });
});

describe("testedWorkspaces", () => {
  test("lists the workspaces whose test script runs the runner", () => {
    writeFiles(dir, {
      "package.json": JSON.stringify({ workspaces: ["app", "packages/*"] }),
      "app/package.json": JSON.stringify({ scripts: { test: "bun ../run-tests.ts --isolate" } }),
      "packages/a/package.json": JSON.stringify({ scripts: { test: "bun ../../run-tests.ts" } }),
      "packages/b/package.json": JSON.stringify({ scripts: { test: "bun test" } }),
      "packages/c/package.json": JSON.stringify({}),
    });
    expect(testedWorkspaces(dir).sort()).toEqual(["app", "packages/a"]);
  });

  test("covers every workspace in this repository", () => {
    expect(testedWorkspaces(repoRoot).sort()).toEqual([
      "frontend",
      "packages/contracts",
      "packages/core",
      "packages/ingest",
      "packages/sync",
      "packages/tokens",
      "tools/repo-rules",
    ]);
  });
});

describe("bunTestArgs", () => {
  test("passes the files by path, after the caller's options", () => {
    expect(bunTestArgs({ files: ["tests/a.test.ts"], skippedNames: [] }, ["--isolate"])).toEqual([
      "--no-env-file",
      "test",
      "--isolate",
      "./tests/a.test.ts",
    ]);
  });

  test("skips listed names with a pattern that matches every other name, escaping regex characters", () => {
    expect(bunTestArgs({ files: ["tests/a.test.ts"], skippedNames: ["costs (in $) add up", "x"] }, [])).toEqual([
      "--no-env-file",
      "test",
      "--test-name-pattern=^(?!(?:costs \\(in \\$\\) add up|x)$)",
      "--pass-with-no-tests",
      "./tests/a.test.ts",
    ]);
  });
});

describe("a run with a pending list", () => {
  // Every test that should be skipped throws, so the run only passes if the skips work.
  beforeEach(() =>
    writeFiles(dir, {
      "pkg/tests/pending.test.ts": testFile([{ name: "whole file pending", passes: false }]),
      "pkg/tests/mixed.test.ts": testFile(
        [
          { name: "not built yet (part 1)", passes: false },
          { name: "already works", passes: true },
        ],
        "filters",
      ),
      // Same full name as the pending test in mixed.test.ts, but not pending.
      "pkg/tests/same-name.test.ts": testFile([{ name: "not built yet (part 1)", passes: false }], "filters"),
      "pkg/tests/plain.test.ts": testFile([{ name: "passes", passes: true }]),
    }),
  );

  /** Every run the plan makes, as one exit code and the combined output. */
  function runPackage(list: string) {
    const results = planTests(dir, path.join(dir, "pkg"), list, ["pkg"]).runs.map((testRun) =>
      run([process.execPath, ...bunTestArgs(testRun, [])], path.join(dir, "pkg")),
    );
    return {
      failed: results.some((result) => result.exitCode !== 0),
      output: results.map((result) => result.output).join("\n"),
    };
  }

  test("skips the listed file and the listed test, and runs the rest", () => {
    const list = [
      "pkg/tests/pending.test.ts",
      "pkg/tests/same-name.test.ts",
      "pkg/tests/mixed.test.ts::filters not built yet (part 1)",
    ].join("\n");
    const result = runPackage(list);
    expect(result.output).not.toContain("(fail)");
    expect(result.failed).toBe(false);
  });

  test("keeps a pending name from skipping the same name in another file", () => {
    const result = runPackage("pkg/tests/pending.test.ts\npkg/tests/mixed.test.ts::filters not built yet (part 1)");
    expect(result.output).toContain("(fail) filters > not built yet (part 1)");
    expect(result.output).toContain("same-name.test.ts");
    expect(result.failed).toBe(true);
  });

  test("fails once the list no longer covers a failing test", () => {
    const result = runPackage("pkg/tests/same-name.test.ts\npkg/tests/mixed.test.ts::filters not built yet (part 1)");
    expect(result.output).toContain("(fail) whole file pending");
    expect(result.failed).toBe(true);
  });
});
