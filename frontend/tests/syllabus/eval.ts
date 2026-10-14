#!/usr/bin/env bun
/**
 * Scores `extractSyllabusFacts` against hand-labeled real UNT syllabi.
 *
 * Labels live in `docs/research/syllabus/labels.json` and contain, per
 * syllabus, only the URL, short identifying quotes, and the labeled facts.
 * The syllabus text itself is never committed: the label file names the
 * syllabus URL, and this script reads the reconstructed text from the study
 * cache (`tools/syllabus/.cache/text/<sha1(url)>.txt`), which
 * `tools/syllabus/run.ts` builds. Labels were hand-written from the same
 * text before the extractor was run on it.
 *
 * Scoring, per fact type:
 * - attendance policy: a prediction is correct when the extractor quotes a
 *   sentence that overlaps the labeled policy excerpt (content words);
 * - exam count: a prediction is correct when the count equals the label;
 * - grading weights: each labeled component (name, weight) must be matched
 *   by an extracted component with the same weight and an overlapping name.
 *
 * It prints precision, recall, and F1 per fact type, plus corpus coverage
 * (how many labeled planner courses had a findable syllabus at all - here,
 * all labeled entries were findable by construction; the coverage number for
 * the full course sweep lives in the study report).
 *
 * Usage, from frontend/:
 *   bun --no-env-file tests/syllabus/eval.ts
 *   bun --no-env-file tests/syllabus/eval.ts --file=../docs/research/syllabus/labels.json
 *
 * Exit code 1 when a label entry cannot be scored (missing cached text), so
 * a broken cache is never silently scored as zero.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractSyllabusFacts, normalizeForComparison } from "../../src/lib/syllabus/extract";

// import.meta.url (not Bun's import.meta.dir) so the script typechecks with
// plain TypeScript types as well as Bun's.
const REPO_ROOT = path.join(fileURLToPath(new URL("../../..", import.meta.url)), "");
const DEFAULT_LABELS = path.join(REPO_ROOT, "docs/research/syllabus/labels.json");
const CACHE_TEXT = path.join(REPO_ROOT, "tools/syllabus/.cache/text");

interface AttendanceLabel {
  present: boolean;
  excerpt?: string;
}
interface ExamCountLabel {
  present: boolean;
  count?: number;
  excerpt?: string;
}
interface GradingWeightsLabel {
  present: boolean;
  components?: { name: string; weightPct: number }[];
}
interface LabelEntry {
  id: string;
  course: string;
  section: string;
  faculty: string | null;
  profileUrl: string;
  syllabusUrl: string;
  docQuote: string;
  attendance: AttendanceLabel;
  examCount: ExamCountLabel;
  gradingWeights: GradingWeightsLabel;
}

interface Tally {
  tp: number;
  fp: number;
  fn: number;
}

const emptyTally = (): Tally => ({ tp: 0, fp: 0, fn: 0 });

function contentWords(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !["the", "and", "for", "you", "your", "will", "are", "with", "that", "this", "from", "have", "not"].includes(word)),
  );
}

function overlaps(a: string, b: string): boolean {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const word of wa) if (wb.has(word)) shared++;
  return shared / Math.min(wa.size, wb.size) >= 0.5;
}

function nameMatches(extracted: string, labeled: string): boolean {
  const a = normalizeForComparison(extracted);
  const b = normalizeForComparison(labeled);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a) || overlaps(extracted, labeled);
}

function rate(tally: Tally): { precision: number | null; recall: number | null; f1: number | null } {
  const precision = tally.tp + tally.fp > 0 ? tally.tp / (tally.tp + tally.fp) : null;
  const recall = tally.tp + tally.fn > 0 ? tally.tp / (tally.tp + tally.fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { precision, recall, f1 };
}

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function main(): void {
  const fileArg = process.argv.find((arg) => arg.startsWith("--file="))?.slice("--file=".length);
  const labelsPath = fileArg ? path.resolve(process.cwd(), fileArg) : DEFAULT_LABELS;
  const doc = JSON.parse(readFileSync(labelsPath, "utf8")) as { entries: LabelEntry[] };

  const attendance = emptyTally();
  const examCount = emptyTally();
  const weights = emptyTally();
  const weightsComponents = emptyTally();
  const misses: string[] = [];
  let scored = 0;

  for (const entry of doc.entries) {
    const urlKey = createHash("sha1").update(entry.syllabusUrl).digest("hex");
    let text: string;
    try {
      text = readFileSync(path.join(CACHE_TEXT, `${urlKey}.txt`), "utf8");
    } catch {
      console.error(`cannot score ${entry.id}: no cached text for ${entry.syllabusUrl}`);
      console.error("run tools/syllabus/run.ts first to rebuild the study cache");
      process.exit(1);
    }
    const facts = extractSyllabusFacts(text);
    scored++;

    // Attendance
    if (facts.attendancePolicy.found) {
      const labeled = entry.attendance.present && entry.attendance.excerpt && overlaps(facts.attendancePolicy.source.quote, entry.attendance.excerpt);
      if (entry.attendance.present && labeled) attendance.tp++;
      else {
        attendance.fp++;
        misses.push(`${entry.id} attendance: extracted ${entry.attendance.present ? "wrong sentence" : "policy where none stated"}: "${facts.attendancePolicy.source.quote.slice(0, 110)}"`);
      }
    } else if (entry.attendance.present) {
      attendance.fn++;
      misses.push(`${entry.id} attendance: missed labeled policy: "${entry.attendance.excerpt?.slice(0, 110)}"`);
    }

    // Exam count
    if (facts.examCount.found) {
      if (entry.examCount.present && entry.examCount.count === facts.examCount.count) examCount.tp++;
      else {
        examCount.fp++;
        misses.push(`${entry.id} examCount: extracted ${facts.examCount.count}, label ${entry.examCount.present ? entry.examCount.count : "absent"}: "${facts.examCount.source.quote.slice(0, 110)}"`);
      }
    } else if (entry.examCount.present) {
      examCount.fn++;
      misses.push(`${entry.id} examCount: missed labeled count ${entry.examCount.count}: "${entry.examCount.excerpt?.slice(0, 110)}"`);
    }

    // Grading weights
    if (facts.gradingWeights.found) {
      const extracted = facts.gradingWeights.components;
      const labeledComponents = entry.gradingWeights.present ? entry.gradingWeights.components ?? [] : [];
      const matched = new Set<number>();
      for (const label of labeledComponents) {
        const hit = extracted.findIndex((c, i) => !matched.has(i) && c.weightPct === label.weightPct && nameMatches(c.name, label.name));
        if (hit >= 0) {
          matched.add(hit);
          weightsComponents.tp++;
        } else {
          weightsComponents.fn++;
          misses.push(`${entry.id} weights: missed labeled component ${label.name} ${label.weightPct}%`);
        }
      }
      for (let i = 0; i < extracted.length; i++) {
        if (!matched.has(i)) {
          weightsComponents.fp++;
          misses.push(`${entry.id} weights: extra component ${extracted[i].name} ${extracted[i].weightPct}%`);
        }
      }
      if (entry.gradingWeights.present && labeledComponents.length > 0 && matched.size === labeledComponents.length) weights.tp++;
      else if (!entry.gradingWeights.present) {
        weights.fp++;
        misses.push(`${entry.id} weights: extracted weights where none stated`);
      }
    } else if (entry.gradingWeights.present) {
      weights.fn++;
      for (const label of entry.gradingWeights.components ?? []) {
        weightsComponents.fn++;
        misses.push(`${entry.id} weights: missed labeled component ${label.name} ${label.weightPct}%`);
      }
      misses.push(`${entry.id} weights: found no weight block for labeled grading table`);
    }
  }

  console.log(`scored ${scored} labeled syllabi from ${labelsPath}`);
  console.log("");
  const rows: [string, Tally, Tally][] = [
    ["attendance policy", attendance, attendance],
    ["exam count", examCount, examCount],
    ["grading weights (doc level)", weights, weights],
    ["grading weights (component level)", weightsComponents, weightsComponents],
  ];
  console.log("fact type                       precision   recall      f1        (tp/fp/fn)");
  for (const [name, tally] of rows) {
    const r = rate(tally);
    console.log(
      `${name.padEnd(30)}  ${pct(r.precision).padStart(8)}  ${pct(r.recall).padStart(8)}  ${pct(r.f1).padStart(8)}   (${tally.tp}/${tally.fp}/${tally.fn})`,
    );
  }
  if (misses.length > 0) {
    console.log("");
    console.log("misclassifications:");
    for (const miss of misses) console.log(`  - ${miss}`);
  }
}

main();
