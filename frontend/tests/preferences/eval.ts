/**
 * Field-level precision/recall evaluation over the labeled corpus.
 *
 * Run with:  bun run frontend/tests/preferences/eval.ts
 *
 * Every expected field is scored separately: a field the parser left null or
 * empty when the label sets it counts as a false negative; a field the
 * parser set when the label does not include it counts as a false positive;
 * a field set to the wrong value counts as both. The evaluation never hides
 * a miss inside an aggregate: per-family tables list the entry ids involved.
 */

import { parseIntent } from "../../src/lib/preferences/parse";
import { CORPUS, type CorpusEntry } from "./corpus";
import type { PreferenceIntent } from "../../src/lib/preferences/schema";

type Tally = { tp: number; fp: number; fn: number };

const emptyTally = (): Tally => ({ tp: 0, fp: 0, fn: 0 });

const add = (t: Tally, kind: "tp" | "fp" | "fn") => {
  t[kind] += 1;
};

const setKey = (day: string, start: number, end: number, label?: string) =>
  `${day}|${start}|${end}|${label ?? ""}`;

/** Score one scalar field: exact expected value vs exact predicted value. */
function scoreScalar(
  tallies: Map<string, Tally>,
  field: string,
  expected: unknown,
  predicted: unknown,
) {
  const t = tallies.get(field) ?? emptyTally();
  const e = expected !== undefined && expected !== null && expected !== false;
  const p = predicted !== undefined && predicted !== null && predicted !== false;
  if (e && p && expected === predicted) add(t, "tp");
  else if (e && p) {
    add(t, "fn");
    add(t, "fp");
  } else if (e) add(t, "fn");
  else if (p) add(t, "fp");
  tallies.set(field, t);
}

/** Score a string-set field (days off, course lists, tags) item by item. */
function scoreSet(tallies: Map<string, Tally>, field: string, expected: string[], predicted: string[]) {
  const t = tallies.get(field) ?? emptyTally();
  for (const item of expected) {
    if (predicted.includes(item)) add(t, "tp");
    else add(t, "fn");
  }
  for (const item of predicted) {
    if (!expected.includes(item)) add(t, "fp");
  }
  tallies.set(field, t);
}

/** Score blocked times as an unordered set of day|start|end|label keys. */
function scoreBlocked(tallies: Map<string, Tally>, expected: string[], predicted: string[]) {
  scoreSet(tallies, "blockedTimes", expected, predicted);
}

/** Score soft preferences: presence at any strength, plus strength checks. */
function scoreSoft(
  tallies: Map<string, Tally>,
  entry: CorpusEntry,
  predicted: { key: string; strength: string }[],
) {
  const expect = entry.expect ?? {};
  const expectedKeys = new Set<string>(expect.soft ?? []);
  const expectedStrong = new Set<string>(expect.softStrong ?? []);
  const t = tallies.get("soft") ?? emptyTally();
  for (const key of expectedKeys) {
    const hit = predicted.find((p) => p.key === key);
    if (!hit) add(t, "fn");
    else if (expectedStrong.has(key) && hit.strength !== "strong") add(t, "fn");
    else add(t, "tp");
  }
  for (const p of predicted) {
    if (!expectedKeys.has(p.key)) add(t, "fp");
  }
  tallies.set("soft", t);
}

/** Score the instructor preference as a whole value. */
function scoreInstructor(
  tallies: Map<string, Tally>,
  expected: CorpusEntry["expect"] extends infer E ? E : never,
  predicted: PreferenceIntent["instructor"],
) {
  const t = tallies.get("instructor") ?? emptyTally();
  const e = expected?.instructor ?? null;
  if (!e && !predicted) return;
  if (e && predicted) {
    const same =
      e.kind === predicted.kind &&
      (e.kind !== "named" || predicted.kind !== "named" || e.name === predicted.name);
    if (same) add(t, "tp");
    else {
      add(t, "fn");
      add(t, "fp");
    }
  } else if (e) add(t, "fn");
  else add(t, "fp");
  tallies.set("instructor", t);
}

export type EvalRow = {
  id: string;
  text: string;
  strictMatch: boolean;
  fieldMisses: string[];
};

