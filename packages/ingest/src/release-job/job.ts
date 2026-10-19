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

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
  /** Each requested subject file: whether it went into the build, and why not when it did not. */
  subjects: Array<{ subject: string; applied: boolean; detail?: string }>;
  /** Watched terms and what the watchdog saw. */
  termWatch: TermWatchReport[];
  /** Whether this run fetched at all (dry runs and unchanged terms do not write). */
  wrote: boolean;
};

export async function runReleaseJob(options: RunReleaseJobOptions): Promise<JobReport> {
  const { outDir } = options;
  const dryRun = options.dryRun === true;
  const sink: ReleaseSink = localSink(outDir);
  const state = dryRun ? emptyMirrorState() : await loadMirrorState(outDir);
  const mirror = new Mirror({
    policy: options.policy,
    baseUrl: options.baseUrl,
    fetcher: options.fetcher,
    timeoutMs: options.timeoutMs,
    now: options.now,
    state,
  });
  // A 304 is only usable with the body it confirms. A cached body counts only
  // when the validators stored with it are the ones the state will send; any
  // other file the job needs is fetched without validators, so the mirror
  // cannot answer 304 for it. Another run's watch can move a URL's
  // validators, and a failed write can leave an older body, so the two are
  // compared rather than trusted.
  const cached = new Map<string, string>();
  const urls = [mirror.urlFor(options.termId), ...(options.subjects ?? []).map(subject => mirror.urlFor(options.termId, subject))];
  for (const url of urls) {
    const file = state.files[url];
    if (file === undefined) continue;
    const entry = await readCachedBody(outDir, url);
    if (entry !== null && entry.etag === file.etag && entry.lastModified === file.lastModified) cached.set(url, entry.body);
    else Object.assign(file, { etag: null, lastModified: null });
  }
  // Every exit saves the request log and validators, including refusals,
  // errors and the watch's requests, so the next run honors the policy.
  try {
    return await runWithMirror(options, mirror, sink, cached);
  } finally {
    if (!dryRun) await saveMirrorState(outDir, mirror.state);
  }
}

