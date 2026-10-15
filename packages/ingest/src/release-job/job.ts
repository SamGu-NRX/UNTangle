/**
 * The section release job: steps 1 to 4 of "Reference data: published
 * releases" (docs/architecture/README.md) for one term of the VSB mirror.
 *
 * Fetch the term file within its source policy, build a release with
 * buildSectionRelease, optionally overlay subject files, compare with the
 * last good release, and write a new versioned release only when the build
 * and the sanity checks pass. A partial response, a schema change, a parser
 * failure or a suspicious diff never replaces a good release: the pointer
 * stays where it was.
 *
 * The run ends with a JobReport, the JSON the CLI prints. Nothing here
 * touches a clock or the network directly: the Mirror and the sink get both
 * as arguments, so tests run against a local stub.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { diffReleases, sanityCheck, type ReleaseDiff, type SanityResult } from "./compare";
import { emptyMirrorState, Mirror, type FetchLike, type FetchOutcome, type MirrorState } from "./mirror";
import { localSink, type ReleaseSink } from "./publish";
import { buildSectionRelease, type ReleaseManifest } from "../section-release";
import type { ReviewedSourcePolicy } from "../source-policies";
import { termWatchReport, type TermWatchReport } from "./term-watch";

export type RunReleaseJobOptions = {
  termId: string;
  /** The local directory holding releases, pointers and fetch state. */
  outDir: string;
  /** Report what would happen, fetch nothing, write nothing. */
  dryRun?: boolean;
  /**
   * Subject files to overlay on the term file before building, e.g.
   * ["CSCE", "MATH"]. The term file is complete on its own; a subject file
   * is a fresher per-subject slice, the overlay frontend/src/lib/sections/
   * proxy.ts prefers. Each one still counts against the policy's hourly cap,
   * and a subject file that fails its schema check is skipped, never fatal.
   */
  subjects?: string[];
  /** Terms to watch for first appearance; default ["fall-2027"]. Empty disables the watch. */
  watchTerms?: string[];
  /** Dependencies, for tests: a stub server and a stopped clock. */
  fetcher?: FetchLike;
  policy?: ReviewedSourcePolicy;
  /** Mirror root; defaults to the policy's first allowed prefix. */
  baseUrl?: string;
  timeoutMs?: number;
  now?: () => number;
};

export type JobReport = {
  termId: string;
  outcome:
    | "published"
    | "unchanged"
    | "refused"
    | "error";
  /** Why the run ended as it did; always present except when published or unchanged. */
  reason?: string;
  detail?: string;
  /** Set when published: where the pointer now aims. */
  releaseId?: string;
  contentSha256?: string;
  file?: string;
  /** The previous release's identity, when one was published. */
  previousReleaseId?: string;
  /** The diff against the last good release, when there was one to compare with. */
  diff?: ReleaseDiff | null;
  sanity?: Extract<SanityResult, { ok: true }> | Extract<SanityResult, { ok: false }>;
  manifest?: ReleaseManifest["counts"];
  /** Per-URL fetch results, in policy order. */
  fetched: Array<{ url: string; kind: FetchOutcome["kind"]; reason?: string }>;
  /** Watched terms and what the watchdog saw. */
  termWatch: TermWatchReport[];
  /** Whether this run fetched at all (dry runs and unchanged terms do not write). */
  wrote: boolean;
};

