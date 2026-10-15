/**
 * The term watchdog: report when a new term appears in the VSB mirror, with
 * a schema check on its file, so the next term's first scrape is noticed by
 * a scheduled run rather than by a person.
 *
 * A term "appears" when its term file answers 200. The schema check is the
 * root-level one vsb.ts applies: schema_version 2 and the term field
 * matching the term asked for. Deeper parsing waits for that term's own
 * release job.
 */

import { buildSectionRelease } from "../section-release";
import type { FetchOutcome, Mirror } from "./mirror";

export type TermWatchReport = {
  termId: string;
  /** The mirror answered 200 for the term file. */
  appeared: boolean;
  /** The root-level schema check, when the file appeared; null when it did not. */
  schemaOk: boolean | null;
  /** What the check saw: HTTP status, the schema verdict, or the error. */
  detail: string;
  /** The file's own updated_at, when it appeared and said one. */
  sourceObservedAt: string | null;
};

const termPattern = /^(spring|summer|fall|winter)-(\d{4})$/;

export async function watchTerm(mirror: Mirror, termId: string): Promise<TermWatchReport> {
  if (!termPattern.exec(termId)) throw new Error(`Malformed watched term ${JSON.stringify(termId)}; expected spring-2027.`);
  return termWatchReport(termId, await mirror.fetchFile(termId));
}

/** The report for one watched-term fetch. Pure, so a job can reuse a fetch it already made. */
export function termWatchReport(termId: string, outcome: FetchOutcome): TermWatchReport {
  if (outcome.kind === "absent") {
    return { termId, appeared: false, schemaOk: null, detail: "HTTP 404: the mirror has no file for this term yet", sourceObservedAt: null };
  }
  if (outcome.kind === "deferred") {
    return { termId, appeared: false, schemaOk: null, detail: `not checked: ${outcome.reason}`, sourceObservedAt: null };
  }
  if (outcome.kind === "error") {
    return { termId, appeared: false, schemaOk: null, detail: outcome.message, sourceObservedAt: null };
  }
  if (outcome.kind === "not-modified") {
    // A watched term's conditional request answered 304: it appeared before, within this state's lifetime.
    return { termId, appeared: true, schemaOk: null, detail: "HTTP 304: unchanged since the last check", sourceObservedAt: null };
  }

  // buildSectionRelease's file-level gates are the schema check: they read
  // schema_version, term and coverage and fail before parsing any course.
  const result = buildSectionRelease({
    body: outcome.body,
    sourceId: "vsb-untgrades",
    institutionId: "unt",
    termId,
    fetchedAt: outcome.fetchedAt,
  });
  if (result.ok) {
    return { termId, appeared: true, schemaOk: true, detail: `schema v2 accepted, ${result.release.manifest.counts.courses} courses`, sourceObservedAt: result.release.manifest.sourceObservedAt };
  }
  if (result.reason === "unsupported-schema" || result.reason === "wrong-term" || result.reason === "invalid-json") {
    return { termId, appeared: true, schemaOk: false, detail: `${result.reason}: ${result.message}`, sourceObservedAt: null };
  }
  // partial and invalid-data are scrape-depth problems, not schema problems:
  // the file is v2 and matches the term, it is just not ready yet.
  return { termId, appeared: true, schemaOk: true, detail: `schema v2 accepted, but ${result.reason}: ${result.message}`, sourceObservedAt: null };
}
