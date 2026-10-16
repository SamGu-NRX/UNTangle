/**
 * Writes the web app's copy of UNT's final-exam schedule from the saved
 * registrar page: `bun packages/ingest/tests/build-exam-module.ts --write`
 * from the repo root. Without --write it only says whether the copy is
 * current. exam-schedule.test.ts runs the same comparison.
 *
 * It lives beside the tests because it reads a fixture: the web app gets
 * the parse, never the parser or the page.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseUntExamPage, renderExamModule, type ParsedExamPage } from "../src/exam-schedule";

const repoRoot = join(import.meta.dir, "..", "..", "..");
export const FIXTURE = "packages/ingest/tests/fixtures/unt-exams/fall-2026.html";
export const MODULE = "frontend/src/lib/generated/unt-final-exams.ts";

/** The fixture's source URL and capture date, read from its row in SOURCES.md so they can't drift. */
export function fixtureMeta(): { sourceUrl: string; capturedAt: string } {
  const sources = readFileSync(join(repoRoot, "packages/ingest/tests/fixtures/unt-exams/SOURCES.md"), "utf8");
  const row = /^\| `fall-2026\.html` \| (\S+) \| (\d{4}-\d{2}-\d{2})\b/m.exec(sources);
  if (!row) throw new Error("SOURCES.md has no row for fall-2026.html");
  return { sourceUrl: row[1], capturedAt: row[2] };
}

export function parseFixture(): ParsedExamPage {
  return parseUntExamPage(readFileSync(join(repoRoot, FIXTURE), "utf8"), fixtureMeta());
}

export function expectedModule(): string {
  return renderExamModule(parseFixture().schedule, FIXTURE);
}

export function currentModule(): string {
  return readFileSync(join(repoRoot, MODULE), "utf8");
}

if (import.meta.main) {
  const expected = expectedModule();
  if (process.argv.includes("--write")) {
    writeFileSync(join(repoRoot, MODULE), expected);
    console.log(`Wrote ${MODULE}`);
  } else {
    const fresh = currentModule() === expected;
    console.log(fresh ? `${MODULE} is current.` : `${MODULE} is out of date. Run with --write.`);
    process.exit(fresh ? 0 : 1);
  }
}