export async function runReleaseJob(options: RunReleaseJobOptions): Promise<JobReport> {
  const now = options.now ?? Date.now;
  const termId = options.termId;
  const outDir = options.outDir;
  const dryRun = options.dryRun === true;
  const watchTerms = options.watchTerms === undefined ? ["fall-2027"] : options.watchTerms;

  const sink: ReleaseSink = localSink(outDir);
  const state = dryRun ? emptyMirrorState() : await loadMirrorState(outDir);
  const mirror = new Mirror({
    policy: options.policy,
    baseUrl: options.baseUrl,
    fetcher: options.fetcher,
    timeoutMs: options.timeoutMs,
    now,
    state,
  });

  const fetched: JobReport["fetched"] = [];
  const record = (url: string, outcome: { kind: FetchOutcome["kind"]; reason?: string }) =>
    fetched.push({ url, kind: outcome.kind, ...(outcome.reason ? { reason: outcome.reason } : {}) });

  // The watchdog's loop, shared by every terminal path that got a term
  // response: one request per watched term, classified by the fetch the job
  // already made.
  const runWatch = async (): Promise<TermWatchReport[]> => {
    const reports: TermWatchReport[] = [];
    for (const watched of watchTerms) {
      const watchUrl = mirror.urlFor(watched);
      const outcome = await mirror.fetchFile(watched);
      record(watchUrl, outcome);
      reports.push(watchFromOutcome(watched, outcome));
    }
    return reports;
  };

  // 1. The term file. A dry run still fetches (the real dry run below is the
  //    evidence the pipeline works against the mirror), it only never writes.
  const termUrl = mirror.urlFor(termId);
  const termOutcome = await mirror.fetchFile(termId);
  record(termUrl, termOutcome);

  if (termOutcome.kind === "deferred") {
    return { termId, outcome: "error", reason: "deferred", detail: `the term file was not fetched: ${termOutcome.reason}`, fetched, termWatch: [], wrote: false };
  }
  if (termOutcome.kind === "error") {
    return { termId, outcome: "error", reason: "fetch-failed", detail: termOutcome.message, fetched, termWatch: [], wrote: false };
  }
  if (termOutcome.kind === "absent") {
    return { termId, outcome: "error", reason: "absent-upstream", detail: `the mirror has no file for ${termId}`, fetched, termWatch: [], wrote: false };
  }
  if (termOutcome.kind === "not-modified") {
    return { termId, outcome: "unchanged", reason: "not-modified", detail: `HTTP 304 for ${termUrl}; the published release stays`, fetched, termWatch: await runWatch(), wrote: false };
  }

  // 2. Subject overlays, then build. A subject file that fails its own
  //    schema check is dropped and reported; the term file's slice for that
  //    subject stands.
  let body = termOutcome.body;
  const subjects = options.subjects ?? [];
  if (subjects.length) {
    const requests = subjects.map(subject => ({ term: termId, subject }));
    const outcomes = await mirror.fetchFiles(requests);
    const overlays: Array<{ subject: string; body: string }> = [];
    for (const { request, url, outcome } of outcomes) {
      record(url, outcome);
      if (outcome.kind !== "fetched") continue;
      const check = checkSubjectFile(outcome.body, termId, request.subject as string);
      if (!check.ok) continue;
      overlays.push({ subject: request.subject as string, body: outcome.body });
    }
    if (overlays.length) body = overlaySubjects(termOutcome.body, overlays);
  }

  const built = buildSectionRelease({ body, sourceId: "vsb-untgrades", institutionId: "unt", termId, fetchedAt: new Date(now()).toISOString() });
  if (!built.ok) {
    // The last good release stays published; nothing has been written.
    return { termId, outcome: "refused", reason: built.reason, detail: built.message, fetched, termWatch: await runWatch(), wrote: false };
  }
  const next = built.release;

  // 3. Compare with the last good release.
  const pointer = await sink.readPointer(termId);
  const previous = pointer ? await sink.readContent(pointer.file) : null;
  if (previous !== null && previous.manifest.contentSha256 === next.manifest.contentSha256) {
    return { termId, outcome: "unchanged", detail: "same content hash as the published release", previousReleaseId: pointer?.releaseId, fetched, termWatch: await runWatch(), wrote: false };
  }
  const diff = previous ? diffReleases(previous, next) : null;
  const sanity = sanityCheck(previous, next);
  if (!sanity.ok) {
    return {
      termId,
      outcome: "refused",
      reason: "sanity-check",
      detail: `${sanity.check}: ${sanity.detail}; the last good release stays published`,
      previousReleaseId: pointer?.releaseId,
      diff,
      sanity,
      fetched,
      termWatch: await runWatch(),
      wrote: false,
    };
  }

  // 4. Publish: content first, pointer last. A dry run stops here.
  if (!dryRun) {
    await sink.putContent(next);
    await sink.putPointer(next, new Date(now()).toISOString());
    await saveMirrorState(outDir, mirror.state);
  }

  // The watchdog runs after the release work, so the term file always gets
  // the budget first; a new term is a report, never a replacement for one.
  const termWatch: TermWatchReport[] = await runWatch();

  return {
    termId,
    outcome: "published",
    releaseId: next.manifest.releaseId,
    contentSha256: next.manifest.contentSha256,
    file: path.join("releases", `${next.manifest.contentSha256}.json`),
    previousReleaseId: pointer?.releaseId,
    diff,
    sanity,
    manifest: next.manifest.counts,
    fetched,
    termWatch,
    wrote: !dryRun,
  };
}

