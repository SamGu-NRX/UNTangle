import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeFixtureTree, AUDIT_CLI } from "./helpers.mjs";

const run = promisify(execFile);

test("two audit runs over the same input produce byte-identical reports", async () => {
  const { dir, inputPath } = writeFixtureTree(JSON.parse(JSON.stringify(fixtureSource())));
  const args = ["--input", inputPath, "--out", "results"];
  await run(process.execPath, [AUDIT_CLI, ...args], { cwd: dir });
  const first = readFileSync(join(dir, "results", "report.json"));
  await run(process.execPath, [AUDIT_CLI, ...args], { cwd: dir });
  const second = readFileSync(join(dir, "results", "report.json"));
  assert.ok(first.equals(second), "report.json must be byte-identical across runs");
});

test("replay of committed results reports match with exit 0", async () => {
  const { dir, inputPath } = writeFixtureTree(JSON.parse(JSON.stringify(fixtureSource())));
  await run(process.execPath, [AUDIT_CLI, "--input", inputPath, "--out", "results"], { cwd: dir });
  const { stdout } = await run(process.execPath, [AUDIT_CLI, "--replay", "results"], { cwd: dir });
  const verdict = JSON.parse(readFileSync(join(dir, "results", "replay.json"), "utf8"));
  assert.equal(verdict.result, "match");
  assert.equal(verdict.inputUnchanged, true);
  assert.equal(verdict.countsMatch, true);
  assert.equal(verdict.reportByteIdentical, true);
  assert.equal(verdict.examplesStable, true);
  assert.match(stdout, /result: match/);
});

test("replay detects input drift against the receipt and exits 1", async () => {
  const { dir, inputPath } = writeFixtureTree(JSON.parse(JSON.stringify(fixtureSource())));
  await run(process.execPath, [AUDIT_CLI, "--input", inputPath, "--out", "results"], { cwd: dir });
  // Mutate the input WITHOUT re-running the audit: the receipt no longer binds.
  const fixture = JSON.parse(readFileSync(join(dir, "generated", "seed-data.json"), "utf8"));
  fixture.courses.push({
    code: "GHOST 9999",
    title: "Ghost",
    department: "GHOST",
    creditHours: 3,
    description: "",
    prerequisites: [],
    planned: false,
  });
  writeFileSync(join(dir, "generated", "seed-data.json"), JSON.stringify(fixture));
  await assert.rejects(
    run(process.execPath, [AUDIT_CLI, "--replay", "results"], { cwd: dir }),
    (error) => {
      assert.equal(error.code, 1);
      return true;
    },
  );
  const verdict = JSON.parse(readFileSync(join(dir, "results", "replay.json"), "utf8"));
  assert.equal(verdict.result, "mismatch");
  assert.equal(verdict.inputUnchanged, false);
  assert.ok(verdict.differences.some((line) => line.includes("sha256")));
});

test("replay detects a tampered committed report and exits 1", async () => {
  const { dir, inputPath } = writeFixtureTree(JSON.parse(JSON.stringify(fixtureSource())));
  await run(process.execPath, [AUDIT_CLI, "--input", inputPath, "--out", "results"], { cwd: dir });
  const reportPath = join(dir, "results", "report.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  report.counts.courses = 999; // tamper
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await assert.rejects(
    run(process.execPath, [AUDIT_CLI, "--replay", "results"], { cwd: dir }),
    (error) => {
      assert.equal(error.code, 1);
      return true;
    },
  );
  const verdict = JSON.parse(readFileSync(join(dir, "results", "replay.json"), "utf8"));
  assert.equal(verdict.result, "mismatch");
  assert.equal(verdict.reportByteIdentical, false);
});

function fixtureSource() {
  return {
    buildings: [{ id: "bld-art", name: "Art Building", shortName: "ART", lat: 33.2, lng: -97.1 }],
    courses: [
      {
        code: "ANTH 1010",
        title: "Introduction to Anthropology",
        department: "ANTH",
        creditHours: 3,
        description: "",
        prerequisites: [],
        planned: false,
      },
      {
        code: "ANTH 2300",
        title: "Intermediate Anthropology",
        department: "ANTH",
        creditHours: 3,
        description: "",
        prerequisites: ["ANTH 1010", "MATH 9999"],
        planned: false,
      },
    ],
    sections: [
      {
        id: "anth-1010-001",
        courseCode: "ANTH 1010",
        title: "Introduction to Anthropology",
        professor: "Jamie K. Johnson",
        rating: 4.6,
        meetings: [{ day: "Mon", start: "16:00", end: "16:50", buildingId: "bld-art" }],
      },
    ],
    courseStatuses: { "ANTH 1010": "notTaken" },
  };
}
