import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * No mid dots anywhere in the design (docs/design/untangle-v3.md, "Mid
 * dots"). Copy says it in words or separates facts by layout instead.
 */

const SRC = path.join(import.meta.dir, "../src");
const TEXT = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".json", ".md", ".html"]);
/** The character itself, its HTML entities, and its escapes in JS and CSS source. */
const MID_DOT = /·|&middot;|&#183;|&#x0*b7;|\\u00b7|\\u\{b7\}|\\b7\b|\\0000b7/i;

function textFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return textFiles(full);
    return TEXT.has(path.extname(entry.name)) ? [full] : [];
  });
}

function linesWithMidDots(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, i) => (MID_DOT.test(line) ? [`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`] : []));
}

describe("mid dots", () => {
  const files = textFiles(SRC);

  test("no file in frontend/src has one", () => {
    expect(files.flatMap(linesWithMidDots)).toEqual([]);
  });

  test("the pattern catches every spelling of the character", () => {
    for (const spelling of ["a · b", "a &middot; b", "a &#183; b", "a &#xB7; b", 'a\\u00b7b', 'a\\u{b7}b', 'content: "\\b7"']) {
      expect({ spelling, caught: MID_DOT.test(spelling) }).toEqual({ spelling, caught: true });
    }
    expect(MID_DOT.test("Leave Kerr Hall by 8:49, in 12 min")).toBe(false);
  });
});