export type EvalReport = {
  entries: number;
  strictMatched: number;
  fields: Record<string, Tally>;
  families: Record<string, { entries: number; strictMatched: number }>;
  rows: EvalRow[];
};

export function evaluate(): EvalReport {
  const tallies = new Map<string, Tally>();
  const rows: EvalRow[] = [];
  const families: Record<string, { entries: number; strictMatched: number }> = {};
  let strictMatched = 0;

  for (const entry of CORPUS) {
    const { intent, notUnderstood } = parseIntent(entry.text);
    const expect = entry.expect ?? {};

    scoreScalar(tallies, "earliestStart", expect.earliestStart, intent.hard.earliestStart);
    scoreScalar(tallies, "latestEnd", expect.latestEnd, intent.hard.latestEnd);
    scoreScalar(tallies, "creditMin", expect.creditMin, intent.hard.creditMin);
    scoreScalar(tallies, "creditMax", expect.creditMax, intent.hard.creditMax);
    scoreScalar(tallies, "openSeatsOnly", expect.openSeatsOnly, intent.hard.openSeatsOnly);
    scoreScalar(tallies, "campusScope", expect.campusScope, intent.hard.campusScope);
    scoreScalar(tallies, "mode", expect.mode, intent.hard.mode);

    const daysOffE = expect.daysOff ?? [];
    const daysOffP = intent.hard.daysOff;
    scoreSet(tallies, "daysOff", daysOffE, daysOffP);

    scoreSet(tallies, "wantedCourses", expect.wantedCourses ?? [], intent.hard.wantedCourses);
    scoreSet(tallies, "avoidedCourses", expect.avoidedCourses ?? [], intent.hard.avoidedCourses);

    const blockedE = (expect.blockedTimes ?? []).map((b) => setKey(b.day, b.start, b.end, b.label));
    const blockedP = intent.hard.blockedTimes.map((b) => setKey(b.day, b.start, b.end, b.label));
    scoreBlocked(tallies, blockedE, blockedP);

    scoreSoft(
      tallies,
      entry,
      intent.soft.map((s) => ({ key: s.key, strength: s.strength })),
    );

    scoreInstructor(tallies, entry.expect, intent.instructor);

    const tagsE = entry.unsupportedTags ?? [];
    const tagsP = notUnderstood.filter((n) => n.reason === "unsupported").map((n) => n.tag ?? "");
    scoreSet(tallies, "unsupportedTags", tagsE, tagsP);

    const unparseE = entry.unparseable ?? false;
    const unparseP = notUnderstood.some((n) => n.reason === "unparseable");
    const unT = tallies.get("unparseable") ?? emptyTally();
    if (unparseE && unparseP) add(unT, "tp");
    else if (unparseE) add(unT, "fn");
    else if (unparseP) add(unT, "fp");
    tallies.set("unparseable", unT);

    // A field-level miss: any expected set item missing or any mismatch.
    const fieldMisses: string[] = [];
    if ((expect.earliestStart ?? null) !== (intent.hard.earliestStart ?? null)) fieldMisses.push("earliestStart");
    if ((expect.latestEnd ?? null) !== (intent.hard.latestEnd ?? null)) fieldMisses.push("latestEnd");
    if ((expect.creditMin ?? null) !== (intent.hard.creditMin ?? null)) fieldMisses.push("creditMin");
    if ((expect.creditMax ?? null) !== (intent.hard.creditMax ?? null)) fieldMisses.push("creditMax");
    if ((expect.openSeatsOnly ?? false) !== (intent.hard.openSeatsOnly ?? false)) fieldMisses.push("openSeatsOnly");
    if ((expect.campusScope ?? null) !== (intent.hard.campusScope ?? null)) fieldMisses.push("campusScope");
    if ((expect.mode ?? null) !== (intent.hard.mode ?? null)) fieldMisses.push("mode");
    if (daysOffE.length !== daysOffP.length || !daysOffE.every((d) => daysOffP.includes(d))) fieldMisses.push("daysOff");
    if ((expect.wantedCourses ?? []).length !== intent.hard.wantedCourses.length || !(expect.wantedCourses ?? []).every((c) => intent.hard.wantedCourses.includes(c))) fieldMisses.push("wantedCourses");
    if ((expect.avoidedCourses ?? []).length !== intent.hard.avoidedCourses.length || !(expect.avoidedCourses ?? []).every((c) => intent.hard.avoidedCourses.includes(c))) fieldMisses.push("avoidedCourses");
    if (blockedE.length !== blockedP.length || !blockedE.every((b) => blockedP.includes(b))) fieldMisses.push("blockedTimes");
    for (const key of expect.soft ?? []) {
      const hit = intent.soft.find((s) => s.key === key);
      if (!hit) fieldMisses.push(`soft.${key}`);
      else if ((expect.softStrong ?? []).includes(key) && hit.strength !== "strong") fieldMisses.push(`soft.${key}.strength`);
    }
    for (const s of intent.soft) if (!(expect.soft ?? []).includes(s.key)) fieldMisses.push(`soft.${s.key}.spurious`);
    const expInstructor = expect.instructor ?? null;
    const predInstructor = intent.instructor;
    if (!expInstructor !== !predInstructor) fieldMisses.push("instructor");
    else if (expInstructor && predInstructor) {
      const same =
        expInstructor.kind === predInstructor.kind &&
        (expInstructor.kind !== "named" || predInstructor.kind !== "named" || expInstructor.name === predInstructor.name);
      if (!same) fieldMisses.push("instructor");
    }
    if (tagsE.length !== tagsP.length || !tagsE.every((tag) => tagsP.includes(tag))) fieldMisses.push("unsupportedTags");
    if (unparseE !== unparseP) fieldMisses.push("unparseable");

    const ok = fieldMisses.length === 0;
    if (ok) strictMatched += 1;
    const fam = families[entry.kind] ?? { entries: 0, strictMatched: 0 };
    fam.entries += 1;
    if (ok) fam.strictMatched += 1;
    families[entry.kind] = fam;
    rows.push({ id: entry.id, text: entry.text, strictMatch: ok, fieldMisses });
  }

  const fields: Record<string, Tally> = {};
  for (const [field, t] of [...tallies.entries()].sort()) fields[field] = t;

  return { entries: CORPUS.length, strictMatched, fields, families, rows };
}

