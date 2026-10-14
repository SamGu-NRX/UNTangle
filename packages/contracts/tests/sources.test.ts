import { describe, expect, expectTypeOf, test } from "bun:test";
import type { z } from "zod";
import type { SourcePolicy } from "../../ingest/src/source-policies";
import { SourcePolicySchema } from "../src/sources";
import { decoded, rejections } from "./helpers";

const server: SourcePolicy = {
  sourceId: "vsb-untgrades",
  description: "UNT class search, as mirrored by vsb.untgrades.app.",
  acquisition: "server",
  approval: "allowed",
  retention: "versioned",
  redistribution: "unverified",
  allowedUrlPrefixes: ["https://vsb.untgrades.app/data/"],
  minIntervalMs: 900_000,
  maxRequestsPerHour: null,
  maxConcurrency: 1,
  policyEvidenceUrl: null,
  policyCheckedAt: null,
};

const linkOnly: SourcePolicy = {
  sourceId: "ratemyprofessors",
  description: "RateMyProfessors: a link only.",
  acquisition: "link-only",
  approval: "allowed",
  retention: "none",
  redistribution: "restricted",
  allowedUrlPrefixes: [],
  minIntervalMs: null,
  maxRequestsPerHour: null,
  maxConcurrency: 1,
  policyEvidenceUrl: null,
  policyCheckedAt: null,
};

/** A made-up source with a published policy page, for the paired fields. */
const curated: SourcePolicy = {
  ...linkOnly,
  sourceId: "example-degree-plans",
  description: "Degree plans curated from an institution's catalog pages.",
  acquisition: "curated",
  retention: "versioned",
  redistribution: "allowed",
  policyEvidenceUrl: "https://catalog.example.edu/terms",
  policyCheckedAt: "2026-10-14",
};

describe("SourcePolicySchema", () => {
  test.each([
    ["a server source", server],
    ["a link-only source", linkOnly],
    ["a curated source with a policy page", curated],
  ])("%s round-trips", (_name, policy) => {
    expect(decoded(SourcePolicySchema, policy)).toEqual(policy);
  });

  test("a source no server fetches names no URLs", () => {
    expect(rejections(SourcePolicySchema, { ...linkOnly, allowedUrlPrefixes: ["https://www.ratemyprofessors.com/"] })).toEqual([
      "allowedUrlPrefixes: A link-only source is never fetched by a server, so it names no URLs.",
    ]);
  });

  test("an allowed server source names the URLs it may fetch", () => {
    expect(rejections(SourcePolicySchema, { ...server, allowedUrlPrefixes: [] })).toEqual([
      "allowedUrlPrefixes: An allowed server source names the URLs it may fetch.",
    ]);
  });

  test.each([
    ["plain http", "http://vsb.untgrades.app/data/"],
    ["no trailing slash, which would also match /database", "https://vsb.untgrades.app/data"],
    ["a query", "https://vsb.untgrades.app/data/?term=spring-2027/"],
  ])("rejects a URL prefix with %s", (_why, prefix) => {
    expect(rejections(SourcePolicySchema, { ...server, allowedUrlPrefixes: [prefix] })).not.toEqual([]);
  });

  test("a policy page and the day it was read come together", () => {
    expect(rejections(SourcePolicySchema, { ...curated, policyCheckedAt: null })).toEqual([
      "policyCheckedAt: A policy page and the day it was read come together.",
    ]);
  });

  test("rejects an unknown field and a concurrency of zero", () => {
    expect(rejections(SourcePolicySchema, { ...server, robotsTxt: true })).toEqual([': Unrecognized key: "robotsTxt"']);
    expect(rejections(SourcePolicySchema, { ...server, maxConcurrency: 0 })).not.toEqual([]);
  });

  test("decodes to ingest's SourcePolicy", () => {
    expectTypeOf<z.output<typeof SourcePolicySchema>>().toEqualTypeOf<SourcePolicy>();
  });
});
