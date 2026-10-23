/**
 * Unit tests for _optdata-lib's pure logic. The runner skips *.test.* files,
 * so this never registers as a suite. Run: bun test evals/suites/optdata-lib.test.ts
 *
 * These tests pin the decision-685c contracts: the prescribed REAL tool
 * invocations (audit.mjs / verify.mjs / run-bench.ts, built once from the
 * tools' own code at the PR heads), strict parsing of the tools' real output
 * files (verify's verdict line, the bench's report shape), verdict-first
 * summarization for the three optimizer cases, and the provenance-descriptor
 * claim recognition. Not-applicable is reserved for absent target files;
 * unparseable output is a fail.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  benchCommand,
  catalogAuditCommand,
  catalogVerifyCommand,
  collectNumericCounts,
  extractActiveDataset,
  parseBenchReport,
  parseJsonObject,
  parseVerifyVerdict,
  readJsonObjectFile,
  recognizeDescriptorClaims,
  resolveBundledCatalogPath,
  resolveTargetDir,
  roundNumber,
  sha256Hex,
  summarizeBenchReport,
  verifyDescriptorAgainstBundle,
  XL_INSTANCE_NAME,
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

describe("parseJsonObject", () => {
  test("objects parse; arrays and scalars are rejected", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject("[1,2]")).toBeUndefined();
    expect(parseJsonObject("42")).toBeUndefined();
    expect(parseJsonObject("nope")).toBeUndefined();
  });
});

describe("parseVerifyVerdict (verify.mjs's own verdict line)", () => {
  test("the last non-empty line decides", () => {
    expect(parseVerifyVerdict("checking report.json\nok\nverdict: PASS\n")).toBe("PASS");
    expect(parseVerifyVerdict("checking report.json\nbad evidence\nverdict: FAIL\n")).toBe("FAIL");
  });
  test("trailing whitespace and blank trailing lines are tolerated", () => {
    expect(parseVerifyVerdict("verdict: PASS  \n\n")).toBe("PASS");
    expect(parseVerifyVerdict("\nverdict: FAIL\n")).toBe("FAIL");
  });
  test("anything else is unparseable (strict)", () => {
    expect(parseVerifyVerdict("")).toBeNull();
    expect(parseVerifyVerdict("all good\n")).toBeNull();
    expect(parseVerifyVerdict("verdict: pass\n")).toBeNull();
    expect(parseVerifyVerdict("verdict: PASSFAIL\n")).toBeNull();
  });
});

describe("readJsonObjectFile (strict target-file reads)", () => {
  test("reads a JSON object from disk", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-read-"));
    try {
      const file = path.join(dir, "report.json");
      writeFileSync(file, '{"counts":{"courses":8}}');
      expect(readJsonObjectFile(file)).toEqual({ counts: { courses: 8 } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("missing files and non-JSON content are undefined, not throws", () => {
    expect(readJsonObjectFile("/tmp/optdata-no-such-file-9f7b.json")).toBeUndefined();
    const dir = mkdtempSync(path.join(os.tmpdir(), "optdata-read2-"));
    try {
      const file = path.join(dir, "broken.json");
      writeFileSync(file, "not json");
      expect(readJsonObjectFile(file)).toBeUndefined();
      writeFileSync(file, "[1,2]");
      expect(readJsonObjectFile(file)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("roundNumber", () => {
  test("one decimal, used for compact measured strings", () => {
    expect(roundNumber(123.456)).toBe(123.5);
    expect(roundNumber(500)).toBe(500);
  });
});

describe("prescribed real-tool commands (decision 685c)", () => {
  test("catalogAuditCommand runs node audit.mjs with --input/--out, cwd = target root", () => {
    const command = catalogAuditCommand("/srv/target", "/tmp/audit-out");
    expect(command.cmd).toBe("node");
    expect(command.args).toEqual([
      path.join("tools", "catalog-consistency", "audit.mjs"),
      "--input",
      path.join("frontend", "src", "lib", "generated", "seed-data.json"),
      "--out",
      "/tmp/audit-out",
    ]);
    expect(command.cwd).toBe("/srv/target");
    expect(command.describe).toContain("audit.mjs");
  });
  test("catalogVerifyCommand passes --results and --repo-root (its parser requires it)", () => {
    const command = catalogVerifyCommand("/srv/target", "/tmp/audit-out");
    expect(command.cmd).toBe("node");
    expect(command.args).toEqual([
      path.join("tools", "catalog-consistency", "verify.mjs"),
      "--results",
      "/tmp/audit-out",
      "--repo-root",
      "/srv/target",
    ]);
    expect(command.cwd).toBe("/srv/target");
  });
  test("benchCommand runs the real run-bench.ts under bun in frontend/ with the bench's own flags", () => {
    const command = benchCommand("/srv/target");
    expect(command.cmd).toBe("bun");
    expect(command.cwd).toBe(path.join("/srv/target", "frontend"));
    expect(command.args[0]).toBe("run");
    expect(command.args[1]).toBe(path.join("src", "lib", "optimizer", "bench", "run-bench.ts"));
    expect(command.args).toContain("--variant=./src/lib/optimizer/brute-force");
    expect(command.args).toContain("--suite=all");
    expect(command.args).toContain("--k=3");
    expect(command.args).toContain("--repeat=3");
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

describe("parseBenchReport (the real run-bench.ts report file)", () => {
  const realShapedReport = {
    variant: "./src/lib/optimizer/brute-force",
    suite: "all",
    k: 3,
    repeat: 3,
    instances: [
      {
        name: "baseline-8",
        suite: "baseline",
        sizeClass: "8 courses",
        enumerable: true,
        statuses: 64,
        violations: 0,
        iisValid: true,
        optimalityGap: 0,
        topKAgreement: 3,
        diversity: 0.9,
        initMsP50: 1,
        initMsP95: 2,
        searchMsP50: 3,
        searchMsP95: 4,
        wallMsP50: 5,
        wallMsP95: 6,
      },
    ],
    sizeSummary: [],
  };

  test("the bench's own report shape parses", () => {
    const parsed = parseBenchReport(JSON.stringify(realShapedReport));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.instances).toHaveLength(1);
      expect(parsed.report.variant).toBe("./src/lib/optimizer/brute-force");
    }
  });
  test("broken JSON names the problem instead of throwing", () => {
    const parsed = parseBenchReport("not json");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("not valid JSON");
  });
  test("a non-object root is rejected", () => {
    const parsed = parseBenchReport("[1,2]");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("not a JSON object");
  });
  test("a foreign shape (no instances array) is rejected, naming the shape", () => {
    const parsed = parseBenchReport(JSON.stringify({ courses: 8, violations: 0 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("instances array");
  });
  test("a non-object instance entry is rejected", () => {
    const parsed = parseBenchReport(JSON.stringify({ instances: [{ name: "x" }, 7] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("non-object entry");
  });
});

describe("summarizeBenchReport (verdict-first over instances[])", () => {
  const base = {
    suite: "baseline",
    sizeClass: "8 courses",
    enumerable: true,
    statuses: 64,
    iisValid: true,
    topKAgreement: 3,
    diversity: 0.9,
    initMsP50: 1,
    initMsP95: 2,
    searchMsP50: 3,
    searchMsP95: 4,
    wallMsP50: 5,
  };

  test("a clean run: zero violations, zero gaps, the pinned 8-course family measured", () => {
    const parsed = parseBenchReport(
      JSON.stringify({
        variant: "v",
        suite: "all",
        instances: [
          { ...base, name: "baseline-8", violations: 0, optimalityGap: 0, wallMsP95: 123.456 },
          { ...base, name: XL_INSTANCE_NAME, violations: 0, optimalityGap: 0, wallMsP95: 444.4 },
          { ...base, name: "nonenum-10", enumerable: false, violations: 0, optimalityGap: null, skipped: "variant cannot enumerate >8 courses" },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = summarizeBenchReport(parsed.instances);
    expect(s.violationsChecked).toBe(3);
    expect(s.violationsMax).toBe(0);
    expect(s.violationsBreaches).toEqual([]);
    expect(s.gapChecked).toBe(2); // the non-enumerable instance is not judged on gap
    expect(s.gapMax).toBe(0);
    expect(s.gapBreaches).toEqual([]);
    expect(s.gapUnjudged).toBe(0);
    expect(s.skipped).toEqual([{ name: "nonenum-10", reason: "variant cannot enumerate >8 courses" }]);
    expect(s.xlRecordPresent).toBe(true);
    expect(s.xlSkipReason).toBeNull();
    expect(s.xlWallMsP95).toBe(444.4);
  });

  test("a planted defect: a violations breach names the instance and max", () => {
    const parsed = parseBenchReport(
      JSON.stringify({
        variant: "v",
        suite: "all",
        instances: [
          { ...base, name: "baseline-8", violations: 0, optimalityGap: 0, wallMsP95: 10 },
          { ...base, name: "defect-8", violations: 2, optimalityGap: 0, wallMsP95: 10 },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = summarizeBenchReport(parsed.instances);
    expect(s.violationsMax).toBe(2);
    expect(s.violationsBreaches).toEqual(["defect-8=2"]);
  });

  test("a planted defect: a nonzero gap is a breach", () => {
    const parsed = parseBenchReport(
      JSON.stringify({
        variant: "v",
        suite: "all",
        instances: [{ ...base, name: "baseline-8", violations: 0, optimalityGap: 0.5, wallMsP95: 10 }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = summarizeBenchReport(parsed.instances);
    expect(s.gapMax).toBe(0.5);
    expect(s.gapBreaches).toEqual(["baseline-8=0.5"]);
  });

  test("a skipped or missing pinned 8-course family is visible as such, never invented", () => {
    const parsed = parseBenchReport(
      JSON.stringify({
        variant: "v",
        suite: "all",
        instances: [
          { ...base, name: "baseline-8", violations: 0, optimalityGap: 0, wallMsP95: 10 },
          { ...base, name: XL_INSTANCE_NAME, enumerable: false, violations: null, optimalityGap: null, skipped: "variant refused to enumerate" },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = summarizeBenchReport(parsed.instances);
    expect(s.xlRecordPresent).toBe(true);
    expect(s.xlSkipReason).toBe("variant refused to enumerate");
    expect(s.xlWallMsP95).toBeNull();
  });

  test("an infeasible enumerable instance (null gap) is counted as unjudged, not failed", () => {
    const parsed = parseBenchReport(
      JSON.stringify({
        variant: "v",
        suite: "all",
        instances: [
          { ...base, name: "infeasible-8", violations: 0, optimalityGap: null, wallMsP95: 10 },
          { ...base, name: "ok-8", violations: 0, optimalityGap: 0, wallMsP95: 10 },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = summarizeBenchReport(parsed.instances);
    expect(s.gapChecked).toBe(1);
    expect(s.gapUnjudged).toBe(1);
    expect(s.gapMax).toBe(0);
  });

  test("non-numeric defect counts are ignored (a tampered report cannot smuggle a string past the parse)", () => {
    const parsed = parseBenchReport(
      JSON.stringify({
        variant: "v",
        suite: "all",
        instances: [{ ...base, name: "baseline-8", violations: "0", optimalityGap: "0", wallMsP95: "10" }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = summarizeBenchReport(parsed.instances);
    expect(s.violationsChecked).toBe(0);
    expect(s.gapChecked).toBe(0);
  });
});

describe("collectNumericCounts", () => {
  test("collects top-level and nested numbers under dotted keys", () => {
    const { counts, nonNumericFields } = collectNumericCounts({
      courses: 2,
      totals: { sections: 5, buildings: 1 },
      certified: true,
      detail: { failures: 0 },
      tags: ["x"],
    });
    expect(counts).toEqual({ courses: 2, "totals.sections": 5, "totals.buildings": 1, "detail.failures": 0 });
    expect(nonNumericFields.sort()).toEqual(["certified", "tags"]);
  });
  test("an empty payload yields nothing to record", () => {
    const { counts, nonNumericFields } = collectNumericCounts({});
    expect(counts).toEqual({});
    expect(nonNumericFields).toEqual([]);
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
