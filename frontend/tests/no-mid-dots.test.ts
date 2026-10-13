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

/**
 * Files that open PRs rewrite; their own workers sweep them. Each entry goes
 * once its PR lands clean, and this test fails on an entry that no longer
 * holds a mid dot, so the list cannot go stale.
 */
const PENDING = new Map([
  ["components/courses/CoursesView.tsx", "#42"],
  ["components/courses/DetailPanel.tsx", "#42"],
  ["components/map/map-itinerary.tsx", "#42"],
  ["components/saved-plans/plans-client.tsx", "#42"],
  ["components/schedule-client.tsx", "#42"],
  ["components/schedule-print-view.tsx", "#42"],
  ["components/schedule/ConstraintRail.tsx", "#42"],
  ["lib/plan-library/diff.ts", "#42"],
]);

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

  test("no file in frontend/src has one, apart from the pending list", () => {
    const found = files.filter((file) => !PENDING.has(path.relative(SRC, file))).flatMap(linesWithMidDots);
    expect(found).toEqual([]);
  });

  test("every pending file still has one; delete its entry once swept", () => {
    const swept = [...PENDING.keys()].filter((relative) => {
      const file = path.join(SRC, relative);
      return !files.includes(file) || linesWithMidDots(file).length === 0;
    });
    expect(swept).toEqual([]);
  });

  test("the pattern catches every spelling of the character", () => {
    for (const spelling of ["a · b", "a &middot; b", "a &#183; b", "a &#xB7; b", 'a\\u00b7b', 'a\\u{b7}b', 'content: "\\b7"']) {
      expect({ spelling, caught: MID_DOT.test(spelling) }).toEqual({ spelling, caught: true });
    }
    expect(MID_DOT.test("Leave Kerr Hall by 8:49, in 12 min")).toBe(false);
  });
});
