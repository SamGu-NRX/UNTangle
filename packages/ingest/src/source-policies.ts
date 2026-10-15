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
    // The mirror publishes no rate limit. One request at a time and the
    // interval above are the whole budget.
    maxRequestsPerHour: null,
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
