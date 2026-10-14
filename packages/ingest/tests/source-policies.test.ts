import { describe, expect, test } from "bun:test";
import { vsbUrl } from "../../../frontend/src/lib/sections/config";
import { SourcePolicySchema } from "../../contracts/src/sources";
import { SOURCE_POLICIES, sourcePolicy } from "../src/source-policies";

describe("SOURCE_POLICIES", () => {
  test.each(SOURCE_POLICIES.map((policy) => [policy.sourceId, policy] as const))("%s passes the contract", (_id, policy) => {
    expect(SourcePolicySchema.parse(policy)).toEqual(policy);
  });

  test("each source is listed once", () => {
    const ids = SOURCE_POLICIES.map((policy) => policy.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the class-search source allows exactly the files the app fetches today", () => {
    const policy = sourcePolicy("vsb-untgrades");
    expect(policy.allowedUrlPrefixes).toEqual(["https://vsb.untgrades.app/data/"]);
    for (const url of [vsbUrl("spring-2027"), vsbUrl("spring-2027", "MATH")]) {
      expect(policy.allowedUrlPrefixes.some((prefix) => url.startsWith(prefix))).toBe(true);
    }
  });

  test("a source with no policy throws", () => {
    expect(() => sourcePolicy("ratemyprofessors")).toThrow('No source policy for "ratemyprofessors"');
  });
});
