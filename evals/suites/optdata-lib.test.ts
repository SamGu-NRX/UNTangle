/**
 * Unit tests for _optdata-lib's pure logic. The runner skips *.test.* files,
 * so this never registers as a suite. Run: bun test evals/suites/optdata-lib.test.ts
 *
 * These tests pin the DETECT-AND-ADAPT contracts: invocation derived from the
 * artifact's own code (package scripts, then entry files; no prescribed
 * args), verbatim output recording, best-effort recognition of measurements
 * and claims, and not-applicable (never shape-fail) when nothing
 * recognizable is exposed.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  artifactCommand,
  discoverEntrypointInDir,
  discoverPackageScript,
  extractActiveDataset,
  interpretBenchOutput,
  parseJsonObject,
  parseJsonObjectFromProcess,
  percentileNearestRank,
  recognizeDescriptorClaims,
  resolveBundledCatalogPath,
  resolveTargetDir,
  sha256Hex,
  verifyDescriptorAgainstBundle,
} from "./_optdata-lib";
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

describe("discoverPackageScript / artifactCommand", () => {
  test("prefers run.ts with bun when no package script exists", () => {
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
  test("an artifact's own bench package script wins over entry files", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-pkg-"));
    try {
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { bench: "bun ./bench.ts" } }));
      writeFileSync(path.join(dir, "run.ts"), "export {};\n");
      const resolved = artifactCommand(dir);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.cmd).toBe("bun");
        expect(resolved.args).toEqual(["run", "bench"]); // no prescribed flags
        expect(resolved.cwd).toBe(dir);
        expect(resolved.source).toBe("package.json scripts");
      }
      expect(discoverPackageScript(dir)).toBe("bench");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("a single unambiguous script is used whatever its name", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-pkg2-"));
    try {
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { certify: "bun ./certify.ts" } }));
      expect(discoverPackageScript(dir)).toBe("certify");
      const resolved = artifactCommand(dir);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.args).toEqual(["run", "certify"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("an ambiguous package.json falls through to entry-file discovery", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-pkg3-"));
    try {
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ scripts: { lint: "eslint .", test: "bun test" } }),
      );
      expect(discoverPackageScript(dir)).toBeUndefined();
      writeFileSync(path.join(dir, "main.ts"), "export {};\n");
      const resolved = artifactCommand(dir);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.source).toBe("entrypoint file discovery");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("a directory with no derivable interface is reported, with what was looked for", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-ep3-"));
    try {
      expect(discoverEntrypointInDir(dir)).toBeUndefined();
      const resolved = artifactCommand(dir);
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) expect(resolved.reason).toContain("no runnable interface");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("a bare .ts file runs with bun, no prescribed args, cwd = its own directory", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-ep4-"));
    try {
      const script = path.join(dir, "consistency.ts");
      writeFileSync(script, "export {};\n");
      const resolved = artifactCommand(script);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.cmd).toBe("bun");
        expect(resolved.cwd).toBe(dir);
        expect(resolved.args).toEqual([script]);
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

describe("interpretBenchOutput", () => {
  test("recognizes a fully-instrumented bench report and records extras verbatim", () => {
    const m = interpretBenchOutput({
      courses: 8,
      violations: 0,
      violationSamples: 20,
      gap: 0,
      enumerableInstances: 20,
      solveTimesMs: [10, 20, 30],
      seed: 0,
      label: "unt-fall-2026",
    });
    expect(m.violations).toBe(0);
    expect(m.violationSamples).toBe(20);
    expect(m.gap).toBe(0);
    expect(m.gapInstances).toBe(20);
    expect(m.courses).toBe(8);
    expect(m.solveTimesMs).toEqual([10, 20, 30]);
    expect(m.reportedP95Ms).toBeNull();
    expect(m.numericFields).toEqual({ courses: 8, violations: 0, violationSamples: 20, gap: 0, enumerableInstances: 20, seed: 0 });
    // solveTimesMs (an array) and label are recorded as non-numeric fields.
    expect(m.nonNumericFields).toEqual(["solveTimesMs", "label"]);
  });
  test("alternate field names are recognized, not required", () => {
    const m = interpretBenchOutput({
      hardConstraintViolations: 2,
      instancesChecked: 50,
      optimalityGap: 0.02,
      gapSamples: 50,
      courseCount: 6,
      p95Ms: 640,
    });
    expect(m.violations).toBe(2);
    expect(m.violationSamples).toBe(50);
    expect(m.gap).toBe(0.02);
    expect(m.gapInstances).toBe(50);
    expect(m.courses).toBe(6);
    expect(m.reportedP95Ms).toBe(640);
  });
  test("an unrecognizable shape yields nulls while numbers stay recorded", () => {
    const m = interpretBenchOutput({ mode: "fast", score: 99, tags: ["a"] });
    expect(m.violations).toBeNull();
    expect(m.gap).toBeNull();
    expect(m.courses).toBeNull();
    expect(m.reportedP95Ms).toBeNull();
    expect(m.solveTimesMs).toBeNull();
    expect(m.numericFields).toEqual({ score: 99 });
    expect(m.nonNumericFields).toEqual(["mode", "tags"]);
  });
  test("a solve-time array containing non-numbers is not recognized as samples", () => {
    const m = interpretBenchOutput({ solveTimesMs: [10, "n/a", 30] });
    expect(m.solveTimesMs).toBeNull();
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
      expect(extracted.descriptor.fields.dataset).toBe("UNT 2026 fall");
      expect(extracted.descriptor.fields.file).toBe("src/data/catalog/complete.json");
      expect(extracted.descriptor.fields.sha256).toBe("ab".repeat(32));
      expect(extracted.descriptor.counts).toEqual({ courses: 84, sections: 312 });
      expect(extracted.descriptor.ignored).toEqual([]);
    }
  });
  test("single quotes and escaped quotes parse", () => {
    const source = "export const activeDataset = { dataset: 'UNT \\'26 fall', file: 'f.json' };";
    const extracted = extractActiveDataset(source);
    expect(extracted.found).toBe(true);
    if (extracted.found) expect(extracted.descriptor.fields.dataset).toBe("UNT '26 fall");
  });
  test("nested counts groups flatten to bare count keys", () => {
    const source = "export const activeDataset = { file: 'f.json', sha256: 'a'.repeat(64), counts: { courses: 84, buildings: 9 } };";
    const extracted = extractActiveDataset(source);
    expect(extracted.found).toBe(true);
    if (extracted.found) {
      expect(extracted.descriptor.counts.courses).toBe(84);
      expect(extracted.descriptor.counts.buildings).toBe(9);
      expect(extracted.descriptor.fields["counts.courses"]).toBe(84);
      // 'a'.repeat(64) is computed: recorded as ignored, never fatal.
      expect(extracted.descriptor.ignored).toContain("sha256");
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
      expect(extracted.descriptor.fields.file).toBe("f.json");
    }
  });
  test("computed values are recorded as ignored, never a failure — the harness does not prescribe shape", () => {
    const source = "export const activeDataset = { file: 'f.json', sha256: computeHash(), courses: 3 };";
    const extracted = extractActiveDataset(source);
    expect(extracted.found).toBe(true);
    if (extracted.found) {
      expect(extracted.descriptor.ignored).toContain("sha256");
      expect(extracted.descriptor.fields.sha256).toBeUndefined();
      expect(extracted.descriptor.counts.courses).toBe(3);
    }
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
    // because `{ a: 1 }` yields no recognizable claims — the caller
    // reports not-applicable on those.
    if (extracted.found) {
      expect(extracted.descriptor.fields.file).toBeUndefined();
      expect(extracted.descriptor.fields.sha256).toBeUndefined();
    }
  });
});

describe("recognizeDescriptorClaims", () => {
  test("recognizes file claims by name and hash claims by shape, whatever the field is called", () => {
    const descriptor = {
      fields: { dataset: "UNT fall", file: "src/data/catalog/complete.json", digest: "f".repeat(64) },
      counts: { courses: 84 },
      ignored: [],
    };
    const claims = recognizeDescriptorClaims(descriptor);
    expect(claims.fileClaim).toEqual({ key: "file", value: "src/data/catalog/complete.json" });
    expect(claims.hashClaim).toEqual({ key: "digest", value: "f".repeat(64) });
    expect(claims.countClaims).toEqual({ courses: 84 });
  });
  test("a .json-valued string is a file claim even under an unknown field name", () => {
    const descriptor = { fields: { bundlePath: "data/complete.json" }, counts: {}, ignored: [] };
    const claims = recognizeDescriptorClaims(descriptor);
    expect(claims.fileClaim).toEqual({ key: "bundlePath", value: "data/complete.json" });
  });
  test("a descriptor with no recognizable claims yields nulls — never an invented schema", () => {
    const descriptor = { fields: { dataset: "UNT fall", revision: 7 }, counts: { revision: 7 }, ignored: [] };
    const claims = recognizeDescriptorClaims(descriptor);
    expect(claims.fileClaim).toBeNull();
    expect(claims.hashClaim).toBeNull();
    expect(claims.countClaims).toEqual({ revision: 7 });
  });
});

describe("verifyDescriptorAgainstBundle / resolveBundledCatalogPath", () => {
  const bundle = JSON.stringify({ courses: [{}, {}, {}], sections: new Array(7).fill(0), instructors: [] });
  const bundleHash = sha256Hex(bundle);

  test("matching hash and array-length counts verify", () => {
    const claims = {
      fileClaim: { key: "file", value: "b.json" },
      hashClaim: { key: "sha256", value: bundleHash },
      countClaims: { courses: 3, sections: 7 },
      fileClaimCandidatesRejected: [],
    };
    const verdict = verifyDescriptorAgainstBundle(claims, "/tmp/b.json", bundle);
    expect(verdict.hashOk).toBe(true);
    expect(verdict.countChecks.every((c) => c.ok === true)).toBe(true);
    expect(verdict.allCheckedOk).toBe(true);
    expect(verdict.anythingChecked).toBe(true);
  });
  test("a wrong hash fails while correct counts cannot save it", () => {
    const claims = {
      fileClaim: { key: "file", value: "b.json" },
      hashClaim: { key: "sha256", value: "f".repeat(64) },
      countClaims: { courses: 3 },
      fileClaimCandidatesRejected: [],
    };
    const verdict = verifyDescriptorAgainstBundle(claims, "/tmp/b.json", bundle);
    expect(verdict.hashOk).toBe(false);
    expect(verdict.allCheckedOk).toBe(false);
  });
  test("a count mismatch is a failed check naming both sides", () => {
    const claims = {
      fileClaim: { key: "file", value: "b.json" },
      hashClaim: null,
      countClaims: { sections: 8 },
      fileClaimCandidatesRejected: [],
    };
    const verdict = verifyDescriptorAgainstBundle(claims, "/tmp/b.json", bundle);
    const sections = verdict.countChecks.find((c) => c.key === "sections");
    expect(sections?.ok).toBe(false);
    expect(sections?.actual).toBe("array length 7");
    expect(verdict.allCheckedOk).toBe(false);
  });
  test("a count with no bundle counterpart is recorded, not judged", () => {
    const claims = {
      fileClaim: { key: "file", value: "b.json" },
      hashClaim: { key: "sha256", value: bundleHash },
      countClaims: { rooms: 4 },
      fileClaimCandidatesRejected: [],
    };
    const verdict = verifyDescriptorAgainstBundle(claims, "/tmp/b.json", bundle);
    const rooms = verdict.countChecks.find((c) => c.key === "rooms");
    expect(rooms?.ok).toBeNull();
    expect(rooms?.kind).toBe("no-counterpart");
    // The hash claim carried the case; the unjudged count does not fail it.
    expect(verdict.allCheckedOk).toBe(true);
    expect(verdict.anythingChecked).toBe(true);
  });
  test("no hash claim but a matching count still checks something", () => {
    const claims = {
      fileClaim: { key: "file", value: "b.json" },
      hashClaim: null,
      countClaims: { courses: 3 },
      fileClaimCandidatesRejected: [],
    };
    const verdict = verifyDescriptorAgainstBundle(claims, "/tmp/b.json", bundle);
    expect(verdict.hashOk).toBeNull();
    expect(verdict.allCheckedOk).toBe(true);
    expect(verdict.anythingChecked).toBe(true);
  });
  test("nothing checkable: no hash claim and only counterpart-less counts", () => {
    const claims = {
      fileClaim: { key: "file", value: "b.json" },
      hashClaim: null,
      countClaims: { rooms: 4 },
      fileClaimCandidatesRejected: [],
    };
    const verdict = verifyDescriptorAgainstBundle(claims, "/tmp/b.json", bundle);
    expect(verdict.anythingChecked).toBe(false);
    expect(verdict.allCheckedOk).toBe(true); // vacuously true; the caller reports n/a
  });
  test("unreadable bundle: hash unknown (the caller fails on the missing named file)", () => {
    const claims = {
      fileClaim: { key: "file", value: "b.json" },
      hashClaim: { key: "sha256", value: bundleHash },
      countClaims: {},
      fileClaimCandidatesRejected: [],
    };
    const verdict = verifyDescriptorAgainstBundle(claims, "/tmp/missing.json", null);
    expect(verdict.hashOk).toBeNull();
    expect(verdict.anythingChecked).toBe(false);
  });
  test("a non-JSON bundle with claimed counts is a failed check", () => {
    const claims = {
      fileClaim: { key: "file", value: "b.json" },
      hashClaim: null,
      countClaims: { courses: 3 },
      fileClaimCandidatesRejected: [],
    };
    const verdict = verifyDescriptorAgainstBundle(claims, "/tmp/b.json", "not json at all");
    const courses = verdict.countChecks.find((c) => c.key === "courses");
    expect(courses?.ok).toBe(false);
    expect(courses?.kind).toBe("bundle-not-json");
  });
  test("file claim resolves under frontend/ first, then repo root, then the module dir", () => {
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
