#!/usr/bin/env bun
/**
 * Writes prerequisites.json: the catalog's original prerequisite text and hour
 * strings for every course in `courses/*.json`, trimmed to what the
 * prerequisite engine reads. The Courses view runs the engine in the browser,
 * and the flattened `Course.prerequisites` list in seed-data loses AND/OR and
 * grade minimums, so the original text has to ship with the client.
 *
 *   bun src/lib/course-catalog/build.ts          rewrite the file
 *   bun src/lib/course-catalog/build.ts --check  exit 1 if the file is stale
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourceDir = resolve(import.meta.dir, "../../../../courses");
const target = resolve(import.meta.dir, "prerequisites.json");

type SourceEntry = { course_number: string; number_of_hours: string; prerequisites: string };

export function buildPrerequisiteTable(): Array<[string, string, string]> {
  const rows: Array<[string, string, string]> = [];
  for (const file of readdirSync(sourceDir).filter((name) => name.endsWith(".json")).sort()) {
    const entries = JSON.parse(readFileSync(resolve(sourceDir, file), "utf8")) as SourceEntry[];
    for (const entry of entries) rows.push([entry.course_number, entry.number_of_hours, entry.prerequisites]);
  }
  return rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function renderPrerequisiteTable(): string {
  return `${JSON.stringify(buildPrerequisiteTable(), null, 0).replaceAll("],[", "],\n[")}\n`;
}

if (import.meta.main) {
  const next = renderPrerequisiteTable();
  if (process.argv.includes("--check")) {
    const current = readFileSync(target, "utf8");
    if (current !== next) {
      console.error("prerequisites.json is stale; run bun src/lib/course-catalog/build.ts");
      process.exit(1);
    }
    console.log("prerequisites.json matches courses/*.json");
  } else {
    writeFileSync(target, next);
    console.log(`wrote ${target}`);
  }
}
