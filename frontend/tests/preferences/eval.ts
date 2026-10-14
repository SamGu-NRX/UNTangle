#!/usr/bin/env bun
/**
 * Field-level evaluator for the schedule-preferences parser.
 *
 * Scores every labeled phrase by running `parseIntent` and comparing the
 * result to the entry's expectation, exactly:
 *
 * - every hard field named in the expectation must match, and every hard
 *   field NOT named must equal its default from `emptyIntent()` (the
 *   no-invention rule: a phrase about Fridays may not silently cap credits);
 * - soft preferences must match as an exact set, including polarity;
 * - unsupported tags must match as an exact multiset;
 * - the residual unparseable-span count must match when one is specified;
 * - span invariants: every reported span must slice the original input to
 *   exactly its own text, and no two reported spans may overlap.
 *
 * Usage:
 *   bun frontend/tests/preferences/eval.ts
 *       Score the labeled corpus in `corpus.ts`.
 *   bun frontend/tests/preferences/eval.ts --file=labels.json
 *       Score a held-out label file instead: a JSON array of entries in the
 *       same `{ input, hard?, soft?, unsupportedTags?, unparseable? }` shape
 *       (see `CorpusExpectation` in `corpus.ts`). Exit code 0 only if all pass.
 *
 * This corpus was developed alongside the parser, so a full pass here is
 * coverage evidence, not an independent benchmark. Held-out scoring exists
 * for phrases the parser has not seen.
 */

import { parseIntent } from "../../src/lib/preferences/parse";
import { emptyIntent, type HardConstraints, type SoftPreference } from "../../src/lib/preferences/schema";
import { CORPUS, type CorpusEntry, type CorpusExpectation } from "./corpus";

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

type HardKey = keyof HardConstraints;

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
}

