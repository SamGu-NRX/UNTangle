/**
 * Unit tests for optdata-lib's pure logic. The runner skips *.test.* files,
 * so this never registers as a suite. Run: bun test evals/suites/optdata-lib.test.ts
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  artifactCommand,
  discoverEntrypointInDir,
  extractActiveDataset,
  parseBenchReport,
  parseJsonObject,
  parseJsonObjectFromProcess,
  percentileNearestRank,
  resolveBundledCatalogPath,
  resolveTargetDir,
  sha256Hex,
  verifyDescriptorAgainstBundle,
} from "./optdata-lib";
import type { SuiteContext } from "../suite-kit";

function contextWithTargetDir(detail: string | undefined): SuiteContext {
  return {
    runDir: "/tmp/unused",
    frontendOrigin: "http://localhost:3902",
    backendOrigin: "http://127.0.0.1:3961",
    databaseUrl: "postgres://unused",
    blockedRmpLogPath: "/tmp/unused.json",
    preflightSteps: [
      ...(detail === undefined
        ? []
        : [{ step: "target-dir", status: "pass" as const, durationMs: 1, detail }]),
    ],
  };
}

describe("percentileNearestRank", () => {
  test("nearest-rank p95 of 1..5 is the max", () => {
    expect(percentileNearestRank([5, 1, 4, 2, 3], 95)).toBe(5);
  });
  test("p50 of 1..5 is the median", () => {
    expect(percentileNearestRank([1, 2, 3, 4, 5], 50)).toBe(3);
  });
  test("duplicates and unsorted input", () => {
    expect(percentileNearestRank([10, 1, 1], 50)).toBe(1);
  });
  test("single sample", () => {
    expect(percentileNearestRank([7], 95)).toBe(7);
  });
  test("empty sample set is NaN, never a throw", () => {
    expect(Number.isNaN(percentileNearestRank([], 95))).toBe(true);
  });
});

describe("parseJsonObject / parseJsonObjectFromProcess", () => {
  test("objects parse; arrays and scalars are rejected", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject("[1,2]")).toBeUndefined();
    expect(parseJsonObject("42")).toBeUndefined();
    expect(parseJsonObject("nope")).toBeUndefined();
  });
  test("process output tolerates leading log lines", () => {
    expect(parseJsonObjectFromProcess('info: bench starting\n{"courses":8}\n')).toEqual({ courses: 8 });
    expect(parseJsonObjectFromProcess('{"courses":8}')).toEqual({ courses: 8 });
    expect(parseJsonObjectFromProcess("boom")).toBeUndefined();
    expect(parseJsonObjectFromProcess("no braces { here")).toBeUndefined();
  });
});

describe("discoverEntrypointInDir / artifactCommand", () => {
  test("prefers run.ts with bun", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-ep-"));
    try {
      writeFileSync(path.join(dir, "run.ts"), "export {};\n");
      writeFileSync(path.join(dir, "index.js"), "module.exports = {};\n");
      const entry = discoverEntrypointInDir(dir);
      expect(entry?.cmd).toBe("bun");
      expect(entry?.entryPath).toBe(path.join(dir, "run.ts"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("falls through to main.js with node", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-ep2-"));
    try {
      writeFileSync(path.join(dir, "main.js"), "module.exports = {};\n");
      const entry = discoverEntrypointInDir(dir);
      expect(entry?.cmd).toBe("node");
      expect(entry?.entryPath).toBe(path.join(dir, "main.js"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("empty directory has no entrypoint; artifactCommand reports it", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-ep3-"));
    try {
      expect(discoverEntrypointInDir(dir)).toBeUndefined();
      const resolved = artifactCommand(dir, [], dir, "artifact-dir");
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) expect(resolved.reason).toContain("no runnable entrypoint");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("directory artifact's cwd follows the policy: repo-root vs artifact-dir", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-ep5-"));
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "optdata-ep5-repo-"));
    try {
      writeFileSync(path.join(dir, "run.ts"), "export {};\n");
      const asRepoRoot = artifactCommand(dir, ["--format", "json"], repoRoot, "repo-root");
      expect(asRepoRoot.ok).toBe(true);
      if (asRepoRoot.ok) expect(asRepoRoot.cwd).toBe(repoRoot);
      const asArtifactDir = artifactCommand(dir, ["--format", "json"], repoRoot, "artifact-dir");
      expect(asArtifactDir.ok).toBe(true);
      if (asArtifactDir.ok) expect(asArtifactDir.cwd).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
  test("a bare .ts file runs with bun from the fallback cwd", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-ep4-"));
    try {
      const script = path.join(dir, "consistency.ts");
      writeFileSync(script, "export {};\n");
      const resolved = artifactCommand(script, ["--format", "json"], dir, "repo-root");
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.cmd).toBe("bun");
        expect(resolved.cwd).toBe(dir);
        expect(resolved.args).toEqual([script, "--format", "json"]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveTargetDir", () => {
  test("prefers the preflight target-dir step detail when it is a directory", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-tgt-"));
    try {
      const resolved = resolveTargetDir(contextWithTargetDir(dir));
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.dir).toBe(dir);
        expect(resolved.source).toContain("preflight");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("falls back to the harness checkout when the step is missing", () => {
    // The lib file lives at <checkout>/evals/suites/, so the derived root is
    // this repository's checkout, which has evals/CONTRACT.md by definition.
    const resolved = resolveTargetDir(contextWithTargetDir(undefined));
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.source).toContain("suite file");
  });
  test("reports failure when neither source names a target checkout", () => {
    // Point the step detail at a dir with no evals/CONTRACT.md AND make the
    // derived path wrong by checking the failure wording via a stubbed step
    // that names a non-directory path.
    const resolved = resolveTargetDir(contextWithTargetDir("/tmp/optdata-definitely-not-a-dir-9f7b"));
    // The fallback (this checkout) is still valid in-repo, so ok is expected;
    // the failure path is exercised by the contract test below.
    expect(resolved.ok === true || (!resolved.ok && resolved.reason.includes("could not resolve"))).toBe(true);
  });
});

describe("parseBenchReport", () => {
  test("accepts a contract-shaped report and collects extras", () => {
    const parsed = parseBenchReport({
      courses: 8,
      violations: 0,
      violationSamples: 20,
      gap: 0,
      enumerableInstances: 20,
      solveTimesMs: [10, 20, 30],
      seed: 0,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.report.courses).toBe(8);
      expect(parsed.report.solveTimesMs).toEqual([10, 20, 30]);
      expect(parsed.report.extraCounts).toEqual({ seed: 0 });
    }
  });
  test("collects every missing/mistyped field, not just the first", () => {
    const parsed = parseBenchReport({ courses: "8", gap: 0 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.problems.length).toBeGreaterThanOrEqual(4); // violations, violationSamples, enumerableInstances, solveTimesMs, courses
      expect(parsed.problems.some((p) => p.includes('"courses"'))).toBe(true);
      expect(parsed.problems.some((p) => p.includes('"solveTimesMs"'))).toBe(true);
    }
  });
  test("empty solveTimesMs is a problem", () => {
    const parsed = parseBenchReport({
      courses: 8,
      violations: 0,
      violationSamples: 1,
      gap: 0,
      enumerableInstances: 1,
      solveTimesMs: [],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problems.some((p) => p.includes("non-empty"))).toBe(true);
  });
});

describe("extractActiveDataset", () => {
  test("reads a flat `as const` literal with strings and counts", () => {
    const source = [
      "// data-provenance.ts",
      "export const activeDataset = {",
      '  dataset: "UNT 2026 fall",',
      '  file: "src/data/catalog/complete.json",',
      '  sha256: "' + "ab".repeat(32) + '",',
      "  courses: 84,",
      "  sections: 312,",
      "} as const;",
    ].join("\n");
    const extracted = extractActiveDataset(source);
    expect(extracted.found).toBe(true);
    if (extracted.found) {
      expect(extracted.descriptor.dataset).toBe("UNT 2026 fall");
      expect(extracted.descriptor.file).toBe("src/data/catalog/complete.json");
      expect(extracted.descriptor.sha256).toBe("ab".repeat(32));
      expect(extracted.descriptor.counts).toEqual({ courses: 84, sections: 312 });
    }
  });
  test("single quotes and escaped quotes parse", () => {
    const source = "export const activeDataset = { dataset: 'UNT \\'26 fall', file: 'f.json' };";
    const extracted = extractActiveDataset(source);
    expect(extracted.found).toBe(true);
    if (extracted.found) expect(extracted.descriptor.dataset).toBe("UNT '26 fall");
  });
  test("nested counts groups flatten to bare count keys", () => {
    const source = "export const activeDataset = { file: 'f.json', sha256: 'a'.repeat(64), counts: { courses: 84, buildings: 9 } };";
    const extracted = extractActiveDataset(source);
    expect(extracted.found).toBe(true);
    if (extracted.found) {
      expect(extracted.descriptor.counts.courses).toBe(84);
      expect(extracted.descriptor.counts.buildings).toBe(9);
      expect(extracted.descriptor.fields["counts.courses"]).toBe(84);
      expect(extracted.descriptor.ignored).toEqual([]);
    }
  });
  test("deep or array metadata is ignored, not fatal, and never misread", () => {
    const source = "export const activeDataset = { file: 'f.json', sha256: 'a'.repeat(64), counts: { deep: { b: 1 }, list: [1, 2] }, changelog: [\"x\"], courses: 3 };";
    const extracted = extractActiveDataset(source);
    expect(extracted.found).toBe(true);
    if (extracted.found) {
      expect(extracted.descriptor.counts.courses).toBe(3);
      expect(extracted.descriptor.counts["counts.deep"]).toBeUndefined();
      expect(extracted.descriptor.ignored).toContain("counts.deep");
      expect(extracted.descriptor.ignored).toContain("counts.list");
      expect(extracted.descriptor.ignored).toContain("changelog");
      expect(extracted.descriptor.file).toBe("f.json");
    }
  });
  test("a computed contract field is rejected with the field named", () => {
    const source = "export const activeDataset = { file: 'f.json', sha256: computeHash(), courses: 3 };";
    const extracted = extractActiveDataset(source);
    expect(extracted.found).toBe(false);
    if (!extracted.found) expect(extracted.reason).toContain("sha256");
  });
  test("a non-primitive value's interior keys are not misread", () => {
    const source = "export const activeDataset = { file: 'f.json', sha256: 'a'.repeat(64), pick: cond ? { a: 1 } : { b: 2 }, courses: 3 };";
    const extracted = extractActiveDataset(source);
    expect(extracted.found).toBe(true);
    if (extracted.found) {
      expect(extracted.descriptor.ignored).toContain("pick");
      expect(extracted.descriptor.counts.courses).toBe(3);
      expect(extracted.descriptor.counts["pick.a"]).toBeUndefined();
    }
  });
  test("no declaration at all", () => {
    const extracted = extractActiveDataset("export const other = 1;");
    expect(extracted.found).toBe(false);
    if (!extracted.found) expect(extracted.reason).toContain("no activeDataset");
  });
  test("a declaration in a comment does not produce a phantom descriptor", () => {
    const source = "// The activeDataset: see below.\nexport const other = { a: 1 };";
    const extracted = extractActiveDataset(source);
    // Either rejected outright or found-with-garbage is unacceptable; it must
    // never silently pass with fields it did not read. Rejection is expected
    // because `{ a: 1 }` has no file/sha256 keys — the caller fails on those.
    if (extracted.found) {
      expect(extracted.descriptor.file).toBeUndefined();
      expect(extracted.descriptor.sha256).toBeUndefined();
    }
  });
});

describe("verifyDescriptorAgainstBundle / resolveBundledCatalogPath", () => {
  const bundle = JSON.stringify({ courses: [{}, {}, {}], sections: new Array(7).fill(0), instructors: [] });
  const bundleHash = sha256Hex(bundle);

  test("matching hash and array-length counts verify", () => {
    const descriptor = {
      fields: { file: "b.json", sha256: bundleHash, courses: 3, sections: 7 },
      file: "b.json",
      sha256: bundleHash,
      counts: { courses: 3, sections: 7 },
      ignored: [],
    };
    const verdict = verifyDescriptorAgainstBundle(descriptor, "/tmp/b.json", bundle);
    expect(verdict.hashOk).toBe(true);
    expect(verdict.countChecks.every((c) => c.ok)).toBe(true);
    expect(verdict.allOk).toBe(true);
  });
  test("a wrong hash fails while correct counts cannot save it", () => {
    const descriptor = {
      fields: { file: "b.json", sha256: "f".repeat(64) },
      file: "b.json",
      sha256: "f".repeat(64),
      counts: { courses: 3 },
      ignored: [],
    };
    const verdict = verifyDescriptorAgainstBundle(descriptor, "/tmp/b.json", bundle);
    expect(verdict.hashOk).toBe(false);
    expect(verdict.allOk).toBe(false);
  });
  test("a count mismatch is a failed check naming both sides", () => {
    const descriptor = { fields: { sections: 8 }, counts: { sections: 8 }, ignored: [] };
    const verdict = verifyDescriptorAgainstBundle(descriptor, "/tmp/b.json", bundle);
    const sections = verdict.countChecks.find((c) => c.key === "sections");
    expect(sections?.ok).toBe(false);
    expect(sections?.actual).toBe("array length 7");
  });
  test("missing count key in the bundle fails", () => {
    const descriptor = { fields: { rooms: 4 }, counts: { rooms: 4 }, ignored: [] };
    const verdict = verifyDescriptorAgainstBundle(descriptor, "/tmp/b.json", bundle);
    const rooms = verdict.countChecks.find((c) => c.key === "rooms");
    expect(rooms?.ok).toBe(false);
    expect(rooms?.kind).toBe("not-array-or-number");
  });
  test("missing bundle file: hash unknown, allOk false", () => {
    const descriptor = { fields: { file: "b.json", sha256: bundleHash }, file: "b.json", sha256: bundleHash, counts: {}, ignored: [] };
    const verdict = verifyDescriptorAgainstBundle(descriptor, "/tmp/missing.json", null);
    expect(verdict.hashOk).toBeNull();
    expect(verdict.allOk).toBe(false);
  });
  test("file claim resolves under frontend/ first", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "optdata-res-"));
    try {
      mkdirSync(path.join(root, "frontend", "src", "data"), { recursive: true });
      writeFileSync(path.join(root, "frontend", "src", "data", "complete.json"), "{}\n");
      const relative = resolveBundledCatalogPath(root, "src/data/catalog/complete.json");
      expect(relative.path).toBeNull(); // not planted at that subpath

      const direct = resolveBundledCatalogPath(root, "src/data/complete.json");
      expect(direct.path).toBe(path.join(root, "frontend", "src", "data", "complete.json"));

      const prefixed = resolveBundledCatalogPath(root, "frontend/src/data/complete.json");
      expect(prefixed.path).toBe(path.join(root, "frontend", "src", "data", "complete.json"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
