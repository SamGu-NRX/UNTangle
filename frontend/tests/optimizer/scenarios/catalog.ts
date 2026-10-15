/**
 * The scenario harness's catalog: the real Spring 2027 options the app would
 * load, from the trimmed capture in fixtures/ (see fixtures/README.md for the
 * source URL and capture date), parsed by the app's own parseTerm so the
 * scenarios run the same data path as the live proxy, with no network.
 */

import { courseResult, parseTerm } from "@/lib/sections/vsb";
import type { SectionCatalog } from "@/lib/planner-sections";
import fixture from "./fixtures/spring-2027-trimmed.json";

/** When the capture was checked into the harness; provenance, not data. */
const checkedAt = "2026-10-15T11:09:00.000Z";

export function scenarioCatalog(): SectionCatalog {
  const term = parseTerm(structuredClone(fixture), "spring-2027");
  const file = { data: term, status: "ok" as const, checkedAt, diagnostic: null };
  return (courseCode) => {
    const result = courseResult(file, courseCode);
    const answer = result && "sections" in result ? result : null;
    if (!answer) throw new Error(`scenario fixture has no real options for ${courseCode}`);
    return { status: "ready", result: answer };
  };
}

/** Real section ids of an option by its section code, e.g. "051" or "110 + 112". */
export function sectionIdByCode(catalog: SectionCatalog, courseCode: string, sectionCode: string): string {
  const loaded = catalog(courseCode);
  if (loaded.status !== "ready") throw new Error(`${courseCode} did not load`);
  const found = loaded.result.sections.find((section) => section.sectionCode === sectionCode);
  if (!found) {
    throw new Error(`${courseCode} has no option with section code ${sectionCode}`);
  }
  return found.id;
}
