/**
 * Detection suite: each rule reports exact totals with capped examples;
 * evidence classification follows the priority chain; the CLI is
 * deterministic and byte-stable; malformed invocations fail loudly.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildBundleAnnotations,
  canonicalStringify,
  expandDayTokens,
  locationShortCode,
  normalizeCourseCode,
  parseCsv,
  parseMajorsFromTs,
  runAudit,
  sha256,
  submodulePinFromLsTree,
} from "../audit.mjs";
import {
  TOOL_DIR,
  building,
  cleanCompd,
  cleanCorpus,
  cleanMajors,
  cleanSeedData,
  course,
  majorsTs,
  meeting,
  meeting25SeedData,
  section,
  writeTree,
} from "./helpers.mjs";

const AUDIT_CLI = path.join(TOOL_DIR, "audit.mjs");

function makeTree(prefix, { seedData, majors, corpusFiles = {}, compdCsv = null }) {
  return writeTree(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), { seedData, majors, corpusFiles, compdCsv });
}

function runCli(tree, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [AUDIT_CLI, "--input", "frontend/src/lib/generated/seed-data.json", "--out", "tools/catalog-consistency/results", ...extraArgs],
    { cwd: tree, encoding: "utf8" },
  );
}

/* ------------------------------- the v1 regressions ---------------------------- */

test("25 end<=start meetings report total 25 with exactly 10 examples", () => {
  const tree = makeTree("cc-25-", { seedData: meeting25SeedData(), majors: cleanMajors, compdCsv: cleanCompd });
  const { report } = runAudit({
    inputPath: path.join(tree, "frontend/src/lib/generated/seed-data.json"),
    outDir: path.join(tree, "tools/catalog-consistency/results"),
  });

  const endBad = report.findings.meetingBounds.endTimeNotAfterStart;
  assert.equal(endBad.total, 25);
  assert.equal(endBad.examples.length, 10);
  // First 10 in input order: the five bad meetings of section 001, then 002's.
  assert.deepEqual(endBad.examples.map((e) => e.sectionId), [
    "anth-2000-001", "anth-2000-001", "anth-2000-001", "anth-2000-001", "anth-2000-001",
    "anth-2000-002", "anth-2000-002", "anth-2000-002", "anth-2000-002", "anth-2000-002",
  ]);
  assert.equal(report.findings.meetingBounds.meetingsChecked, 30); // 25 bad + 5 good
  assert.equal(report.violations.meetingBounds, 25);
});

/* --------------------------- prerequisite classification ----------------------- */

test("TYPO9999 stays unknown with null evidence and stays out of unknownReferences", () => {
  const tree = makeTree("cc-typo-", {
    seedData: {
      buildings: [building("bld-chem", "CHEM")],
      courses: [course("ANTH 2000", "Intermediate Anthropology", ["TYPO9999"])],
      sections: [section("anth-2000-001", "ANTH 2000", [meeting("Mon", "08:00", "08:50", "bld-chem")])],
      courseStatuses: {},
    },
    majors: [{ id: "m", name: "M", department: "X", icon: "i", coreCourseCodes: [] }],
    compdCsv: cleanCompd,
  });
  const { report } = runAudit({
    inputPath: path.join(tree, "frontend/src/lib/generated/seed-data.json"),
    outDir: path.join(tree, "tools/catalog-consistency/results"),
  });

  const unknown = report.findings.references.prerequisites.external.categories.unknown;
  assert.equal(unknown.codes, 1);
  assert.equal(unknown.edges, 1);
  assert.deepEqual(unknown.examples, [{ code: "TYPO9999", edges: 1, category: "unknown", evidence: null }]);
  assert.match(unknown.note, /intent unresolved/);
  // R2.5 externals are never unknown references.
  assert.deepEqual(report.violations, { duplicateIds: 0, meetingBounds: 0, unknownReferences: 0 });
});