/** Canonical form: sort arrays whose order is not meaningful, keep the rest. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(sortDeep);
    const isScalar = items.every((x) => x === null || typeof x !== "object");
    // Day lists and span lists are sets; blocked times are compared in day order.
    return (isScalar ? [...items].sort() : [...items]).map((x) => x);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([k1], [k2]) => (k1 < k2 ? -1 : 1))
        .map(([k, v]) => [k, sortDeep(v)]),
    );
  }
  return value;
}

function softKeyOf(p: SoftPreference): string {
  return `${p.key}:${p.strength}:${p.positive === false ? "neg" : "pos"}`;
}

// ---------------------------------------------------------------------------
// Entry scoring
// ---------------------------------------------------------------------------

export type EntryProblems = string[];

export function scoreEntry(entry: CorpusEntry, defaults: HardConstraints): EntryProblems {
  const problems: EntryProblems = [];
  const result = parseIntent(entry.input);
  const { hard, soft } = result.intent;

  // - Hard fields: expected values, and no-invention everywhere else.
  const expectedHard = entry.expect.hard ?? {};
  for (const key of Object.keys(defaults) as HardKey[]) {
    const actual = hard[key];
    if (key in expectedHard) {
      if (!deepEqual(actual, (expectedHard as Record<string, unknown>)[key])) {
        problems.push(
          `hard.${key}: expected ${JSON.stringify(sortDeep((expectedHard as Record<string, unknown>)[key]))}, got ${JSON.stringify(sortDeep(actual))}`,
        );
      }
    } else if (!deepEqual(actual, defaults[key])) {
      problems.push(
        `hard.${key}: invented (expected default ${JSON.stringify(sortDeep(defaults[key]))}, got ${JSON.stringify(sortDeep(actual))})`,
      );
    }
  }

  // - Soft preferences as an exact multiset.
  if (entry.expect.soft) {
    const got = soft.map(softKeyOf).sort();
    const want = entry.expect.soft.map(softKeyOf).sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`soft: expected [${want.join(", ")}], got [${got.join(", ")}]`);
    }
  }

  // - Unsupported tags as an exact multiset.
  if (entry.expect.unsupportedTags) {
    const got = result.notUnderstood
      .filter((n) => n.reason === "unsupported")
      .map((n) => n.tag ?? "<no-tag>")
      .sort();
    const want = [...entry.expect.unsupportedTags].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`unsupportedTags: expected [${want.join(", ")}], got [${got.join(", ")}]`);
    }
  }

  // - Residual count, when pinned.
  if (entry.expect.unparseable !== undefined) {
    const got = result.notUnderstood.filter((n) => n.reason === "unparseable").length;
    if (got !== entry.expect.unparseable) {
      problems.push(`unparseable spans: expected ${entry.expect.unparseable}, got ${got}`);
    }
  }

  // - Span invariants: exact original-text slices, no overlaps.
  const spans = [...result.understood, ...result.notUnderstood];
  for (const span of spans) {
    const sliced = entry.input.slice(span.start, span.end);
    if (sliced !== span.text) {
      problems.push(`span misaligned: [${span.start},${span.end}) text "${span.text}" but input slice is "${sliced}"`);
    }
  }
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      problems.push(
        `overlapping spans: [${sorted[i - 1].start},${sorted[i - 1].end}) and [${sorted[i].start},${sorted[i].end})`,
      );
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Held-out label file support (JSON, same expectation shape)
// ---------------------------------------------------------------------------

function loadHeldOutEntries(raw: unknown): CorpusEntry[] {
  if (!Array.isArray(raw)) throw new Error("held-out label file must be a JSON array");
  return raw.map((item, i) => {
    const rec = item as Record<string, unknown>;
    const input = (rec.input ?? rec.text) as string | undefined;
    if (typeof input !== "string") throw new Error(`held-out entry ${i} has no input text`);
    const expect: CorpusExpectation = {
      hard: rec.hard as CorpusExpectation["hard"],
      soft: rec.soft as CorpusExpectation["soft"],
      unsupportedTags: rec.unsupportedTags as string[],
      unparseable: rec.unparseable as number | undefined,
    };
    return { id: (rec.id as string) ?? `held-out/${i}`, input, expect };
  });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function familyOf(entry: CorpusEntry): string {
  const slash = entry.id.indexOf("/");
  return slash > 0 ? entry.id.slice(0, slash) : entry.id;
}

function run(entries: CorpusEntry[], label: string): number {
  const defaults = emptyIntent().hard;
  const failures: { entry: CorpusEntry; problems: string[] }[] = [];
  const families = new Map<string, { pass: number; total: number }>();

  for (const entry of entries) {
    let problems: string[];
    try {
      problems = scoreEntry(entry, defaults);
    } catch (err) {
      console.error(`\nTHREW on ${entry.id}: "${entry.input}"`);
      throw err;
    }
    const fam = familyOf(entry);
    const bucket = families.get(fam) ?? { pass: 0, total: 0 };
    bucket.total++;
    if (problems.length === 0) bucket.pass++;
    else failures.push({ entry, problems });
    families.set(fam, bucket);
  }

  console.log(`\n${label}: ${entries.length - failures.length}/${entries.length} entries pass\n`);
  for (const [fam, bucket] of [...families.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const mark = bucket.pass === bucket.total ? "ok  " : "FAIL";
    console.log(`  [${mark}] ${fam.padEnd(12)} ${bucket.pass}/${bucket.total}`);
  }
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const { entry, problems } of failures) {
      console.log(`\n  ${entry.id}: "${entry.input}"`);
      for (const p of problems) console.log(`    - ${p}`);
    }
  }

  const tagCounts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.expect.unsupportedTags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  console.log(`\n  expected tag coverage: ${[...tagCounts.entries()].sort().map(([t, c]) => `${t}=${c}`).join(", ") || "none"}`);

  return failures.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------

const fileArg = process.argv.find((a) => a.startsWith("--file="));
if (fileArg) {
  const path = fileArg.slice("--file=".length);
  const raw = await Bun.file(path).json();
  process.exit(run(loadHeldOutEntries(raw), `held-out labels (${path})`));
} else {
  process.exit(run(CORPUS, "labeled corpus"));
}
