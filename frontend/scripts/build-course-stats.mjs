#!/usr/bin/env bun
/**
 * Builds frontend/src/lib/generated/course-grade-stats.json from the backend
 * submodule's committed grade-distribution file (data/grade-distributions/
 * complete.json, pinned at 0a49d4d). Pure offline aggregation — no network.
 * GPA formula mirrors backend src/lib/grade-metrics.ts calculateGpa:
 * points = A*4 + B*3 + C*2 + D*1 over graded = A+B+C+D+F; null when graded 0.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const repoRoot = resolve(frontendRoot, "..");
const inputPath =
  process.argv[2] ?? resolve(repoRoot, "backend", "data", "grade-distributions", "complete.json");
const outputPath = resolve(frontendRoot, "src", "lib", "generated", "course-grade-stats.json");

const SEASON_ORDER = { Spring: 0, Summer: 1, "Summer I": 1, "Summer II": 1, Fall: 2, Winter: 3 };
function termKey(term) {
  const m = /^(\d{4})\s+(.+)$/.exec(term);
  if (!m) return 0;
  return Number(m[1]) * 10 + (SEASON_ORDER[m[2]] ?? 0);
}

const rows = JSON.parse(readFileSync(inputPath, "utf8"));
if (!Array.isArray(rows) || rows.length === 0) throw new Error(`no rows parsed from ${inputPath}`);

const byCourse = new Map();
for (const row of rows) {
  if (!row || typeof row.subj !== "string" || typeof row.num !== "string" || !row.grades) continue;
  const code = `${row.subj} ${row.num}`;
  const g = row.grades;
  const num = (v) => (v == null ? 0 : Number(v) || 0);
  const enrollment = Object.values(g).reduce((sum, v) => sum + num(v), 0);
  const entry = byCourse.get(code) ?? {
    a: 0, b: 0, c: 0, d: 0, f: 0,
    sections: 0, students: 0, termSet: new Set(),
  };
  entry.a += num(g.A); entry.b += num(g.B); entry.c += num(g.C);
  entry.d += num(g.D); entry.f += num(g.F);
  entry.sections += 1;
  entry.students += enrollment;
  if (typeof row.term === "string") entry.termSet.add(row.term);
  byCourse.set(code, entry);
}

const stats = {};
for (const [code, e] of byCourse) {
  const graded = e.a + e.b + e.c + e.d + e.f;
  const gpa = graded === 0 ? null : Math.round(((e.a * 4 + e.b * 3 + e.c * 2 + e.d) / graded) * 100) / 100;
  const terms = [...e.termSet].sort((x, y) => termKey(x) - termKey(y));
  stats[code] = {
    gpa,
    sections: e.sections,
    students: e.students,
    terms: terms.length,
    firstTerm: terms[0] ?? null,
    lastTerm: terms[terms.length - 1] ?? null,
  };
}

const payload = {
  _meta: {
    source: "backend submodule data/grade-distributions/complete.json @ 0a49d4d (jeffw16/unt-grade-distributions, MIT)",
    generatedAt: new Date().toISOString(),
    rows: rows.length,
    courses: Object.keys(stats).length,
    gpaFormula: "(A*4 + B*3 + C*2 + D) / (A+B+C+D+F), null when graded = 0",
    terms: "2017-2019 terms present in the source data",
  },
  stats,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(payload, null, 1) + "\n");
const withGpa = Object.values(stats).filter((s) => s.gpa !== null).length;
console.log(`rows=${payload._meta.rows} courses=${payload._meta.courses} withGpa=${withGpa}`);
console.log(`CSCE 2100 =`, JSON.stringify(stats["CSCE 2100"]));
