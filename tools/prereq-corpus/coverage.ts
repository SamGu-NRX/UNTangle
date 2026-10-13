import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseUntPrerequisite, normalizeUntCourseId } from "../../frontend/src/lib/prereq/unt";
import type { UntCatalogEntry } from "../../frontend/src/lib/prereq/unt";

const root = resolve(import.meta.dir, "../..");
const directory = resolve(root, "courses");
const files = (await readdir(directory)).filter(file => file.endsWith(".json")).sort();
const hash = createHash("sha256");
const counts = { full: 0, partial: 0, unknown: 0 };
const rows: { courseId: string; coverage: string; source: string }[] = [];
let empty = 0;
for (const file of files) {
  const contents = await readFile(resolve(directory, file), "utf8");
  hash.update(file).update("\0").update(contents).update("\0");
  const entries: UntCatalogEntry[] = JSON.parse(contents);
  for (const entry of entries) {
    const result = parseUntPrerequisite(entry.prerequisites);
    counts[result.coverage]++;
    if (!entry.prerequisites.trim()) empty++;
    rows.push({ courseId: normalizeUntCourseId(entry.course_number), coverage: result.coverage, source: entry.prerequisites });
  }
}
rows.sort((a, b) => a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 : 0);
const unknownWithCourseCodes = rows.filter(row => row.coverage === "unknown" && /\b[A-Z]{2,5}\s*\d{4}[A-Z]?\b/i.test(row.source)).length;
const report = { corpusSha256: hash.digest("hex"), total: rows.length, counts, empty, unknownWithCourseCodes, courses: rows };
const json = JSON.stringify(report, null, 2) + "\n";
const reportPath = resolve(import.meta.dir, "coverage.json");
const markdown = `# UNT prerequisite parse coverage\n\nThis report measures the 656 bundled catalog entries, not parser accuracy. The golden set checks specific interpretations.\n\n| Classification | Courses |\n| --- | ---: |\n| Fully parsed | ${counts.full} |\n| Partial | ${counts.partial} |\n| Unknown | ${counts.unknown} |\n| Total | ${rows.length} |\n\nFully parsed includes ${empty} empty prerequisite strings. Partial means at least one requirement leaf was parsed and at least one remains unparsed. Unknown means no requirement leaf was parsed. Recognized annotations remain in the parse result and original source. Consent and equivalent routes count as parsed grammar but require advisor confirmation when used.\n\nUnknown classifications that still name a course code: ${unknownWithCourseCodes}. The required limit is fewer than 40.\n\nUnsupported mandatory major restrictions, GPA rules, placement rules, scoped department-credit totals, timing conditions, and ambiguous lists remain advisor checks. Course conjuncts are retained beside unknown leaves. Conditional major-dependent prose is kept whole. Scoped consent, equivalent, and replacement alternatives supply no closure facts, while mandatory AND siblings do. Mandatory consent does not waive course siblings. Unparsed text outside an explicitly attached escape blocks the entire rule. Equivalent alternatives retain an advisor-check leaf; direct named-course evidence still satisfies the alternative. Consent exceptions attach to preceding requirements, and replacement sentences attach to the named course. Explicit all, each, or both grade wording applies across listed semicolon groups; unmarked trailing grades stay local. Total-hour thresholds use explicit or accepted transcript hours.\n\n[Per-course classifications and original text](coverage.json) carry the corpus SHA-256, ${report.corpusSha256}.\n\nRegenerate from the repository root with \`bun tools/prereq-corpus/coverage.ts\`. Use \`--check\` to verify that the committed report matches the parser and catalog.\n`;
if (process.argv.includes("--check")) {
  if (await readFile(reportPath, "utf8") !== json || await readFile(resolve(import.meta.dir, "coverage.md"), "utf8") !== markdown) throw new Error("Prerequisite coverage report is stale.");
} else {
  await writeFile(reportPath, json);
  await writeFile(resolve(import.meta.dir, "coverage.md"), markdown);
}
console.log(JSON.stringify({ total: rows.length, ...counts, empty, unknownWithCourseCodes }));
