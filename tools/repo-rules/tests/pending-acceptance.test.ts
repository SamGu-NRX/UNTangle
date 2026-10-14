import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PENDING_LIST, PendingListError, parsePendingList } from "../src/pending-acceptance";
import { repoRoot } from "./helpers";

describe("parsePendingList", () => {
  test("reads file entries and named-test entries, skipping comments and blank lines", () => {
    const text = [
      "# comment",
      "",
      "packages/core/tests/filters.test.ts",
      "  packages/core/tests/weights.test.ts :: importance maps 5 to 4  ",
    ].join("\n");
    expect(parsePendingList(text)).toEqual([
      { kind: "file", path: "packages/core/tests/filters.test.ts", line: 3, text: "packages/core/tests/filters.test.ts" },
      {
        kind: "test",
        path: "packages/core/tests/weights.test.ts",
        name: "importance maps 5 to 4",
        line: 4,
        text: "packages/core/tests/weights.test.ts :: importance maps 5 to 4",
      },
    ]);
  });

  test.each([
    ["/packages/core/tests/a.test.ts", "must be a path from the repo root"],
    ["./packages/core/tests/a.test.ts", "must be a path from the repo root"],
    ["packages/core/../core/tests/a.test.ts", "must not contain .."],
    ["packages\\core\\tests\\a.test.ts", "must use / between directories"],
    ["packages/core/tests/helpers.ts", "is not a test file name Bun runs"],
    ["packages/core/tests/a.test.ts::", "has '::' but no test name after it"],
  ])("rejects %p", (line, problem) => {
    expect(() => parsePendingList(line)).toThrow(problem);
  });

  test("reports every bad line at once", () => {
    const text = "packages/core/tests/a.test.ts\npackages/core/tests/a.test.ts\nnot-a-test.ts";
    expect(() => parsePendingList(text)).toThrow(PendingListError);
    expect(() => parsePendingList(text)).toThrow('line 2: "packages/core/tests/a.test.ts" is listed twice');
    expect(() => parsePendingList(text)).toThrow('line 3: "not-a-test.ts" is not a test file name');
  });
});

test("the repository's own list parses", () => {
  const text = readFileSync(path.join(repoRoot, PENDING_LIST), "utf8");
  expect(() => parsePendingList(text)).not.toThrow();
});
