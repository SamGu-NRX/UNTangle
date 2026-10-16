/**
 * The reviewed table of reference-data sources: where each may be fetched
 * from, how hard, and what we keep (docs/architecture/README.md, "Reference
 * data: published releases"). It's checked in review and by tests; it is
 * not a runtime permission system.
 *
 * SourcePolicySchema in @untangle/contracts/sources is the same shape, and
 * its tests pin it to the type here.
 */

export type SourcePolicy = {
  sourceId: string;
  /** The institution whose data this source provides. */
  institutionId: string;
  /** What the source is, for a reviewer. */
  description: string;
  /** How we get it: a server job fetches it, a maintainer captures it in a browser, someone curates it by hand, or we only link to it. */
  acquisition: "server" | "browser-capture" | "curated" | "link-only";
  approval: "allowed" | "review-required" | "disabled";
  /** What we keep: nothing, a cache that expires, or versioned releases. */
  retention: "none" | "ttl-cache" | "versioned";
  /** Whether we may serve what we keep to others. */
  redistribution: "allowed" | "restricted" | "unverified";
  /** What a server job may fetch: URLs starting with one of these. Empty for every source a server never fetches. */
  allowedUrlPrefixes: string[];
  /** The least time between two fetches of one URL; null when there is no floor. */
  minIntervalMs: number | null;
  /** Fetches per hour across all of the source's URLs; null when no cap beyond the interval applies. */
  maxRequestsPerHour: number | null;
  maxConcurrency: number;
  /** The page that states the source's terms, and the day we read it; both null when the source publishes none. */
  policyEvidenceUrl: string | null;
  policyCheckedAt: string | null;
};

/** A policy as the table hands it out: frozen, down to its URL list. */
export type ReviewedSourcePolicy = Readonly<Omit<SourcePolicy, "allowedUrlPrefixes">> & { readonly allowedUrlPrefixes: readonly string[] };

/** Freezes each policy and its URL list, so no caller can loosen a reviewed record for the rest of the process. */
function reviewed(policies: SourcePolicy[]): readonly ReviewedSourcePolicy[] {
  return Object.freeze(policies.map((policy) => Object.freeze({ ...policy, allowedUrlPrefixes: Object.freeze([...policy.allowedUrlPrefixes]) })));
}

export const SOURCE_POLICIES: readonly ReviewedSourcePolicy[] = reviewed([
  {
    sourceId: "vsb-untgrades",
    institutionId: "unt",
    description:
      "UNT class search, as scraped and published per term by the volunteer mirror at vsb.untgrades.app (schema v2 term and subject files). The app reads it today through frontend/src/lib/sections/proxy.ts.",
    acquisition: "server",
    // In production use today. Its operator's limits and redistribution
    // terms aren't established (README, "Reference data"), so releases built
    // from it are served only through /api/v1, never as public files.
    approval: "allowed",
    retention: "versioned",
    redistribution: "unverified",
    allowedUrlPrefixes: ["https://vsb.untgrades.app/data/"],
    // The README's 15-minute starting interval per term file, the same TTL
    // the proxy uses. A starting value; nothing was measured.
    minIntervalMs: 15 * 60_000,
    // Four requests per hour across all URLs preserves the single-term
    // 15-minute budget when jobs fetch multiple terms or subjects. This is
    // a conservative starting cap, not a measured or operator-published limit.
    maxRequestsPerHour: 4,
    maxConcurrency: 1,
    policyEvidenceUrl: null,
    policyCheckedAt: null,
  },
  {
    sourceId: "catalog-utexas",
    institutionId: "ut-austin",
    description:
      "UT Austin undergraduate catalog course pages, one page per field of study (catalog.utexas.edu/courses/<field-of-study>/), Courseleaf-published static HTML. Parsed from saved copies by packages/ingest/src/ut-austin/catalog.ts; the access-rule research is docs/research/ut-austin/README.md.",
    acquisition: "server",
    // Public, unauthenticated pages. The host published no robots.txt on
    // 2026-10-15 (the path returned the site's 404 page) and no terms page
    // governs the course pages, so policy evidence stays null and pacing is
    // self-imposed. Redistribution of the parsed records is unverified:
    // catalog text is UT Austin's publication, so releases built from it
    // should be served through /api/v1 like the VSB mirror's.
    approval: "allowed",
    retention: "versioned",
    redistribution: "unverified",
    allowedUrlPrefixes: ["https://catalog.utexas.edu/courses/"],
    // One page per field of study, a few hundred pages in all, captured
    // about twice a year per catalog edition. Three seconds between fetches
    // matches the capture used for the first fixtures; nothing was measured.
    minIntervalMs: 3_000,
    maxRequestsPerHour: 60,
    maxConcurrency: 1,
    policyEvidenceUrl: null,
    policyCheckedAt: null,
  },
  {
    sourceId: "unt-registrar-exams",
    institutionId: "unt",
    description:
      "UNT Office of the Registrar final-exam schedule pages, one per term (registrar.unt.edu/exams/final-exam-schedule/fall.html, spring.html, summer.html), static HTML. Parsed from saved copies by packages/ingest/src/exam-schedule.ts; capture notes are in packages/ingest/tests/fixtures/unt-exams/SOURCES.md.",
    acquisition: "server",
    // Public, unauthenticated pages. robots.txt (read 2026-10-16) allows
    // /exams/, and no terms page governs them, so policy evidence stays null
    // and pacing is self-imposed. The schedule is UNT's publication, so
    // redistribution is unverified, as for the class-search mirror.
    approval: "allowed",
    retention: "versioned",
    redistribution: "unverified",
    allowedUrlPrefixes: ["https://registrar.unt.edu/exams/final-exam-schedule/"],
    // A handful of pages, captured once when a term's schedule is published.
    // Three seconds between fetches matches the first capture; nothing was measured.
    minIntervalMs: 3_000,
    maxRequestsPerHour: 20,
    maxConcurrency: 1,
    policyEvidenceUrl: null,
    policyCheckedAt: null,
  },
]);

/** The policy for `sourceId`. Throws when the table has none, so a job can't fetch from an unreviewed source. */
export function sourcePolicy(sourceId: string): ReviewedSourcePolicy {
  const policy = SOURCE_POLICIES.find((entry) => entry.sourceId === sourceId);
  if (!policy) throw new Error(`No source policy for "${sourceId}". Add one to packages/ingest/src/source-policies.ts and have it reviewed.`);
  return policy;
}