async function runWithMirror(options: RunReleaseJobOptions, mirror: Mirror, sink: ReleaseSink, cached: Map<string, string>): Promise<JobReport> {
  const now = options.now ?? Date.now;
  const { termId, outDir } = options;
  const dryRun = options.dryRun === true;
  const watchTerms = options.watchTerms === undefined ? ["fall-2027"] : options.watchTerms;

  /** The body a 200 delivered, cached with its validators for a later 304; or the cached body that a 304 confirms. Null for any other outcome. */
  const bodyOf = async (url: string, outcome: FetchOutcome): Promise<string | null> => {
    if (outcome.kind === "fetched") {
      if (!dryRun) await writeCachedBody(outDir, url, { etag: outcome.etag, lastModified: outcome.lastModified, body: outcome.body });
      cached.set(url, outcome.body);
      return outcome.body;
    }
    if (outcome.kind === "not-modified") {
      const body = cached.get(url);
      if (body === undefined) throw new Error(`HTTP 304 for ${url}, but no cached body matches the validators sent`);
      return body;
    }
    return null;
  };

  const fetched: JobReport["fetched"] = [];
  const subjectReports: JobReport["subjects"] = [];
  const record = (url: string, outcome: { kind: FetchOutcome["kind"]; reason?: string }) =>
    fetched.push({ url, kind: outcome.kind, ...(outcome.reason ? { reason: outcome.reason } : {}) });

  // The watchdog's loop, shared by every terminal path that got a term
  // response: one request per watched term, and none for a watched term that
  // is the job's own term, whose fetch is already in hand.
  const runWatch = async (): Promise<TermWatchReport[]> => {
    const reports: TermWatchReport[] = [];
    for (const watched of watchTerms) {
      if (watched === termId) {
        reports.push(termWatchReport(watched, termOutcome));
        continue;
      }
      const watchUrl = mirror.urlFor(watched);
      const outcome = await mirror.fetchFile(watched);
      record(watchUrl, outcome);
      reports.push(termWatchReport(watched, outcome));
    }
    return reports;
  };

  // 1. The term file. A dry run still fetches (the real dry run below is the
  //    evidence the pipeline works against the mirror), it only never writes.
  const termUrl = mirror.urlFor(termId);
  const termOutcome = await mirror.fetchFile(termId);
  record(termUrl, termOutcome);

  if (termOutcome.kind === "deferred") {
    return { termId, outcome: "error", reason: "deferred", detail: `the term file was not fetched: ${termOutcome.reason}`, fetched, subjects: subjectReports, termWatch: [], wrote: false };
  }
  if (termOutcome.kind === "error") {
    return { termId, outcome: "error", reason: "fetch-failed", detail: termOutcome.message, fetched, subjects: subjectReports, termWatch: [], wrote: false };
  }
  if (termOutcome.kind === "absent") {
    return { termId, outcome: "error", reason: "absent-upstream", detail: `the mirror has no file for ${termId}`, fetched, subjects: subjectReports, termWatch: [], wrote: false };
  }
  const subjects = options.subjects ?? [];
  const pointer = await sink.readPointer(termId);

  // 2. Subject overlays, then build. A 304 builds from the cached term body:
  //    it confirms that body, not that it was published, since a publish can
  //    fail after the state saved its validators. The content hash check in
  //    step 3 decides whether anything changed. A subject file that fails its
  //    own schema check, or that the mirror no longer has, is dropped and
  //    reported; the term file's slice for that subject stands. A subject the
  //    run could not ask about (deferred or failed) uses its cached body, and
  //    with none cached the run publishes nothing, since the term file's
  //    slice may be older than the overlay already published.
  const termBody = await bodyOf(termUrl, termOutcome) as string;
  let body = termBody;
  const overlays: Array<{ subject: string; body: string }> = [];
  const unavailable: string[] = [];
  if (subjects.length) {
    const requests = subjects.map(subject => ({ term: termId, subject }));
    const outcomes = await mirror.fetchFiles(requests);
    for (const { request, url, outcome } of outcomes) {
      record(url, outcome);
      const subject = request.subject as string;
      const notAsked = outcome.kind === "deferred" || outcome.kind === "error";
      const subjectBody = notAsked ? cached.get(url) ?? null : await bodyOf(url, outcome);
      if (subjectBody === null) {
        if (notAsked) unavailable.push(subject);
        subjectReports.push({ subject, applied: false, detail: notAsked ? `not fetched (${outcome.kind}) and no cached body` : "HTTP 404: the mirror has no file for this subject" });
        continue;
      }
      const check = checkSubjectFile(subjectBody, termId, subject);
      if (!check.ok) {
        subjectReports.push({ subject, applied: false, detail: check.detail });
        continue;
      }
      subjectReports.push({ subject, applied: true, ...(notAsked ? { detail: `from the cached body; the fetch was ${outcome.kind}` } : {}) });
      overlays.push({ subject, body: subjectBody });
    }
  }
  // An unchanged term file's slices are no fresher than the subject files
  // the published release was built with, so a 304 rebuild keeps those it
  // was not asked for, from their cached bodies. One it cannot reapply
  // stops the run, so it never publishes an older slice. A release with no
  // record (published before records existed) may carry any overlay, even
  // one the run did not request, so step 3 publishes nothing over it.
  let overlayUnknown = false;
  if (termOutcome.kind === "not-modified" && pointer !== null) {
    const published = await readOverlaySubjects(outDir, pointer.contentSha256);
    overlayUnknown = published === null;
    for (const subject of published ?? []) {
      if (subjects.includes(subject)) continue;
      const entry = await readCachedBody(outDir, mirror.urlFor(termId, subject));
      const check = entry === null ? null : checkSubjectFile(entry.body, termId, subject);
      if (entry === null || !check?.ok) {
        unavailable.push(subject);
        subjectReports.push({ subject, applied: false, detail: `in the published release, but ${check && !check.ok ? check.detail : "no cached body"}` });
        continue;
      }
      subjectReports.push({ subject, applied: true, detail: "kept from the published release, from the cached body" });
      overlays.push({ subject, body: entry.body });
    }
  }
  if (unavailable.length) {
    return { termId, outcome: "error", reason: "subject-unavailable", detail: `${unavailable.join(", ")}: no body to apply; the published release stays`, fetched, subjects: subjectReports, termWatch: await runWatch(), wrote: false };
  }
  if (overlays.length) body = overlaySubjects(termBody, overlays);

  const built = buildSectionRelease({ body, sourceId: "vsb-untgrades", institutionId: "unt", termId, fetchedAt: new Date(now()).toISOString() });
  if (!built.ok) {
    // Whole-file failures — a body that does not parse, a schema mismatch, a
    // wrong term — are always refused, whatever the last good release looked
    // like: the pointer stays put and nothing has been written. Per-course
    // invalid-data records are the expected, publishable failure mode;
    // compare.ts sanityCheck bounds those instead.
    return { termId, outcome: "refused", reason: built.reason, detail: built.message, fetched, subjects: subjectReports, termWatch: await runWatch(), wrote: false };
  }
  const next = built.release;

  // 3. Compare with the last good release.
  const previous = pointer ? await sink.readContent(pointer.file) : null;
  if (previous !== null && previous.manifest.contentSha256 === next.manifest.contentSha256) {
    // This build is the published content, so its subjects describe the
    // published release too; record them when it has no record yet.
    if (!dryRun && (await readOverlaySubjects(outDir, next.manifest.contentSha256)) === null) {
      await writeOverlaySubjects(outDir, next.manifest.contentSha256, overlays.map(overlay => overlay.subject).sort());
    }
    return { termId, outcome: "unchanged", detail: "same content hash as the published release", previousReleaseId: pointer?.releaseId, fetched, subjects: subjectReports, termWatch: await runWatch(), wrote: false };
  }
  // A different build over a release with unknown overlays could drop a
  // fresher subject slice the run did not request. A 200 rebuilds in full
  // instead, since the term itself changed. The one build allowed through is
  // one whose own content already has a record of exactly these subjects: a
  // release an earlier 200 accepted, whose pointer write failed.
  const appliedSubjects = overlays.map(overlay => overlay.subject).sort();
  const pending = overlayUnknown ? await readOverlaySubjects(outDir, next.manifest.contentSha256) : null;
  if (overlayUnknown && (pending === null || pending.join(",") !== appliedSubjects.join(","))) {
    return {
      termId,
      outcome: "error",
      reason: "overlay-unknown",
      detail: `${pointer?.releaseId} has no record of the subject files it was built with, and this build differs from it, so it could replace a fresher subject slice; it stays published until a run that rebuilds its exact content or a changed term file records one`,
      previousReleaseId: pointer?.releaseId,
      fetched,
      subjects: subjectReports,
      termWatch: await runWatch(),
      wrote: false,
    };
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
      subjects: subjectReports,
      termWatch: await runWatch(),
      wrote: false,
    };
  }

  // 4. Publish: content first, pointer last. A dry run stops here.
  if (!dryRun) {
    await writeOverlaySubjects(outDir, next.manifest.contentSha256, appliedSubjects);
    await sink.putContent(next);
    await sink.putPointer(next, new Date(now()).toISOString());
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
    subjects: subjectReports,
    termWatch,
    wrote: !dryRun,
  };
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
 * Overlays subject files on the term file: a subject file's courses for its
 * own subject replace that subject's slice, and updated_at keeps the newest
 * value. The term file's coverage claims move by exactly what the overlay
 * added or removed, so a term file that claimed an incomplete scrape still
 * claims one, and buildSectionRelease's coverage gate refuses it.
 */
