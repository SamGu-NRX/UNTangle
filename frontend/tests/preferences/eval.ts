#!/usr/bin/env bun
/**
 * Scores `parseIntent` against labeled phrases.
 *
 * Per entry, exactly:
 * - every hard field the label names must match, and every other hard field
 *   must keep its `emptyIntent()` default (a phrase about Fridays may not
 *   cap credits);
 * - soft preferences, when labeled, match as a set of key, strength and
 *   polarity;
 * - unsupported tags, when labeled, match as a multiset;
 * - the count of unparseable spans, when labeled, matches;
 * - every span slices the input to its own text, and no two spans overlap.
 *
 * It also prints field-level precision and recall: a field the parser set is
 * a prediction, a field the label sets is a fact, and a prediction is
 * correct only when its value equals the label's.
 *
 * Usage, from frontend/:
 *   bun --no-env-file tests/preferences/eval.ts
 *   bun --no-env-file tests/preferences/eval.ts --file=labels.json
 * A label file is a JSON array of `{ input, hard?, soft?, unsupportedTags?, unparseable? }`.
 *
 * Exit code 1 when an entry fails, or when an entry marked as a known miss
 * passes (so the mark gets removed). The corpus is our own wording, written
 * alongside the parser: passing it shows coverage, not accuracy.
 */

import { parseIntent, type ParseResult } from "../../src/lib/preferences/parse";
import { emptyIntent, type HardConstraints, type SoftPreference } from "../../src/lib/preferences/schema";
import { CORPUS, type CorpusEntry, type CorpusExpectation } from "./corpus";

type HardKey = keyof HardConstraints;

const DEFAULTS = emptyIntent().hard;
const HARD_KEYS = Object.keys(DEFAULTS) as HardKey[];