test("corpus title annotation classifies a code as inSourceCorpus", () => {
  const tree = makeTree("cc-annote-", {
    seedData: {
      buildings: [building("bld-chem", "CHEM")],
      courses: [course("ANTH 2000", "Intermediate Anthropology", ["MATH 9999"])],
      sections: [section("anth-2000-001", "ANTH 2000", [meeting("Mon", "08:00", "08:50", "bld-chem")])],
      courseStatuses: {},
    },
    majors: [{ id: "m", name: "M", department: "X", icon: "i", coreCourseCodes: [] }],
    corpusFiles: { "math.json": [{ course_number: "MATH3000", title: "Math for Teachers (MATH 9999)" }] },
    compdCsv: cleanCompd,
  });
  const { report } = runAudit({
    inputPath: path.join(tree, "frontend/src/lib/generated/seed-data.json"),
    outDir: path.join(tree, "tools/catalog-consistency/results"),
  });

  const inCorpus = report.findings.references.prerequisites.external.categories.inSourceCorpus;
  assert.equal(inCorpus.codes, 1);
  assert.deepEqual(inCorpus.examples, [
    { code: "MATH 9999", edges: 1, category: "inSourceCorpus", evidence: { kind: "sourceCorpusFile", files: ["courses/math.json"] } },
  ]);
});

test("a section-title annotation classifies a code as titleAnnotatedInBundle", () => {
  const s = section("anth-2000-001", "ANTH 2000", [meeting("Mon", "08:00", "08:50", "bld-chem")]);
  s.title = "ANTH 2000 Section Sample (CHEM 1010)";
  const tree = makeTree("cc-sectt-", {
    seedData: {
      buildings: [building("bld-chem", "CHEM")],
      courses: [course("ANTH 2000", "Intermediate Anthropology", ["CHEM 1010"])],
      sections: [s],
      courseStatuses: {},
    },
    majors: [{ id: "m", name: "M", department: "X", icon: "i", coreCourseCodes: [] }],
    compdCsv: cleanCompd,
  });
  const { report } = runAudit({
    inputPath: path.join(tree, "frontend/src/lib/generated/seed-data.json"),
    outDir: path.join(tree, "tools/catalog-consistency/results"),
  });

  const annotated = report.findings.references.prerequisites.external.categories.titleAnnotatedInBundle;
  assert.equal(annotated.codes, 1);
  assert.deepEqual(annotated.examples, [
    {
      code: "CHEM 1010",
      edges: 1,
      category: "titleAnnotatedInBundle",
      evidence: { kind: "titleAnnotationInBundle", titles: ["ANTH 2000 Section Sample (CHEM 1010)"] },
    },
  ]);
});

test("major core unresolved code carries titleAnnotatedEquivalent evidence when a title annotates it", () => {
  const tree = makeTree("cc-mcev-", {
    seedData: {
      buildings: [building("bld-chem", "CHEM")],
      courses: [course("PSCI 2305", "US Political Behavior and Policy  (GOVT 2305)")],
      sections: [section("psci-2305-001", "PSCI 2305", [meeting("Mon", "08:00", "08:50", "bld-chem")])],
      courseStatuses: {},
    },
    majors: [{ id: "psci-bs", name: "Political Science BS", department: "PSCI", icon: "i", coreCourseCodes: ["GOVT 2305"] }],
    compdCsv: cleanCompd,
  });
  const { report } = runAudit({
    inputPath: path.join(tree, "frontend/src/lib/generated/seed-data.json"),
    outDir: path.join(tree, "tools/catalog-consistency/results"),
  });

  const unresolved = report.findings.references.majorCoreToCourse.unresolved;
  assert.equal(unresolved.total, 1);
  assert.deepEqual(unresolved.examples, [
    {
      majorId: "psci-bs",
      majorName: "Political Science BS",
      code: "GOVT 2305",
      evidence: { kind: "titleAnnotatedEquivalent", courseCode: "PSCI 2305", title: "US Political Behavior and Policy  (GOVT 2305)" },
    },
  ]);
});