/** The watchdog's report for a fetch the job already made, so a watched term costs one request, not two. */
function watchFromOutcome(watched: string, outcome: Awaited<ReturnType<Mirror["fetchFile"]>>): TermWatchReport {
  return termWatchReport(watched, outcome);
}
/** Subject files carry the term file's schema; the check is the root-level one. */
function checkSubjectFile(body: string, termId: string, subject: string): { ok: true } | { ok: false; detail: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, detail: `${subject}.json is not JSON` };
  }
  const root = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (root === null) return { ok: false, detail: `${subject}.json is not an object` };
  if (root.schema_version !== 2) return { ok: false, detail: `${subject}.json: schema_version ${JSON.stringify(root.schema_version)} is not 2` };
  const [season, year] = termId.split("-");
  if (typeof root.term !== "string" || root.term.toLowerCase() !== `${year} ${season}`) {
    return { ok: false, detail: `${subject}.json: term ${JSON.stringify(root.term)} does not match ${termId}` };
  }
  if (typeof root.courses !== "object" || root.courses === null || Array.isArray(root.courses)) {
    return { ok: false, detail: `${subject}.json: courses is not an object` };
  }
  return { ok: true };
}

/**
 * Overlays subject files on the term file: a subject file's courses replace
 * that subject's slice, coverage is recomputed from what is actually there,
 * and updated_at keeps the newest value. The result is the body
 * buildSectionRelease validates; its own coverage gate still applies, so a
 * bad overlay fails the build and no release is written.
 */
function overlaySubjects(termBody: string, overlays: Array<{ subject: string; body: string }>): string {
  const term = JSON.parse(termBody) as {
    updated_at: string;
    coverage: { catalog_courses: number; completed_courses: number; courses_with_options: number };
    courses: Record<string, unknown>;
  };
  for (const overlay of overlays) {
    const parsed = JSON.parse(overlay.body) as { updated_at?: string; courses: Record<string, unknown> };
    for (const [code, course] of Object.entries(parsed.courses)) term.courses[code] = course;
    if (parsed.updated_at && Date.parse(parsed.updated_at) > Date.parse(term.updated_at)) term.updated_at = parsed.updated_at;
  }
  const entries = Object.entries(term.courses).filter(([code]) => /^[A-Z]{3,4} \d{3,4}[A-Z]?$/.test(code));
  term.coverage = {
    catalog_courses: entries.length,
    completed_courses: entries.length,
    courses_with_options: entries.filter(([, value]) => {
      return typeof value === "object" && value !== null && "sections" in value && Array.isArray((value as { sections: unknown }).sections) && (value as { sections: unknown[] }).sections.length > 0;
    }).length,
  };
  return JSON.stringify(term);
}

/** Fetch state lives beside the releases, so one-shot CLI runs keep their etags and budget. */
export async function loadMirrorState(outDir: string): Promise<MirrorState> {
  try {
    const parsed = JSON.parse(await readFile(path.join(outDir, "state.json"), "utf8")) as MirrorState;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.files !== "object" || !Array.isArray(parsed.requests)) throw new Error("shape");
    return parsed;
  } catch {
    return emptyMirrorState();
  }
}

export async function saveMirrorState(outDir: string, state: MirrorState): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "state.json"), JSON.stringify(state, null, 2), "utf8");
}
