/**
 * Test suite for verify.mjs, the independent verifier.
 *
 * Fixtures drive the REAL producer CLI (audit.mjs) to create faithful
 * evidence bundles, then require the verifier to accept them; tampering
 * tests then mutate specific bytes or fields and require the verifier to
 * reject each tampered bundle with the right failing check. Scope note:
 * evidence-byte integrity terminates at results-manifest.json — a same-length
 * canonicity-preserving edit to free text that no check recomputes (course
 * titles of clean records) evades every automated check; that residual is
 * covered by review of the committed manifest digest, not here.
 *
 * The verifier imports nothing from the producer; these tests import the
 * producer only as a CLI and fixture source.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalStringify, runAudit, sha256 } from "../audit.mjs";
import {
  TOOL_DIR,
  cleanCompd,
  cleanCorpus,
  cleanMajors,
  cleanSeedData,
  negativeCompd,
  negativeCorpus,
  negativeMajors,
  negativeSeedData,
  writeTree,
} from "./helpers.mjs";

const AUDIT_CLI = path.join(TOOL_DIR, "audit.mjs");
const VERIFY_CLI = path.join(TOOL_DIR, "verify.mjs");

function makeTree(prefix, fixture) {
  return writeTree(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), fixture);
}

function produce(tree) {
  const res = spawnSync(
    process.execPath,
    [AUDIT_CLI, "--input", "frontend/src/lib/generated/seed-data.json", "--out", "tools/catalog-consistency/results"],
    { cwd: tree, encoding: "utf8" },
  );
  assert.equal(res.status, 0, `producer failed: ${res.stderr}`);
  return path.join(tree, "tools/catalog-consistency/results");
}

function verify(resultsDir, repoRoot, extraArgs = []) {
  return spawnSync(process.execPath, [VERIFY_CLI, "--results", resultsDir, "--repo-root", repoRoot, ...extraArgs], {
    encoding: "utf8",
  });
}

/** Refresh results-manifest.json hashes after a content edit (attacker move). */
function rebindManifest(resultsDir) {
  const manifestPath = path.join(resultsDir, "results-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const name of Object.keys(manifest.files)) {
    const bytes = fs.readFileSync(path.join(resultsDir, name));
    manifest.files[name] = { sha256: sha256(bytes), bytes: bytes.length };
  }
  fs.writeFileSync(manifestPath, canonicalStringify(manifest));
}

/* --------------------------------- acceptance --------------------------------- */

test("verifier accepts a faithful clean bundle", () => {
  const tree = makeTree("vt-clean-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const resultsDir = produce(tree);
  const res = verify(resultsDir, tree);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /ok canonical-bytes/);
  assert.match(res.stdout, /ok provenance/);
  assert.match(res.stdout, /verdict: PASS/);
});

test("verifier accepts a faithful defect-laden bundle (agreement on negative fixtures)", () => {
  const tree = makeTree("vt-neg-", { seedData: negativeSeedData(), majors: negativeMajors, corpusFiles: negativeCorpus, compdCsv: negativeCompd });
  const resultsDir = produce(tree);
  const res = verify(resultsDir, tree);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /verdict: PASS/);
});

test("verifier accepts a bundle produced with no section source (unbound provenance)", () => {
  const tree = makeTree("vt-unbound-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: null });
  const resultsDir = produce(tree);
  const res = verify(resultsDir, tree);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /ok provenance/);
  assert.match(res.stdout, /verdict: PASS/);
});

/* ---------------------------------- tampering ---------------------------------- */

test("single-byte content tampering fails manifest-bytes and names the file", () => {
  const tree = makeTree("vt-byte-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const resultsDir = produce(tree);
  const reportPath = path.join(resultsDir, "report.json");
  const text = fs.readFileSync(reportPath, "utf8");
  // A zero-findings report carries no course titles; tamper one byte inside a
  // free-text field that is always present (the section-source assessment),
  // keeping reportVersion and JSON validity so the manifest-bytes check is the
  // earliest check that can fire.
  fs.writeFileSync(reportPath, text.replace("synthetic/generated", "synthetic/generateD"));
  const res = verify(resultsDir, tree);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL manifest-bytes: report\.json: sha256 mismatch/);
  assert.match(res.stdout, /verdict: FAIL/);
});

