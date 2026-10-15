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
import {
  checkAgainstReference,
  checkBudgets,
  checkExplanations,
  checkLargeInstancesValid,
  checkRegressions,
  termInstance,
  type OptimizeFn,
} from "./checks";

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
  const mutated = (await import(join(dir, "optimize.ts"))) as { optimize: OptimizeFn };
  return mutated.optimize;
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
const agreement = (fn: OptimizeFn) => checkAgainstReference(fn, SEEDS);
const TERM_SEEDS = Array.from({ length: 300 }, (_, i) => 7001 + i);
const datedAgreement = (fn: OptimizeFn) => checkAgainstReference(fn, TERM_SEEDS, (seed) => termInstance(seed, true));
const explanations = (fn: OptimizeFn) => checkExplanations(fn, [...SEEDS, ...Array.from({ length: 150 }, (_, i) => 401 + i)]).failures;

const MUTATIONS: Array<{ name: string; file: string; from: string; to: string; check: (fn: OptimizeFn) => string[] }> = [
  {
    name: "segment bounds are summed and double-count pairs across dates",
    file: "search.ts",
    from: "bound = Math.max(bound, cost);",
    to: "bound += cost;",
    check: datedAgreement,
  },
  {
    name: "undated meetings are active in bits outside the term",
    file: "weeks.ts",
    from: "return masks[OPT_DAYS.indexOf(meeting.day)][range.id];",
    to: "return meeting.dates ? masks[OPT_DAYS.indexOf(meeting.day)][range.id] : -1;",
    check: checkRegressions,
  },
  {
    name: "activity starts on the range boundary instead of the first weekday occurrence",
    file: "weeks.ts",
    from: "const first = range.start + ((weekday - ((range.start + 3) % 7) + 7) % 7);",
    to: "const first = range.start;",
    check: checkRegressions,
  },
  {
    name: "classes that only touch count as overlapping",
    file: "prepare.ts",
    from: "return a.day === b.day && a.start < b.end && b.start < a.end && (a.weeks & b.weeks) !== 0;",
    to: "return a.day === b.day && a.start <= b.end && b.start <= a.end && (a.weeks & b.weeks) !== 0;",
    check: agreement,
  },
  {
    name: "meetings in different weeks conflict when their times overlap",
    file: "prepare.ts",
    from: " && (a.weeks & b.weeks) !== 0;",
    to: ";",
    check: datedAgreement,
  },
  {
    name: "the search treats every consecutive pair in a day as back to back, whatever the dates",
    file: "search.ts",
    from: "const backToBack = (prev.weeks & next.weeks & ~between) !== 0;",
    to: "const backToBack = j === i + 1;",
    check: datedAgreement,
  },
  {
    name: "the scorer and the pairwise checks treat every consecutive pair as back to back, whatever the dates",
    file: "weeks.ts",
    from: "if ((prev.weeks & next.weeks & ~between) !== 0 && test(prev, next)) return true;",
    to: "if (j === i + 1 && test(prev, next)) return true;",
    check: datedAgreement,
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
    from: "if (meeting.start >= block.end || block.start >= meeting.end) return false;",
    to: "if (meeting.start > block.end || block.start > meeting.end) return false;",
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
    name: "every suggestion's resolves flag is inverted",
    file: "explain.ts",
    from: "    resolves: check(applyRelaxation(request, entry.relaxation)),",
    to: "    resolves: !check(applyRelaxation(request, entry.relaxation)),",
    check: explanations,
  },
  {
    name: "a break is credited with one meeting, not a section's total",
    file: "prepare.ts",
    from: "            total += own[last].end - own[last].start;",
    to: "            total = Math.max(total, own[last].end - own[last].start);",
    check: (fn) => checkRegressions(fn),
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
