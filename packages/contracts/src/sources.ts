/**
 * A reference-data source's policy record, from docs/architecture/README.md
 * ("Reference data: published releases"): what may be fetched, how hard,
 * what we keep and whether we may serve it on. The reviewed table of them
 * is SOURCE_POLICIES in packages/ingest/src/source-policies.ts; the
 * contract tests pin this schema to its type.
 *
 * Beyond the README's interface, a record lists `allowedUrlPrefixes`, the
 * URLs a server job may fetch, and a `description` for reviewers.
 */
import { z } from "zod";

/** "https://host/path/", ending in a slash so a prefix can't match a sibling path ("/data" would match "/database"). */
const urlPrefix = z
  .string()
  .max(2048)
  .regex(/^https:\/\/[a-z0-9.-]+(?::\d+)?\/(?:[^\s?#]*\/)?$/, "A URL prefix is an https URL that ends in a slash, without a query.");

/** A source's id, such as "vsb-untgrades": lowercase words joined by hyphens, up to 64 characters. Releases name their source with it. */
export const SourceIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'A source id is lowercase words joined by hyphens, like "vsb-untgrades".');

export const SourcePolicySchema = z
  .strictObject({
    sourceId: SourceIdSchema,
    description: z.string().min(1).max(500),
    acquisition: z.enum(["server", "browser-capture", "curated", "link-only"]),
    approval: z.enum(["allowed", "review-required", "disabled"]),
    retention: z.enum(["none", "ttl-cache", "versioned"]),
    redistribution: z.enum(["allowed", "restricted", "unverified"]),
    allowedUrlPrefixes: z.array(urlPrefix),
    minIntervalMs: z.int().min(0).nullable(),
    maxRequestsPerHour: z.int().min(1).nullable(),
    maxConcurrency: z.int().min(1),
    policyEvidenceUrl: z.url({ protocol: /^https$/ }).nullable(),
    policyCheckedAt: z.iso.date().nullable(),
  })
  .superRefine((policy, ctx) => {
    // Only a server job fetches, so only a server source may name URLs, and an allowed one must.
    if (policy.acquisition !== "server" && policy.allowedUrlPrefixes.length > 0) {
      ctx.addIssue({ code: "custom", path: ["allowedUrlPrefixes"], message: `A ${policy.acquisition} source is never fetched by a server, so it names no URLs.` });
    }
    if (policy.acquisition === "server" && policy.approval === "allowed" && policy.allowedUrlPrefixes.length === 0) {
      ctx.addIssue({ code: "custom", path: ["allowedUrlPrefixes"], message: "An allowed server source names the URLs it may fetch." });
    }
    if ((policy.policyEvidenceUrl === null) !== (policy.policyCheckedAt === null)) {
      ctx.addIssue({ code: "custom", path: ["policyCheckedAt"], message: "A policy page and the day it was read come together." });
    }
  });

export type SourcePolicy = z.output<typeof SourcePolicySchema>;
