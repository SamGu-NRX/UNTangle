#!/usr/bin/env bun
/**
 * The section release job's CLI. Fetches a term's files from the VSB mirror
 * within its source policy, builds, compares and publishes a release, and
 * prints the run's report as JSON:
 *
 *   bun packages/ingest/src/release-job/cli.ts --term spring-2027 --out <dir> [--dry-run]
 *
 * Flags:
 *   --term <id>            required, e.g. spring-2027
 *   --out <dir>            required; holds releases/, pointers/ and state.json
 *   --dry-run              fetch and report, write nothing
 *   --subjects=A,B         overlay these subject files before building
 *   --watch-term=<id>      a term to watch for first appearance; repeatable;
 *                          default fall-2027; --watch-term=none disables the watch
 *
 * Exit codes: 0 for a finished run (published, unchanged, refused or a
 * reported error) since the JSON report is the result; 1 when the arguments
 * are wrong or the job throws.
 */

import { runReleaseJob, type JobReport } from "./job";

type Arguments = {
  term: string | null;
  out: string | null;
  dryRun: boolean;
  subjects: string[];
  watchTerms: string[] | null;
};

function parseArguments(argv: readonly string[]): Arguments | string {
  const arguments_: Arguments = { term: null, out: null, dryRun: false, subjects: [], watchTerms: null };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] as string;
    const value = (name: string): string => {
      if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
      index++;
      const next = argv[index];
      if (next === undefined) throw new Error(`${name} needs a value`);
      return next;
    };
    if (argument === "--dry-run") arguments_.dryRun = true;
    else if (argument.startsWith("--term")) arguments_.term = value("--term");
    else if (argument.startsWith("--out")) arguments_.out = value("--out");
    else if (argument.startsWith("--subjects")) {
      arguments_.subjects = value("--subjects").split(",").map(subject => subject.trim().toUpperCase()).filter(Boolean);
    } else if (argument.startsWith("--watch-term")) {
      const watched = value("--watch-term");
      if (watched === "none") arguments_.watchTerms = [];
      else {
        const list = (arguments_.watchTerms ??= []);
        if (!list.includes(watched)) list.push(watched);
      }
    } else {
      return `unknown argument ${JSON.stringify(argument)}`;
    }
  }
  if (arguments_.term === null) return "--term is required, e.g. --term spring-2027";
  if (arguments_.out === null) return "--out is required, e.g. --out /var/lib/untangle/releases";
  return arguments_;
}

async function main(): Promise<number> {
  let parsed: Arguments | string;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    parsed = error instanceof Error ? error.message : String(error);
  }
  if (typeof parsed === "string") {
    console.error(`section-release-job: ${parsed}`);
    console.error("usage: bun packages/ingest/src/release-job/cli.ts --term spring-2027 --out <dir> [--dry-run] [--subjects=A,B] [--watch-term=fall-2027|--watch-term=none]");
    return 1;
  }
  const watchTerms = parsed.watchTerms === null ? undefined : parsed.watchTerms;
  const { term, out } = parsed;
  if (term === null || out === null) return 1;
  let report: JobReport;
  try {
    report = await runReleaseJob({
      termId: term,
      outDir: out,
      dryRun: parsed.dryRun,
      subjects: parsed.subjects,
      watchTerms,
    });
  } catch (error) {
    console.error(`section-release-job: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    return 1;
  }
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

process.exit(await main());