/* ---------------------------------- unit helpers -------------------------------- */

test("day-token expansion handles two-letter and single-letter tokens", () => {
  assert.deepEqual(expandDayTokens("MWF"), ["Mon", "Wed", "Fri"]);
  assert.deepEqual(expandDayTokens("TuTh"), ["Tue", "Thu"]);
  assert.deepEqual(expandDayTokens("MW"), ["Mon", "Wed"]);
  assert.deepEqual(expandDayTokens("Th"), ["Thu"]);
  assert.deepEqual(expandDayTokens("T"), ["Tue"]);
  assert.deepEqual(expandDayTokens("M"), ["Mon"]);
  assert.deepEqual(expandDayTokens(""), []);
});

test("location short code takes the last ALL-CAPS parenthetical", () => {
  assert.equal(locationShortCode("Chemistry Building (CHEM) 162"), "CHEM");
  assert.equal(locationShortCode("Discovery Park (NTDP) A107"), "NTDP");
  assert.equal(locationShortCode("No room here"), null);
  assert.equal(locationShortCode(null), null);
});

test("csv parser handles quoted fields and CRLF", () => {
  const rows = parseCsv('a,b\r\n"x,1",y\r\n"say ""hi""",z\r\n');
  assert.deepEqual(rows, [["a", "b"], ["x,1", "y"], ['say "hi"', "z"]]);
});

test("course code normalization only affects the cross-source spelling", () => {
  assert.equal(normalizeCourseCode("ANTH4520"), "ANTH 4520");
  assert.equal(normalizeCourseCode("ANTH 4520"), "ANTH 4520");
});

test("majors literal parses from committed TS shape", () => {
  const majors = [{ id: "x", name: "X", department: "X", icon: "i", coreCourseCodes: ["A 1"] }];
  const parsed = parseMajorsFromTs(majorsTs(majors));
  assert.deepEqual(parsed, majors);
  assert.equal(parseMajorsFromTs("no majors here"), null);
});

test("bundle annotations collect course and section title annotations in order, capped at 3", () => {
  const map = buildBundleAnnotations(
    [course("A 1", "One (CODE 1)"), course("B 2", "Two (CODE 2) (CODE 1)")],
    [{ ...section("s-1", "A 1"), title: "S One (CODE 1)" }],
  );
  assert.deepEqual(map.get("CODE 1"), ["One (CODE 1)", "Two (CODE 2) (CODE 1)", "S One (CODE 1)"]);
  assert.deepEqual(map.get("CODE 2"), ["Two (CODE 2) (CODE 1)"]);
});

/* --------------------------------------- CLI ------------------------------------ */