function overlaySubjects(termBody: string, overlays: Array<{ subject: string; body: string }>): string {
  let term: {
    updated_at: string;
    coverage: { catalog_courses: number; completed_courses: number; courses_with_options: number };
    courses: Record<string, unknown>;
  };
  try {
    term = JSON.parse(termBody) as typeof term;
  } catch {
    return termBody;
  }
  // A term body without coverage and courses objects goes to the build as it
  // came, so buildSectionRelease refuses it with its own reason.
  if (typeof term !== "object" || term === null || typeof term.coverage !== "object" || term.coverage === null || typeof term.courses !== "object" || term.courses === null) {
    return termBody;
  }
  const before = courseCounts(term.courses);
  for (const overlay of overlays) {
    const parsed = JSON.parse(overlay.body) as { updated_at?: string; courses: Record<string, unknown> };
    const inSubject = (code: string) => code.split(" ")[0] === overlay.subject;
    for (const code of Object.keys(term.courses)) if (inSubject(code)) delete term.courses[code];
    for (const [code, course] of Object.entries(parsed.courses)) if (inSubject(code)) term.courses[code] = course;
    if (parsed.updated_at && Date.parse(parsed.updated_at) > Date.parse(term.updated_at)) term.updated_at = parsed.updated_at;
  }
  const after = courseCounts(term.courses);
  term.coverage = {
    catalog_courses: term.coverage.catalog_courses + after.courses - before.courses,
    completed_courses: term.coverage.completed_courses + after.courses - before.courses,
    courses_with_options: term.coverage.courses_with_options + after.withOptions - before.withOptions,
  };
  return JSON.stringify(term);
}