test("reformatting without rebinding fails manifest-bytes; with rebinding fails canonical-bytes", () => {
  const tree = makeTree("vt-fmt-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const resultsDir = produce(tree);
  const reportPath = path.join(resultsDir, "report.json");
  const compact = JSON.stringify(JSON.parse(fs.readFileSync(reportPath, "utf8")));
  fs.writeFileSync(reportPath, compact);
  let res = verify(resultsDir, tree);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL manifest-bytes: report\.json: sha256 mismatch/);

  rebindManifest(resultsDir);
  res = verify(resultsDir, tree);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL canonical-bytes: report\.json/);
});

test("bumping a violation total fails the semantic recompute", () => {
  const tree = makeTree("vt-total-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const resultsDir = produce(tree);
  const reportPath = path.join(resultsDir, "report.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.violations.duplicateIds = 999;
  fs.writeFileSync(reportPath, canonicalStringify(report));
  rebindManifest(resultsDir);
  const res = verify(resultsDir, tree);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL violations: duplicateIds: report 999, recomputed 0/);
});

test("forging the section-source assessment fails provenance (premise implication)", () => {
  const tree = makeTree("vt-assess-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const resultsDir = produce(tree);
  const reportPath = path.join(resultsDir, "report.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.provenance.sectionSource.assessment = report.provenance.sectionSource.assessment.replace(
    "synthetic/generated",
    "verified-real-term",
  );
  fs.writeFileSync(reportPath, canonicalStringify(report));
  rebindManifest(resultsDir);
  const res = verify(resultsDir, tree);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL provenance: assessment: report .* recomputed /);
});

test("modifying a bound corpus file fails input-binding", () => {
  const tree = makeTree("vt-corpus-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const resultsDir = produce(tree);
  fs.writeFileSync(path.join(tree, "courses/anth.json"), JSON.stringify([{ course_number: "ANTH3000", title: "CHANGED" }]));
  const res = verify(resultsDir, tree);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL input-binding: .*sha256 mismatch/);
});

/* ------------------------------- refusal and usage ------------------------------ */

test("verifier refuses --verdict-out inside the audited results directory", () => {
  const tree = makeTree("vt-refuse-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const resultsDir = produce(tree);
  const res = verify(resultsDir, tree, ["--verdict-out", path.join(resultsDir, "verdict.txt")]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /refusing --verdict-out inside the audited results directory/);
});

test("unknown arguments are a usage error", () => {
  const res = spawnSync(process.execPath, [VERIFY_CLI, "--bogus"], { encoding: "utf8" });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown argument: --bogus/);
});

test("missing --results is a usage error", () => {
  const res = spawnSync(process.execPath, [VERIFY_CLI, "--repo-root", os.tmpdir()], { encoding: "utf8" });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /--results and --repo-root are required/);
});

test("missing evidence file fails parse", () => {
  const tree = makeTree("vt-missing-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const resultsDir = produce(tree);
  fs.rmSync(path.join(resultsDir, "unresolved-examples.json"));
  const res = verify(resultsDir, tree);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL parse: missing evidence file: unresolved-examples\.json/);
});

test("--verdict-out writes the verdict lines to a file outside the results directory", () => {
  const tree = makeTree("vt-vout-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const resultsDir = produce(tree);
  const reportPath = path.join(resultsDir, "report.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.provenance.sectionSource.assessment = "forged claim";
  fs.writeFileSync(reportPath, canonicalStringify(report));
  rebindManifest(resultsDir);
  const verdictPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vt-voutdir-")), "verdict.txt");
  const res = verify(resultsDir, tree, ["--verdict-out", verdictPath]);
  assert.equal(res.status, 1);
  const written = fs.readFileSync(verdictPath, "utf8");
  assert.equal(written, res.stdout);
  assert.match(written, /verdict: FAIL/);
});

