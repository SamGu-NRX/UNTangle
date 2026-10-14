#!/usr/bin/env bun
/**
 * Build the syllabus corpus for the study.
 *
 * Reads faculty profile IDs from a seed file, fetches each profile page
 * politely (max 1 request per second, robots.txt honored, everything cached),
 * keeps the scheduled teaching rows for the target term whose courses are in
 * the planner's catalog, downloads the posted syllabi, and extracts their
 * text. Raw syllabi and page caches stay in `.cache/` and are never
 * committed; the manifest written next to them is metadata only.
 *
 * Usage:
 *   bun --no-env-file tools/syllabus/run.ts \
 *     --profiles=tools/syllabus/data/profile-ids.txt \
 *     --term="Fall 2026" \
 *     [--manifest=tools/syllabus/.cache/manifest.json] \
 *     [--limit=N] [--stop-on-error=true|false]
 *
 * Exit codes: 0 = manifest written; 2 = usage or IO error.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PoliteFetcher, StopOnHttpError, USER_AGENT } from "./lib/fetcher";
import { parseProfile, type TeachingRow } from "./lib/profile";
import { extractSyllabusText } from "./lib/syllabus-text";

const REPO_ROOT = path.join(import.meta.dir, "../..");
const PLANNER_SEED = path.join(REPO_ROOT, "frontend/src/lib/generated/seed-data.json");

function fail(message: string): never {
  console.error(`error: ${message}`);
  console.error(
    "usage: bun --no-env-file tools/syllabus/run.ts --profiles=<ids.txt> --term=\"Fall 2026\" [--manifest=<out.json>] [--limit=N] [--stop-on-error=true|false]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) fail(`unexpected argument ${arg}`);
    const eq = arg.indexOf("=");
    if (eq < 0) args.set(arg.slice(2), "true");
    else args.set(arg.slice(2, eq), arg.slice(eq + 1));
  }
  return args;
}

interface ManifestEntry {
  profileId: string;
  faculty: string | null;
  profileUrl: string;
  courseCode: string;
  section: string;
  courseTitle: string;
  term: string;
  syllabusUrl: string;
  textChars: number;
  kind: string;
  pages: number | null;
}

interface SkippedRow {
  profileId: string;
  courseCode: string;
  section: string;
  term: string;
  reason: string;
}

function plannerCourseCodes(): Set<string> {
  const seed = JSON.parse(readFileSync(PLANNER_SEED, "utf8")) as { courses: { code: string }[] };
  return new Set(seed.courses.map((c) => c.code));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const profilesFile = args.get("profiles");
  const term = args.get("term");
  if (!profilesFile || !term) fail("--profiles and --term are required");
  const manifestPath = args.get("manifest") ?? path.join(import.meta.dir, ".cache/manifest.json");
  const rawLimit = args.get("limit");
  const limit = rawLimit === undefined ? undefined : Number(rawLimit);
  if (rawLimit !== undefined && (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(limit))) {
    fail(`--limit must be a nonnegative safe integer, got ${JSON.stringify(rawLimit)}`);
  }

  const rawStopOnError = args.get("stop-on-error") ?? "true";
  if (rawStopOnError !== "true" && rawStopOnError !== "false") {
    fail(`--stop-on-error must be true or false, got ${JSON.stringify(rawStopOnError)}`);
  }
  const stopOnError = rawStopOnError === "true";

  const planner = plannerCourseCodes();
  const profileIds = readFileSync(profilesFile, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const ids = typeof limit === "number" ? profileIds.slice(0, limit) : profileIds;

  const fetcher = new PoliteFetcher({ cacheDir: path.join(import.meta.dir, ".cache"), stopOnError });
  console.log(`user agent: ${USER_AGENT}`);
  console.log(`profiles: ${ids.length}, planner courses in catalog: ${planner.size}, target term: ${term}`);

  const entries: ManifestEntry[] = [];
  const skipped: SkippedRow[] = [];
  let rowsInTerm = 0;
  let plannerRows = 0;

  const seenSyllabusUrls = new Set<string>();
  for (const profileId of ids) {
    const profileUrl = `https://facultyinfo.unt.edu/faculty-profile?profile=${profileId}`;
    let profile;
    try {
      const page = await fetcher.fetch(profileUrl);
      if (page.status !== 200) {
        skipped.push({ profileId, courseCode: "", section: "", term: "", reason: `profile HTTP ${page.status}` });
        continue;
      }
      profile = parseProfile(page.body.toString("utf8"), profileUrl);
    } catch (err) {
      if (err instanceof StopOnHttpError) fail(err.message);
      skipped.push({ profileId, courseCode: "", section: "", term: "", reason: `profile fetch: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    for (const row of profile.rows as TeachingRow[]) {
      if (row.term !== term) continue;
      rowsInTerm++;
      if (!planner.has(row.courseCode)) continue;
      plannerRows++;
      if (!row.syllabusUrl) {
        skipped.push({ profileId, courseCode: row.courseCode, section: row.section, term, reason: "no syllabus posted" });
        continue;
      }
      if (seenSyllabusUrls.has(row.syllabusUrl)) continue; // same PDF shared across sections

      let textResult;
      try {
        const file = await fetcher.fetch(row.syllabusUrl);
        if (file.status !== 200) {
          skipped.push({ profileId, courseCode: row.courseCode, section: row.section, term, reason: `syllabus HTTP ${file.status}` });
          continue;
        }
        textResult = await extractSyllabusText(file.body, file.contentType);
      } catch (err) {
        if (err instanceof StopOnHttpError) fail(err.message);
        skipped.push({ profileId, courseCode: row.courseCode, section: row.section, term, reason: `syllabus read: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }

      seenSyllabusUrls.add(row.syllabusUrl);
      const urlKey = createHash("sha1").update(row.syllabusUrl).digest("hex");
      mkdirSync(path.join(import.meta.dir, ".cache/text"), { recursive: true });
      writeFileSync(path.join(import.meta.dir, ".cache/text", `${urlKey}.txt`), textResult.text);
      entries.push({
        profileId,
        faculty: profile.name,
        profileUrl,
        courseCode: row.courseCode,
        section: row.section,
        courseTitle: row.title,
        term,
        syllabusUrl: row.syllabusUrl,
        textChars: textResult.text.length,
        kind: textResult.kind,
        pages: textResult.pages,
      });
      console.log(`  ${row.courseCode}.${row.section} ${profile.name ?? profileId}: ${textResult.text.length} chars (${textResult.kind})`);
    }
  }

  const uniqueCourses = new Set(entries.map((e) => e.courseCode));
  const summary = {
    term,
    profilesScanned: ids.length,
    rowsInTerm,
    plannerCourseRows: plannerRows,
    syllabiDownloaded: entries.length,
    uniqueCourses: uniqueCourses.size,
    entries,
    skipped,
  };
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(summary, null, 2));
  console.log(
    `done: ${summary.syllabiDownloaded} syllabi across ${summary.uniqueCourses} planner courses ` +
      `(${summary.plannerCourseRows} planner course rows in term, ${summary.rowsInTerm} rows total)`,
  );
  console.log(`manifest: ${manifestPath}`);
}

await main();