/** Course entries and entries with options, counted the way buildSectionRelease's coverage gate counts them. */
function courseCounts(courses: Record<string, unknown>): { courses: number; withOptions: number } {
  const entries = Object.entries(courses).filter(([code]) => /^[A-Z]{3,4} \d{3,4}[A-Z]?$/.test(code));
  return {
    courses: entries.length,
    withOptions: entries.filter(([, value]) => {
      return typeof value === "object" && value !== null && "sections" in value && Array.isArray((value as { sections: unknown }).sections) && (value as { sections: unknown[] }).sections.length > 0;
    }).length,
  };
}

type CachedBody = { etag: string | null; lastModified: string | null; body: string };

/** Where a fetched body is kept for a later 304, keyed by its URL. */
function cachedBodyPath(outDir: string, url: string): string {
  return path.join(outDir, "bodies", `${createHash("sha256").update(url).digest("hex")}.json`);
}

/** Writes beside the target and renames, so a failed write never leaves a cut-off body under the real name. */
async function writeCachedBody(outDir: string, url: string, entry: CachedBody): Promise<void> {
  const file = cachedBodyPath(outDir, url);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(entry), "utf8");
  await rename(`${file}.tmp`, file);
}

/** The cached body with the validators it was served under, or null when there is none or it is unreadable. */
async function readCachedBody(outDir: string, url: string): Promise<CachedBody | null> {
  try {
    const entry = JSON.parse(await readFile(cachedBodyPath(outDir, url), "utf8")) as Partial<CachedBody>;
    if (typeof entry.body !== "string" || entry.etag === undefined || entry.lastModified === undefined) return null;
    return { etag: entry.etag, lastModified: entry.lastModified, body: entry.body };
  } catch {
    return null;
  }
}

/**
 * Which subject files a release was built with, keyed by its content hash
 * so a failed publish never overwrites the record of the release still
 * published. Written before the release, so a published release always has one.
 */
function overlaySubjectsPath(outDir: string, contentSha256: string): string {
  return path.join(outDir, "overlays", `${contentSha256}.json`);
}

async function writeOverlaySubjects(outDir: string, contentSha256: string, subjects: string[]): Promise<void> {
  const file = overlaySubjectsPath(outDir, contentSha256);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify({ subjects }), "utf8");
  await rename(`${file}.tmp`, file);
}

/** The subjects a release was built with; null when it has no record, as for a release published before records existed. */
async function readOverlaySubjects(outDir: string, contentSha256: string): Promise<string[] | null> {
  let raw: string;
  try {
    raw = await readFile(overlaySubjectsPath(outDir, contentSha256), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = JSON.parse(raw) as { subjects?: unknown };
  if (!Array.isArray(parsed.subjects) || !parsed.subjects.every(subject => typeof subject === "string")) {
    throw new Error(`${overlaySubjectsPath(outDir, contentSha256)} does not list subjects`);
  }
  return parsed.subjects;
}

/** Fetch state lives beside the releases, so one-shot CLI runs keep their etags and budget. */
export async function loadMirrorState(outDir: string): Promise<MirrorState> {
  try {
    const parsed = JSON.parse(await readFile(path.join(outDir, "state.json"), "utf8")) as MirrorState;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.files !== "object" || !Array.isArray(parsed.requests)) throw new Error("shape");
    // State written before attemptedAt existed carries fetchedAt, the time of
    // the last 200; the minimum interval runs from it until the next request.
    for (const file of Object.values(parsed.files) as Array<MirrorState["files"][string] & { fetchedAt?: string }>) {
      if (file.attemptedAt === undefined && file.fetchedAt !== undefined) file.attemptedAt = file.fetchedAt;
    }
    return parsed;
  } catch {
    return emptyMirrorState();
  }
}

export async function saveMirrorState(outDir: string, state: MirrorState): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "state.json"), JSON.stringify(state, null, 2), "utf8");
}
