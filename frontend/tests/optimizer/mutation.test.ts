/**
 * Mutation checks: each test copies src/lib/optimizer to a temp directory,
 * plants one bug, and asserts that the check meant to catch that kind of bug
 * fails on the mutant. A check that passes on a planted bug is not checking
 * anything. The planted text must occur exactly once, so a refactor that
 * moves it fails loudly here instead of silently testing nothing.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAgainstReference, checkBudgets, checkExplanations, checkLargeInstancesValid, type OptimizeFn } from "./checks";

const SOURCE = join(import.meta.dir, "../../src/lib/optimizer");
const created: string[] = [];
afterAll(() => created.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function mutant(file: string, from: string, to: string): Promise<OptimizeFn> {
  const dir = mkdtempSync(join(tmpdir(), "untangle-optimizer-mutant-"));
  created.push(dir);
  cpSync(SOURCE, dir, { recursive: true });
  const path = join(dir, file);
  const text = readFileSync(path, "utf8");
  const occurrences = text.split(from).length - 1;
  if (occurrences !== 1) throw new Error(`mutation target in ${file} occurs ${occurrences} times: ${from}`);
  writeFileSync(path, text.replace(from, to));
  const module = (await import(join(dir, "optimize.ts"))) as { optimize: OptimizeFn };
  return module.optimize;
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
const agreement = (fn: OptimizeFn) => checkAgainstReference(fn, SEEDS);
const explanations = (fn: OptimizeFn) => checkExplanations(fn, SEEDS).failures;

const MUTATIONS: Array<{ name: string; file: string; from: string; to: string; check: (fn: OptimizeFn) => string[] }> = [
  {
    name: "classes that only touch count as overlapping",
    file: "prepare.ts",
    from: "return a.day === b.day && a.start < b.end && b.start < a.end;",
    to: "return a.day === b.day && a.start <= b.end && b.start <= a.end;",
    check: agreement,
  },
  {
    name: "a section's own meetings are not checked for overlap",
    file: "prepare.ts",
    from: "if (overlaps(meetings[i], meetings[j])) {",
    to: "if (false) {",
    check: agreement,
  },
  {
    name: "an unknown walk is treated as free",
    file: "score.ts",
    from: "export const UNKNOWN_WALK_SECONDS = 600;",
    to: "export const UNKNOWN_WALK_SECONDS = 0;",
    check: agreement,
  },
  {
    name: "days off are ignored",
    file: "prepare.ts",
    from: "if (off.has(meeting.day)) return false;",
    to: "",
    check: agreement,
  },
  {
    name: "a blocked time that only touches a class blocks it",
    file: "prepare.ts",
    from: "if (block.day === meeting.day && meeting.start < block.end && block.start < meeting.end) return false;",
    to: "if (block.day === meeting.day && meeting.start <= block.end && block.start <= meeting.end) return false;",
    check: agreement,
  },
  {
    name: "a credit total equal to the limit is rejected",
    file: "search.ts",
    from: "prepared.totalCredits > prepared.maxCredits",
    to: "prepared.totalCredits >= prepared.maxCredits",
    check: agreement,
  },
  {
    name: "the walking check is skipped between classes during the search",
    file: "search.ts",
    from: "if (bufferSeconds !== null && window * 60 < (seconds ?? UNKNOWN_WALK_SECONDS) + bufferSeconds) return -1;",
    to: "",
    check: agreement,
  },
  {
    name: "the lower bound overestimates (inadmissible)",
    file: "search.ts",
    from: "const bound = lowerSelf + dayPrice * (popcount(nextDays) + mostNewDays) + pairs;",
    to: "const bound = lowerSelf + dayPrice * (popcount(nextDays) + mostNewDays + 1) + pairs;",
    check: agreement,
  },
  {
    name: "pairs another class could still split are counted as certain",
    file: "search.ts",
    from: "if (filled > 0) {",
    to: "if (false) {",
    check: agreement,
  },
  {
    name: "the id tie-break is reversed",
    file: "search.ts",
    from: "if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;",
    to: "if (a[i] !== b[i]) return a[i] < b[i] ? 1 : -1;",
    check: agreement,
  },
  {
    name: "the dearer twin is kept",
    file: "prepare.ts",
    from: "candidate.self < current.self ||",
    to: "candidate.self > current.self ||",
    check: agreement,
  },
  {
    name: "the diversity rule is off",
    file: "prepare.ts",
    from: "return Math.max(1, Math.min(2, variable));",
    to: "return 0;",
    check: agreement,
  },
  {
    name: "the diversity rule counts room changes as different",
    file: "prepare.ts",
    from: "const signature = timeSignatureOf(section.meetings);",
    to: "const signature = fullSignatureOf(section.meetings);",
    check: agreement,
  },
  {
    name: "the clock is never read",
    file: "search.ts",
    from: "if ((budget.nodes & 31) === 0 && budget.now() > budget.deadline) throw new BudgetExhausted();",
    to: "",
    check: checkBudgets,
  },
  {
    name: "a cut-off search is reported as optimal",
    file: "optimize.ts",
    from: 'return ranOut ? { status: "feasible", schedules, stats: stats() } : { status: "optimal", schedules, stats: stats() };',
    to: 'return { status: "optimal", schedules, stats: stats() };',
    check: checkBudgets,
  },
  {
    name: "a cut-off schedule is marked proven",
    file: "optimize.ts",
    from: "if (outcome.best !== null) picks.push({ leaf: outcome.best, proven: false });",
    to: "if (outcome.best !== null) picks.push({ leaf: outcome.best, proven: true });",
    check: checkBudgets,
  },
  {
    name: "the explanation is not reduced",
    file: "explain.ts",
    from: "if (verdict === false) kept = pruned;",
    to: "if (verdict === false && kept.length < 0) kept = pruned;",
    check: explanations,
  },
  {
    name: "the explanation drops a member it needs",
    file: "explain.ts",
    from: "const verdict = check(restrictTo(request, pruned));",
    to: 'const verdict = member.kind === "course" ? false : check(restrictTo(request, pruned));',
    check: explanations,
  },
  {
    name: "a locked section is not forced",
    file: "prepare.ts",
    from: "(locked === undefined || section.id === locked)",
    to: "(locked === undefined || section.id !== null)",
    check: (fn) => checkLargeInstancesValid(fn, [1, 2, 3, 4, 5, 6]),
  },
];

describe("each check catches its planted bug", () => {
  for (const mutation of MUTATIONS) {
    test(mutation.name, async () => {
      const fn = await mutant(mutation.file, mutation.from, mutation.to);
      // A mutant that throws (for example on the search/scorer cost
      // cross-check in optimize.ts) has been caught too.
      let failures: string[];
      try {
        failures = mutation.check(fn);
      } catch (error) {
        failures = [String(error)];
      }
      expect(failures.length).toBeGreaterThan(0);
    });
  }
});
