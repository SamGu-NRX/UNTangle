import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rate, scoreEntries, verifyText, type LabelEntry } from "./eval";

const root = path.resolve(import.meta.dir, "../../..");
const labels = JSON.parse(readFileSync(path.join(root, "docs/research/syllabus/labels.json"), "utf8")) as { entries: LabelEntry[] };
const entry = (overrides: Partial<LabelEntry> = {}): LabelEntry => ({
  id: "fixture", course: "TEST 1000", section: "001", faculty: null,
  profileUrl: "https://example.invalid/profile", syllabusUrl: "https://example.invalid/syllabus",
  docQuote: "Synthetic fixture", attendance: { present: false }, examCount: { present: false },
  gradingWeights: { present: false }, ...overrides,
});
const document = (overrides: Partial<LabelEntry>, text: string) => ({ entry: entry(overrides), text });

const wrongText = "Attendance is required and affects your grade. There will be two exams. Grading: Exams 60%, Homework 40%.";
const positive: Partial<LabelEntry> = {
  attendance: { present: true, excerpt: "Missing students lose participation points after repeated absences." },
  examCount: { present: true, count: 3 },
  gradingWeights: { present: true, components: [{ name: "Project", weightPct: 100 }] },
};

describe("document scoring", () => {
  test("wrong answers on positive documents count as both false positives and misses", () => {
    const score = scoreEntries([document(positive, wrongText)]);
    for (const tally of [score.attendance, score.examCount, score.weights]) {
      expect(tally).toEqual({ tp: 0, fp: 1, fn: 1 });
    }
    expect(score.weightsComponents).toEqual({ tp: 0, fp: 2, fn: 1 });
  });

  test("correct, absent, wrong and spurious answers have distinct counts", () => {
    const correct = { attendance: { present: true, excerpt: "Attendance is required and affects your grade." }, examCount: { present: true, count: 2 }, gradingWeights: { present: true, components: [{ name: "Exams", weightPct: 60 }, { name: "Homework", weightPct: 40 }] } };
    const score = scoreEntries([
      document(correct, wrongText), document(positive, wrongText),
      document(positive, "Course introduction."), document({}, wrongText), document({}, "Course introduction."),
    ]);
    for (const tally of [score.attendance, score.examCount, score.weights]) {
      expect(tally).toEqual({ tp: 1, fp: 2, fn: 2 });
    }
  });

  test("a grading block with extra or duplicate components is not an exact set", () => {
    const gradingWeights = { present: true, components: [{ name: "Exams", weightPct: 60 }] };
    expect(scoreEntries([document({ gradingWeights }, wrongText)]).weights).toEqual({ tp: 0, fp: 1, fn: 1 });
    expect(scoreEntries([document({ gradingWeights: { present: true, components: [{ name: "Exams", weightPct: 50 }] } }, "Grading: Exams 50%, Exams 50%.")]).weights).toEqual({ tp: 0, fp: 1, fn: 1 });
  });

  test("component assignment is complete and independent of label order", () => {
    const components = [{ name: "Exam", weightPct: 50 }, { name: "Midterm", weightPct: 50 }];
    for (const ordered of [components, [...components].reverse()]) {
      const score = scoreEntries([document({ gradingWeights: { present: true, components: ordered } }, "Grading: Midterm Exam 50%, Exam 50%.")]);
      expect(score.weights).toEqual({ tp: 1, fp: 0, fn: 0 });
      expect(score.weightsComponents).toEqual({ tp: 2, fp: 0, fn: 0 });
      expect(score.misses).toEqual([]);
    }
  });

  test("attendance evidence cannot match an opposite explicit negation", () => {
    for (const [excerpt, text] of [
      ["Attendance is not required.", "Attendance is required and affects your grade."],
      ["Attendance is required.", "Attendance is not required and never affects your grade."],
    ]) {
      expect(scoreEntries([document({ attendance: { present: true, excerpt } }, text)]).attendance).toEqual({ tp: 0, fp: 1, fn: 1 });
    }
    expect(scoreEntries([document({ attendance: { present: true, excerpt: "Attendance is not required." } }, "Attendance is not required and affects no grade.")]).attendance).toEqual({ tp: 1, fp: 0, fn: 0 });
  });

  test("defined zero precision and recall yield zero F1, not an unavailable metric", () => {
    expect(rate({ tp: 0, fp: 2, fn: 3 })).toEqual({ precision: 0, recall: 0, f1: 0 });
    expect(rate({ tp: 0, fp: 0, fn: 3 })).toEqual({ precision: null, recall: 0, f1: null });
    expect(rate({ tp: 0, fp: 2, fn: 0 })).toEqual({ precision: 0, recall: null, f1: null });
    expect(rate({ tp: 2, fp: 2, fn: 2 })).toEqual({ precision: 0.5, recall: 0.5, f1: 0.5 });
  });

  test("every committed labeled-positive entry remains in its recall denominator", () => {
    // Synthetic wrong answers test the denominator, not the corpus's extraction quality.
    const documents = labels.entries.map((entry) => ({ entry, text: wrongText }));
    const score = scoreEntries(documents);
    for (const [key, tally, count] of [
      ["attendance", score.attendance, 38], ["examCount", score.examCount, 29], ["gradingWeights", score.weights, 38],
    ] as const) {
      expect(labels.entries.filter((entry) => entry[key].present)).toHaveLength(count);
      expect(tally.tp + tally.fn).toBe(count);
    }
  });
});

