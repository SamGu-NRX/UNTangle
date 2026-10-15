import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import { parseProfile } from "../../../tools/syllabus/lib/profile";
import { extractSyllabusText, pdfItemsToText } from "../../../tools/syllabus/lib/syllabus-text";
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

describe("collector stop-on-error flag", () => {
  test("rejects invalid flag values before reading the profile list", () => {
    const result = Bun.spawnSync([process.execPath, "--no-env-file", path.join(root, "tools/syllabus/run.ts"), "--profiles=/missing/profiles.txt", "--term=Fall 2026", "--stop-on-error=maybe"], { cwd: root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain('--stop-on-error must be true or false, got "maybe"');
  });
  for (const [status, stage, flag] of [[429, "syllabus", ""], [503, "syllabus", "--stop-on-error"], [500, "profile", "--stop-on-error=true"]] as const) {
    test(`HTTP ${status} at ${stage} stops the whole CLI run and reports the URL`, () => {
      const dir = mkdtempSync(path.join(tmpdir(), "syllabus-stop-cli-"));
      try {
        const tools = path.join(dir, "tools/syllabus");
        const seedDir = path.join(dir, "frontend/src/lib/generated");
        mkdirSync(tools, { recursive: true });
        mkdirSync(seedDir, { recursive: true });
        copyFileSync(path.join(root, "tools/syllabus/run.ts"), path.join(tools, "run.ts"));
        symlinkSync(path.join(root, "tools/syllabus/lib"), path.join(tools, "lib"), "dir");
        writeFileSync(path.join(seedDir, "seed-data.json"), JSON.stringify({ courses: [{ code: "TEST 1000" }] }));
        writeFileSync(path.join(dir, "profiles.txt"), "123\n456\n");
        writeFileSync(path.join(dir, "manifest.json"), "preserve existing manifest");
        const profileHtml = '<tr><td>TEST 1000.001</td><td>Course</td><td>Fall 2026</td><td><a class="profile-syllabus" href="https://example.invalid/syllabus.pdf">Syllabus</a></td></tr>';
        // The preload replaces every network call and advances a synthetic clock.
        writeFileSync(path.join(dir, "preload.ts"), `
          let now = 1700000000000;
          Date.now = () => now;
          Bun.sleep = async (ms) => { now += Number(ms); };
          globalThis.fetch = async (input) => {
            const url = String(input);
            console.log("MOCK REQUEST " + url);
            if (url.endsWith("/robots.txt")) return new Response("User-agent: *\\n");
            if (url.includes("faculty-profile")) {
              if (${JSON.stringify(stage)} === "profile") return new Response(null, { status: ${status} });
              return new Response(${JSON.stringify(profileHtml)}, { headers: { "content-type": "text/html" } });
            }
            if (url === "https://example.invalid/syllabus.pdf") return new Response(null, { status: ${status} });
            throw new Error("unexpected mocked request: " + url);
          };
        `);
        const args = [process.execPath, "--no-env-file", "--preload", path.join(dir, "preload.ts"), path.join(tools, "run.ts"), `--profiles=${dir}/profiles.txt`, "--term=Fall 2026", `--manifest=${dir}/manifest.json`];
        if (flag) args.push(flag);
        const result = Bun.spawnSync(args, { cwd: root });
        const stoppedUrl = stage === "profile" ? "https://facultyinfo.unt.edu/faculty-profile?profile=123" : "https://example.invalid/syllabus.pdf";
        expect(result.exitCode).toBe(2);
        expect(result.stderr.toString()).toContain(`run stopped: ${stoppedUrl} returned HTTP ${status}`);
        expect(result.stdout.toString()).not.toContain("profile=456");
        expect(result.stdout.toString().split(`MOCK REQUEST ${stoppedUrl}`).length - 1).toBe(1);
        expect(readFileSync(path.join(dir, "manifest.json"), "utf8")).toBe("preserve existing manifest");
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
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

function blankPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("a valid PDF without text is unreadable and excluded from coverage", async () => {
  await expect(extractSyllabusText(blankPdf(), "application/pdf")).rejects.toThrow("no text layer");
  const dir = mkdtempSync(path.join(tmpdir(), "syllabus-unreadable-"));
  try {
    const tools = path.join(dir, "tools/syllabus");
    const seedDir = path.join(dir, "frontend/src/lib/generated");
    mkdirSync(tools, { recursive: true });
    mkdirSync(seedDir, { recursive: true });
    copyFileSync(path.join(root, "tools/syllabus/run.ts"), path.join(tools, "run.ts"));
    symlinkSync(path.join(root, "tools/syllabus/lib"), path.join(tools, "lib"), "dir");
    writeFileSync(path.join(seedDir, "seed-data.json"), JSON.stringify({ courses: [{ code: "TEST 1000" }] }));
    writeFileSync(path.join(dir, "profiles.txt"), "123\n");
    const html = '<tr><td>TEST 1000.001</td><td>Course</td><td>Fall 2026</td><td><a class="profile-syllabus" href="https://example.invalid/blank.pdf">Syllabus</a></td></tr>';
    writeFileSync(path.join(dir, "preload.ts"), `
      let now = 1700000000000;
      Date.now = () => now;
      Bun.sleep = async (ms) => { now += Number(ms); };
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.endsWith("/robots.txt")) return new Response("User-agent: *\\n");
        if (url.includes("faculty-profile")) return new Response(${JSON.stringify(html)}, { headers: { "content-type": "text/html" } });
        if (url.endsWith("/blank.pdf")) return new Response(Buffer.from(${JSON.stringify(blankPdf().toString('base64'))}, "base64"), { headers: { "content-type": "application/pdf" } });
        throw new Error("unexpected mocked request: " + url);
      };
    `);
    const result = Bun.spawnSync([process.execPath, "--no-env-file", "--preload", path.join(dir, "preload.ts"), path.join(tools, "run.ts"), `--profiles=${dir}/profiles.txt`, "--term=Fall 2026", `--manifest=${dir}/manifest.json`], { cwd: root });
    expect(result.exitCode).toBe(0);
    const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
    expect(manifest.plannerCourseRows).toBe(1);
    expect(manifest.syllabiDownloaded).toBe(0);
    expect(manifest.syllabiUnreadable).toBe(1);
    expect(manifest.uniqueCourses).toBe(0);
    expect(manifest.skipped[0].reason).toContain("no text layer");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
