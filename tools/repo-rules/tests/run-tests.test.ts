import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bunTestArgs, findTestFiles, planTests } from "../src/run-tests";
import { run, scratchDir, testFile, writeFiles } from "./helpers";

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
  beforeEach(() =>
    writeFiles(dir, {
      "pkg/tests/a.test.ts": "",
      "pkg/tests/b.test.ts": "",
      "pkg/tests/c.test.ts": "",
      "other/tests/a.test.ts": "",
    }),
  );

  test("leaves out listed files and collects listed names for this package only", () => {
    const list = [
      "pkg/tests/a.test.ts",
      "pkg/tests/b.test.ts::group one test",
      "other/tests/a.test.ts",
    ].join("\n");
    expect(planTests(dir, path.join(dir, "pkg"), list)).toEqual({
      files: ["tests/b.test.ts", "tests/c.test.ts"],
      skippedNames: ["group one test"],
      skipped: ["pkg/tests/a.test.ts", "pkg/tests/b.test.ts::group one test"],
    });
  });

  test("doesn't mistake a package whose name starts the same for this one", () => {
    writeFiles(dir, { "pkg-extra/tests/a.test.ts": "" });
    expect(planTests(dir, path.join(dir, "pkg"), "pkg-extra/tests/a.test.ts").files).toEqual([
      "tests/a.test.ts",
      "tests/b.test.ts",
      "tests/c.test.ts",
    ]);
  });

  test("fails on a listed file that doesn't exist, in any package", () => {
    expect(() => planTests(dir, path.join(dir, "pkg"), "other/tests/gone.test.ts")).toThrow(
      "lists files that don't exist:\n  line 1: other/tests/gone.test.ts",
    );
  });

  test("fails on a malformed list", () => {
    expect(() => planTests(dir, path.join(dir, "pkg"), "pkg/tests/a.ts")).toThrow("is not a test file name");
  });
});

describe("bunTestArgs", () => {
  test("passes the remaining files by path, after the caller's options", () => {
    const plan = { files: ["tests/a.test.ts"], skippedNames: [], skipped: [] };
    expect(bunTestArgs(plan, ["--isolate"])).toEqual(["--no-env-file", "test", "--isolate", "./tests/a.test.ts"]);
  });

  test("skips listed names with a pattern that matches every other name, escaping regex characters", () => {
    const plan = { files: ["tests/a.test.ts"], skippedNames: ["costs (in $) add up", "x"], skipped: [] };
    expect(bunTestArgs(plan, [])).toEqual([
      "--no-env-file",
      "test",
      "--test-name-pattern=^(?!(?:costs \\(in \\$\\) add up|x)$)",
      "--pass-with-no-tests",
      "./tests/a.test.ts",
    ]);
  });

  test("returns null when every file is pending", () => {
    expect(bunTestArgs({ files: [], skippedNames: [], skipped: [] }, [])).toBeNull();
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
      "pkg/tests/plain.test.ts": testFile([{ name: "passes", passes: true }]),
    }),
  );

  function runPackage(list: string) {
    const args = bunTestArgs(planTests(dir, path.join(dir, "pkg"), list), []);
    if (args === null) throw new Error("expected tests to run");
    return run([process.execPath, ...args], path.join(dir, "pkg"));
  }

  test("skips the listed file and the listed test, and runs the rest", () => {
    const result = runPackage("pkg/tests/pending.test.ts\npkg/tests/mixed.test.ts::filters not built yet (part 1)");
    expect(result.output).toContain(" 2 pass");
    expect(result.output).toContain(" 0 fail");
    expect(result.exitCode).toBe(0);
  });

  test("fails once the list no longer covers a failing test", () => {
    const result = runPackage("pkg/tests/pending.test.ts");
    expect(result.output).toContain(" 1 fail");
    expect(result.exitCode).not.toBe(0);
  });
});