test("CLI writes the four evidence files, canonicalized with trailing newlines", () => {
  const tree = makeTree("cc-cli-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  const result = runCli(tree);
  assert.equal(result.status, 0, result.stderr);
  const outDir = path.join(tree, "tools/catalog-consistency/results");
  for (const name of ["input-receipt.json", "report.json", "unresolved-examples.json", "results-manifest.json"]) {
    const content = fs.readFileSync(path.join(outDir, name), "utf8");
    assert.ok(content.endsWith("}\n"), `${name} ends with brace+newline`);
    assert.equal(content, canonicalStringify(JSON.parse(content)), `${name} is canonical`);
  }
  assert.match(result.stdout, /catalog-consistency auditor v2/);
});

test("two CLI runs over the same tree are byte-identical", () => {
  const tree = makeTree("cc-det-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  assert.equal(runCli(tree).status, 0);
  const outDir = path.join(tree, "tools/catalog-consistency/results");
  const first = Object.fromEntries(
    ["input-receipt.json", "report.json", "unresolved-examples.json", "results-manifest.json"].map((n) => [
      n,
      sha256(fs.readFileSync(path.join(outDir, n))),
    ]),
  );
  assert.equal(runCli(tree).status, 0);
  for (const [name, hash] of Object.entries(first)) {
    assert.equal(sha256(fs.readFileSync(path.join(outDir, name))), hash, `${name} identical across runs`);
  }
});

test("receipt hashes change when a bound input changes", () => {
  const tree = makeTree("cc-bind-", { seedData: cleanSeedData(), majors: cleanMajors, corpusFiles: cleanCorpus, compdCsv: cleanCompd });
  assert.equal(runCli(tree).status, 0);
  const outDir = path.join(tree, "tools/catalog-consistency/results");
  const before = JSON.parse(fs.readFileSync(path.join(outDir, "input-receipt.json"), "utf8"));
  fs.writeFileSync(
    path.join(tree, "backend/data/compD.csv"),
    `${cleanCompd}ANTH1010,003,Prof B,13:00,13:50,M,Chemistry Building (CHEM) 101\n`,
  );
  assert.equal(runCli(tree).status, 0);
  const after = JSON.parse(fs.readFileSync(path.join(outDir, "input-receipt.json"), "utf8"));
  const beforeCompd = before.inputs.find((e) => e.role === "section-source");
  const afterCompd = after.inputs.find((e) => e.role === "section-source");
  assert.notEqual(beforeCompd.sha256, afterCompd.sha256);
  assert.equal(after.counts.compDRows, 3);
});

test("missing --input exits 2; unparsable catalog exits 1 writing nothing", () => {
  const usage = spawnSync(process.execPath, [AUDIT_CLI], { cwd: os.tmpdir(), encoding: "utf8" });
  assert.equal(usage.status, 2);

  const tree = writeTree(fs.mkdtempSync(path.join(os.tmpdir(), "cc-badjson-")), {
    seedData: cleanSeedData(),
    majors: cleanMajors,
    corpusFiles: {},
  });
  fs.writeFileSync(path.join(tree, "frontend/src/lib/generated/seed-data.json"), "{not json");
  const result = spawnSync(process.execPath, [AUDIT_CLI, "--input", "frontend/src/lib/generated/seed-data.json", "--out", "out"], {
    cwd: tree,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /audit failed/);
  assert.ok(!fs.existsSync(path.join(tree, "out")), "no output directory is written on abort");
});

test("missing majors source exits 1", () => {
  const tree = writeTree(fs.mkdtempSync(path.join(os.tmpdir(), "cc-nomaj-")), {
    seedData: cleanSeedData(),
    majors: cleanMajors,
    corpusFiles: {},
  });
  fs.rmSync(path.join(tree, "frontend/src/lib/seed-data.ts"));
  const result = spawnSync(process.execPath, [AUDIT_CLI, "--input", "frontend/src/lib/generated/seed-data.json", "--out", "out"], {
    cwd: tree,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /audit failed/);
});

test("--replay is retired with a pointer to the verifier", () => {
  const result = spawnSync(process.execPath, [AUDIT_CLI, "--replay"], { cwd: os.tmpdir(), encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /verify\.mjs/);
});

test("submodule pin parses the gitlink entry git actually emits (160000, not 040000)", () => {
  const gitlink = "160000 commit 0a49d4d863161c3b568f6aa6d3da4b4e68637a44\tbackend\n";
  assert.equal(submodulePinFromLsTree(gitlink), "0a49d4d863161c3b568f6aa6d3da4b4e68637a44");
  // a plain tree entry must never be mistaken for the submodule pin
  assert.equal(submodulePinFromLsTree("040000 tree 1234567890123456789012345678901234567890\tbackend\n"), null);
  // wrong path, wrong mode, empty, and missing output all yield null
  assert.equal(submodulePinFromLsTree("160000 commit 0a49d4d863161c3b568f6aa6d3da4b4e68637a44\tother\n"), null);
  assert.equal(submodulePinFromLsTree(""), null);
  assert.equal(submodulePinFromLsTree(null), null);
});
