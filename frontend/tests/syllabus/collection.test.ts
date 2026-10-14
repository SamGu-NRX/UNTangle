import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import { parseProfile } from "../../../tools/syllabus/lib/profile";
import { pdfItemsToText } from "../../../tools/syllabus/lib/syllabus-text";
import { extractSyllabusFacts } from "../../src/lib/syllabus/extract";

const root = path.resolve(import.meta.dir, "../../..");

describe("profile links", () => {
  test("resolves relative, protocol-relative and absolute syllabus links against the profile", () => {
    const profileUrl = "https://example.invalid/faculty/profile";
    for (const [href, expected] of [
      ["/files/syllabus.pdf", "https://example.invalid/files/syllabus.pdf"],
      ["../files/syllabus.pdf", "https://example.invalid/files/syllabus.pdf"],
      ["syllabus.pdf?x=1&amp;y=2", "https://example.invalid/faculty/syllabus.pdf?x=1&y=2"],
      ["//mirror.invalid/syllabus.pdf", "https://mirror.invalid/syllabus.pdf"],
      ["https://mirror.invalid/syllabus.pdf", "https://mirror.invalid/syllabus.pdf"],
    ]) {
      const html = `<tr><td>TEST 1000.001</td><td>Course</td><td>Fall 2026</td><td><a class="profile-syllabus" href="${href}">Syllabus</a></td></tr>`;
      expect(parseProfile(html, profileUrl).rows[0].syllabusUrl).toBe(expected);
    }
  });
});

describe("collection limits", () => {
  for (const limit of ["--limit", "--limit=", "--limit=nope", "--limit=-1", "--limit=1.5", "--limit=Infinity", "--limit=9007199254740992"]) {
    test(`rejects ${limit} before any input read, network request, or manifest overwrite`, () => {
      const dir = mkdtempSync(path.join(tmpdir(), "syllabus-limit-"));
      try {
        const manifest = path.join(dir, "manifest.json");
        writeFileSync(manifest, "preserve existing manifest");
        const result = Bun.spawnSync([process.execPath, "--no-env-file", path.join(root, "tools/syllabus/run.ts"), `--profiles=${dir}/missing.txt`, "--term=Fall 2026", `--manifest=${manifest}`, limit], { cwd: root });
        expect(result.exitCode).toBe(2);
        expect(result.stdout.toString()).toBe("");
        expect(result.stderr.toString()).toContain("--limit must be a nonnegative safe integer");
        expect(readFileSync(manifest, "utf8")).toBe("preserve existing manifest");
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
  test("accepts zero without requesting a profile", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "syllabus-limit-zero-"));
    try {
      writeFileSync(path.join(dir, "profiles.txt"), "123\n");
      const result = Bun.spawnSync([process.execPath, "--no-env-file", path.join(root, "tools/syllabus/run.ts"), `--profiles=${dir}/profiles.txt`, "--term=Fall 2026", `--manifest=${dir}/manifest.json`, "--limit=0"], { cwd: root });
      expect(result.exitCode).toBe(0);
      const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
      expect(manifest.profilesScanned).toBe(0);
      expect(manifest.entries).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

const item = (str: string, hasEOL = false): TextContent["items"][number] => ({
  str, hasEOL, dir: "ltr", transform: [1, 0, 0, 1, 0, 0], width: str.length, height: 1, fontName: "fixture",
});

describe("PDF text reconstruction", () => {
  test("preserves word boundaries and line breaks across text and marked-content items", () => {
    const text = pdfItemsToText([
      { type: "beginMarkedContent", id: "fixture" }, item("Attendance"), item("is"), item("required"), item("daily.", true),
      item("There"), item("will"), item("be"), item("three"), item("exams.", true),
      { type: "endMarkedContent", id: "fixture" }, item("Final"), item("Exam"),
    ]);
    expect(text).toBe("Attendance is required daily.\nThere will be three exams.\nFinal Exam");
    const facts = extractSyllabusFacts(text);
    expect(facts.attendancePolicy.found).toBe(true);
    expect(facts.examCount.count).toBe(3);
    if (facts.attendancePolicy.found) expect(text.slice(facts.attendancePolicy.source.start, facts.attendancePolicy.source.end)).toBe(facts.attendancePolicy.source.quote);
    if (facts.examCount.found) expect(text.slice(facts.examCount.source.start, facts.examCount.source.end)).toBe(facts.examCount.source.quote);
  });
  test("retains existing whitespace and ignores empty items without adding spaces", () => {
    expect(pdfItemsToText([item("Final "), item("Exam", true), item("", true), item("Grading:"), item(" Homework "), item("100%")])).toBe("Final Exam\n\nGrading: Homework 100%");
  });
});
