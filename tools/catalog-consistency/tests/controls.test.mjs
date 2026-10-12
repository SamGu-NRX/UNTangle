/**
 * Controls: producer output must deep-equal HAND-COMPUTED expectations on a
 * clean tree and on a one-defect-per-class negative tree. The expected
 * literals in helpers.mjs were computed from RULES.md v2 / FORMAT-v2.md by
 * hand, not from the producer.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAudit } from "../audit.mjs";
import {
  ANNEX_NOTE,
  cleanCompd,
  cleanCorpus,
  cleanMajors,
  cleanSeedData,
  expectedCleanCounts,
  expectedCleanFindings,
  expectedCleanProvenance,
  expectedNegativeCounts,
  expectedNegativeFindings,
  expectedNegativeProvenance,
  negativeCompd,
  negativeCorpus,
  negativeMajors,
  negativeSeedData,
  writeTree,
} from "./helpers.mjs";

function cryptoHash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function makeTree(prefix, { seedData, majors, corpusFiles, compdCsv }) {
  return writeTree(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), { seedData, majors, corpusFiles, compdCsv });
}

test("clean control: findings, counts, provenance, violations equal hand-computed values", () => {
  const tree = makeTree("cc-clean-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const { report } = runAudit({
    inputPath: path.join(tree, "frontend/src/lib/generated/seed-data.json"),
    outDir: path.join(tree, "tools/catalog-consistency/results"),
  });

  assert.deepEqual(report.findings, expectedCleanFindings());
  assert.deepEqual(report.counts, expectedCleanCounts());
  assert.deepEqual(report.provenance.sectionSource, expectedCleanProvenance());
  assert.deepEqual(report.violations, { duplicateIds: 0, meetingBounds: 0, unknownReferences: 0 });
});

test("negative control: every finding class reports exactly one hand-computed defect", () => {
  const tree = makeTree("cc-neg-", { seedData: negativeSeedData(), majors: negativeMajors, corpusFiles: negativeCorpus, compdCsv: negativeCompd });
  const { report } = runAudit({
    inputPath: path.join(tree, "frontend/src/lib/generated/seed-data.json"),
    outDir: path.join(tree, "tools/catalog-consistency/results"),
  });

  assert.deepEqual(report.findings, expectedNegativeFindings());
  assert.deepEqual(report.counts, expectedNegativeCounts());
  assert.deepEqual(report.provenance.sectionSource, expectedNegativeProvenance());
  assert.deepEqual(report.violations, { duplicateIds: 3, meetingBounds: 3, unknownReferences: 4 });
});

test("receipt binds versions, pins, corpus digest, and ordered input roles", () => {
  const tree = makeTree("cc-rcpt-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const { receipt } = runAudit({
    inputPath: path.join(tree, "frontend/src/lib/generated/seed-data.json"),
    outDir: path.join(tree, "tools/catalog-consistency/results"),
  });

  assert.equal(receipt.receiptVersion, 2);
  assert.equal(receipt.toolVersion, 2);
  assert.equal(receipt.rulesVersion, 2);
  assert.equal(receipt.sourceCommit, null); // fixture tree has no .git
  assert.deepEqual(receipt.submodulePins, [{ path: "backend", commit: null }]);

  const roles = receipt.inputs.map((entry) => entry.role);
  assert.deepEqual(roles, [
    "generated-catalog",
    "majors-source",
    "rule-source",
    "rule-source",
    "rule-source",
    "rule-source",
    "prerequisite-corpus",
    "section-source",
  ]);
  const rulePaths = receipt.inputs.filter((e) => e.role === "rule-source").map((e) => e.path);
  assert.deepEqual(rulePaths, ["frontend/src/lib/types.ts", "frontend/src/lib/planner.ts", "README.md", "tools/catalog-consistency/RULES.md"]);
  for (const entry of receipt.inputs) {
    assert.equal(entry.present, true);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.equal(typeof entry.bytes, "number");
  }
  const catalog = receipt.inputs[0];
  assert.equal(catalog.path, "frontend/src/lib/generated/seed-data.json");
  assert.equal(receipt.inputs.find((e) => e.role === "majors-source").path, "frontend/src/lib/seed-data.ts");
  assert.equal(receipt.inputs.find((e) => e.role === "prerequisite-corpus").path, "courses/anth.json");
  assert.equal(receipt.inputs.find((e) => e.role === "section-source").path, "backend/data/compD.csv");
  assert.equal(receipt.corpusDigest.algorithm, "sha256");
  assert.match(receipt.corpusDigest.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(receipt.counts, expectedCleanCounts());
});

test("manifest binds the exact bytes of the three evidence files", () => {
  const tree = makeTree("cc-man-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const outDir = path.join(tree, "tools/catalog-consistency/results");
  runAudit({
    inputPath: path.join(tree, "frontend/src/lib/generated/seed-data.json"),
    outDir,
  });

  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "results-manifest.json"), "utf8"));
  assert.equal(manifest.manifestVersion, 1);
  assert.deepEqual(Object.keys(manifest.files).sort(), ["input-receipt.json", "report.json", "unresolved-examples.json"]);
  for (const [name, entry] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(path.join(outDir, name));
    assert.equal(entry.bytes, bytes.byteLength, `${name} byte size`);
    assert.equal(entry.sha256, cryptoHash(bytes), `${name} sha256`);
  }
});

test("unresolved-examples annex mirrors the report and provenance summary", () => {
  const tree = makeTree("cc-annex-", { seedData: negativeSeedData(), majors: negativeMajors, corpusFiles: negativeCorpus, compdCsv: negativeCompd });
  const { report, annex } = runAudit({
    inputPath: path.join(tree, "frontend/src/lib/generated/seed-data.json"),
    outDir: path.join(tree, "tools/catalog-consistency/results"),
  });

  assert.equal(annex.unresolvedExamplesVersion, 2);
  assert.equal(annex.toolVersion, 2);
  assert.equal(annex.note, ANNEX_NOTE);
  assert.deepEqual(
    annex.referenceExamples.map((r) => r.check),
    ["sectionToCourse", "meetingToBuilding", "courseStatusToCourse", "majorCoreToCourse"],
  );
  assert.equal(annex.referenceExamples[3].total, 1);
  assert.deepEqual(annex.referenceExamples[3].examples, report.findings.references.majorCoreToCourse.unresolved.examples);
  assert.deepEqual(annex.externalPrerequisites, report.findings.references.prerequisites.external);
  assert.deepEqual(annex.provenanceSummary, { bound: true, assessment: expectedNegativeProvenance().assessment });
});

test("unbound section source: receipt marks present false, provenance says not established", () => {
  const tree = makeTree("cc-unbound-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: null });
  const { receipt, report } = runAudit({
    inputPath: path.join(tree, "frontend/src/lib/generated/seed-data.json"),
    outDir: path.join(tree, "tools/catalog-consistency/results"),
  });

  const sectionSource = receipt.inputs.find((e) => e.role === "section-source");
  assert.equal(sectionSource.present, false);
  assert.equal(sectionSource.sha256, null);
  assert.equal(sectionSource.bytes, 0);
  assert.equal(receipt.counts.compDRows, 0);
  assert.equal(report.provenance.sectionSource.bound, false);
  assert.equal(report.provenance.sectionSource.assessment, "section source not available — backend/data/compD.csv absent; provenance not established");
  // Everything else still audits; only provenance numbers are zeroed.
  assert.deepEqual(report.counts, { ...expectedCleanCounts(), compDRows: 0 });
  assert.deepEqual(report.findings, expectedCleanFindings());
});