describe("corpus identity", () => {
  const text = "Original labeled text.\n";
  const bound = entry({ textSha256: createHash("sha256").update(text).digest("hex") });

  test("requires a valid SHA-256 and rejects even whitespace changes", () => {
    expect(() => verifyText(bound, text)).not.toThrow();
    expect(() => verifyText(bound, `${text}\n`)).toThrow("SHA-256 mismatch");
    expect(() => verifyText(entry(), text)).toThrow("missing valid textSha256");
    expect(() => verifyText(entry({ textSha256: "fake" }), text)).toThrow("missing valid textSha256");
  });

  test("CLI rejects a changed document before publishing any partial scores", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "syllabus-eval-"));
    try {
      const second = entry({ ...bound, id: "changed", syllabusUrl: "https://example.invalid/changed" });
      writeFileSync(path.join(dir, "labels.json"), JSON.stringify({ entries: [bound, second] }));
      for (const label of [bound, second]) {
        const key = createHash("sha1").update(label.syllabusUrl).digest("hex");
        writeFileSync(path.join(dir, `${key}.txt`), label === bound ? text : "Changed document.");
      }
      const result = Bun.spawnSync([process.execPath, "--no-env-file", path.join(import.meta.dir, "eval.ts"), `--file=${dir}/labels.json`, `--cache-text=${dir}`], { cwd: root });
      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toBe("");
      expect(result.stderr.toString()).toContain("cannot score changed: cached text SHA-256 mismatch");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

test("label builder records the exact cached-text hash without committing raw text", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "syllabus-labels-"));
  try {
    const tools = path.join(dir, "tools/syllabus");
    mkdirSync(path.join(tools, ".cache/text"), { recursive: true });
    copyFileSync(path.join(root, "tools/syllabus/build-labels.ts"), path.join(tools, "build-labels.ts"));
    const text = "Synthetic original text.\n";
    for (const label of labels.entries) {
      const key = createHash("sha1").update(label.syllabusUrl).digest("hex");
      writeFileSync(path.join(tools, ".cache/text", `${key}.txt`), text);
    }
    writeFileSync(path.join(tools, ".cache/manifest.json"), JSON.stringify({ entries: labels.entries }));
    const result = Bun.spawnSync([process.execPath, "--no-env-file", path.join(tools, "build-labels.ts")], { cwd: root });
    expect(result.exitCode).toBe(0);
    const built = JSON.parse(readFileSync(path.join(dir, "docs/research/syllabus/labels.json"), "utf8")) as { entries: LabelEntry[] };
    expect(built.entries).toHaveLength(labels.entries.length);
    for (const label of built.entries) {
      expect(label.textSha256).toBe(createHash("sha256").update(text).digest("hex"));
      expect(() => verifyText(label, text)).not.toThrow();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("TypeScript checks the hand-written label tuples", () => {
  const result = Bun.spawnSync([process.execPath, "--no-env-file", path.join(root, "frontend/node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--target", "es2020", "--module", "esnext", "--moduleResolution", "bundler", "--types", "bun", path.join(root, "tools/syllabus/build-labels.ts")], { cwd: path.join(root, "frontend") });
  expect(result.stdout.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});

test("research README withdraws unsupported scores and documents complete replay arguments", () => {
  const report = readFileSync(path.join(root, "docs/research/syllabus/README.md"), "utf8");
  expect(report).toContain("Results are withdrawn");
  expect(report).toContain("wrong answer differs from an absent answer");
  expect(report).toContain("--profiles=tools/syllabus/data/profile-ids.txt --term=\"Fall 2026\"");
  expect(report).toContain('if bun --no-env-file frontend/tests/syllabus/eval.ts > "$output"; then');
  expect(report).not.toContain("Never fires on real documents");
  expect(readFileSync(path.join(root, "docs/research/syllabus/eval-results.txt"), "utf8")).toContain("Results withdrawn pending offline regeneration");
});

test("documented replay publishes output only on success", () => {
  const report = readFileSync(path.join(root, "docs/research/syllabus/README.md"), "utf8");
  const command = report.match(/```sh\n([\s\S]*?)\n```/)?.[1];
  if (!command) throw new Error("research README is missing its replay command");
  const dir = mkdtempSync(path.join(tmpdir(), "syllabus-publish-"));
  try {
    const outputDir = path.join(dir, "docs/research/syllabus");
    const bin = path.join(dir, "bin");
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(bin);
    // Test the documented shell control flow without reading a real corpus.
    writeFileSync(path.join(bin, "bun"), '#!/bin/sh\nprintf "%s\\n" "synthetic evaluation"\nexit "$EVALUATOR_STATUS"\n');
    chmodSync(path.join(bin, "bun"), 0o700);
    for (const status of [1, 0]) {
      writeFileSync(path.join(outputDir, "eval-results.txt"), "withdrawal notice");
      const result = Bun.spawnSync(["/bin/sh", "-c", command], { cwd: dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, EVALUATOR_STATUS: String(status) } });
      expect(result.exitCode).toBe(status);
      expect(readFileSync(path.join(outputDir, "eval-results.txt"), "utf8")).toBe(status === 0 ? "synthetic evaluation\n" : "withdrawal notice");
      expect(readdirSync(outputDir)).toEqual(["eval-results.txt"]);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("worksheet uses an explicit readable list, not a hidden /tmp file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "syllabus-worksheet-"));
  try {
    const url = "https://example.invalid/worksheet";
    const key = createHash("sha1").update(url).digest("hex");
    mkdirSync(path.join(dir, "text"));
    writeFileSync(path.join(dir, "text", `${key}.txt`), wrongText);
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ entries: [{ syllabusUrl: url, courseCode: "TEST 1000" }] }));
    writeFileSync(path.join(dir, "readable.json"), JSON.stringify([`${key}.txt`]));
    const result = Bun.spawnSync([process.execPath, "--no-env-file", path.join(root, "tools/syllabus/make-worksheet.ts"), `--readable=${dir}/readable.json`, `--cache=${dir}`, `--output=${dir}/worksheet.txt`], { cwd: root });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(path.join(dir, "worksheet.txt"), "utf8")).toContain("TEST 1000");
    expect(result.stdout.toString()).toContain("worksheet entries: 1");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
