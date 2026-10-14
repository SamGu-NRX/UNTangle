/**
 * Coverage measurement for the smart-filters join: how many spring-2027
 * sections get grade history? Sections come from the committed whole-term
 * fixture (repo data); grade history comes only through the shared
 * grades-history service, whose limiter and disk cache bound the reads.
 *
 * Run from frontend/: bun --no-env-file tests/smart-filters/coverage.ts
 * It needs network access to untgrades.app and fills the gitignored
 * .grades-history-cache directory.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { GradesDiskCache } from "@/lib/grades-history/cache";
import { GradesMcpClient } from "@/lib/grades-history/client";
import { GradesHistoryService } from "@/lib/grades-history/service";
import { SectionsProxy } from "@/lib/sections/proxy";
import { createTermFilterHandler } from "@/lib/smart-filters/handlers";
import type { SmartFiltersResponse } from "@/lib/smart-filters/handlers";
import type { GradeFactsResult } from "@/lib/smart-filters/model";

const fixture = JSON.parse(readFileSync(new URL("../sections/fixtures/spring-2027.json", import.meta.url), "utf8"));
const proxy = new SectionsProxy({ fetcher: async () => Response.json(fixture), now: () => Date.now() });

// The same construction the server singletons use, minus their server-only
// guards: grade history only through the shared service and its limiter.
const gradesHistory = new GradesHistoryService(
  new GradesMcpClient(),
  new GradesDiskCache(path.join(process.cwd(), ".grades-history-cache")),
);

// The same wiring the API route uses: sections through the app's own proxy,
// grade history only through the shared service and its limiter.
const handler = createTermFilterHandler({
  termSections: (term) => proxy.getTermSections(term),
  courseHistory: (subject, number) => gradesHistory.getCourseHistory(subject, number),
});

const response = await handler(new Request("https://coverage.local/api/terms/spring-2027/smart-filters"), "spring-2027");
if (response.status !== 200) {
  console.error(`coverage request failed: ${response.status}`);
  console.error(await response.text());
  process.exit(1);
}
const body = (await response.json()) as SmartFiltersResponse;

const kinds = new Map<string, number>();
for (const row of body.results) {
  kinds.set(row.gradeFacts.kind, (kinds.get(row.gradeFacts.kind) ?? 0) + 1);
}
function reasonFor(facts: GradeFactsResult): string | undefined {
  switch (facts.kind) {
    case "matched":
      return undefined;
    case "insufficient-data":
      return "fewer than MIN_GRADED_SECTIONS graded sections";
    case "no-history":
      return facts.reason;
    case "unavailable":
      return facts.reason;
  }
}
const byCourse = new Map<string, { id: string; kind: string; reason?: string }[]>();
for (const row of body.results) {
  const facts = row.gradeFacts;
  const reason = reasonFor(facts);
  const entry = { id: row.sectionId, kind: facts.kind, ...(reason === undefined ? {} : { reason }) };
  const list = byCourse.get(row.courseCode) ?? [];
  list.push(entry);
  byCourse.set(row.courseCode, list);
}
console.log(
  JSON.stringify(
    {
      term: body.term,
      sections: body.results.length,
      courseHistory: body.courseHistory,
      sectionsSource: body.sectionsSource.status,
      gradeFacts: Object.fromEntries([...kinds.entries()].sort()),
      byCourse: Object.fromEntries([...byCourse.entries()].sort()),
    },
    null,
    2,
  ),
);