function precisionRecall(t: Tally): { precision: number | null; recall: number | null; f1: number | null } {
  const precision = t.tp + t.fp === 0 ? null : t.tp / (t.tp + t.fp);
  const recall = t.tp + t.fn === 0 ? null : t.tp / (t.tp + t.fn);
  const f1 = precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function main() {
  const report = evaluate();
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

  console.log(`# Preference parser evaluation\n`);
  console.log(`Corpus entries: ${report.entries}`);
  console.log(`Strictly correct entries (every expected field exact): ${report.strictMatched} (${pct(report.strictMatched / report.entries)})\n`);

  console.log(`## Field-level metrics\n`);
  console.log(`| field | tp | fp | fn | precision | recall | f1 |`);
  console.log(`|---|---|---|---|---|---|---|`);
  for (const [field, t] of Object.entries(report.fields)) {
    const { precision, recall, f1 } = precisionRecall(t);
    console.log(`| ${field} | ${t.tp} | ${t.fp} | ${t.fn} | ${pct(precision)} | ${pct(recall)} | ${pct(f1)} |`);
  }

  console.log(`\n## Per-family strict accuracy\n`);
  console.log(`| family | entries | strict |`);
  console.log(`|---|---|---|`);
  for (const [family, f] of Object.entries(report.families)) {
    console.log(`| ${family} | ${f.entries} | ${f.strictMatched}/${f.entries} |`);
  }

  const failing = report.rows.filter((r) => !r.strictMatch);
  if (failing.length > 0) {
    console.log(`\n## Entries with misses (${failing.length})\n`);
    for (const r of failing) {
      console.log(`- ${r.id}: ${JSON.stringify(r.text)} — ${r.fieldMisses.join(", ")}`);
    }
  }

  // Exit code signals failures for CI; detailed listing above explains them.
  if (failing.length > 0) process.exitCode = 1;
}

if (import.meta.main) main();