/** Canonical JSON: object keys sorted, lists of scalars sorted (days are sets). */
function canonical(value: unknown): string {
  const sortDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const items = v.map(sortDeep);
      return items.every((x) => x === null || typeof x !== "object") ? [...items].sort() : items;
    }
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, x]) => [k, sortDeep(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(sortDeep(value));
}

const softKeyOf = (p: SoftPreference): string => `${p.key}:${p.strength}:${p.positive === false ? "neg" : "pos"}`;

const tagsOf = (r: ParseResult): string[] =>
  r.notUnderstood.flatMap((n) => (n.reason === "unsupported" ? [n.tag] : [])).sort();

export function scoreEntry(entry: CorpusEntry, result: ParseResult = parseIntent(entry.input)): string[] {
  const problems: string[] = [];
  const { hard, soft } = result.intent;
  const expected: Partial<HardConstraints> = entry.expect.hard ?? {};

  for (const key of HARD_KEYS) {
    const want = key in expected ? expected[key] : DEFAULTS[key];
    if (canonical(hard[key]) !== canonical(want)) {
      const why = key in expected ? "expected" : "invented, expected default";
      problems.push(`hard.${key}: ${why} ${canonical(want)}, got ${canonical(hard[key])}`);
    }
  }
  if (entry.expect.soft) {
    const got = soft.map(softKeyOf).sort();
    const want = entry.expect.soft.map(softKeyOf).sort();
    if (canonical(got) !== canonical(want)) problems.push(`soft: expected [${want}], got [${got}]`);
  }
  if (entry.expect.unsupportedTags) {
    const got = tagsOf(result);
    const want = [...entry.expect.unsupportedTags].sort();
    if (canonical(got) !== canonical(want)) problems.push(`tags: expected [${want}], got [${got}]`);
  }
  if (entry.expect.unparseable !== undefined) {
    const got = result.notUnderstood.filter((n) => n.reason === "unparseable").length;
    if (got !== entry.expect.unparseable) problems.push(`unparseable spans: expected ${entry.expect.unparseable}, got ${got}`);
  }

  const spans = [...result.understood, ...result.notUnderstood].sort((a, b) => a.start - b.start);
  for (const [i, span] of spans.entries()) {
    const sliced = entry.input.slice(span.start, span.end);
    if (sliced !== span.text) problems.push(`span [${span.start},${span.end}) says "${span.text}" but the input has "${sliced}"`);
    const prev = spans[i - 1];
    if (prev && span.start < prev.end) problems.push(`spans overlap: [${prev.start},${prev.end}) and [${span.start},${span.end})`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Field-level precision and recall
// ---------------------------------------------------------------------------

type Tally = { tp: number; fp: number; fn: number };

/**
 * Adds one entry's predictions and facts to `tallies`, per field. Soft and
 * tags count only where the label states them, as in `scoreEntry`.
 */
function tallyEntry(entry: CorpusEntry, result: ParseResult, tallies: Map<string, Tally>): void {
  const bump = (field: string, k: keyof Tally) => {
    const t = tallies.get(field) ?? { tp: 0, fp: 0, fn: 0 };
    t[k]++;
    tallies.set(field, t);
  };
  const expected: Partial<HardConstraints> = entry.expect.hard ?? {};
  for (const key of HARD_KEYS) {
    const predicted = canonical(result.intent.hard[key]) !== canonical(DEFAULTS[key]);
    const fact = key in expected && canonical(expected[key]) !== canonical(DEFAULTS[key]);
    const right = predicted && fact && canonical(result.intent.hard[key]) === canonical(expected[key]);
    if (right) bump(`hard.${key}`, "tp");
    if (predicted && !right) bump(`hard.${key}`, "fp");
    if (fact && !right) bump(`hard.${key}`, "fn");
  }
  const multiset = (field: string, got: string[], want: string[]) => {
    const left = [...want];
    for (const g of got) {
      const i = left.indexOf(g);
      if (i >= 0) {
        left.splice(i, 1);
        bump(field, "tp");
      } else bump(field, "fp");
    }
    for (let i = 0; i < left.length; i++) bump(field, "fn");
  };
  if (entry.expect.soft) multiset("soft", result.intent.soft.map(softKeyOf), entry.expect.soft.map(softKeyOf));
  if (entry.expect.unsupportedTags) multiset("tags", tagsOf(result), entry.expect.unsupportedTags);
}

const pct = (n: number, d: number) => (d === 0 ? "   -" : `${Math.round((100 * n) / d)}%`.padStart(4));

function printTallies(tallies: Map<string, Tally>): void {
  console.log(`\n  field                precision  recall   (correct / set, correct / labeled)`);
  const facts: Tally = { tp: 0, fp: 0, fn: 0 };
  for (const [field, t] of [...tallies.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    console.log(`  ${field.padEnd(20)} ${pct(t.tp, t.tp + t.fp)}       ${pct(t.tp, t.tp + t.fn)}     (${t.tp}/${t.tp + t.fp}, ${t.tp}/${t.tp + t.fn})`);
    if (field === "tags") continue;
    facts.tp += t.tp;
    facts.fp += t.fp;
    facts.fn += t.fn;
  }
  console.log(`  ${"facts (hard + soft)".padEnd(20)} ${pct(facts.tp, facts.tp + facts.fp)}       ${pct(facts.tp, facts.tp + facts.fn)}`);
}

// ---------------------------------------------------------------------------

function loadLabelFile(raw: unknown): CorpusEntry[] {
  if (!Array.isArray(raw)) throw new Error("label file must be a JSON array");
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null) throw new Error(`label ${i} is not an object`);
    const rec: Record<string, unknown> = item;
    const input = rec.input ?? rec.text;
    if (typeof input !== "string") throw new Error(`label ${i} has no input text`);
    /** A labeled field, checked for its JSON shape; the comparison then checks its contents. */
    const field = <T,>(key: string, shape: (v: unknown) => boolean): T | undefined => {
      if (rec[key] === undefined) return undefined;
      if (!shape(rec[key])) throw new Error(`label ${i}: "${key}" has the wrong shape`);
      // SAFETY: `shape` checked the JSON kind; scoreEntry compares the values field by field.
      return rec[key] as T;
    };
    const isObject = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
    const expect: CorpusExpectation = {
      hard: field("hard", isObject),
      soft: field("soft", Array.isArray),
      unsupportedTags: field("unsupportedTags", (v) => Array.isArray(v) && v.every((t) => typeof t === "string")),
      unparseable: field("unparseable", (v) => typeof v === "number"),
    };
    return { id: typeof rec.id === "string" ? rec.id : `label/${i}`, input, expect };
  });
}

const familyOf = (entry: CorpusEntry): string => entry.id.split("/")[0];

function run(entries: CorpusEntry[], label: string): number {
  const tallies = new Map<string, Tally>();
  const families = new Map<string, { pass: number; total: number }>();
  const failures: Array<{ entry: CorpusEntry; problems: string[] }> = [];
  const misses: CorpusEntry[] = [];
  const fixedMisses: CorpusEntry[] = [];

  for (const entry of entries) {
    const result = parseIntent(entry.input);
    const problems = scoreEntry(entry, result);
    tallyEntry(entry, result, tallies);
    const family = families.get(familyOf(entry)) ?? { pass: 0, total: 0 };
    family.total++;
    if (problems.length === 0) family.pass++;
    families.set(familyOf(entry), family);
    if (entry.miss && problems.length === 0) fixedMisses.push(entry);
    else if (entry.miss) misses.push(entry);
    else if (problems.length > 0) failures.push({ entry, problems });
  }

  const passed = entries.length - failures.length - misses.length;
  console.log(`\n${label}: ${passed}/${entries.length} pass, ${misses.length} known misses, ${failures.length} failures\n`);
  for (const [name, f] of [...families.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    console.log(`  ${name.padEnd(12)} ${f.pass}/${f.total}`);
  }
  printTallies(tallies);
  if (misses.length > 0) {
    console.log(`\nKnown misses:`);
    for (const m of misses) console.log(`  ${m.id}: "${m.input}" (${m.miss})`);
  }
  for (const m of fixedMisses) console.log(`\nNow passes, remove its miss note: ${m.id}: "${m.input}"`);
  for (const { entry, problems } of failures) {
    console.log(`\nFAIL ${entry.id}: "${entry.input}"`);
    for (const p of problems) console.log(`    - ${p}`);
  }
  return failures.length === 0 && fixedMisses.length === 0 ? 0 : 1;
}

const fileArg = process.argv.find((a) => a.startsWith("--file="));
if (fileArg) {
  const path = fileArg.slice("--file=".length);
  process.exit(run(loadLabelFile(await Bun.file(path).json()), `labels (${path})`));
} else {
  process.exit(run(CORPUS, "corpus"));
}
